import type { AnalysisStatus, HeardCheck, MoodDetail, TrackAnalysis, TrackAnalysisState } from '../shared/analysis'
import { correctionProblem } from '../shared/heard-check'
import type { MoodListen } from './gemini/mood-listen'
import type { HelperMethod, HelperMethods, HelperStatus } from '../shared/helper'
import type { SuiteDatabase } from './db/database'
import { HelperCallError } from './helper/client'
import type { TrackLibrary } from './tracks'

/** Where each track's analysis lives (the track_analysis table). */
export interface TrackAnalysisStore {
  get(trackId: number): TrackAnalysisState | null
  /** Queues a track. Its last result, if any, stays until the new one replaces it. */
  markPending(trackId: number): TrackAnalysisState
  markRunning(trackId: number): TrackAnalysisState
  /** A fresh result from the helper. The "What I heard" check starts over. */
  saveResult(trackId: number, analysis: TrackAnalysis): TrackAnalysisState
  /**
   * The owner's corrections from the "What I heard" check (V3). They replace the heard analysis,
   * so every tool reads the corrected sections and grid. Throws, saving nothing, if they don't hold together.
   */
  saveCorrection(trackId: number, analysis: TrackAnalysis): TrackAnalysisState
  /**
   * Gemini's mood listen (V12), added to whatever result is stored now. It never resets the
   * "What I heard" check or undoes the owner's corrections, even when it lands after them.
   */
  saveMoodDetail(trackId: number, moodDetail: MoodDetail): TrackAnalysisState
  /** The owner skipped the check: the heard analysis stands as it is. */
  skipCheck(trackId: number): TrackAnalysisState
  saveFailure(trackId: number, error: string): TrackAnalysisState
  /** Queued tracks, oldest first. */
  pending(): number[]
  /** Tracks that were never analysed. */
  unanalysed(): number[]
  /** Runs cut short by the app closing go back in the queue. */
  requeueRunning(): void
}

interface AnalysisRow {
  track_id: number
  status: AnalysisStatus
  result: string | null
  error: string | null
  analyzed_at: string | null
  updated_at: string
  check_state: HeardCheck
  checked_at: string | null
}

export function createTrackAnalysisStore(db: SuiteDatabase, now: () => Date = () => new Date()): TrackAnalysisStore {
  const read = db.prepare('SELECT * FROM track_analysis WHERE track_id = ?')
  const setStatus = db.prepare(`
    INSERT INTO track_analysis (track_id, status, error, updated_at) VALUES (?, ?, NULL, ?)
    ON CONFLICT (track_id) DO UPDATE SET status = excluded.status, error = NULL, updated_at = excluded.updated_at
  `)
  const setResult = db.prepare(`
    UPDATE track_analysis SET status = 'done', result = ?, error = NULL, analyzed_at = ?, updated_at = ?,
      check_state = 'unchecked', checked_at = NULL
    WHERE track_id = ?
  `)
  const setCorrection = db.prepare(`
    UPDATE track_analysis SET result = ?, check_state = 'confirmed', checked_at = ? WHERE track_id = ?
  `)
  const setMood = db.prepare(`UPDATE track_analysis SET result = ? WHERE track_id = ?`)
  const setSkipped = db.prepare(`UPDATE track_analysis SET check_state = 'skipped', checked_at = ? WHERE track_id = ?`)
  const setFailure = db.prepare(`UPDATE track_analysis SET status = 'failed', error = ?, updated_at = ? WHERE track_id = ?`)
  const queued = db.prepare(`SELECT track_id FROM track_analysis WHERE status = 'pending' ORDER BY updated_at, track_id`)
  const never = db.prepare(`
    SELECT id FROM tracks WHERE id NOT IN (SELECT track_id FROM track_analysis) ORDER BY id
  `)
  const requeue = db.prepare(`UPDATE track_analysis SET status = 'pending' WHERE status = 'running'`)

  const get = (trackId: number): TrackAnalysisState | null => {
    const row = read.get(trackId) as unknown as AnalysisRow | undefined
    return row ? fromRow(row) : null
  }
  const must = (trackId: number) => {
    const state = get(trackId)
    if (!state) throw new Error(`No analysis row for track ${trackId}`)
    return state
  }
  const stamp = () => now().toISOString()

  return {
    get,
    markPending(trackId) {
      setStatus.run(trackId, 'pending', stamp())
      return must(trackId)
    },
    markRunning(trackId) {
      setStatus.run(trackId, 'running', stamp())
      return must(trackId)
    },
    saveResult(trackId, analysis) {
      const at = stamp()
      setResult.run(JSON.stringify(analysis), at, at, trackId)
      return must(trackId)
    },
    saveCorrection(trackId, analysis) {
      const stored = get(trackId)?.analysis
      if (!stored) throw new Error(`Track ${trackId} has no analysis to correct yet.`)
      const problem = correctionProblem(analysis)
      if (problem) throw new Error(problem)
      // A check opened before the mood listen came back doesn't carry it; keep the stored one.
      const moodDetail = analysis.moodDetail ?? stored.moodDetail
      setCorrection.run(JSON.stringify(moodDetail ? { ...analysis, moodDetail } : analysis), stamp(), trackId)
      return must(trackId)
    },
    saveMoodDetail(trackId, moodDetail) {
      const stored = get(trackId)?.analysis
      if (stored) setMood.run(JSON.stringify({ ...stored, moodDetail }), trackId)
      return must(trackId)
    },
    skipCheck(trackId) {
      if (!get(trackId)?.analysis) throw new Error(`Track ${trackId} has no analysis to check yet.`)
      setSkipped.run(stamp(), trackId)
      return must(trackId)
    },
    saveFailure(trackId, error) {
      setFailure.run(error, stamp(), trackId)
      return must(trackId)
    },
    pending: () => (queued.all() as unknown as { track_id: number }[]).map((r) => r.track_id),
    unanalysed: () => (never.all() as unknown as { id: number }[]).map((r) => r.id),
    requeueRunning: () => void requeue.run()
  }
}

function fromRow(row: AnalysisRow): TrackAnalysisState {
  return {
    trackId: row.track_id,
    status: row.status,
    analysis: row.result ? (JSON.parse(row.result) as TrackAnalysis) : null,
    error: row.error,
    analyzedAt: row.analyzed_at,
    check: row.check_state,
    checkedAt: row.checked_at
  }
}

/** The part of the helper supervisor the queue needs. */
export interface AnalysisHelper {
  status(): HelperStatus
  onStatus(listener: (status: HelperStatus) => void): () => void
  call<M extends HelperMethod>(method: M, params: HelperMethods[M]['params'], options?: { timeoutMs?: number }): Promise<HelperMethods[M]['result']>
  toHelperPath(path: string): string
}

export interface AnalysisQueue {
  /** Queues a track (again), for example when it's added or the owner asks for a re-run. */
  enqueue(trackId: number): TrackAnalysisState
  /** Called at launch: unfinished runs and never-analysed tracks go in the queue. */
  resume(): void
  /** Resolves once nothing is running and nothing that can run now is queued. For tests. */
  idle(): Promise<void>
}

export interface AnalysisQueueOptions {
  store: TrackAnalysisStore
  tracks: TrackLibrary
  helper: AnalysisHelper
  /** Every state change, for the UI. */
  onChange?: (state: TrackAnalysisState) => void
  timeoutMs?: number
  /** The optional Gemini mood listen (V12), run after the local read. Null means keep the coarse mood. */
  moodListen?: MoodListen
}

/** A five-minute track takes well under a minute on the GPU; this only catches a stuck helper. */
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000
/** A track that kills the helper this many times is marked failed instead of retried forever. */
const MAX_CRASHES = 2

const FRIENDLY: Record<string, string> = {
  file_not_found: 'The mixdown is no longer where it was added from.',
  unreadable_audio: "The helper couldn't read the mixdown as audio.",
  silent_audio: 'The mixdown is silent.',
  no_beat: 'The mixdown is too short, or has no beat to follow.',
  unknown_method: 'The helper is older than the app. Re-run the helper setup (helper/README.md).',
  timeout: 'The helper took too long.'
}

/** Runs analysis one track at a time whenever the helper is up, and saves results on the track. */
export function createAnalysisQueue({
  store,
  tracks,
  helper,
  onChange = () => {},
  timeoutMs = ANALYSIS_TIMEOUT_MS,
  moodListen
}: AnalysisQueueOptions): AnalysisQueue {
  let running: Promise<void> | null = null
  const crashes = new Map<number, number>()
  const emit = (state: TrackAnalysisState) => onChange(state)

  const runOne = async (trackId: number) => {
    const track = tracks.get(trackId)
    if (!track) return
    emit(store.markRunning(trackId))
    try {
      const analysis = await helper.call('track.analyze', { path: helper.toHelperPath(track.mixdownPath) }, { timeoutMs })
      crashes.delete(trackId)
      emit(store.saveResult(trackId, analysis))
      if (moodListen) await listenForMood(trackId, track.mixdownPath, analysis)
    } catch (error) {
      const code = error instanceof HelperCallError ? error.code : 'internal'
      const helperWentAway = code === 'helper_exited' || code === 'not_running'
      const count = (crashes.get(trackId) ?? 0) + (code === 'helper_exited' ? 1 : 0)
      crashes.set(trackId, count)
      if (helperWentAway && count < MAX_CRASHES) {
        // Not this track's fault (or not yet proven to be): try again when the helper is back.
        emit(store.markPending(trackId))
        return
      }
      const message = helperWentAway
        ? 'The helper stopped while analysing this track, twice.'
        : (FRIENDLY[code] ?? (error instanceof Error ? error.message : String(error)))
      emit(store.saveFailure(trackId, message))
    }
  }

  /** The local result is already saved, so a missing key, no internet or a bad answer changes nothing. */
  const listenForMood = async (trackId: number, mixdownPath: string, analysis: TrackAnalysis) => {
    const moodDetail = await moodListen?.({ trackId, mixdownPath, analysis }).catch(() => null)
    if (moodDetail) emit(store.saveMoodDetail(trackId, moodDetail))
  }

  const drain = async () => {
    while (helper.status().state === 'running') {
      const next = store.pending()[0]
      if (next === undefined) return
      await runOne(next)
    }
  }

  const kick = () => {
    if (running) return
    running = drain().finally(() => {
      running = null
      // Something may have been queued while the last run finished.
      if (helper.status().state === 'running' && store.pending().length > 0) kick()
    })
  }

  helper.onStatus((status) => {
    if (status.state === 'running') kick()
  })

  return {
    enqueue(trackId) {
      const state = store.markPending(trackId)
      emit(state)
      kick()
      return state
    },
    resume() {
      store.requeueRunning()
      for (const id of store.unanalysed()) emit(store.markPending(id))
      kick()
    },
    async idle() {
      while (running) await running
    }
  }
}
