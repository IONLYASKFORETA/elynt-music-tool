import {
  emptyProfile,
  GOALS,
  MAX_REFERENCE_ARTISTS,
  PLATFORMS,
  type ArtistProfile,
  type GoalId,
  type PlatformId
} from '../shared/profile'
import { isSubgenreId, MAX_OTHER_SUBGENRES, type SubgenreId } from '../shared/subgenres'
import type { SuiteDatabase } from './db/database'

export interface ProfileStore {
  /** The suite's one artist profile; an empty profile if it was never saved. */
  get(): ArtistProfile
  /** Saves the whole profile (half-filled is fine) and returns it as stored. */
  save(profile: ArtistProfile): ArtistProfile
}

interface ProfileRow {
  artist_name: string | null
  links: string
  main_subgenre: string | null
  other_subgenres: string
  followers: string
  spotify_monthly_listeners: number | null
  budget_per_release: number | null
  distributor: string | null
  platforms: string
  reference_artists: string
  default_goal: string | null
  updated_at: string
}

export function createProfileStore(db: SuiteDatabase, now: () => Date = () => new Date()): ProfileStore {
  const read = db.prepare('SELECT * FROM artist_profile WHERE id = 1')
  const upsert = db.prepare(`
    INSERT INTO artist_profile (
      id, artist_name, links, main_subgenre, other_subgenres, followers, spotify_monthly_listeners,
      budget_per_release, distributor, platforms, reference_artists, default_goal, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      artist_name = excluded.artist_name,
      links = excluded.links,
      main_subgenre = excluded.main_subgenre,
      other_subgenres = excluded.other_subgenres,
      followers = excluded.followers,
      spotify_monthly_listeners = excluded.spotify_monthly_listeners,
      budget_per_release = excluded.budget_per_release,
      distributor = excluded.distributor,
      platforms = excluded.platforms,
      reference_artists = excluded.reference_artists,
      default_goal = excluded.default_goal,
      updated_at = excluded.updated_at
  `)

  const get = (): ArtistProfile => {
    const row = read.get() as unknown as ProfileRow | undefined
    return row ? fromRow(row) : emptyProfile()
  }

  return {
    get,
    save(input) {
      const p = normalizeProfile(input)
      upsert.run(
        p.artistName,
        JSON.stringify(p.links),
        p.subgenres.main,
        JSON.stringify(p.subgenres.others),
        JSON.stringify(p.audience.followers),
        p.audience.spotifyMonthlyListeners,
        p.budgetPerRelease,
        p.distributor,
        JSON.stringify(p.platforms),
        JSON.stringify(p.referenceArtists),
        p.defaultGoal,
        now().toISOString()
      )
      return get()
    }
  }
}

/**
 * Cleans a profile coming from the UI: trims text, turns blanks into "not filled in",
 * drops duplicates, and rejects values the suite doesn't know.
 */
export function normalizeProfile(input: ArtistProfile): ArtistProfile {
  const main = input.subgenres.main
  if (main !== null && !isSubgenreId(main)) throw new Error(`Unknown subgenre: ${String(main)}`)
  const others = unique(input.subgenres.others).filter((o) => o !== main)
  for (const o of others) if (!isSubgenreId(o)) throw new Error(`Unknown subgenre: ${String(o)}`)
  if (others.length > MAX_OTHER_SUBGENRES) {
    throw new Error(`Pick one main subgenre and at most ${MAX_OTHER_SUBGENRES} more`)
  }
  if (main === null && others.length > 0) throw new Error('Pick a main subgenre before adding more')

  const referenceArtists = unique(input.referenceArtists.map((a) => a.trim()).filter(Boolean))
  if (referenceArtists.length > MAX_REFERENCE_ARTISTS) {
    throw new Error(`List at most ${MAX_REFERENCE_ARTISTS} reference artists`)
  }

  const goal = input.defaultGoal
  if (goal !== null && !GOALS.some((g) => g.id === goal)) throw new Error(`Unknown goal: ${String(goal)}`)

  const links: Partial<Record<PlatformId, string>> = {}
  const followers: Partial<Record<PlatformId, number>> = {}
  for (const { id } of PLATFORMS) {
    const link = text(input.links[id])
    if (link !== null) links[id] = link
    const count = count0(input.audience.followers[id], `${id} followers`)
    if (count !== null) followers[id] = count
  }

  const platforms = unique(input.platforms)
  for (const p of platforms) if (!isPlatformId(p)) throw new Error(`Unknown platform: ${String(p)}`)

  return {
    artistName: text(input.artistName),
    links,
    subgenres: { main, others: others as SubgenreId[] },
    audience: {
      followers,
      spotifyMonthlyListeners: count0(input.audience.spotifyMonthlyListeners, 'Spotify monthly listeners')
    },
    budgetPerRelease: amount(input.budgetPerRelease),
    distributor: text(input.distributor),
    platforms,
    referenceArtists,
    defaultGoal: goal as GoalId | null,
    updatedAt: input.updatedAt
  }
}

function fromRow(row: ProfileRow): ArtistProfile {
  return {
    artistName: row.artist_name,
    links: JSON.parse(row.links),
    subgenres: {
      main: isSubgenreId(row.main_subgenre) ? row.main_subgenre : null,
      others: (JSON.parse(row.other_subgenres) as unknown[]).filter(isSubgenreId)
    },
    audience: { followers: JSON.parse(row.followers), spotifyMonthlyListeners: row.spotify_monthly_listeners },
    budgetPerRelease: row.budget_per_release,
    distributor: row.distributor,
    platforms: (JSON.parse(row.platforms) as unknown[]).filter(isPlatformId),
    referenceArtists: JSON.parse(row.reference_artists),
    defaultGoal: GOALS.some((g) => g.id === row.default_goal) ? (row.default_goal as GoalId) : null,
    updatedAt: row.updated_at
  }
}

function isPlatformId(value: unknown): value is PlatformId {
  return PLATFORMS.some((p) => p.id === value)
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** A whole count of 0 or more, or null when blank. */
function count0(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a whole number of 0 or more`)
  return value
}

/** A dollar amount of 0 or more, rounded to cents, or null when blank. */
function amount(value: number | null): number | null {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0) throw new Error('Budget must be 0 or more')
  return Math.round(value * 100) / 100
}
