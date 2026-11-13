import type { SubgenreChoice } from './subgenres'

/** The platforms the profile knows: one link and one follower count each. */
export const PLATFORMS = [
  { id: 'spotify', name: 'Spotify' },
  { id: 'soundcloud', name: 'SoundCloud' },
  { id: 'tiktok', name: 'TikTok' },
  { id: 'instagram', name: 'Instagram' },
  { id: 'youtube', name: 'YouTube' }
] as const

export type PlatformId = (typeof PLATFORMS)[number]['id']

/** What a release aims for by default. Each release can override it. */
export const GOALS = [
  { id: 'grow-fans', name: 'Grow fans and followers' },
  { id: 'streams', name: 'More streams' },
  { id: 'dj-support', name: 'DJ support' },
  { id: 'get-signed', name: 'Get signed' }
] as const

export type GoalId = (typeof GOALS)[number]['id']

/** The goal a release uses when the profile leaves it blank. */
export const DEFAULT_GOAL: GoalId = 'grow-fans'

/** Reference artists are 2 or 3 artists whose release style the owner learns from. */
export const MAX_REFERENCE_ARTISTS = 3

export const DISTRIBUTORS = ['DistroKid', 'TuneCore', 'CD Baby', 'Amuse', 'UnitedMasters', 'Ditto'] as const

/**
 * What the owner tells the suite once, so every tool fits them (see GLOSSARY.md).
 * One row for the whole suite. Every field is optional: null, an empty list or a
 * missing key means "not filled in yet".
 *
 * Voice, past releases and the setup check are added by the Release Assistant (R7).
 */
export interface ArtistProfile {
  /** Also what the Visualizer puts on screen. */
  artistName: string | null
  /** One optional link per platform. */
  links: Partial<Record<PlatformId, string>>
  subgenres: SubgenreChoice
  /** Follower counts per platform plus Spotify monthly listeners. Check-ins update these. */
  audience: {
    followers: Partial<Record<PlatformId, number>>
    spotifyMonthlyListeners: number | null
  }
  /** Default spend per release, in US dollars. */
  budgetPerRelease: number | null
  distributor: string | null
  /** The platforms that matter most, in the order they were picked. */
  platforms: PlatformId[]
  referenceArtists: string[]
  /** Null means DEFAULT_GOAL. */
  defaultGoal: GoalId | null
  /** ISO 8601 time of the last save; null if never saved. */
  updatedAt: string | null
}

/** The profile before anything is filled in. */
export function emptyProfile(): ArtistProfile {
  return {
    artistName: null,
    links: {},
    subgenres: { main: null, others: [] },
    audience: { followers: {}, spotifyMonthlyListeners: null },
    budgetPerRelease: null,
    distributor: null,
    platforms: [],
    referenceArtists: [],
    defaultGoal: null,
    updatedAt: null
  }
}
