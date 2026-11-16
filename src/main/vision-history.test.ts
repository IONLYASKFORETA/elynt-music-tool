import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createPresetStore, createVisionHistoryStore } from './vision-history'

let dir: string
let db: SuiteDatabase
const file = () => join(dir, 'elynt.sqlite')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-history-'))
  db = openSuiteDatabase(file())
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Stands in for a whole vision: the store keeps any JSON state as it is, Claude notes and all. */
const v = (n: number, note = '') => ({ sections: [{ label: 'drop', hue: n }], note })

describe('vision history', () => {
  it('has nothing for a vision never edited', () => {
    expect(createVisionHistoryStore(db).current('track:1')).toEqual({ vision: null, canUndo: false, canRedo: false })
  })

  it('undoes and redoes every edit, in order', () => {
    const history = createVisionHistoryStore(db)
    history.record('track:1', v(1))
    history.record('track:1', v(2))
    history.record('track:1', v(3, 'darker in the drop'))

    expect(history.undo('track:1')).toEqual({ vision: v(2), canUndo: true, canRedo: true })
    expect(history.undo('track:1')).toEqual({ vision: v(1), canUndo: false, canRedo: true })
    expect(history.undo('track:1')).toEqual({ vision: v(1), canUndo: false, canRedo: true })
    expect(history.redo('track:1').vision).toEqual(v(2))
    expect(history.redo('track:1')).toEqual({ vision: v(3, 'darker in the drop'), canUndo: true, canRedo: false })
  })

  it('has no limit', () => {
    const history = createVisionHistoryStore(db)
    for (let i = 0; i <= 500; i++) history.record('track:1', v(i))
    for (let i = 0; i < 500; i++) history.undo('track:1')
    expect(history.current('track:1')).toEqual({ vision: v(0), canUndo: false, canRedo: true })
  })

  it('drops what was undone once a new edit is made', () => {
    const history = createVisionHistoryStore(db)
    history.record('track:1', v(1))
    history.record('track:1', v(2))
    history.undo('track:1')
    expect(history.record('track:1', v(9))).toEqual({ vision: v(9), canUndo: true, canRedo: false })
    expect(history.undo('track:1').vision).toEqual(v(1))
  })

  it('ignores a record that changes nothing', () => {
    const history = createVisionHistoryStore(db)
    history.record('track:1', v(1))
    history.record('track:1', v(1))
    expect(history.current('track:1').canUndo).toBe(false)
  })

  it('keeps each vision to its own history', () => {
    const history = createVisionHistoryStore(db)
    history.record('track:1', v(1))
    history.record('track:2', v(5))
    history.record('track:1', v(2))
    expect(history.undo('track:2')).toEqual({ vision: v(5), canUndo: false, canRedo: false })
    expect(history.undo('track:1').vision).toEqual(v(1))
  })

  it('survives a restart, undo and redo included', () => {
    const before = createVisionHistoryStore(db)
    before.record('track:1', v(1))
    before.record('track:1', v(2))
    before.record('track:1', v(3))
    before.undo('track:1')
    db.close()
    db = openSuiteDatabase(file())

    const after = createVisionHistoryStore(db)
    expect(after.current('track:1')).toEqual({ vision: v(2), canUndo: true, canRedo: true })
    expect(after.redo('track:1').vision).toEqual(v(3))
    expect(after.undo('track:1').vision).toEqual(v(2))
    expect(after.undo('track:1').vision).toEqual(v(1))
  })
})

describe('named snapshots', () => {
  const clock = () => new Date('2026-11-16T10:00:00.000Z')

  it('are saved, listed newest first, restored and deleted', () => {
    const history = createVisionHistoryStore(db, clock)
    history.record('track:1', v(1))
    const first = history.saveSnapshot('track:1', '  Moody first pass ')
    history.record('track:1', v(2))
    const second = history.saveSnapshot('track:1', 'Brighter drop')
    history.record('track:1', v(3))

    expect(first).toMatchObject({ name: 'Moody first pass', vision: v(1), savedAt: '2026-11-16T10:00:00.000Z' })
    expect(history.listSnapshots('track:1').map((s) => s.name)).toEqual(['Brighter drop', 'Moody first pass'])
    expect(history.listSnapshots('track:2')).toEqual([])

    expect(history.restoreSnapshot(first.id)).toEqual({ vision: v(1), canUndo: true, canRedo: false })
    // Restoring is an edit like any other.
    expect(history.undo('track:1').vision).toEqual(v(3))

    history.deleteSnapshot(second.id)
    expect(history.listSnapshots('track:1').map((s) => s.name)).toEqual(['Moody first pass'])
  })

  it('need a name and something to save', () => {
    const history = createVisionHistoryStore(db)
    expect(() => history.saveSnapshot('track:1', 'Empty')).toThrow('nothing to snapshot')
    history.record('track:1', v(1))
    expect(() => history.saveSnapshot('track:1', '   ')).toThrow('name')
  })

  it('survive a restart', () => {
    const history = createVisionHistoryStore(db)
    history.record('track:1', v(1))
    history.saveSnapshot('track:1', 'Keeper')
    db.close()
    db = openSuiteDatabase(file())
    expect(createVisionHistoryStore(db).listSnapshots('track:1')).toMatchObject([{ name: 'Keeper', vision: v(1) }])
  })
})

describe('presets', () => {
  it('are saved and listed per level, newest first, and deleted', () => {
    const presets = createPresetStore(db)
    const layer = presets.save('layer', 'Hot chrome', { kind: 'chrome', shine: 0.9 })
    presets.save('scene', 'Big drop', { layers: [] })
    presets.save('layer', 'Soft grain', { kind: 'finish', grain: 0.05 })

    expect(presets.list('layer').map((p) => p.name)).toEqual(['Soft grain', 'Hot chrome'])
    expect(presets.list().map((p) => p.level)).toEqual(['layer', 'scene', 'layer'])
    expect(layer).toMatchObject({ level: 'layer', name: 'Hot chrome', data: { kind: 'chrome', shine: 0.9 } })

    presets.delete(layer.id)
    expect(presets.list('layer').map((p) => p.name)).toEqual(['Soft grain'])
  })

  it('refuse a blank name or an unknown level', () => {
    const presets = createPresetStore(db)
    expect(() => presets.save('vision', ' ', {})).toThrow('name')
    expect(() => presets.save('track' as 'vision', 'X', {})).toThrow('Unknown preset level')
  })
})
