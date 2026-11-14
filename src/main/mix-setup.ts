import { existsSync } from 'node:fs'
import {
  DEFAULT_LOUDNESS_TARGET,
  isLoudnessTargetId,
  MAX_REFERENCE_TRACKS,
  REFERENCE_EXTENSIONS,
  type MixSetup,
  type ReferenceTrack
} from '../shared/mix-setup'
import { fileExtension, samePath, titleFromFileName } from '../shared/paths'
import { isSubgenreId } from '../shared/subgenres'
import type { SuiteDatabase } from './db/database'
import type { TrackLibrary } from './tracks'

export interface MixSetupStore {
  /** A track's saved setup, or null if it was never set up (the UI then shows the first-time setup). */
  get(trackId: number): MixSetup | null
  /** Saves the whole setup and returns it as stored. Rejects values the suite doesn't know. */
  save(setup: MixSetup): MixSetup
}

interface MixSetupRow {
  track_id: number
  subgenre: string | null
  loudness_target: string
  reference_tracks: string
  updated_at: string
}

export interface MixSetupStoreOptions {
  now?: () => Date
  /** Checked on save, so a reference that was moved or deleted is caught straight away. */
  fileExists?: (path: string) => boolean
}

export function createMixSetupStore(
  db: SuiteDatabase,
  tracks: TrackLibrary,
  { now = () => new Date(), fileExists = existsSync }: MixSetupStoreOptions = {}
): MixSetupStore {
  const read = db.prepare('SELECT * FROM mix_setup WHERE track_id = ?')
  const upsert = db.prepare(`
    INSERT INTO mix_setup (track_id, subgenre, loudness_target, reference_tracks, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (track_id) DO UPDATE SET
      subgenre = excluded.subgenre,
      loudness_target = excluded.loudness_target,
      reference_tracks = excluded.reference_tracks,
      updated_at = excluded.updated_at
  `)

  const get = (trackId: number): MixSetup | null => {
    const row = read.get(trackId) as unknown as MixSetupRow | undefined
    return row ? fromRow(row) : null
  }

  return {
    get,
    save(input) {
      const track = tracks.get(input.trackId)
      if (!track) throw new Error(`No track with id ${String(input.trackId)}`)

      if (input.subgenre !== null && !isSubgenreId(input.subgenre)) {
        throw new Error(`Unknown subgenre: ${String(input.subgenre)}`)
      }
      if (!isLoudnessTargetId(input.loudnessTarget)) {
        throw new Error(`Unknown loudness target: ${String(input.loudnessTarget)}`)
      }

      const paths: string[] = []
      for (const { path } of input.referenceTracks) {
        const trimmed = path.trim()
        if (!trimmed || paths.some((p) => samePath(p, trimmed))) continue
        if (!REFERENCE_EXTENSIONS.includes(fileExtension(trimmed))) {
          throw new Error(`${titleFromFileName(trimmed)} isn't an audio file the assistant can read`)
        }
        if (samePath(trimmed, track.mixdownPath)) {
          throw new Error("A reference track is someone else's song, not this track's own mixdown")
        }
        if (!fileExists(trimmed)) throw new Error(`Can't find the reference track ${trimmed}`)
        paths.push(trimmed)
      }
      if (paths.length > MAX_REFERENCE_TRACKS) {
        throw new Error(`Pick at most ${MAX_REFERENCE_TRACKS} reference tracks`)
      }

      upsert.run(track.id, input.subgenre, input.loudnessTarget, JSON.stringify(paths), now().toISOString())
      return get(track.id)!
    }
  }
}

function fromRow(row: MixSetupRow): MixSetup {
  const paths = JSON.parse(row.reference_tracks) as string[]
  return {
    trackId: row.track_id,
    subgenre: isSubgenreId(row.subgenre) ? row.subgenre : null,
    loudnessTarget: isLoudnessTargetId(row.loudness_target) ? row.loudness_target : DEFAULT_LOUDNESS_TARGET,
    referenceTracks: paths.map((path): ReferenceTrack => ({ path, title: titleFromFileName(path) })),
    updatedAt: row.updated_at
  }
}
