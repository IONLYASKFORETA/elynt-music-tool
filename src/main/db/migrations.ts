/**
 * The suite's schema history (ADR 0002: one SQLite file for the whole suite).
 *
 * To add tables, append a migration with the next version number. Never edit
 * or reorder a migration that has shipped: databases on disk have already run it.
 * Two branches that both add the same version number fail at startup, so rebase and renumber.
 */
export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'tracks',
    sql: `
      CREATE TABLE tracks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT NOT NULL,
        mixdown_path TEXT NOT NULL UNIQUE COLLATE NOCASE, -- Windows paths ignore case
        added_at     TEXT NOT NULL
      );
    `
  }
]
