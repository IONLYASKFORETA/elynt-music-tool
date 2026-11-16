import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Playbook } from '../shared/playbook'
import { currentPlaybook } from '../shared/playbooks'
import { emptyProfile } from '../shared/profile'
import { buildPlan } from '../shared/release-plan'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createProfileStore } from './profile'
import { createReleaseStore } from './releases'
import { createTrackLibrary, type TrackLibrary } from './tracks'

let dir: string
let db: SuiteDatabase
let tracks: TrackLibrary
const fixedNow = () => new Date('2026-11-16T12:00:00.000Z')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-releases-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  tracks = createTrackLibrary(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function store(playbooks?: readonly Playbook[]) {
  return createReleaseStore(db, { tracks, profile: createProfileStore(db), playbooks, now: fixedNow })
}

/** A playbook update: same step ids, new text and a new date for one step. */
function nextVersionOf(playbook: Playbook): Playbook {
  return {
    version: playbook.version + 1,
    steps: playbook.steps.map((s) =>
      s.id === 'upload-distrokid' ? { ...s, when: { offset: -35 }, phase: 'prep', what: 'Upload five weeks out.' } : s
    )
  }
}

describe('starting a release', () => {
  it('saves the release and its dated steps, recording the playbook version that built them', () => {
    const track = tracks.addFromMixdown('D:\\Music\\Neon Rain.wav')

    const started = store().start({ trackId: track.id, releaseDay: '2027-01-15' })

    expect(started.release).toMatchObject({
      trackId: track.id,
      trackTitle: 'Neon Rain',
      releaseDay: '2027-01-15',
      playbookVersion: currentPlaybook().version,
      status: 'active',
      startedAt: '2026-11-16T12:00:00.000Z'
    })
    expect(started.plan).toEqual(buildPlan(currentPlaybook(), emptyProfile(), { releaseDay: '2027-01-15' }))
    expect(store().get(started.release.id)).toEqual(started)
  })

  it('lists releases, newest first', () => {
    const a = tracks.addFromMixdown('D:\\Music\\A.wav')
    const b = tracks.addFromMixdown('D:\\Music\\B.wav')
    store().start({ trackId: a.id, releaseDay: '2027-01-15' })
    store().start({ trackId: b.id, releaseDay: '2027-02-19' })

    expect(store().list().map((r) => [r.trackTitle, r.releaseDay])).toEqual([
      ['B', '2027-02-19'],
      ['A', '2027-01-15']
    ])
  })

  it.each([
    ['a track the suite does not know', 999, '2027-01-15', /No track with id 999/],
    ['a date that is not a calendar day', null, '2027-02-30', /release day/i],
    ['a date in the wrong format', null, '15/01/2027', /release day/i]
  ])('refuses %s', (_name, trackId, releaseDay, message) => {
    const track = tracks.addFromMixdown('D:\\Music\\A.wav')

    expect(() => store().start({ trackId: trackId ?? track.id, releaseDay })).toThrow(message)
    expect(store().list()).toEqual([])
  })

  it('reads back as null for a release that does not exist', () => {
    expect(store().get(42)).toBeNull()
  })
})

describe('an app update with a newer playbook', () => {
  it('leaves a plan already running on the version that built it, and builds new releases from the newest', () => {
    const v1 = currentPlaybook()
    const v2 = nextVersionOf(v1)
    const running = tracks.addFromMixdown('D:\\Music\\Running.wav')
    const before = store([v1]).start({ trackId: running.id, releaseDay: '2027-01-15' })

    const updated = store([v1, v2])
    const after = updated.get(before.release.id)
    const fresh = updated.start({ trackId: tracks.addFromMixdown('D:\\Music\\New.wav').id, releaseDay: '2027-01-15' })

    expect(after).toEqual(before)
    expect(after?.plan.steps.find((s) => s.stepId === 'upload-distrokid')).toMatchObject({ dueDate: '2026-12-18' })
    expect(fresh.release.playbookVersion).toBe(v2.version)
    expect(fresh.plan.steps.find((s) => s.stepId === 'upload-distrokid')).toMatchObject({
      dueDate: '2026-12-11',
      step: { what: 'Upload five weeks out.' }
    })
  })
})
