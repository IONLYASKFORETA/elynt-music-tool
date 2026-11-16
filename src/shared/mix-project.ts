import type { LiveSet, LiveTrack } from './live-set'

/**
 * The Mix & Master project (M2): a track's Ableton project folder, the newest Live Set in it, and
 * the bounces Aden exported into its `Elynt Bounces` subfolder.
 */

/** The fixed subfolder of the project folder that bounces go into. */
export const BOUNCES_FOLDER = 'Elynt Bounces'

/** Audio the assistant measures. Live also writes .asd analysis files next to them; those are skipped. */
export const BOUNCE_EXTENSIONS = ['wav', 'aif', 'aiff', 'flac']

/** The export settings that make bounces measure correctly, for the help panel. */
export const BOUNCE_SETTINGS: { setting: string; value: string; why: string }[] = [
  { setting: 'Rendered Track', value: 'All Individual Tracks', why: 'Gives a stem per Live track, plus the Main track as the mixdown.' },
  { setting: 'File Type', value: 'WAV', why: 'Lossless, so nothing is smeared before it is measured.' },
  { setting: 'Bit Depth', value: '32-bit float', why: 'Keeps peaks above 0 dB, so headroom is measured as it really is.' },
  { setting: 'Normalize', value: 'Off', why: 'Normalizing changes the level, so loudness and headroom would be wrong.' },
  { setting: 'Folder', value: BOUNCES_FOLDER, why: 'Export into this subfolder of the project folder, so the app finds them.' }
]

/** Which stem file went with which Live track. liveTrack is null when no Live track matched. */
export interface StemMatch {
  file: string
  liveTrack: string | null
}

export interface SortedBounces {
  /** File names of mixdowns: the Main (or Master) track, the Set's own name, or a file called "mixdown". */
  mixdowns: string[]
  /** Every other bounce, in the order given. */
  stems: StemMatch[]
  unmatchedStems: string[]
  /** Live tracks (including groups and returns) that no stem was found for, in Live's order. */
  unmatchedLiveTracks: string[]
}

/** What sorting needs from a Live Set: its file name without .als, and its Live tracks. */
export interface SetForMatching {
  name: string
  tracks: Pick<LiveTrack, 'name'>[]
  returns: Pick<LiveTrack, 'name'>[]
}

/** Lowercase words only: "SUPERFLY 1-Kick" and "superfly_1 kick" both become "superfly 1 kick". */
function words(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function baseName(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? file
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** True when `name` is `part` or ends with it as whole words ("superfly sub bass" ends with "sub bass"). */
function endsWithWords(name: string, part: string): boolean {
  return part !== '' && (name === part || name.endsWith(` ${part}`))
}

/**
 * Splits bounce files into mixdowns and stems, and matches stems to Live tracks by file name.
 * Live's "All Individual Tracks" export names each file "<file name> <Live track name>", so a stem
 * matches the Live track whose name ends its file name; the longest such name wins ("Sub Bass" over "Bass").
 */
export function sortBounces(files: string[], set: SetForMatching | null): SortedBounces {
  const liveTracks = set ? [...set.tracks, ...set.returns].map((t) => t.name) : []
  const taken = new Set<number>()
  const setName = set ? words(set.name) : null
  const mixdowns: string[] = []
  const stems: StemMatch[] = []

  for (const file of files) {
    const name = words(baseName(file))
    const candidates = liveTracks
      .map((track, index) => ({ track, index, key: words(track) }))
      .filter((c) => !taken.has(c.index) && endsWithWords(name, c.key))
      .sort((a, b) => b.key.length - a.key.length || a.index - b.index)
    const match = candidates[0]
    if (match) {
      taken.add(match.index)
      stems.push({ file, liveTrack: match.track })
    } else if (isMixdownName(name, setName)) {
      mixdowns.push(file)
    } else {
      stems.push({ file, liveTrack: null })
    }
  }

  return {
    mixdowns,
    stems,
    unmatchedStems: stems.filter((s) => s.liveTrack === null).map((s) => s.file),
    unmatchedLiveTracks: liveTracks.filter((_, index) => !taken.has(index))
  }
}

function isMixdownName(name: string, setName: string | null): boolean {
  if (setName !== null && name === setName) return true
  if (endsWithWords(name, 'main') || endsWithWords(name, 'master')) return true
  return name.split(' ').includes('mixdown')
}

/** One file in `Elynt Bounces`. */
export interface Bounce {
  path: string
  file: string
  /** ISO 8601 time the file was last written. */
  savedAt: string
}

/** The Live Set the assistant works on: always the newest .als at the top of the project folder. */
export interface ProjectLiveSet {
  path: string
  savedAt: string
  /** What the Live Set reader read, or null with readError when it couldn't. */
  read: LiveSet | null
  readError: string | null
}

export interface MixProject {
  trackId: number
  folder: string
  /** False when the saved folder has gone (moved, renamed or a drive not plugged in). */
  folderFound: boolean
  /** Null when there is no .als at the top of the folder. */
  liveSet: ProjectLiveSet | null
  /** False until `Elynt Bounces` exists. */
  bouncesFolderFound: boolean
  bouncesFolder: string
  mixdowns: Bounce[]
  stems: (Bounce & { liveTrack: string | null })[]
  unmatchedStems: string[]
  unmatchedLiveTracks: string[]
  /**
   * Set when the Live Set was saved after some bounces, so advice may be about an old mix.
   * Only a warning: it never stops a run.
   */
  staleBounces: { liveSetSavedAt: string; files: string[] } | null
  /** A Live Set was read and there is at least one bounce. Stale bounces still count. */
  readyToAnalyze: boolean
}

/** What the project watcher noticed. Later tickets re-run on these. */
export type MixProjectChange =
  | { kind: 'live-set'; path: string; savedAt: string }
  | { kind: 'bounces'; added: string[]; updated: string[] }

export interface MixProjectChangeEvent {
  trackId: number
  changes: MixProjectChange[]
}
