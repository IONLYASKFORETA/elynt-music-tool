import { rmSync } from 'node:fs'
import type { HelperProgress } from '../shared/helper'
import type { SplitJob, Stem, StemSource } from '../shared/stems'
import type { Track } from '../shared/track'
import type { SuiteDatabase } from './db/database'
import type { TrackLibrary } from './tracks'

/** What a split hands back: stems written to disk, with paths as the app sees them. */
export interface SplitResult {
  stems: { name: string; path: string }[]
  model: string
  /** The folder the split wrote into. It is deleted when the owner's own stems replace the set. */
  folder: string
}

/** Splits a mixdown into stems. The real one calls the Python helper; tests pass a stub. */
export type StemSplitter = (track: Track, onProgress: (progress: HelperProgress) => void) => Promise<SplitResult>

export interface TrackStems {
  /** Every stem of a track: either all the owner's own or all AI-split, never a mix. */
  list(trackId: number): Stem[]
  /** Only the owner's own bounces. The Mix & Master Assistant reads stems through this. */
  ownStems(trackId: number): Stem[]
  /**
   * Attaches the owner's own stems. Own stems always win: this drops a split set (and its files),
   * and if a split is running, its result is thrown away when it finishes.
   * Picking a file the track already has does nothing.
   */
  attachOwn(trackId: number, paths: string[]): Stem[]
  /** Takes one of the owner's own stems off the track. The file stays on disk. */
  removeOwn(stemId: number): void
  /**
   * Splits the mixdown if the track has no stems yet, and resolves to the track's stems.
   * A track that already has stems is left alone. Calling it again mid-split joins that split.
   */
  split(trackId: number): Promise<Stem[]>
  /** The running or failed split of each track. A track with none has finished or never split. */
  jobs(): SplitJob[]
  /** Calls back whenever a split starts, reports progress, finishes or fails. */
  onJob(listener: (job: SplitJob | { trackId: number; state: 'done' }) => void): () => void
}

interface StemRow {
  id: number
  track_id: number
  name: string
  path: string
  source: StemSource
  model: string | null
  added_at: string
}

export function createTrackStems(options: {
  db: SuiteDatabase
  tracks: TrackLibrary
  splitter: StemSplitter
  /** Deletes a split's folder. Defaults to removing it from disk. */
  removeFolder?: (folder: string) => void
}): TrackStems {
  const { db, tracks, splitter } = options
  const removeFolder = options.removeFolder ?? ((folder: string) => rmSync(folder, { recursive: true, force: true }))

  const byTrack = db.prepare('SELECT * FROM stems WHERE track_id = ? ORDER BY id')
  const bySource = db.prepare('SELECT * FROM stems WHERE track_id = ? AND source = ? ORDER BY id')
  const insert = db.prepare(
    'INSERT INTO stems (track_id, name, path, source, model, added_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (track_id, path) DO NOTHING'
  )
  const deleteSplit = db.prepare("DELETE FROM stems WHERE track_id = ? AND source = 'split'")
  const deleteOwn = db.prepare("DELETE FROM stems WHERE id = ? AND source = 'own'")

  const splitPaths = db.prepare("SELECT path FROM stems WHERE track_id = ? AND source = 'split'")

  const running = new Map<number, Promise<Stem[]>>()
  const jobs = new Map<number, SplitJob>()
  const listeners = new Set<(job: SplitJob | { trackId: number; state: 'done' }) => void>()

  const emit = (job: SplitJob | { trackId: number; state: 'done' }) => {
    if (job.state === 'done') jobs.delete(job.trackId)
    else jobs.set(job.trackId, job)
    for (const listener of listeners) listener(job)
  }

  const list = (trackId: number) => (byTrack.all(trackId) as unknown as StemRow[]).map(toStem)
  const requireTrack = (trackId: number) => {
    const track = tracks.get(trackId)
    if (!track) throw new Error(`No track with id ${trackId}`)
    return track
  }

  const dropSplitSet = (trackId: number) => {
    // A split writes all its stems into one folder of its own, so the folder goes with them.
    const folder = commonFolder((splitPaths.all(trackId) as { path: string }[]).map((r) => r.path))
    deleteSplit.run(trackId)
    if (folder) removeFolder(folder)
  }

  const runSplit = async (track: Track): Promise<Stem[]> => {
    emit({ trackId: track.id, state: 'running', stage: 'Starting' })
    let result: SplitResult
    try {
      result = await splitter(track, (p) => emit({ trackId: track.id, state: 'running', stage: p.stage, fraction: p.fraction }))
    } catch (error) {
      emit({ trackId: track.id, state: 'failed', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
    // The owner attached their own stems while this ran. Theirs win: throw the split away.
    if (list(track.id).length > 0) {
      removeFolder(result.folder)
    } else {
      const now = new Date().toISOString()
      db.exec('BEGIN')
      try {
        for (const stem of result.stems) insert.run(track.id, stem.name, stem.path, 'split', result.model, now)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    emit({ trackId: track.id, state: 'done' })
    return list(track.id)
  }

  return {
    list,
    ownStems: (trackId) => (bySource.all(trackId, 'own') as unknown as StemRow[]).map(toStem),
    attachOwn(trackId, paths) {
      requireTrack(trackId)
      const now = new Date().toISOString()
      db.exec('BEGIN')
      try {
        if (paths.length > 0) dropSplitSet(trackId)
        for (const path of paths) insert.run(trackId, titleFromFileName(path), path, 'own', null, now)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return list(trackId)
    },
    removeOwn(stemId) {
      deleteOwn.run(stemId)
    },
    split(trackId) {
      const track = requireTrack(trackId)
      const inFlight = running.get(trackId)
      if (inFlight) return inFlight
      const existing = list(trackId)
      if (existing.length > 0) return Promise.resolve(existing)
      const job = runSplit(track).finally(() => running.delete(trackId))
      running.set(trackId, job)
      return job
    },
    jobs: () => [...jobs.values()],
    onJob(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/** The folder all of a split's stems sit in, or null if they don't share one. */
function commonFolder(paths: string[]): string | null {
  const folders = new Set(paths.map((p) => p.replace(/[\\/][^\\/]*$/, '')))
  return folders.size === 1 ? [...folders][0]! : null
}

/** "D:\\Bounces\\SUPERFLY Kick.wav" -> "SUPERFLY Kick". */
function titleFromFileName(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

function toStem(row: StemRow): Stem {
  return {
    id: row.id,
    trackId: row.track_id,
    name: row.name,
    path: row.path,
    source: row.source,
    ...(row.model ? { model: row.model } : {}),
    addedAt: row.added_at
  }
}
