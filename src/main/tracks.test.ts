import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createTrackLibrary } from './tracks'

let dir: string
let db: SuiteDatabase

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('track library', () => {
  it('adds a track from a mixdown, titled after the file name', () => {
    const tracks = createTrackLibrary(db)

    const track = tracks.addFromMixdown('C:\\Music\\Bounces\\SUPERFLY.wav')

    expect(track.title).toBe('SUPERFLY')
    expect(track.mixdownPath).toBe('C:\\Music\\Bounces\\SUPERFLY.wav')
    expect(tracks.list()).toEqual([track])
  })
  it('treats Windows paths that differ only in letter case as the same mixdown', () => {
    const tracks = createTrackLibrary(db)

    const first = tracks.addFromMixdown('C:\\Bounces\\flip.wav')
    const second = tracks.addFromMixdown('c:\\bounces\\FLIP.wav')

    expect(second).toEqual(first)
    expect(tracks.list()).toHaveLength(1)
  })

  it('keeps tracks after the database is closed and reopened', () => {
    createTrackLibrary(db).addFromMixdown('/music/flip.wav')
    db.close()

    db = openSuiteDatabase(join(dir, 'elynt.sqlite'))

    expect(createTrackLibrary(db).list().map((t) => t.title)).toEqual(['flip'])
  })

  it('returns the existing track when the same mixdown is picked twice', () => {
    const tracks = createTrackLibrary(db)

    const first = tracks.addFromMixdown('/music/THE WAY I.wav')
    const second = tracks.addFromMixdown('/music/THE WAY I.wav')

    expect(second).toEqual(first)
    expect(tracks.list()).toHaveLength(1)
  })

  it('lists tracks in the order they were added', () => {
    const tracks = createTrackLibrary(db)

    tracks.addFromMixdown('/music/b.wav')
    tracks.addFromMixdown('/music/a.flac')

    expect(tracks.list().map((t) => t.title)).toEqual(['b', 'a'])
  })

  it('finds a track by id, or null when there is none', () => {
    const tracks = createTrackLibrary(db)
    const track = tracks.addFromMixdown('C:\\Music\\Bounces\\flip.wav')

    expect(tracks.get(track.id)).toEqual(track)
    expect(tracks.get(track.id + 1)).toBeNull()
  })
})
