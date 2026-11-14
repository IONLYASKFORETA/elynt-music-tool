import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HelperProgress } from '../shared/helper'
import type { Track } from '../shared/track'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createTrackStems, type SplitResult, type StemSplitter } from './stems'
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

/** A splitter that waits until the test lets it finish, so a test can act mid-split. */
function stubSplitter() {
  const calls: Track[] = []
  let progress!: (p: HelperProgress) => void
  let finish!: (r: SplitResult) => void
  let fail!: (e: Error) => void
  const splitter: StemSplitter = (track, onProgress) => {
    calls.push(track)
    progress = onProgress
    return new Promise((resolve, reject) => {
      finish = resolve
      fail = reject
    })
  }
  const folder = 'C:\\Elynt\\stems\\1\\split-1'
  const result: SplitResult = {
    folder,
    model: 'BS-Roformer-SW.ckpt',
    stems: ['drums', 'bass', 'other'].map((name) => ({ name, path: `${folder}\\${name}.wav` }))
  }
  return {
    splitter,
    calls,
    report: (p: HelperProgress) => progress(p),
    finish: () => finish(result),
    fail: (message: string) => fail(new Error(message)),
    folder
  }
}

function setup() {
  const stub = stubSplitter()
  const stems = createTrackStems({ db, tracks, splitter: stub.splitter, removeFolder: (f) => removed.push(f) })
  const track = tracks.addFromMixdown('D:\\Bounces\\SUPERFLY.wav')
  return { stub, stems, track }
}

describe('track stems', () => {
  it('splits a track with no stems, marking each stem as AI-split', async () => {
    const { stub, stems, track } = setup()

    const splitting = stems.split(track.id)
    stub.finish()
    const result = await splitting

    expect(result.map((s) => [s.name, s.source])).toEqual([
      ['drums', 'split'],
      ['bass', 'split'],
      ['other', 'split']
    ])
    expect(result[0]).toMatchObject({ trackId: track.id, path: `${stub.folder}\\drums.wav`, model: 'BS-Roformer-SW.ckpt' })
    expect(stems.list(track.id)).toEqual(result)
  })

  it("stores the owner's own stems as file paths, named after the file", () => {
    const { stems, track } = setup()

    const own = stems.attachOwn(track.id, ['D:\\Bounces\\SUPERFLY Kick.wav', 'D:\\Bounces\\SUPERFLY Bass.wav'])

    expect(own.map((s) => [s.name, s.path, s.source])).toEqual([
      ['SUPERFLY Kick', 'D:\\Bounces\\SUPERFLY Kick.wav', 'own'],
      ['SUPERFLY Bass', 'D:\\Bounces\\SUPERFLY Bass.wav', 'own']
    ])
  })

  it("own stems replace a split set, and the split's files are deleted", async () => {
    const { stub, stems, track } = setup()
    const splitting = stems.split(track.id)
    stub.finish()
    await splitting

    const after = stems.attachOwn(track.id, ['D:\\Bounces\\SUPERFLY Kick.wav'])

    expect(after.map((s) => s.source)).toEqual(['own'])
    expect(removed).toEqual([stub.folder])
  })

  it('own stems attached mid-split win: the split result is thrown away when it lands', async () => {
    const { stub, stems, track } = setup()
    const splitting = stems.split(track.id)

    stems.attachOwn(track.id, ['D:\\Bounces\\SUPERFLY Kick.wav'])
    stub.finish()
    const result = await splitting

    expect(result.map((s) => [s.name, s.source])).toEqual([['SUPERFLY Kick', 'own']])
    expect(stems.list(track.id)).toEqual(result)
    expect(removed).toEqual([stub.folder])
  })

  it('never splits a track that already has its own stems', async () => {
    const { stub, stems, track } = setup()
    stems.attachOwn(track.id, ['D:\\Bounces\\SUPERFLY Kick.wav'])

    const result = await stems.split(track.id)

    expect(stub.calls).toEqual([])
    expect(result.map((s) => s.source)).toEqual(['own'])
  })

  it('a second split request joins the one running', async () => {
    const { stub, stems, track } = setup()
    const first = stems.split(track.id)
    const second = stems.split(track.id)
    stub.finish()

    expect(await second).toEqual(await first)
    expect(stub.calls).toHaveLength(1)
  })

  it('reports progress, then clears the job when done', async () => {
    const { stub, stems, track } = setup()
    const seen: string[] = []
    stems.onJob((job) => seen.push(job.state === 'running' ? `${job.stage} ${job.fraction ?? ''}`.trim() : job.state))

    const splitting = stems.split(track.id)
    stub.report({ stage: 'Splitting', fraction: 0.5 })
    expect(stems.jobs()).toEqual([{ trackId: track.id, state: 'running', stage: 'Splitting', fraction: 0.5 }])
    stub.finish()
    await splitting

    expect(seen).toEqual(['Starting', 'Splitting 0.5', 'done'])
    expect(stems.jobs()).toEqual([])
  })

  it('keeps a failed split visible, and a retry can start a new one', async () => {
    const { stub, stems, track } = setup()
    const splitting = stems.split(track.id)
    stub.fail('the stem splitter isn\'t installed')
    await expect(splitting).rejects.toThrow(/isn't installed/)
    expect(stems.jobs()).toEqual([{ trackId: track.id, state: 'failed', message: "the stem splitter isn't installed" }])

    const retry = stems.split(track.id)
    stub.finish()
    expect(await retry).toHaveLength(3)
    expect(stub.calls).toHaveLength(2)
  })

  it('ownStems gives other tools only real bounces, never AI-split stems', async () => {
    const { stub, stems, track } = setup()
    const splitting = stems.split(track.id)
    stub.finish()
    await splitting

    expect(stems.list(track.id)).toHaveLength(3)
    expect(stems.ownStems(track.id)).toEqual([])
  })

  it('removing an own stem takes it off the track', () => {
    const { stems, track } = setup()
    const [kick] = stems.attachOwn(track.id, ['D:\\Bounces\\SUPERFLY Kick.wav', 'D:\\Bounces\\SUPERFLY Bass.wav'])

    stems.removeOwn(kick!.id)

    expect(stems.list(track.id).map((s) => s.name)).toEqual(['SUPERFLY Bass'])
  })

  it('picking a stem file the track already has (in any letter case) adds nothing', () => {
    const { stems, track } = setup()
    stems.attachOwn(track.id, ['D:\\Bounces\\SUPERFLY Kick.wav'])

    const after = stems.attachOwn(track.id, ['d:\\bounces\\superfly kick.WAV'])

    expect(after).toHaveLength(1)
  })
})
