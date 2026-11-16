import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HelperProgress } from '../shared/helper'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createSubjectImages, type GeneratedImage, type SubjectGenerator, type SubjectGeneratorRequest } from './subject-images'
import { createTrackLibrary, type TrackLibrary } from './tracks'

let dir: string
let db: SuiteDatabase
let tracks: TrackLibrary
let removed: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  tracks = createTrackLibrary(db)
  removed = []
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Stands in for the helper's image model: each image waits until the test lets it finish. */
function stubGenerator() {
  const calls: SubjectGeneratorRequest[] = []
  const pending: { progress: (p: HelperProgress) => void; finish: () => void; fail: (e: Error) => void }[] = []
  let nextSeed = 100
  const generator: SubjectGenerator = (request, onProgress) => {
    calls.push(request)
    return new Promise<GeneratedImage>((resolve, reject) => {
      pending.push({
        progress: onProgress,
        finish: () =>
          resolve({ seed: request.seed ?? nextSeed++, model: 'black-forest-labs/FLUX.2-klein-4B', width: 1024, height: 1024, seconds: 6.4 }),
        fail: reject
      })
    })
  }
  /** Lets the image the generator is on finish, then waits for the store to take it in. */
  const finishNext = async () => {
    while (pending.length === 0) await tick()
    pending.shift()!.finish()
    await tick()
  }
  const failNext = async (message: string) => {
    while (pending.length === 0) await tick()
    pending.shift()!.fail(new Error(message))
    await tick()
  }
  const reportNext = async (p: HelperProgress) => {
    while (pending.length === 0) await tick()
    pending[0]!.progress(p)
  }
  return { generator, calls, finishNext, failNext, reportNext, pending }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function setup() {
  const stub = stubGenerator()
  const images = createSubjectImages({ db, tracks, generator: stub.generator, root: '/elynt/subjects', removeFile: (f) => removed.push(f) })
  const track = tracks.addFromMixdown('D:\\Bounces\\SUPERFLY.wav')
  return { stub, images, track }
}

const MECHA = { motif: 'a chrome mecha', ground: 'black' as const, palette: ['#ff2bd6', '#00e5ff', '#f2ff00'] }

describe('subject images', () => {
  it("generates options for a track's Subject layer and keeps them, with how long each took", async () => {
    const { stub, images, track } = setup()

    const generating = images.generate(track.id, MECHA, 2)
    await stub.finishNext()
    await stub.finishNext()
    const made = await generating

    expect(made.map((i) => [i.motif, i.ground, i.seed, i.seconds])).toEqual([
      ['a chrome mecha', 'black', 100, 6.4],
      ['a chrome mecha', 'black', 101, 6.4]
    ])
    expect(made[0]!.prompt).toMatch(/^a chrome mecha, .*#ff2bd6/)
    expect(stub.calls[0]!.prompt).toBe(made[0]!.prompt)
    // Each image goes to its own file under the track's folder.
    expect(made[0]!.path).toBe(stub.calls[0]!.outPath)
    expect(made[0]!.path.startsWith(join('/elynt/subjects', String(track.id)))).toBe(true)
    expect(made[0]!.path).not.toBe(made[1]!.path)
    expect(images.list(track.id)).toEqual(made)
  })

  it('shows progress image by image, then clears the job', async () => {
    const { stub, images, track } = setup()
    const generating = images.generate(track.id, MECHA, 2)

    await stub.reportNext({ stage: 'Generating', fraction: 0.5 })
    expect(images.jobs()).toEqual([{ trackId: track.id, state: 'running', stage: 'Generating', fraction: 0.5, image: 1, of: 2 }])
    await stub.finishNext()
    expect(images.jobs()).toMatchObject([{ image: 2, of: 2 }])
    await stub.finishNext()
    await generating

    expect(images.jobs()).toEqual([])
  })

  it('keeps the images made before a failure, and shows the failure', async () => {
    const { stub, images, track } = setup()
    const generating = images.generate(track.id, MECHA, 3)

    await stub.finishNext()
    await stub.failNext("the image model isn't installed")

    await expect(generating).rejects.toThrow(/isn't installed/)
    expect(images.list(track.id)).toHaveLength(1)
    expect(images.jobs()).toEqual([{ trackId: track.id, state: 'failed', message: "the image model isn't installed" }])
    expect(stub.calls).toHaveLength(2)
  })

  it('regenerating an option makes a new one from the same motif with a fresh seed, keeping the old', async () => {
    const { stub, images, track } = setup()
    const first = images.generate(track.id, MECHA, 1)
    await stub.finishNext()
    const [old] = await first

    const again = images.regenerate(old!.id)
    await stub.finishNext()
    const fresh = await again

    expect(stub.calls[1]).toMatchObject({ prompt: old!.prompt })
    expect(stub.calls[1]!.seed).toBeUndefined()
    expect(fresh).toMatchObject({ motif: old!.motif, ground: old!.ground, prompt: old!.prompt, seed: 101 })
    expect(images.list(track.id).map((i) => i.id)).toEqual([old!.id, fresh.id])
  })

  it('removing an option deletes its file', async () => {
    const { stub, images, track } = setup()
    const generating = images.generate(track.id, MECHA, 2)
    await stub.finishNext()
    await stub.finishNext()
    const [a, b] = await generating

    images.remove(a!.id)

    expect(images.list(track.id)).toEqual([b])
    expect(removed).toEqual([a!.path])
  })

  it('serves only the files it generated', async () => {
    const { stub, images, track } = setup()
    const generating = images.generate(track.id, MECHA, 1)
    await stub.finishNext()
    const [image] = await generating

    expect(images.isKnownPath(image!.path)).toBe(true)
    expect(images.isKnownPath('C:\\Windows\\win.ini')).toBe(false)
    images.remove(image!.id)
    expect(images.isKnownPath(image!.path)).toBe(false)
  })

  it('runs one image at a time, across tracks', async () => {
    const { stub, images, track } = setup()
    const other = tracks.addFromMixdown('D:\\Bounces\\flip.wav')

    const a = images.generate(track.id, MECHA, 1)
    const b = images.generate(other.id, { motif: 'a sigil', ground: 'off-white' }, 1)
    await tick()
    expect(stub.pending).toHaveLength(1)
    await stub.finishNext()
    await stub.finishNext()

    expect((await a).map((i) => i.trackId)).toEqual([track.id])
    expect((await b).map((i) => i.trackId)).toEqual([other.id])
  })

  it('refuses a track it does not know, and a motif left blank', () => {
    const { images, track } = setup()

    expect(() => images.generate(999, MECHA, 1)).toThrow(/No track/)
    expect(() => images.generate(track.id, { motif: ' ', ground: 'black' }, 1)).toThrow(/motif/)
  })
})
