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
  /** How drafts should sound. Read by the draft writer and its rule check. */
  voice: Voice
  /** One-time answers that show blockers before the first release plan. */
  setupCheck: SetupCheck
  /** Optional past singles, so the first plan has something to compare against. */
  pastReleases: PastRelease[]
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
    voice: emptyVoice(),
    setupCheck: emptySetupCheck(),
    pastReleases: [],
    updatedAt: null
  }
}

// ---------------------------------------------------------------- Voice

/** The owner pastes 3 to 5 captions; edited drafts that get used are added later. */
export const SUGGESTED_VOICE_EXAMPLES = { min: 3, max: 5 } as const
export const MAX_VOICE_EXAMPLES = 20
/** Instagram's caption limit, the longest of the platforms. */
export const MAX_VOICE_EXAMPLE_LENGTH = 2200

export const TONES = [
  { id: 'hype', name: 'Hype' },
  { id: 'chill', name: 'Chill' }
] as const
export type ToneId = (typeof TONES)[number]['id']

export const EMOJI_USE = [
  { id: 'none', name: 'No emoji' },
  { id: 'some', name: 'A few' },
  { id: 'lots', name: 'Lots' }
] as const
export type EmojiUseId = (typeof EMOJI_USE)[number]['id']

export const CAPS = [
  { id: 'normal', name: 'Normal' },
  { id: 'lowercase', name: 'all lowercase' },
  { id: 'shouty', name: 'CAPS for emphasis' }
] as const
export type CapsId = (typeof CAPS)[number]['id']

/** How drafts should sound. A null switch means "learn it from the examples". */
export interface Voice {
  /** Captions the owner wrote, as pasted. */
  examples: string[]
  tone: ToneId | null
  emoji: EmojiUseId | null
  caps: CapsId | null
  /** Words or phrases no draft may use. Matched without regard to case. */
  neverSay: string[]
}

export function emptyVoice(): Voice {
  return { examples: [], tone: null, emoji: null, caps: null, neverSay: [] }
}

/** Splits what the owner typed ("fire, banger\nvibes") into never-say words. */
export function parseNeverSay(typed: string): string[] {
  const seen = new Set<string>()
  const words: string[] = []
  for (const part of typed.split(/[,\n]/)) {
    const word = part.trim()
    if (word && !seen.has(word.toLowerCase())) {
      seen.add(word.toLowerCase())
      words.push(word)
    }
  }
  return words
}

// ---------------------------------------------------------------- Setup check

export const SOUNDCLOUD_PLANS = [
  { id: 'free', name: 'Free' },
  { id: 'artist', name: 'Artist' },
  { id: 'artist-pro', name: 'Artist Pro' }
] as const
export type SoundCloudPlanId = (typeof SOUNDCLOUD_PLANS)[number]['id']

/** Each answer is null until the owner answers it. */
export interface SetupCheck {
  /** The distributor's plan lets the owner choose the release date (DistroKid: Musician Plus or higher). */
  customReleaseDates: boolean | null
  spotifyForArtistsClaimed: boolean | null
  tiktokArtistAccount: boolean | null
  soundcloudPlan: SoundCloudPlanId | null
}

export function emptySetupCheck(): SetupCheck {
  return { customReleaseDates: null, spotifyForArtistsClaimed: null, tiktokArtistAccount: null, soundcloudPlan: null }
}

export type SetupItemId = keyof SetupCheck

export interface SetupItemStatus {
  id: SetupItemId
  question: string
  /** met: nothing blocked. unmet: `blocks` says what. unanswered: not checked yet. */
  state: 'met' | 'unmet' | 'unanswered'
  /** What an unmet item blocks, and how to fix it. Null unless unmet. */
  blocks: string | null
}

/**
 * The setup check as the plan engine and the profile screen read it. Never throws and
 * never blocks a release: unmet items only explain what the plan will lose.
 */
export function setupStatus(profile: Pick<ArtistProfile, 'setupCheck' | 'distributor'>): SetupItemStatus[] {
  const c = profile.setupCheck
  const plan = profile.distributor ? `your ${profile.distributor} plan` : 'your distributor’s plan'
  const yesNo = (v: boolean | null): SetupItemStatus['state'] => (v === null ? 'unanswered' : v ? 'met' : 'unmet')
  const items: Array<[SetupItemId, string, SetupItemStatus['state'], string]> = [
    [
      'customReleaseDates',
      `Does ${plan} let you choose the release date?`,
      yesNo(c.customReleaseDates),
      'Without a chosen date you can’t set a Friday release day weeks ahead, so the R−21 upload and the R−7 Spotify pitch can’t be planned. On DistroKid this needs Musician Plus or higher.'
    ],
    [
      'spotifyForArtistsClaimed',
      'Have you claimed your Spotify for Artists profile?',
      yesNo(c.spotifyForArtistsClaimed),
      'Blocks the Spotify editorial pitch (hard deadline R−7), which also gets the track into followers’ Release Radar, plus Canvas uploads. Claiming can take a few days, so do it before your first plan.'
    ],
    [
      'tiktokArtistAccount',
      'Is your TikTok an Artist Account?',
      yesNo(c.tiktokArtistAccount),
      'Without it your sound isn’t linked to your artist profile and you miss TikTok’s artist tools for new releases. Switch in TikTok settings once your music is distributed there.'
    ],
    [
      'soundcloudPlan',
      'Which SoundCloud plan are you on?',
      c.soundcloudPlan === null ? 'unanswered' : c.soundcloudPlan === 'free' ? 'unmet' : 'met',
      'On Free you can’t schedule the track to go public, so the app pings you at 00:01 on release day to do it by hand, and the R+14 SoundCloud boost step is skipped. Artist or Artist Pro unlocks both.'
    ]
  ]
  return items.map(([id, question, state, blocks]) => ({
    id,
    question,
    state,
    blocks: state === 'unmet' ? blocks : null
  }))
}

// ---------------------------------------------------------------- Past releases

/** A single released before the suite, with whatever numbers the owner remembers. */
export interface PastRelease {
  title: string
  /** YYYY-MM-DD. */
  releasedOn: string
  /** Numbers from the first 28 days, like the R+28 check-in. Each is optional. */
  spotifyStreams: number | null
  spotifySaves: number | null
  soundcloudPlays: number | null
  followersGained: number | null
}

export const PAST_RELEASE_NUMBERS = [
  { key: 'spotifyStreams', name: 'Spotify streams' },
  { key: 'spotifySaves', name: 'Spotify saves' },
  { key: 'soundcloudPlays', name: 'SoundCloud plays' },
  { key: 'followersGained', name: 'Followers gained' }
] as const satisfies ReadonlyArray<{ key: keyof PastRelease; name: string }>

export function emptyPastRelease(): PastRelease {
  return {
    title: '',
    releasedOn: '',
    spotifyStreams: null,
    spotifySaves: null,
    soundcloudPlays: null,
    followersGained: null
  }
}
