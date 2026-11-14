import { fileExtension, samePath, titleFromFileName } from './paths'
import { isSubgenreId, type SubgenreId } from './subgenres'

/**
 * Per-track setup for the Mix & Master Assistant (spec #44, stories 8 to 11):
 * subgenre, loudness target and reference tracks. Every number the checks aim
 * for lives in the tables below, so later checks read targets from one place.
 */

/** A range of values, inclusive at both ends. */
export interface Range {
  min: number
  max: number
}

export type LoudnessTargetId = 'club' | 'streaming'

export interface LoudnessTarget {
  id: LoudnessTargetId
  name: string
  blurb: string
  /** Integrated loudness the master should land in (LUFS). Club's range is shifted by the subgenre. */
  integratedLufs: Range
  /** The true peak ceiling (dBTP). */
  truePeakCeilingDbtp: number
  /** A stricter ceiling once the master is louder than a level, because loud masters clip more on encoding. */
  louderCeiling?: { aboveLufs: number; truePeakCeilingDbtp: number }
}

/** See GLOSSARY.md: Loudness target. Ids are stored in the database, so never rename one. */
export const LOUDNESS_TARGETS: Record<LoudnessTargetId, LoudnessTarget> = {
  club: {
    id: 'club',
    name: 'Club',
    blurb: 'Loud, for DJ sets and club systems.',
    integratedLufs: { min: -9, max: -6 },
    truePeakCeilingDbtp: -1
  },
  streaming: {
    id: 'streaming',
    name: 'Streaming',
    blurb: 'About where Spotify and Apple Music play it, so nothing gets turned down.',
    integratedLufs: { min: -15, max: -13 },
    truePeakCeilingDbtp: -1,
    louderCeiling: { aboveLufs: -14, truePeakCeilingDbtp: -2 }
  }
}

export const LOUDNESS_TARGET_IDS = Object.keys(LOUDNESS_TARGETS) as LoudnessTargetId[]

export const DEFAULT_LOUDNESS_TARGET: LoudnessTargetId = 'club'

export function isLoudnessTargetId(value: unknown): value is LoudnessTargetId {
  return typeof value === 'string' && Object.hasOwn(LOUDNESS_TARGETS, value)
}

/**
 * How loud and how squashed a style usually is. The subgenre picks one of these
 * as its default; it never sets tone (that comes from reference tracks).
 * The values are starting points from common practice, not measured from releases.
 */
export type DynamicsStyle = 'open' | 'standard' | 'dense'

export interface Dynamics {
  name: string
  /** Club loudness for this style (LUFS integrated), inside or near Club's general range. */
  clubLufs: Range
  /** Lowest peak-to-loudness ratio (dB) before the master counts as over-limited. */
  minPlrDb: number
}

export const DYNAMICS: Record<DynamicsStyle, Dynamics> = {
  open: { name: 'Open', clubLufs: { min: -9, max: -7 }, minPlrDb: 9 },
  standard: { name: 'Standard', clubLufs: { min: -8, max: -6 }, minPlrDb: 8 },
  dense: { name: 'Dense', clubLufs: { min: -7, max: -5 }, minPlrDb: 6 }
}

/** Used when the track has no subgenre yet: Club's general range. */
export const UNTAGGED_DYNAMICS: Dynamics = { name: 'General', clubLufs: LOUDNESS_TARGETS.club.integratedLufs, minPlrDb: 8 }

/** Every suite subgenre's default dynamics. The Record type makes a new subgenre fail to compile until it is placed here. */
export const SUBGENRE_DYNAMICS: Record<SubgenreId, DynamicsStyle> = {
  house: 'standard',
  'tech-house': 'standard',
  'deep-house': 'open',
  'progressive-house': 'open',
  'future-house': 'standard',
  'bass-house': 'dense',
  techno: 'standard',
  'melodic-techno': 'open',
  trance: 'standard',
  dubstep: 'dense',
  riddim: 'dense',
  'melodic-dubstep': 'standard',
  'future-bass': 'standard',
  'drum-and-bass': 'standard',
  'liquid-dnb': 'open',
  trap: 'dense',
  hardstyle: 'dense',
  'uk-garage': 'standard',
  breakbeat: 'standard',
  electro: 'standard',
  hyperpop: 'dense',
  phonk: 'dense'
}

export function dynamicsFor(subgenre: SubgenreId | null): Dynamics {
  return subgenre ? DYNAMICS[SUBGENRE_DYNAMICS[subgenre]] : UNTAGGED_DYNAMICS
}

/** The five bands every space is built from (see GLOSSARY.md: Space). Hz; null means open-ended. */
export const BANDS = [
  { id: 'sub', name: 'Sub', lowHz: null, highHz: 60 },
  { id: 'low', name: 'Low', lowHz: 60, highHz: 250 },
  { id: 'low-mid', name: 'Low-mid', lowHz: 250, highHz: 2000 },
  { id: 'presence', name: 'Presence', lowHz: 2000, highHz: 6000 },
  { id: 'air', name: 'Air', lowHz: 6000, highHz: null }
] as const

export type BandId = (typeof BANDS)[number]['id']

/**
 * A general electronic tone curve, used only when a track has no reference tracks.
 * Each band's share of the master's energy, in dB relative to the whole (loudness-matched),
 * with a wide tolerance because it is a rough average across styles, not a measured reference.
 */
export const ROUGH_ELECTRONIC_CONTOUR: { bandDb: Record<BandId, number>; toleranceDb: number } = {
  bandDb: { sub: -6, low: -3.5, 'low-mid': -7, presence: -12, air: -14 },
  toleranceDb: 4
}

/** What tone checks compare against: the owner's reference tracks, or the rough curve, flagged as rough. */
export type ToneReference =
  | { kind: 'references'; rough: false; tracks: ReferenceTrack[] }
  | { kind: 'rough-contour'; rough: true; label: string; contour: typeof ROUGH_ELECTRONIC_CONTOUR }

export const ROUGH_TONE_LABEL = 'Rough: compared with a general electronic curve. Add a reference track for real tone checks.'

export const MAX_REFERENCE_TRACKS = 3

/** Audio files that can be a reference track. */
export const REFERENCE_EXTENSIONS = ['wav', 'aif', 'aiff', 'flac', 'mp3', 'm4a', 'ogg']

/** A released song by another artist, compared against this track's mix and master (see GLOSSARY.md). */
export interface ReferenceTrack {
  path: string
  /** From the file name. */
  title: string
}

/** One track's Mix & Master setup, saved against the shared track. */
export interface MixSetup {
  trackId: number
  /** Null until the owner tags one; general dynamics are used meanwhile. */
  subgenre: SubgenreId | null
  loudnessTarget: LoudnessTargetId
  /** 0 to 3, in the order they were added. */
  referenceTracks: ReferenceTrack[]
  /** ISO 8601 time of the last save; null for a setup that was never saved. */
  updatedAt: string | null
}

/** The setup shown the first time a track is opened: Club, no references, and the artist profile's main subgenre if any. */
export function defaultMixSetup(trackId: number, profileSubgenre: SubgenreId | null = null): MixSetup {
  return {
    trackId,
    subgenre: isSubgenreId(profileSubgenre) ? profileSubgenre : null,
    loudnessTarget: DEFAULT_LOUDNESS_TARGET,
    referenceTracks: [],
    updatedAt: null
  }
}

/** Everything a later check needs from the setup, resolved to numbers. */
export interface MixTargets {
  loudnessTarget: LoudnessTargetId
  integratedLufs: Range
  truePeakCeilingDbtp: number
  louderCeiling: LoudnessTarget['louderCeiling'] | null
  minPlrDb: number
  /** Mix peaks before mastering (spec #44: −6 to −3 dBTP). */
  mixPeakDbtp: Range
  tone: ToneReference
}

export const MIX_PEAK_DBTP: Range = { min: -6, max: -3 }

export function mixTargets(setup: MixSetup): MixTargets {
  const target = LOUDNESS_TARGETS[setup.loudnessTarget]
  const dynamics = dynamicsFor(setup.subgenre)
  return {
    loudnessTarget: target.id,
    integratedLufs: target.id === 'club' ? dynamics.clubLufs : target.integratedLufs,
    truePeakCeilingDbtp: target.truePeakCeilingDbtp,
    louderCeiling: target.louderCeiling ?? null,
    minPlrDb: dynamics.minPlrDb,
    mixPeakDbtp: MIX_PEAK_DBTP,
    tone:
      setup.referenceTracks.length > 0
        ? { kind: 'references', rough: false, tracks: setup.referenceTracks }
        : { kind: 'rough-contour', rough: true, label: ROUGH_TONE_LABEL, contour: ROUGH_ELECTRONIC_CONTOUR }
  }
}

/** Adds dropped or picked files to a setup's references: skips non-audio and duplicates, stops at the max. */
export function addReferencePaths(current: ReferenceTrack[], paths: string[]): ReferenceTrack[] {
  const next = [...current]
  for (const path of paths) {
    if (next.length >= MAX_REFERENCE_TRACKS) break
    if (!REFERENCE_EXTENSIONS.includes(fileExtension(path))) continue
    if (next.some((r) => samePath(r.path, path))) continue
    next.push({ path, title: titleFromFileName(path) })
  }
  return next
}
