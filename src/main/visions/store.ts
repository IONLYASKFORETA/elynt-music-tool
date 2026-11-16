import type { VisionSet, WorkingVision } from '../../shared/visions'
import type { SuiteDatabase } from '../db/database'

/** The vision_sets and track_vision tables (V10). */
export interface VisionStore {
  saveSet(set: Omit<VisionSet, 'id' | 'createdAt'>): VisionSet
  /** The newest run of the vision flow for a track, or null. */
  latestSet(trackId: number): VisionSet | null
  getSet(setId: number): VisionSet | null
  getWorking(trackId: number): WorkingVision | null
  /** Replaces the track's working vision. Throws for a `from` that names no vision. */
  saveWorking(trackId: number, vision: unknown, from: WorkingVision['from']): WorkingVision
}

interface SetRow {
  id: number
  track_id: number
  brief: string
  questions: string
  answers: string
  visions: string
  attempts: number
  cost_usd: number
  created_at: string
}

interface WorkingRow {
  track_id: number
  vision: string
  from_set: number | null
  from_index: number | null
  updated_at: string
}

const toSet = (r: SetRow): VisionSet => ({
  id: r.id,
  trackId: r.track_id,
  brief: r.brief,
  questions: JSON.parse(r.questions),
  answers: JSON.parse(r.answers),
  visions: JSON.parse(r.visions),
  attempts: r.attempts,
  costUsd: r.cost_usd,
  createdAt: r.created_at
})

const toWorking = (r: WorkingRow): WorkingVision => ({
  trackId: r.track_id,
  vision: JSON.parse(r.vision),
  from: r.from_set === null || r.from_index === null ? null : { setId: r.from_set, index: r.from_index },
  updatedAt: r.updated_at
})

export function createVisionStore(db: SuiteDatabase, now: () => Date = () => new Date()): VisionStore {
  const insertSet = db.prepare(`
    INSERT INTO vision_sets (track_id, brief, questions, answers, visions, attempts, cost_usd, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const setById = db.prepare('SELECT * FROM vision_sets WHERE id = ?')
  const latest = db.prepare('SELECT * FROM vision_sets WHERE track_id = ? ORDER BY id DESC LIMIT 1')
  const upsertWorking = db.prepare(`
    INSERT INTO track_vision (track_id, vision, from_set, from_index, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (track_id) DO UPDATE SET vision = excluded.vision, from_set = excluded.from_set,
      from_index = excluded.from_index, updated_at = excluded.updated_at
  `)
  const working = db.prepare('SELECT * FROM track_vision WHERE track_id = ?')

  const getSet = (id: number) => {
    const row = setById.get(id) as unknown as SetRow | undefined
    return row ? toSet(row) : null
  }

  return {
    saveSet(s) {
      const result = insertSet.run(
        s.trackId,
        s.brief,
        JSON.stringify(s.questions),
        JSON.stringify(s.answers),
        JSON.stringify(s.visions),
        s.attempts,
        s.costUsd,
        now().toISOString()
      )
      return getSet(Number(result.lastInsertRowid))!
    },
    latestSet(trackId) {
      const row = latest.get(trackId) as unknown as SetRow | undefined
      return row ? toSet(row) : null
    },
    getSet,
    getWorking(trackId) {
      const row = working.get(trackId) as unknown as WorkingRow | undefined
      return row ? toWorking(row) : null
    },
    saveWorking(trackId, vision, from) {
      if (from) {
        const set = getSet(from.setId)
        if (!set || set.trackId !== trackId || !set.visions[from.index]) {
          throw new Error(`Vision set ${from.setId} has no vision ${from.index + 1} for this track.`)
        }
      }
      upsertWorking.run(trackId, JSON.stringify(vision), from?.setId ?? null, from?.index ?? null, now().toISOString())
      return toWorking(working.get(trackId) as unknown as WorkingRow)
    }
  }
}
