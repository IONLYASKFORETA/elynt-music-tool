import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBackups, KEEP_DAILY_BACKUPS } from './backup'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createTrackLibrary } from './tracks'

let dir: string
let backupFolder: string
let settingsFile: string
let db: SuiteDatabase
let clock: Date

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-backup-'))
  backupFolder = join(dir, 'OneDrive', 'Elynt backups')
  mkdirSync(backupFolder, { recursive: true })
  settingsFile = join(dir, 'backup-settings.json')
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  clock = new Date(2026, 10, 13, 21, 0)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const backups = () => createBackups({ db, settingsFile, now: () => clock })
const backupFiles = () => readdirSync(backupFolder).filter((f) => f.startsWith('elynt-backup-')).sort()

describe('daily backup', () => {
  it('does nothing until a backup folder is chosen', () => {
    expect(backups().runIfDue()).toBeNull()
    expect(backups().status()).toEqual({ folder: null, lastBackupDay: null })
  })

  it('remembers the chosen folder across restarts and backs up straight away', () => {
    backups().setFolder(backupFolder)

    expect(backups().status()).toEqual({ folder: backupFolder, lastBackupDay: '2026-11-13' })
    expect(backupFiles()).toEqual(['elynt-backup-2026-11-13.sqlite'])
  })

  it('writes one backup per day, however often it is asked', () => {
    const b = backups()
    b.setFolder(backupFolder)
    clock = new Date(2026, 10, 13, 23, 59)

    expect(b.runIfDue()).toBeNull()
    expect(backupFiles()).toHaveLength(1)
  })

  it('catches up on the next launch after a missed day', () => {
    backups().setFolder(backupFolder)
    clock = new Date(2026, 10, 16, 9, 0) // app was closed for two days

    const written = backups().runIfDue()

    expect(written).toBe(join(backupFolder, 'elynt-backup-2026-11-16.sqlite'))
    expect(backupFiles()).toEqual(['elynt-backup-2026-11-13.sqlite', 'elynt-backup-2026-11-16.sqlite'])
  })

  it(`keeps only the newest ${KEEP_DAILY_BACKUPS} backups and leaves other files alone`, () => {
    writeFileSync(join(backupFolder, 'my notes.txt'), 'not ours')
    const b = backups()
    b.setFolder(backupFolder)
    for (let day = 1; day <= KEEP_DAILY_BACKUPS + 5; day++) {
      clock = new Date(2026, 10, 13 + day, 9, 0)
      b.runIfDue()
    }

    const files = backupFiles()
    expect(files).toHaveLength(KEEP_DAILY_BACKUPS)
    expect(files.at(-1)).toBe('elynt-backup-2026-12-02.sqlite')
    expect(readdirSync(backupFolder)).toContain('my notes.txt')
  })

  it('restores a backup with the same tracks', () => {
    const tracks = createTrackLibrary(db)
    tracks.addFromMixdown('D:\\Bounces\\SUPERFLY.wav')
    tracks.addFromMixdown('D:\\Bounces\\flip.wav')
    backups().setFolder(backupFolder)

    const restored = openSuiteDatabase(join(backupFolder, 'elynt-backup-2026-11-13.sqlite'))

    expect(createTrackLibrary(restored).list()).toEqual(tracks.list())
    restored.close()
  })

  it('reports a folder that has gone missing instead of crashing', () => {
    const b = backups()
    b.setFolder(backupFolder)
    rmSync(backupFolder, { recursive: true, force: true })
    clock = new Date(2026, 10, 14, 9, 0)

    expect(() => b.runIfDue()).toThrow()
    expect(b.status().folder).toBe(backupFolder)
  })
})

describe('export everything', () => {
  it('writes one file holding the whole database, replacing an older export of the same name', () => {
    const tracks = createTrackLibrary(db)
    tracks.addFromMixdown('D:\\Bounces\\THE WAY I.wav')
    const target = join(dir, 'Elynt export.sqlite')
    writeFileSync(target, 'an older export')

    backups().exportEverything(target)

    const exported = openSuiteDatabase(target)
    expect(createTrackLibrary(exported).list()).toEqual(tracks.list())
    exported.close()
  })
})
