import { DatabaseSync } from 'node:sqlite'
import { migrations as suiteMigrations, type Migration } from './migrations'

export type SuiteDatabase = DatabaseSync

/**
 * Opens (or creates) the suite's SQLite file and brings its schema up to date.
 * The schema version lives in SQLite's own `user_version` pragma.
 */
export function openSuiteDatabase(
  path: string,
  migrations: readonly Migration[] = suiteMigrations
): SuiteDatabase {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  try {
    migrate(db, migrations)
  } catch (error) {
    db.close()
    throw error
  }
  return db
}

export function schemaVersion(db: SuiteDatabase): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

function migrate(db: SuiteDatabase, migrations: readonly Migration[]): void {
  const current = schemaVersion(db)
  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => m.version > current)

  for (const migration of pending) {
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${migration.version} (${migration.name}) failed`, { cause: error })
    }
  }
}
