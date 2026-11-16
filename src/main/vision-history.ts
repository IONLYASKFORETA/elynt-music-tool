import { PRESET_LEVELS, type HistoryState, type Preset, type PresetLevel, type Snapshot, type VisionKey } from '../shared/vision-history'
import type { SuiteDatabase } from './db/database'

/**
 * Unlimited undo and redo over a vision's whole state, kept in the database so it survives a
 * restart, plus named snapshots of it. Restoring a snapshot is itself an edit, so it can be undone.
 */
export interface VisionHistoryStore {
  current(key: VisionKey): HistoryState
  /** Makes `vision` the state showing; anything undone past is dropped. A state equal to the showing one is ignored. */
  record(key: VisionKey, vision: unknown): HistoryState
  /** Steps back one state; at the first state nothing changes. */
  undo(key: VisionKey): HistoryState
  redo(key: VisionKey): HistoryState
  /** Saves the state showing under a name. Throws for a blank name or a vision never recorded. */
  saveSnapshot(key: VisionKey, name: string): Snapshot
  /** Newest first. */
  listSnapshots(key: VisionKey): Snapshot[]
  /** Records the snapshot's state as a new edit and returns the history after it. */
  restoreSnapshot(id: number): HistoryState
  deleteSnapshot(id: number): void
}

export interface PresetStore {
  /** Throws for a blank name or an unknown level. */
  save(level: PresetLevel, name: string, data: unknown): Preset
  /** Newest first; all levels when none is given. */
  list(level?: PresetLevel): Preset[]
  delete(id: number): void
}

interface SnapshotRow {
  id: number
  vision_key: string
  name: string
  vision: string
  saved_at: string
}

interface PresetRow {
  id: number
  level: PresetLevel
  name: string
  data: string
  saved_at: string
}

export function createVisionHistoryStore(db: SuiteDatabase, now: () => Date = () => new Date()): VisionHistoryStore {
  const cursorOf = db.prepare('SELECT seq FROM vision_history_cursor WHERE vision_key = ?')
  const setCursor = db.prepare(
    'INSERT INTO vision_history_cursor (vision_key, seq) VALUES (?, ?) ON CONFLICT (vision_key) DO UPDATE SET seq = excluded.seq'
  )
  const stateAt = db.prepare('SELECT vision FROM vision_history WHERE vision_key = ? AND seq = ?')
  const lastSeq = db.prepare('SELECT MAX(seq) AS seq FROM vision_history WHERE vision_key = ?')
  const firstSeq = db.prepare('SELECT MIN(seq) AS seq FROM vision_history WHERE vision_key = ?')
  const dropAfter = db.prepare('DELETE FROM vision_history WHERE vision_key = ? AND seq > ?')
  const insert = db.prepare('INSERT INTO vision_history (vision_key, seq, vision, recorded_at) VALUES (?, ?, ?, ?)')
  const insertSnapshot = db.prepare('INSERT INTO vision_snapshots (vision_key, name, vision, saved_at) VALUES (?, ?, ?, ?)')
  const snapshotById = db.prepare('SELECT * FROM vision_snapshots WHERE id = ?')
  const snapshotsOf = db.prepare('SELECT * FROM vision_snapshots WHERE vision_key = ? ORDER BY id DESC')
  const removeSnapshot = db.prepare('DELETE FROM vision_snapshots WHERE id = ?')

  const cursor = (key: VisionKey): number | null => (cursorOf.get(key) as { seq: number } | undefined)?.seq ?? null
  const seqBound = (statement: typeof lastSeq, key: VisionKey): number | null =>
    (statement.get(key) as { seq: number | null } | undefined)?.seq ?? null
  const rawAt = (key: VisionKey, seq: number): string | null =>
    (stateAt.get(key, seq) as { vision: string } | undefined)?.vision ?? null

  const current = (key: VisionKey): HistoryState => {
    const seq = cursor(key)
    const raw = seq === null ? null : rawAt(key, seq)
    if (seq === null || raw === null) return { vision: null, canUndo: false, canRedo: false }
    return { vision: JSON.parse(raw), canUndo: seq > (seqBound(firstSeq, key) ?? seq), canRedo: seq < (seqBound(lastSeq, key) ?? seq) }
  }

  const inTransaction = <T>(work: () => T): T => {
    db.exec('BEGIN')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  const record = (key: VisionKey, vision: unknown): HistoryState => {
    const raw = JSON.stringify(vision)
    if (raw === undefined) throw new Error('A vision must be plain data')
    const seq = cursor(key)
    if (seq !== null && rawAt(key, seq) === raw) return current(key)
    inTransaction(() => {
      const next = seq === null ? 1 : seq + 1
      if (seq !== null) dropAfter.run(key, seq)
      insert.run(key, next, raw, now().toISOString())
      setCursor.run(key, next)
    })
    return current(key)
  }

  const step = (key: VisionKey, by: -1 | 1): HistoryState => {
    const seq = cursor(key)
    if (seq !== null && rawAt(key, seq + by) !== null) setCursor.run(key, seq + by)
    return current(key)
  }

  const toSnapshot = (row: SnapshotRow): Snapshot => ({
    id: row.id,
    visionKey: row.vision_key,
    name: row.name,
    vision: JSON.parse(row.vision),
    savedAt: row.saved_at
  })

  return {
    current,
    record,
    undo: (key) => step(key, -1),
    redo: (key) => step(key, 1),
    saveSnapshot(key, name) {
      const trimmed = requireName(name, 'snapshot')
      const seq = cursor(key)
      const raw = seq === null ? null : rawAt(key, seq)
      if (raw === null) throw new Error('There is nothing to snapshot yet')
      const { lastInsertRowid } = insertSnapshot.run(key, trimmed, raw, now().toISOString())
      return toSnapshot(snapshotById.get(lastInsertRowid) as unknown as SnapshotRow)
    },
    listSnapshots: (key) => (snapshotsOf.all(key) as unknown as SnapshotRow[]).map(toSnapshot),
    restoreSnapshot(id) {
      const row = snapshotById.get(id) as unknown as SnapshotRow | undefined
      if (!row) throw new Error(`No snapshot ${id}`)
      return record(row.vision_key, JSON.parse(row.vision))
    },
    deleteSnapshot(id) {
      removeSnapshot.run(id)
    }
  }
}

export function createPresetStore(db: SuiteDatabase, now: () => Date = () => new Date()): PresetStore {
  const insert = db.prepare('INSERT INTO presets (level, name, data, saved_at) VALUES (?, ?, ?, ?)')
  const byId = db.prepare('SELECT * FROM presets WHERE id = ?')
  const all = db.prepare('SELECT * FROM presets ORDER BY id DESC')
  const ofLevel = db.prepare('SELECT * FROM presets WHERE level = ? ORDER BY id DESC')
  const remove = db.prepare('DELETE FROM presets WHERE id = ?')

  const toPreset = (row: PresetRow): Preset => ({
    id: row.id,
    level: row.level,
    name: row.name,
    data: JSON.parse(row.data),
    savedAt: row.saved_at
  })

  return {
    save(level, name, data) {
      if (!PRESET_LEVELS.includes(level)) throw new Error(`Unknown preset level: ${String(level)}`)
      const raw = JSON.stringify(data)
      if (raw === undefined) throw new Error('A preset must be plain data')
      const { lastInsertRowid } = insert.run(level, requireName(name, 'preset'), raw, now().toISOString())
      return toPreset(byId.get(lastInsertRowid) as unknown as PresetRow)
    },
    list: (level) => ((level ? ofLevel.all(level) : all.all()) as unknown as PresetRow[]).map(toPreset),
    delete(id) {
      remove.run(id)
    }
  }
}

function requireName(name: string, what: string): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) throw new Error(`Give the ${what} a name`)
  return trimmed
}
