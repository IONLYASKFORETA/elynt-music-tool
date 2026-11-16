import { coverArtUrl, mediaTypeOf, parseMediaUrl, type CoverArt, type MediaItem, type MediaType } from '../shared/media'
import type { SuiteDatabase } from './db/database'
import type { TrackLibrary } from './tracks'

/** Reads a clip's length and frame rate, so every export frame can pick the exact clip frame. */
export type ClipProbe = (path: string) => Promise<{ durationSeconds: number; fps: number }>

export interface MediaShelf {
  /** Every shelf item, oldest first. */
  list(): MediaItem[]
  /** Adds files by path; one already on the shelf (in any letter case) is returned as it is. Rejects other kinds of file. */
  add(paths: readonly string[]): Promise<MediaItem[]>
  /** Takes an item off the shelf. The file stays where it is. */
  remove(id: number): void
  /** Makes an image the logo, replacing the last one; null means no logo. */
  setLogo(id: number | null): void
  logo(): MediaItem | null
  coverArt(trackId: number): CoverArt | null
  /** Attaches an image as the track's cover art, or takes it off with null. */
  setCoverArt(trackId: number, path: string | null): void
  /** The file behind an elynt-media:// address, only if the database holds it. */
  pathFor(url: string): string | null
}

interface Row {
  id: number
  type: MediaType
  path: string
  is_logo: number
  duration_seconds: number | null
  fps: number | null
  added_at: string
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

export function createMediaShelf(deps: {
  db: SuiteDatabase
  tracks: TrackLibrary
  probeClip: ClipProbe
  now?: () => Date
}): MediaShelf {
  const { db, tracks, probeClip } = deps
  const now = deps.now ?? (() => new Date())
  const all = db.prepare('SELECT * FROM media_shelf ORDER BY id')
  const byId = db.prepare('SELECT * FROM media_shelf WHERE id = ?')
  const byPath = db.prepare('SELECT * FROM media_shelf WHERE path = ?')
  const insert = db.prepare(
    'INSERT INTO media_shelf (type, path, duration_seconds, fps, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (path) DO NOTHING'
  )
  const remove = db.prepare('DELETE FROM media_shelf WHERE id = ?')
  const clearLogo = db.prepare('UPDATE media_shelf SET is_logo = 0 WHERE is_logo = 1')
  const markLogo = db.prepare('UPDATE media_shelf SET is_logo = 1 WHERE id = ?')
  const logo = db.prepare('SELECT * FROM media_shelf WHERE is_logo = 1')
  const cover = db.prepare('SELECT path FROM track_cover_art WHERE track_id = ?')
  const putCover = db.prepare(
    'INSERT INTO track_cover_art (track_id, path) VALUES (?, ?) ON CONFLICT (track_id) DO UPDATE SET path = excluded.path'
  )
  const dropCover = db.prepare('DELETE FROM track_cover_art WHERE track_id = ?')

  const get = (id: number) => {
    const row = byId.get(id) as unknown as Row | undefined
    return row ? toItem(row) : null
  }

  const shelf: MediaShelf = {
    list: () => (all.all() as unknown as Row[]).map(toItem),
    async add(paths) {
      const typed = paths.map((path) => {
        const type = mediaTypeOf(path)
        if (!type) throw new Error(`${fileName(path)} isn't an image or a video clip.`)
        return { path, type }
      })
      const added: MediaItem[] = []
      for (const { path, type } of typed) {
        const known = byPath.get(path) as unknown as Row | undefined
        if (known) {
          added.push(toItem(known))
          continue
        }
        const facts = type === 'clip' ? await probeClip(path) : null
        insert.run(type, path, facts?.durationSeconds ?? null, facts?.fps ?? null, now().toISOString())
        added.push(toItem(byPath.get(path) as unknown as Row))
      }
      return added
    },
    remove(id) {
      remove.run(id)
    },
    setLogo(id) {
      if (id !== null) {
        const item = get(id)
        if (!item) throw new Error(`No shelf item with id ${id}.`)
        if (item.type !== 'image') throw new Error('The logo has to be an image.')
      }
      db.exec('BEGIN')
      try {
        clearLogo.run()
        if (id !== null) markLogo.run(id)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    logo() {
      const row = logo.get() as unknown as Row | undefined
      return row ? toItem(row) : null
    },
    coverArt(trackId) {
      const row = cover.get(trackId) as { path: string } | undefined
      return row ? { trackId, path: row.path, name: fileName(row.path), url: coverArtUrl(trackId) } : null
    },
    setCoverArt(trackId, path) {
      if (!tracks.get(trackId)) throw new Error(`No track with id ${trackId}.`)
      if (path === null) {
        dropCover.run(trackId)
        return
      }
      if (mediaTypeOf(path) !== 'image') throw new Error('Cover art has to be an image.')
      putCover.run(trackId, path)
    },
    pathFor(url) {
      const address = parseMediaUrl(url)
      if (!address) return null
      if (address.from === 'shelf') return get(address.id)?.path ?? null
      return shelf.coverArt(address.trackId)?.path ?? null
    }
  }
  return shelf
}

function toItem(row: Row): MediaItem {
  return {
    id: row.id,
    type: row.type,
    path: row.path,
    name: fileName(row.path),
    isLogo: row.is_logo === 1,
    durationSeconds: row.duration_seconds,
    fps: row.fps,
    addedAt: row.added_at
  }
}
