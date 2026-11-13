import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSuiteDatabase, schemaVersion } from './database'
import type { Migration } from './migrations'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-db-'))
  file = join(dir, 'elynt.sqlite')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const notes: Migration = { version: 1, name: 'notes', sql: 'CREATE TABLE notes (body TEXT NOT NULL)' }
const pinned: Migration = { version: 2, name: 'pinned', sql: 'ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0' }

describe('suite database migrations', () => {
  it('runs a migration added in a later version on an existing file, keeping its rows', () => {
    const v1 = openSuiteDatabase(file, [notes])
    v1.prepare('INSERT INTO notes (body) VALUES (?)').run('kick too loud')
    v1.close()

    const v2 = openSuiteDatabase(file, [notes, pinned])

    expect(schemaVersion(v2)).toBe(2)
    expect(v2.prepare('SELECT body, pinned FROM notes').all()).toEqual([{ body: 'kick too loud', pinned: 0 }])
    v2.close()
  })

  it('does not run a migration twice', () => {
    openSuiteDatabase(file, [notes]).close()

    const reopened = openSuiteDatabase(file, [notes])

    expect(schemaVersion(reopened)).toBe(1)
    reopened.close()
  })

  it('leaves the file at the last good version when a migration fails', () => {
    openSuiteDatabase(file, [notes]).close()
    const broken: Migration = { version: 2, name: 'broken', sql: 'ALTER TABLE missing ADD COLUMN x INTEGER' }

    expect(() => openSuiteDatabase(file, [notes, broken])).toThrow(/Migration 2 \(broken\) failed/)

    const reopened = openSuiteDatabase(file, [notes])
    expect(schemaVersion(reopened)).toBe(1)
    reopened.close()
  })

})
