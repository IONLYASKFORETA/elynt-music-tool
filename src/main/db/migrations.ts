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
  },
  {
    version: 3,
    name: 'artist profile',
    // One suite-wide row (id is always 1). List and map fields are JSON text.
    sql: `
      CREATE TABLE artist_profile (
        id                 INTEGER PRIMARY KEY CHECK (id = 1),
        artist_name        TEXT,
        links              TEXT NOT NULL DEFAULT '{}',
        main_subgenre      TEXT,
        other_subgenres    TEXT NOT NULL DEFAULT '[]',
        followers          TEXT NOT NULL DEFAULT '{}',
        spotify_monthly_listeners INTEGER,
        budget_per_release REAL,
        distributor        TEXT,
        platforms          TEXT NOT NULL DEFAULT '[]',
        reference_artists  TEXT NOT NULL DEFAULT '[]',
        default_goal       TEXT,
        updated_at         TEXT NOT NULL
      );
    `
  },
  {
    version: 4,
    name: 'artist profile voice, setup check and past releases',
    // JSON text, read through createProfileStore. Older rows get the empty values.
    sql: `
      ALTER TABLE artist_profile ADD COLUMN voice TEXT NOT NULL
        DEFAULT '{"examples":[],"tone":null,"emoji":null,"caps":null,"neverSay":[]}';
      ALTER TABLE artist_profile ADD COLUMN setup_check TEXT NOT NULL
        DEFAULT '{"customReleaseDates":null,"spotifyForArtistsClaimed":null,"tiktokArtistAccount":null,"soundcloudPlan":null}';
      ALTER TABLE artist_profile ADD COLUMN past_releases TEXT NOT NULL DEFAULT '[]';
    `
  },
  {
    version: 5,
    name: 'mix setup',
    // Mix & Master per-track setup (M3). One row per track, written the first time it is set up.
    // reference_tracks is a JSON list of file paths, in the order they were added.
    sql: `
      CREATE TABLE mix_setup (
        track_id         INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        subgenre         TEXT,                        -- an id from src/shared/subgenres.ts
        loudness_target  TEXT NOT NULL,               -- club or streaming
        reference_tracks TEXT NOT NULL DEFAULT '[]',
        updated_at       TEXT NOT NULL
      );
    `
  },
  {
    version: 6,
    name: 'stems',
    // A track's stems, as file paths. source is 'own' (bounced by the owner) or 'split' (AI-split by the helper).
    // A track holds one set at a time: the owner's own stems replace a split set.
    sql: `
      CREATE TABLE stems (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id  INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        name      TEXT NOT NULL,
        path      TEXT NOT NULL COLLATE NOCASE, -- Windows paths ignore case
        source    TEXT NOT NULL CHECK (source IN ('own', 'split')),
        model     TEXT,                         -- the separation model, for split stems
        added_at  TEXT NOT NULL,
        UNIQUE (track_id, path)
      );
      CREATE INDEX stems_track ON stems (track_id);
    `
  },
  {
    version: 7,
    name: 'track analysis',
    // Track analysis (V1), one row per track. On the track, not in the Visualizer, because
    // Mix & Master and Release read the same sections. result is TrackAnalysis as JSON.
    sql: `
      CREATE TABLE track_analysis (
        track_id    INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
        result      TEXT,          -- the latest result, kept while a re-run is queued
        error       TEXT,
        analyzed_at TEXT,          -- when result was made
        updated_at  TEXT NOT NULL  -- when status last changed; the queue runs oldest first
      );
    `
  },
  {
    version: 8,
    name: 'what I heard check',
    // The "What I heard" check (V3). The owner's corrections overwrite result in place, so every
    // tool reads them; check says whether the owner confirmed it, skipped it, or hasn't seen it yet.
    sql: `
      ALTER TABLE track_analysis ADD COLUMN check_state TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (check_state IN ('unchecked', 'confirmed', 'skipped'));
      ALTER TABLE track_analysis ADD COLUMN checked_at TEXT;
    `
  },
  {
    version: 9,
    name: 'releases and plan steps',
    // Release Assistant (R1). A release records the playbook version that built its plan; a plan
    // step holds only its dates and status, and reads its What/Why/How from that playbook version,
    // so an app update with a newer playbook never rewrites a running release.
    sql: `
      CREATE TABLE releases (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id          INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        release_day       TEXT NOT NULL,               -- YYYY-MM-DD
        playbook_version  INTEGER NOT NULL,
        subgenre_override TEXT,                        -- per-release overrides; null uses the profile
        budget_override   REAL,
        goal_override     TEXT,
        status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
        started_at        TEXT NOT NULL
      );
      CREATE INDEX releases_track ON releases (track_id);

      CREATE TABLE plan_steps (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        release_id    INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
        position      INTEGER NOT NULL,              -- order in the plan
        step_id       TEXT NOT NULL,                 -- the playbook step id
        offset_days   INTEGER NOT NULL,              -- days from release day, as the playbook placed it
        due_date      TEXT NOT NULL,                 -- YYYY-MM-DD
        hard_deadline INTEGER NOT NULL CHECK (hard_deadline IN (0, 1)),
        status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped', 'missed')),
        moved_from    TEXT,                          -- the due date before the owner moved it
        UNIQUE (release_id, step_id)
      );
      CREATE INDEX plan_steps_release ON plan_steps (release_id, position);
    `
  },
  {
    version: 10,
    name: 'subject images',
    // Subject images (V9), generated by the helper's local image model ahead of time. The PNG
    // stays on disk; this holds its path, the prompt and seed it came from, and how long it took.
    sql: `
      CREATE TABLE subject_images (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        motif      TEXT NOT NULL,
        ground     TEXT NOT NULL CHECK (ground IN ('black', 'off-white')),
        prompt     TEXT NOT NULL,
        path       TEXT NOT NULL UNIQUE COLLATE NOCASE, -- Windows paths ignore case
        seed       INTEGER NOT NULL,
        model      TEXT NOT NULL,
        width      INTEGER NOT NULL,
        height     INTEGER NOT NULL,
        seconds    REAL NOT NULL,                       -- generation time on this machine
        created_at TEXT NOT NULL
      );
      CREATE INDEX subject_images_track ON subject_images (track_id);
    `
  },
  {
    version: 11,
    name: 'media shelf and cover art',
    // The media shelf (V18): the owner's own images, clips and logo, by path, for any track.
    // At most one row is the logo. A track's cover art is offered to its vision, never required.
    sql: `
      CREATE TABLE media_shelf (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        type             TEXT NOT NULL CHECK (type IN ('image', 'clip')),
        path             TEXT NOT NULL UNIQUE COLLATE NOCASE, -- Windows paths ignore case
        is_logo          INTEGER NOT NULL DEFAULT 0 CHECK (is_logo IN (0, 1)),
        duration_seconds REAL,          -- clips only
        fps              REAL,          -- clips only
        added_at         TEXT NOT NULL
      );
      CREATE UNIQUE INDEX media_shelf_one_logo ON media_shelf (is_logo) WHERE is_logo = 1;
      CREATE TABLE track_cover_art (
        track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        path     TEXT NOT NULL
      );
    `
  },
  {
    version: 12,
    name: 'vision history, snapshots and presets',
    // Visualizer undo, snapshots and presets (V15). History keeps every state of a vision as a
    // whole, as JSON, keyed by a vision key (the editor's vision of a track for now), so whatever
    // a vision holds gets undo. cursor is the seq of the state showing; later seqs are redo.
    sql: `
      CREATE TABLE vision_history (
        vision_key  TEXT NOT NULL,
        seq         INTEGER NOT NULL,
        vision      TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (vision_key, seq)
      );
      CREATE TABLE vision_history_cursor (
        vision_key TEXT PRIMARY KEY,
        seq        INTEGER NOT NULL
      );
      CREATE TABLE vision_snapshots (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        vision_key TEXT NOT NULL,
        name       TEXT NOT NULL,
        vision     TEXT NOT NULL,
        saved_at   TEXT NOT NULL
      );
      CREATE INDEX vision_snapshots_key ON vision_snapshots (vision_key);
      -- Presets are the owner's, not a track's: a layer, a scene or a whole vision, as JSON.
      CREATE TABLE presets (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        level    TEXT NOT NULL CHECK (level IN ('layer', 'scene', 'vision')),
        name     TEXT NOT NULL,
        data     TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );
    `
  }
]
