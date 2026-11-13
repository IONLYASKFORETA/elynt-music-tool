import type { Track } from '../shared/track'
import type { SuiteDatabase } from './db/database'

export interface TrackLibrary {
  /** Adds the track a mixdown belongs to. Picking the same file again returns the existing track. */
  addFromMixdown(mixdownPath: string): Track
  /** Every track in the suite, oldest first. Every tool lists the same records. */
  list(): Track[]
}

interface TrackRow {
  id: number
  title: string
  mixdown_path: string
  added_at: string
}

export function createTrackLibrary(db: SuiteDatabase, now: () => Date = () => new Date()): TrackLibrary {
  const insert = db.prepare(
    'INSERT INTO tracks (title, mixdown_path, added_at) VALUES (?, ?, ?) ON CONFLICT (mixdown_path) DO NOTHING'
  )
  const byPath = db.prepare('SELECT * FROM tracks WHERE mixdown_path = ?')
  const all = db.prepare('SELECT * FROM tracks ORDER BY id')

  return {
    addFromMixdown(mixdownPath) {
      insert.run(titleFromFileName(mixdownPath), mixdownPath, now().toISOString())
      return toTrack(byPath.get(mixdownPath) as unknown as TrackRow)
    },
    list() {
      return (all.all() as unknown as TrackRow[]).map(toTrack)
    }
  }
}

/** "C:\\Bounces\\SUPERFLY.wav" -> "SUPERFLY". Handles Windows and POSIX separators. */
function titleFromFileName(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

function toTrack(row: TrackRow): Track {
  return { id: row.id, title: row.title, mixdownPath: row.mixdown_path, addedAt: row.added_at }
}
