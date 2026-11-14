import {
  CAPS,
  EMOJI_USE,
  emptyProfile,
  emptySetupCheck,
  emptyVoice,
  GOALS,
  MAX_REFERENCE_ARTISTS,
  MAX_VOICE_EXAMPLE_LENGTH,
  MAX_VOICE_EXAMPLES,
  PAST_RELEASE_NUMBERS,
  PLATFORMS,
  SOUNDCLOUD_PLANS,
  TONES,
  type ArtistProfile,
  type GoalId,
  type PastRelease,
  type PlatformId,
  type SetupCheck,
  type Voice
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
  voice: string
  setup_check: string
  past_releases: string
  updated_at: string
}

export function createProfileStore(db: SuiteDatabase, now: () => Date = () => new Date()): ProfileStore {
  const read = db.prepare('SELECT * FROM artist_profile WHERE id = 1')
  const upsert = db.prepare(`
    INSERT INTO artist_profile (
      id, artist_name, links, main_subgenre, other_subgenres, followers, spotify_monthly_listeners,
      budget_per_release, distributor, platforms, reference_artists, default_goal,
      voice, setup_check, past_releases, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      voice = excluded.voice,
      setup_check = excluded.setup_check,
      past_releases = excluded.past_releases,
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
        JSON.stringify(p.voice),
        JSON.stringify(p.setupCheck),
        JSON.stringify(p.pastReleases),
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
    voice: normalizeVoice(input.voice ?? emptyVoice()),
    setupCheck: normalizeSetupCheck(input.setupCheck ?? emptySetupCheck()),
    pastReleases: normalizePastReleases(input.pastReleases ?? []),
    updatedAt: input.updatedAt
  }
}

function normalizeVoice(input: Voice): Voice {
  const examples = input.examples.map((e) => e.trim()).filter(Boolean)
  for (const e of examples) {
    if (e.length > MAX_VOICE_EXAMPLE_LENGTH) {
      throw new Error(`Each caption example must be at most ${MAX_VOICE_EXAMPLE_LENGTH} characters`)
    }
  }
  if (examples.length > MAX_VOICE_EXAMPLES) throw new Error(`Keep at most ${MAX_VOICE_EXAMPLES} caption examples`)
  const seen = new Set<string>()
  const neverSay: string[] = []
  for (const raw of input.neverSay) {
    const word = raw.trim()
    if (word && !seen.has(word.toLowerCase())) {
      seen.add(word.toLowerCase())
      neverSay.push(word)
    }
  }
  return {
    examples,
    tone: choice(input.tone, TONES, 'tone'),
    emoji: choice(input.emoji, EMOJI_USE, 'emoji use'),
    caps: choice(input.caps, CAPS, 'caps'),
    neverSay
  }
}

function normalizeSetupCheck(input: SetupCheck): SetupCheck {
  return {
    customReleaseDates: yesNo(input.customReleaseDates),
    spotifyForArtistsClaimed: yesNo(input.spotifyForArtistsClaimed),
    tiktokArtistAccount: yesNo(input.tiktokArtistAccount),
    soundcloudPlan: choice(input.soundcloudPlan, SOUNDCLOUD_PLANS, 'SoundCloud plan')
  }
}

function normalizePastReleases(input: PastRelease[]): PastRelease[] {
  const rows: PastRelease[] = []
  for (const r of input) {
    const title = text(r.title)
    const releasedOn = text(r.releasedOn)
    const numbers = PAST_RELEASE_NUMBERS.map(({ key, name }) => [key, count0(r[key], name)] as const)
    if (title === null && releasedOn === null && numbers.every(([, n]) => n === null)) continue
    if (title === null) throw new Error('Give each past single a title')
    if (releasedOn === null || !isCalendarDate(releasedOn)) {
      throw new Error(`Give "${title}" a release date (year, month and day)`)
    }
    rows.push({ title, releasedOn, ...(Object.fromEntries(numbers) as Omit<PastRelease, 'title' | 'releasedOn'>) })
  }
  // Newest first; ISO dates sort as text.
  return rows.sort((a, b) => b.releasedOn.localeCompare(a.releasedOn))
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value)
}

function choice<T extends string>(
  value: T | null | undefined,
  options: ReadonlyArray<{ id: string }>,
  label: string
): T | null {
  if (value === null || value === undefined) return null
  if (!options.some((o) => o.id === value)) throw new Error(`Unknown ${label}: ${String(value)}`)
  return value
}

function yesNo(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null
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
    voice: { ...emptyVoice(), ...JSON.parse(row.voice) },
    setupCheck: { ...emptySetupCheck(), ...JSON.parse(row.setup_check) },
    pastReleases: JSON.parse(row.past_releases),
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
