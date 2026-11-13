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
  },
  {
    version: 2,
    name: 'api_usage',
    sql: `
      -- One row per Claude call, so cost can be shown per tool, track or release.
      CREATE TABLE api_usage (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        called_at          TEXT NOT NULL,
        tool               TEXT NOT NULL,              -- visualizer, mix-master, release or suite
        track_id           INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
        release_id         INTEGER,                    -- the releases table arrives with the Release Assistant
        tier               TEXT NOT NULL,              -- fast or strongest
        model              TEXT NOT NULL,              -- the model that actually answered
        input_tokens       INTEGER NOT NULL,
        output_tokens      INTEGER NOT NULL,
        cache_read_tokens  INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        cost_usd           REAL NOT NULL
      );
      CREATE INDEX api_usage_track ON api_usage (track_id);
      CREATE INDEX api_usage_release ON api_usage (release_id);
    `
  }
]
