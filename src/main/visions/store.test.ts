import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VisionPlan } from '../../shared/vision-plan'
import { openSuiteDatabase, type SuiteDatabase } from '../db/database'
import { createTrackLibrary } from '../tracks'
import { createVisionStore, type VisionStore } from './store'

const recorded = JSON.parse(readFileSync(join(import.meta.dirname, 'recorded', 'three-visions.json'), 'utf8')) as {
  visions: VisionPlan[]
}

let dir: string
let db: SuiteDatabase
let store: VisionStore
let trackId: number
let clockAt = 0
const now = () => new Date(Date.UTC(2026, 10, 16, 12, 0, clockAt++))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  const mixdown = join(dir, 'flip.wav')
  writeFileSync(mixdown, '')
  trackId = createTrackLibrary(db).addFromMixdown(mixdown).id
  store = createVisionStore(db, now)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const set = (brief = '') => ({ trackId, brief, questions: [], answers: { 'drop-mood': 'dark' }, visions: recorded.visions, attempts: 2, costUsd: 0.4 })

describe('vision sets', () => {
  it('keeps a run of the flow with its brief, answers, three visions and cost', () => {
    const saved = store.saveSet(set('Mecha angels.'))

    expect(store.latestSet(trackId)).toEqual(saved)
    expect(saved).toMatchObject({ trackId, brief: 'Mecha angels.', answers: { 'drop-mood': 'dark' }, attempts: 2, costUsd: 0.4 })
    expect(saved.visions.map((v) => v.name)).toEqual(['Chrome Seraph', 'Datamosh Rave', 'Neon Shrine'])
  })

  it('hands back the newest run of the flow, and none for a track never run', () => {
    store.saveSet(set('first'))
    store.saveSet(set('second'))

    expect(store.latestSet(trackId)!.brief).toBe('second')
    expect(store.latestSet(trackId + 1)).toBeNull()
  })

  it('survives closing and reopening the database', () => {
    const saved = store.saveSet(set())
    db.close()
    db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
    expect(createVisionStore(db).latestSet(trackId)).toEqual(saved)
  })
})

describe('the working vision', () => {
  it('is null until scenes are first saved', () => {
    expect(store.getWorking(trackId)).toBeNull()
  })

  it('saves scene edits so they come back next visit, replacing the last save', () => {
    store.saveWorking(trackId, { sections: [], palette: ['#000000', '#111111', '#222222'] }, null)
    const latest = store.saveWorking(trackId, { sections: [], palette: ['#ffffff', '#111111', '#222222'] }, null)

    expect(store.getWorking(trackId)).toEqual(latest)
    expect(latest.vision).toEqual({ sections: [], palette: ['#ffffff', '#111111', '#222222'] })
  })

  it('remembers which vision of which set it came from', () => {
    const saved = store.saveSet(set())
    store.saveWorking(trackId, { sections: [] }, { setId: saved.id, index: 1 })
    expect(store.getWorking(trackId)!.from).toEqual({ setId: saved.id, index: 1 })
  })

  it('refuses a vision index outside the set', () => {
    const saved = store.saveSet(set())
    expect(() => store.saveWorking(trackId, { sections: [] }, { setId: saved.id, index: 3 })).toThrow(/vision 4/)
  })
})
