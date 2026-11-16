import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LiveSet, LiveTrack } from '../shared/live-set'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createMixProjects, type LiveSetReader } from './mix-project'
import { createTrackLibrary, type TrackLibrary } from './tracks'

let dir: string
let db: SuiteDatabase
let tracks: TrackLibrary

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-mix-project-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  tracks = createTrackLibrary(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Writes a fixture project folder: each file with its last-saved time. */
function fixtureFolder(files: Record<string, string>): string {
  const root = join(dir, 'SUPERFLY Project')
  mkdirSync(root, { recursive: true })
  for (const [relative, savedAt] of Object.entries(files)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'x')
    const time = new Date(savedAt)
    utimesSync(path, time, time)
  }
  return root
}

function liveTrack(name: string): LiveTrack {
  return {
    id: 1,
    kind: 'audio',
    name,
    groupId: null,
    output: { target: 'AudioOut/Main', display: 'Main', kind: 'main' },
    mixer: {
      volume: { value: 1, min: 0, max: 2 },
      volumeDb: 0,
      pan: { value: 0, min: -1, max: 1 },
      muted: false,
      soloed: false,
      sends: []
    },
    devices: []
  }
}

/** Stands in for the helper's liveset.read: a Set with Kick, Bass and Lead. */
function stubReader(read: string[] = []): LiveSetReader {
  return async (path) => {
    read.push(path)
    return {
      path,
      creator: 'Ableton Live 12.1.5',
      minorVersion: '12.0_12117',
      liveVersion: 12,
      tracks: [liveTrack('Kick'), liveTrack('Bass'), liveTrack('Lead')],
      returns: [],
      main: 'unknown'
    } satisfies LiveSet
  }
}

const BOUNCED = '2026-11-10T20:00:00.000Z'
const typical = {
  'SUPERFLY.als': '2026-11-10T19:00:00.000Z',
  'SUPERFLY v1.als': '2026-11-01T12:00:00.000Z',
  'Backup/SUPERFLY [2026-11-11 090000].als': '2026-11-11T09:00:00.000Z',
  'Elynt Bounces/SUPERFLY Main.wav': BOUNCED,
  'Elynt Bounces/SUPERFLY Kick.wav': BOUNCED,
  'Elynt Bounces/SUPERFLY Kick.wav.asd': BOUNCED,
  'Elynt Bounces/SUPERFLY Bass.wav': BOUNCED,
  'Elynt Bounces/SUPERFLY Old Pad.wav': BOUNCED,
  'Elynt Bounces/notes.txt': BOUNCED
}

describe('mix project folder', () => {
  it('has no folder until one is picked, then keeps it against the shared track', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const folder = fixtureFolder(typical)
    expect(createMixProjects({ db, tracks, readLiveSet: stubReader() }).folderOf(track.id)).toBeNull()

    createMixProjects({ db, tracks, readLiveSet: stubReader() }).setFolder(track.id, folder)

    // A fresh store over the same database, as after restarting the app.
    expect(createMixProjects({ db, tracks, readLiveSet: stubReader() }).folderOf(track.id)).toBe(folder)
  })

  it('replaces the folder when another is picked', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const projects = createMixProjects({ db, tracks, readLiveSet: stubReader() })
    const other = join(dir, 'Other')
    mkdirSync(other)
    projects.setFolder(track.id, fixtureFolder(typical))
    projects.setFolder(track.id, other)
    expect(projects.folderOf(track.id)).toBe(other)
  })

  it('rejects a folder that does not exist, or an unknown track', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const projects = createMixProjects({ db, tracks, readLiveSet: stubReader() })
    expect(() => projects.setFolder(track.id, join(dir, 'nope'))).toThrow("Can't find the folder")
    expect(() => projects.setFolder(999, fixtureFolder(typical))).toThrow('No track')
  })

  it('reads the newest .als at the top of the folder, not older versions or Live backups', async () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const read: string[] = []
    const projects = createMixProjects({ db, tracks, readLiveSet: stubReader(read) })
    const folder = fixtureFolder(typical)
    projects.setFolder(track.id, folder)

    const project = await projects.open(track.id)

    expect(read).toEqual([join(folder, 'SUPERFLY.als')])
    expect(project?.liveSet).toMatchObject({
      path: join(folder, 'SUPERFLY.als'),
      savedAt: '2026-11-10T19:00:00.000Z',
      readError: null
    })
    expect(project?.liveSet?.read?.creator).toBe('Ableton Live 12.1.5')
  })

  it('lists the audio in Elynt Bounces, split into mixdown and stems matched to Live tracks', async () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const projects = createMixProjects({ db, tracks, readLiveSet: stubReader() })
    const folder = fixtureFolder(typical)
    projects.setFolder(track.id, folder)

    const project = (await projects.open(track.id))!

    const bounces = join(folder, 'Elynt Bounces')
    expect(project.bouncesFolderFound).toBe(true)
    expect(project.mixdowns).toEqual([{ path: join(bounces, 'SUPERFLY Main.wav'), file: 'SUPERFLY Main.wav', savedAt: BOUNCED }])
    expect(project.stems.map((s) => [s.file, s.liveTrack])).toEqual([
      ['SUPERFLY Bass.wav', 'Bass'],
      ['SUPERFLY Kick.wav', 'Kick'],
      ['SUPERFLY Old Pad.wav', null]
    ])
    expect(project.unmatchedStems).toEqual(['SUPERFLY Old Pad.wav'])
    expect(project.unmatchedLiveTracks).toEqual(['Lead'])
    expect(project.staleBounces).toBeNull()
    expect(project.readyToAnalyze).toBe(true)
  })

  it('warns when the Live Set was saved after the bounces, without blocking a run', async () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const projects = createMixProjects({ db, tracks, readLiveSet: stubReader() })
    projects.setFolder(
      track.id,
      fixtureFolder({
        'SUPERFLY.als': '2026-11-12T10:00:00.000Z',
        'Elynt Bounces/SUPERFLY Main.wav': BOUNCED,
        'Elynt Bounces/SUPERFLY Kick.wav': '2026-11-12T11:00:00.000Z'
      })
    )

    const project = (await projects.open(track.id))!

    expect(project.staleBounces).toEqual({ liveSetSavedAt: '2026-11-12T10:00:00.000Z', files: ['SUPERFLY Main.wav'] })
    expect(project.readyToAnalyze).toBe(true)
  })

  it('still lists the bounces when the Live Set cannot be read', async () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const projects = createMixProjects({
      db,
      tracks,
      readLiveSet: async () => {
        throw new Error('unreadable_live_set: not gzip')
      }
    })
    projects.setFolder(track.id, fixtureFolder(typical))

    const project = (await projects.open(track.id))!

    expect(project.liveSet).toMatchObject({ read: null, readError: 'unreadable_live_set: not gzip' })
    expect(project.mixdowns.map((b) => b.file)).toEqual(['SUPERFLY Main.wav'])
    expect(project.unmatchedLiveTracks).toEqual([])
    expect(project.readyToAnalyze).toBe(false)
  })

  it('says what is missing: no .als, no Elynt Bounces, or a folder that has gone', async () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const projects = createMixProjects({ db, tracks, readLiveSet: stubReader() })
    const empty = join(dir, 'Empty')
    mkdirSync(empty)
    projects.setFolder(track.id, empty)

    const project = (await projects.open(track.id))!
    expect(project).toMatchObject({
      folderFound: true,
      liveSet: null,
      bouncesFolderFound: false,
      mixdowns: [],
      stems: [],
      readyToAnalyze: false
    })

    rmSync(empty, { recursive: true })
    expect((await projects.open(track.id))!.folderFound).toBe(false)
  })

  it('opens nothing for a track with no folder', async () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    expect(await createMixProjects({ db, tracks, readLiveSet: stubReader() }).open(track.id)).toBeNull()
  })
})
