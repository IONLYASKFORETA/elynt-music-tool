import { titleFromFileName } from '../shared/paths'
import type { Track } from '../shared/track'
import type { SuiteDatabase } from './db/database'

export interface TrackLibrary {
  /** Adds the track a mixdown belongs to. Picking the same file again (in any letter case) returns the existing track. */
  addFromMixdown(mixdownPath: string): Track
  /** Every track in the suite, oldest first. Every tool lists the same records. */
  list(): Track[]
  get(id: number): Track | null
  /** Gives a track the owner's title, for example in the "What I heard" check. The mixdown stays where it is. */
  rename(id: number, title: string): Track
}

interface TrackRow {
  id: number
  title: string
  mixdown_path: string
  added_at: string
}

export function createTrackLibrary(db: SuiteDatabase): TrackLibrary {
  const insert = db.prepare(
    'INSERT INTO tracks (title, mixdown_path, added_at) VALUES (?, ?, ?) ON CONFLICT (mixdown_path) DO NOTHING'
  )
  const byPath = db.prepare('SELECT * FROM tracks WHERE mixdown_path = ?')
  const all = db.prepare('SELECT * FROM tracks ORDER BY id')
  const byId = db.prepare('SELECT * FROM tracks WHERE id = ?')
  const setTitle = db.prepare('UPDATE tracks SET title = ? WHERE id = ?')

  return {
    addFromMixdown(mixdownPath) {
      insert.run(titleFromFileName(mixdownPath), mixdownPath, new Date().toISOString())
      return toTrack(byPath.get(mixdownPath) as unknown as TrackRow)
    },
    list() {
      return (all.all() as unknown as TrackRow[]).map(toTrack)
    },
    get(id) {
      const row = byId.get(id) as unknown as TrackRow | undefined
      return row ? toTrack(row) : null
    },
    rename(id, title) {
      const clean = title.trim()
      if (!clean) throw new Error('A track needs a title.')
      if (setTitle.run(clean, id).changes === 0) throw new Error(`No track with id ${id}.`)
      return toTrack(byId.get(id) as unknown as TrackRow)
    }
  }
}

function toTrack(row: TrackRow): Track {
  return { id: row.id, title: row.title, mixdownPath: row.mixdown_path, addedAt: row.added_at }
}
