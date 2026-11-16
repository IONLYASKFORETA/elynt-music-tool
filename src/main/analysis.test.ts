import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MoodDetail, TrackAnalysis, TrackAnalysisState } from '../shared/analysis'
import type { HelperStatus } from '../shared/helper'
import { createAnalysisQueue, createTrackAnalysisStore, type AnalysisHelper } from './analysis'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { HelperCallError } from './helper/client'
import { createTrackLibrary, type TrackLibrary } from './tracks'

let dir: string
let db: SuiteDatabase
let tracks: TrackLibrary

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  tracks = createTrackLibrary(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function analysisFor(bpm: number): TrackAnalysis {
  return {
    analyzerVersion: 1,
    durationSeconds: 72,
    bpm,
    beatsPerBar: 4,
    beats: [0.5, 0.95],
    downbeats: [0.5],
    beatSource: 'dsp',
    constantTempo: true,
    sections: [
      { label: 'intro', start: 0, end: 14.3, startBar: 0, confidence: 0.9, source: 'heuristic' },
      { label: 'build', start: 14.3, end: 42.95, startBar: 8, confidence: 0.9, source: 'heuristic' },
      { label: 'drop', start: 42.95, end: 72, startBar: 24, confidence: 1, source: 'heuristic' }
    ],
    energy: { hz: 10, values: [0, 0.5, 1] },
    mood: { label: 'euphoric', arousal: 0.3, valence: 0.5, key: 'C major', keyConfidence: 0.9, source: 'heuristic' },
    notes: [],
    seconds: 0.2
  }
}

/** A stand-in helper: answers track.analyze from a script, and can go up and down. */
function fakeHelper(answer: (path: string) => Promise<TrackAnalysis>) {
  let status: HelperStatus = { state: 'running', mode: 'native', restarts: 0 }
  const listeners = new Set<(s: HelperStatus) => void>()
  const calls: string[] = []
  const helper: AnalysisHelper = {
    status: () => status,
    onStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async call(method, params) {
      if (status.state !== 'running') throw new HelperCallError('not_running', 'down')
      expect(method).toBe('track.analyze')
      const path = (params as { path: string }).path
      calls.push(path)
      return (await answer(path)) as never
    },
    toHelperPath: (p) => p.replace(/^D:\\/, '/mnt/d/').replaceAll('\\', '/')
  }
  const setState = (state: HelperStatus['state']) => {
    status = { ...status, state }
    for (const l of listeners) l(status)
  }
  return { helper, calls, setState }
}

describe('track analysis store', () => {
  it('keeps the last result while a re-run is queued, and survives a reopen', () => {
    const store = createTrackAnalysisStore(db)
    const track = tracks.addFromMixdown('D:\\Bounces\\flip.wav')

    expect(store.get(track.id)).toBeNull()
    store.markPending(track.id)
    store.saveResult(track.id, analysisFor(134.14))
    store.markPending(track.id)

    const state = store.get(track.id)!
    expect(state.status).toBe('pending')
    expect(state.analysis?.bpm).toBe(134.14)
    expect(state.analyzedAt).not.toBeNull()

    db.close()
    db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
    expect(createTrackAnalysisStore(db).get(track.id)?.analysis?.sections.map((s) => s.label)).toEqual(['intro', 'build', 'drop'])
  })

  it('lists queued tracks oldest first and never-analysed tracks', () => {
    let t = 0
    const store = createTrackAnalysisStore(db, () => new Date(Date.UTC(2026, 10, 14, 12, 0, t++)))
    const a = tracks.addFromMixdown('/m/a.wav')
    const b = tracks.addFromMixdown('/m/b.wav')
    const c = tracks.addFromMixdown('/m/c.wav')

    store.markPending(b.id)
    store.markPending(a.id)

    expect(store.pending()).toEqual([b.id, a.id])
    expect(store.unanalysed()).toEqual([c.id])
  })
})

describe('"What I heard" check on the store', () => {
  it("saves the owner's corrections over the heard analysis, so every tool reads them, and they survive a reopen", () => {
    const store = createTrackAnalysisStore(db, () => new Date('2026-11-16T10:00:00Z'))
    const track = tracks.addFromMixdown('/m/flip.wav')
    store.markPending(track.id)
    store.saveResult(track.id, analysisFor(134))
    expect(store.get(track.id)?.check).toBe('unchecked')

    const fixed = analysisFor(128)
    fixed.sections[1] = { ...fixed.sections[1]!, label: 'breakdown', source: 'owner', confidence: 1 }
    const saved = store.saveCorrection(track.id, fixed)

    expect(saved).toMatchObject({ status: 'done', check: 'confirmed', checkedAt: '2026-11-16T10:00:00.000Z' })
    db.close()
    db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
    const reread = createTrackAnalysisStore(db).get(track.id)!
    expect(reread.analysis?.bpm).toBe(128)
    expect(reread.analysis?.sections.map((s) => s.label)).toEqual(['intro', 'breakdown', 'drop'])
    expect(reread.check).toBe('confirmed')
  })

  it('keeps a mood listen and the corrections whichever lands first', () => {
    const store = createTrackAnalysisStore(db)
    const track = tracks.addFromMixdown('/m/flip.wav')
    store.markPending(track.id)
    store.saveResult(track.id, analysisFor(134))
    const detail: MoodDetail = { source: 'gemini', model: 'gemini-3.1-flash-lite', label: 'dark', arousal: 0.8, valence: -0.4, words: ['cold'], summary: 'Cold.', sections: [] }

    // The owner corrects first; the mood listen arrives after and must not undo the check.
    store.saveCorrection(track.id, analysisFor(128))
    const afterMood = store.saveMoodDetail(track.id, detail)
    expect(afterMood.check).toBe('confirmed')
    expect(afterMood.analysis?.bpm).toBe(128)
    expect(afterMood.analysis?.moodDetail).toEqual(detail)

    // A correction made from a check opened before the mood came back keeps the stored mood.
    const again = store.saveCorrection(track.id, analysisFor(130))
    expect(again.analysis?.bpm).toBe(130)
    expect(again.analysis?.moodDetail).toEqual(detail)
  })

  it('records a skipped check without touching the analysis', () => {
    const store = createTrackAnalysisStore(db)
    const track = tracks.addFromMixdown('/m/flip.wav')
    store.markPending(track.id)
    store.saveResult(track.id, analysisFor(134))

    const skipped = store.skipCheck(track.id)

    expect(skipped.check).toBe('skipped')
    expect(skipped.analysis?.bpm).toBe(134)
  })

  it('asks for a fresh check when the track is analysed again', () => {
    const store = createTrackAnalysisStore(db)
    const track = tracks.addFromMixdown('/m/flip.wav')
    store.markPending(track.id)
    store.saveResult(track.id, analysisFor(134))
    store.saveCorrection(track.id, analysisFor(128))

    store.markPending(track.id)
    expect(store.get(track.id)?.check).toBe('confirmed')
    store.saveResult(track.id, analysisFor(130))
    expect(store.get(track.id)).toMatchObject({ check: 'unchecked', checkedAt: null })
  })

  it('refuses corrections that break the section timeline, and keeps what was there', () => {
    const store = createTrackAnalysisStore(db)
    const track = tracks.addFromMixdown('/m/flip.wav')
    store.markPending(track.id)
    store.saveResult(track.id, analysisFor(134))

    const gap = analysisFor(128)
    gap.sections[1] = { ...gap.sections[1]!, start: 20 }
    const badLabel = analysisFor(128)
    badLabel.sections[0] = { ...badLabel.sections[0]!, label: 'chorus' as never }
    const badBpm = analysisFor(0)

    expect(() => store.saveCorrection(track.id, gap)).toThrow(/sections/i)
    expect(() => store.saveCorrection(track.id, badLabel)).toThrow(/label/i)
    expect(() => store.saveCorrection(track.id, badBpm)).toThrow(/BPM/)
    expect(store.get(track.id)).toMatchObject({ check: 'unchecked', analysis: { bpm: 134 } })
  })

  it("can't check a track that has no analysis yet", () => {
    const store = createTrackAnalysisStore(db)
    const track = tracks.addFromMixdown('/m/flip.wav')

    expect(() => store.saveCorrection(track.id, analysisFor(128))).toThrow(/no analysis/i)
    expect(() => store.skipCheck(track.id)).toThrow(/no analysis/i)
  })
})

describe('analysis queue', () => {
  it('analyses an added track through the helper, with the helper path, and saves it on the track', async () => {
    const store = createTrackAnalysisStore(db)
    const { helper, calls } = fakeHelper(async () => analysisFor(134.14))
    const changes: TrackAnalysisState[] = []
    const queue = createAnalysisQueue({ store, tracks, helper, onChange: (s) => changes.push(s) })
    const track = tracks.addFromMixdown('D:\\Bounces\\flip.wav')

    queue.enqueue(track.id)
    await queue.idle()

    expect(calls).toEqual(['/mnt/d/Bounces/flip.wav'])
    expect(store.get(track.id)?.status).toBe('done')
    expect(store.get(track.id)?.analysis?.bpm).toBe(134.14)
    expect(changes.map((c) => c.status)).toEqual(['pending', 'running', 'done'])
  })

  it('runs one track at a time, in the order they were queued', async () => {
    const store = createTrackAnalysisStore(db)
    let active = 0
    let most = 0
    const { helper, calls } = fakeHelper(async () => {
      active++
      most = Math.max(most, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return analysisFor(128)
    })
    const queue = createAnalysisQueue({ store, tracks, helper })
    for (const name of ['a', 'b', 'c']) queue.enqueue(tracks.addFromMixdown(`/m/${name}.wav`).id)
    await queue.idle()

    expect(calls).toEqual(['/m/a.wav', '/m/b.wav', '/m/c.wav'])
    expect(most).toBe(1)
  })

  it('waits for the helper to start, then runs what was queued', async () => {
    const store = createTrackAnalysisStore(db)
    const { helper, calls, setState } = fakeHelper(async () => analysisFor(140))
    setState('starting')
    const queue = createAnalysisQueue({ store, tracks, helper })
    const track = tracks.addFromMixdown('/m/THE WAY I.wav')

    queue.enqueue(track.id)
    await queue.idle()
    expect(calls).toEqual([])
    expect(store.get(track.id)?.status).toBe('pending')

    setState('running')
    await queue.idle()
    expect(store.get(track.id)?.status).toBe('done')
  })

  it('saves a plain-words failure the owner can act on', async () => {
    const store = createTrackAnalysisStore(db)
    const { helper } = fakeHelper(async () => {
      throw new HelperCallError('file_not_found', 'no file at /m/gone.wav')
    })
    const queue = createAnalysisQueue({ store, tracks, helper })
    const track = tracks.addFromMixdown('/m/gone.wav')

    queue.enqueue(track.id)
    await queue.idle()

    expect(store.get(track.id)).toMatchObject({ status: 'failed', error: 'The mixdown is no longer where it was added from.' })
  })

  it('retries after the helper dies once, but gives up on a track that kills it twice', async () => {
    const store = createTrackAnalysisStore(db)
    let calls = 0
    const fake = fakeHelper(async () => {
      calls++
      fake.setState('restarting')
      throw new HelperCallError('helper_exited', 'The helper exited with code 137')
    })
    const queue = createAnalysisQueue({ store, tracks, helper: fake.helper })
    const track = tracks.addFromMixdown('/m/huge.wav')

    queue.enqueue(track.id)
    await queue.idle()
    expect(store.get(track.id)?.status).toBe('pending')

    fake.setState('running')
    await queue.idle()
    expect(calls).toBe(2)
    expect(store.get(track.id)).toMatchObject({ status: 'failed', error: 'The helper stopped while analysing this track, twice.' })
  })

  it('on launch, queues tracks never analysed and runs cut short by a quit', async () => {
    const store = createTrackAnalysisStore(db)
    const old = tracks.addFromMixdown('/m/old.wav') // added before analysis existed
    const cut = tracks.addFromMixdown('/m/cut.wav')
    store.markRunning(cut.id) // the app quit mid-run
    const done = tracks.addFromMixdown('/m/done.wav')
    store.markPending(done.id)
    store.saveResult(done.id, analysisFor(150))

    const { helper, calls } = fakeHelper(async () => analysisFor(128))
    createAnalysisQueue({ store, tracks, helper }).resume()
    await new Promise((r) => setTimeout(r, 20))

    expect(calls.sort()).toEqual(['/m/cut.wav', '/m/old.wav'])
    expect(store.get(done.id)?.analysis?.bpm).toBe(150)
  })

  it("adds the mood listen's detail to the saved analysis, after the local read", async () => {
    const store = createTrackAnalysisStore(db)
    const { helper } = fakeHelper(async () => analysisFor(134.14))
    const detail: MoodDetail = {
      source: 'gemini',
      model: 'gemini-3.1-flash-lite',
      label: 'dark',
      arousal: 0.8,
      valence: -0.4,
      words: ['menacing', 'cold'],
      summary: 'Cold and driving.',
      sections: [{ index: 2, feeling: 'menacing', intensity: 1 }]
    }
    const heard: { trackId: number; mixdownPath: string; bpm: number }[] = []
    const changes: TrackAnalysisState[] = []
    const queue = createAnalysisQueue({
      store,
      tracks,
      helper,
      onChange: (s) => changes.push(s),
      moodListen: async ({ trackId, mixdownPath, analysis }) => {
        heard.push({ trackId, mixdownPath, bpm: analysis.bpm })
        return detail
      }
    })
    const track = tracks.addFromMixdown('D:\\Bounces\\flip.wav')

    queue.enqueue(track.id)
    await queue.idle()

    expect(heard).toEqual([{ trackId: track.id, mixdownPath: 'D:\\Bounces\\flip.wav', bpm: 134.14 }])
    const saved = store.get(track.id)!
    expect(saved.status).toBe('done')
    expect(saved.analysis?.moodDetail).toEqual(detail)
    expect(saved.analysis?.mood.label).toBe('euphoric') // the coarse read stays alongside
    expect(changes.at(-1)?.analysis?.moodDetail).toEqual(detail)
  })

  it('without a mood listen result, saves the coarse mood alone', async () => {
    const store = createTrackAnalysisStore(db)
    const { helper } = fakeHelper(async () => analysisFor(128))
    const queue = createAnalysisQueue({ store, tracks, helper, moodListen: async () => null })
    const track = tracks.addFromMixdown('/m/a.wav')

    queue.enqueue(track.id)
    await queue.idle()

    expect(store.get(track.id)?.status).toBe('done')
    expect(store.get(track.id)?.analysis?.moodDetail).toBeUndefined()
    expect(store.get(track.id)?.analysis?.mood.label).toBe('euphoric')
  })
})
