import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { HelperProgress } from '../shared/helper'
import { subjectPrompt, type SubjectGround, type SubjectImage, type SubjectImageRequest, type SubjectJob } from '../shared/subject-images'
import type { SuiteDatabase } from './db/database'
import type { TrackLibrary } from './tracks'

export interface SubjectGeneratorRequest {
  prompt: string
  /** Where to write the PNG, as the app sees it. */
  outPath: string
  /** Left out for a fresh image: the helper picks one and reports it. */
  seed?: number
}

/** What the model hands back for one image. */
export interface GeneratedImage {
  seed: number
  model: string
  width: number
  height: number
  seconds: number
}

/** Makes one image. The real one calls the Python helper's image.generate; tests pass a stub. */
export type SubjectGenerator = (request: SubjectGeneratorRequest, onProgress: (progress: HelperProgress) => void) => Promise<GeneratedImage>

export type SubjectJobEvent = SubjectJob | { trackId: number; state: 'done' }

export interface SubjectImages {
  /** A track's generated options, oldest first. */
  list(trackId: number): SubjectImage[]
  /**
   * Generates `count` options of one motif for a track, one image after another, and resolves to
   * the new ones. Images queue across tracks: the GPU makes one at a time. If one fails, the ones
   * made before it are kept.
   */
  generate(trackId: number, request: SubjectImageRequest, count: number): Promise<SubjectImage[]>
  /** A new option from the same prompt with a fresh seed. The old one stays until removed. */
  regenerate(imageId: number): Promise<SubjectImage>
  /** Drops an option and deletes its file. */
  remove(imageId: number): void
  /** True only for a file this store generated and still holds: the media scheme serves nothing else. */
  isKnownPath(path: string): boolean
  jobs(): SubjectJob[]
  onJob(listener: (job: SubjectJobEvent) => void): () => void
}

interface Row {
  id: number
  track_id: number
  motif: string
  ground: SubjectGround
  prompt: string
  path: string
  seed: number
  model: string
  width: number
  height: number
  seconds: number
  created_at: string
}

export function createSubjectImages(options: {
  db: SuiteDatabase
  tracks: TrackLibrary
  generator: SubjectGenerator
  /** The folder images go in, one subfolder per track. */
  root: string
  /** Deletes an image's file. Defaults to removing it from disk. */
  removeFile?: (path: string) => void
}): SubjectImages {
  const { db, tracks, generator, root } = options
  const removeFile = options.removeFile ?? ((path: string) => rmSync(path, { force: true }))

  const byTrack = db.prepare('SELECT * FROM subject_images WHERE track_id = ? ORDER BY id')
  const byId = db.prepare('SELECT * FROM subject_images WHERE id = ?')
  const byPath = db.prepare('SELECT id FROM subject_images WHERE path = ?')
  const insert = db.prepare(
    `INSERT INTO subject_images (track_id, motif, ground, prompt, path, seed, model, width, height, seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  )
  const deleteRow = db.prepare('DELETE FROM subject_images WHERE id = ?')

  const jobs = new Map<number, SubjectJob>()
  const listeners = new Set<(job: SubjectJobEvent) => void>()
  const emit = (job: SubjectJobEvent) => {
    if (job.state === 'done') jobs.delete(job.trackId)
    else jobs.set(job.trackId, job)
    for (const listener of listeners) listener(job)
  }

  // One image at a time, whichever track asked: the helper's GPU would only queue them anyway,
  // and this way each job's progress is its own.
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)
    queue = run.catch(() => undefined)
    return run
  }

  // Unique within this run; the timestamp keeps names apart across runs.
  let counter = 0
  const outPathFor = (trackId: number) => join(root, String(trackId), `subject-${Date.now()}-${++counter}.png`)

  const makeOne = async (
    trackId: number,
    motif: string,
    ground: SubjectGround,
    prompt: string,
    position: { image: number; of: number }
  ): Promise<SubjectImage> => {
    emit({ trackId, state: 'running', stage: 'Starting', ...position })
    const outPath = outPathFor(trackId)
    const made = await generator({ prompt, outPath }, (p) =>
      emit({ trackId, state: 'running', stage: p.stage, ...(p.fraction === undefined ? {} : { fraction: p.fraction }), ...position })
    )
    const row = insert.get(
      trackId, motif, ground, prompt, outPath, made.seed, made.model, made.width, made.height, made.seconds, new Date().toISOString()
    ) as unknown as Row
    return toImage(row)
  }

  const run = async (trackId: number, makeAll: () => Promise<SubjectImage[]>): Promise<SubjectImage[]> => {
    try {
      const made = await makeAll()
      emit({ trackId, state: 'done' })
      return made
    } catch (error) {
      emit({ trackId, state: 'failed', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  return {
    list: (trackId) => (byTrack.all(trackId) as unknown as Row[]).map(toImage),
    generate(trackId, request, count) {
      if (!tracks.get(trackId)) throw new Error(`No track with id ${trackId}`)
      const prompt = subjectPrompt(request)
      const motif = request.motif.trim()
      const of = Math.max(1, Math.floor(count))
      return enqueue(() =>
        run(trackId, async () => {
          const made: SubjectImage[] = []
          for (let image = 1; image <= of; image++) made.push(await makeOne(trackId, motif, request.ground, prompt, { image, of }))
          return made
        })
      )
    },
    async regenerate(imageId) {
      const row = byId.get(imageId) as unknown as Row | undefined
      if (!row) throw new Error(`No subject image with id ${imageId}`)
      const [made] = await enqueue(() =>
        run(row.track_id, async () => [await makeOne(row.track_id, row.motif, row.ground, row.prompt, { image: 1, of: 1 })])
      )
      return made!
    },
    remove(imageId) {
      const row = byId.get(imageId) as unknown as Row | undefined
      if (!row) return
      deleteRow.run(imageId)
      removeFile(row.path)
    },
    isKnownPath: (path) => byPath.get(path) !== undefined,
    jobs: () => [...jobs.values()],
    onJob(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

function toImage(row: Row): SubjectImage {
  return {
    id: row.id,
    trackId: row.track_id,
    motif: row.motif,
    ground: row.ground,
    prompt: row.prompt,
    path: row.path,
    seed: row.seed,
    model: row.model,
    width: row.width,
    height: row.height,
    seconds: row.seconds,
    createdAt: row.created_at
  }
}
