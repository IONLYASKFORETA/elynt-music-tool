/**
 * Track analysis (V1), saved on the shared track so all three tools read the same grid.
 * Produced by the helper's `track.analyze` (helper/src/elynt_helper/analysis). Every value
 * is a proposal the owner can correct later in the "What I heard" check (V3).
 */

/** The parts of a club track, in GLOSSARY.md's words. */
export type SectionLabel = 'intro' | 'build' | 'drop' | 'breakdown' | 'outro'

export const SECTION_LABELS: readonly SectionLabel[] = ['intro', 'build', 'drop', 'breakdown', 'outro']

export interface Section {
  label: SectionLabel
  /** Seconds from the start of the mixdown. The first section starts at 0 and the last ends at the track's end. */
  start: number
  end: number
  /** Which bar it starts on, counting the first full bar as 0. */
  startBar: number
  /** 0 to 1: how clear the change and the label were. */
  confidence: number
  /**
   * "heuristic": from energy and low end on the bar grid (no model labels builds or drops).
   * "owner": moved or relabelled by the owner in the "What I heard" check (V3).
   */
  source: 'heuristic' | 'owner'
}

export type MoodLabel = 'euphoric' | 'dark' | 'dreamy' | 'melancholic' | 'uplifting' | 'moody'

export interface CoarseMood {
  label: MoodLabel
  /** -1 calm to 1 energetic. */
  arousal: number
  /** -1 dark to 1 bright. */
  valence: number
  /** For example "A minor", or null when no key stands out. */
  key: string | null
  keyConfidence: number
  source: 'heuristic'
}

/**
 * Mood detail from the optional Gemini mood listen (V12). Claude can't hear audio,
 * so this is the only AI that listens to the track. Only there when a Gemini key is set.
 */
export interface MoodDetail {
  source: 'gemini'
  /** The Gemini model that listened. */
  model: string
  label: MoodLabel
  /** -1 calm to 1 energetic. */
  arousal: number
  /** -1 dark to 1 bright. */
  valence: number
  /** A few words for the emotion and vibe, for example "menacing", "weightless". */
  words: string[]
  /** One or two sentences on how the track feels. */
  summary: string
  /** How each section feels, by its place in `sections`. */
  sections: { index: number; feeling: string; intensity: number }[]
}

export interface TrackAnalysis {
  analyzerVersion: number
  durationSeconds: number
  bpm: number
  beatsPerBar: 4
  /** Beat times in seconds, on one constant-tempo grid unless `constantTempo` is false. */
  beats: number[]
  /** The beats that start a bar. */
  downbeats: number[]
  /** "beat-this" when the Beat This! model found the beats, "dsp" for the built-in tracker. */
  beatSource: 'beat-this' | 'dsp'
  constantTempo: boolean
  sections: Section[]
  /** Loudness over time, 0 to 1, `hz` values a second. */
  energy: { hz: number; values: number[] }
  mood: CoarseMood
  /** Added by the Gemini mood listen when a key is set. Without it, `mood` is all there is. */
  moodDetail?: MoodDetail
  /** Plain-words notes on how the result was reached. */
  notes: string[]
  /** How long the helper took. */
  seconds: number
}

export type AnalysisStatus =
  /** Queued, waiting for the helper. */
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'

/**
 * Where the "What I heard" check (V3) stands for the latest analysis: not seen yet, confirmed
 * (with or without corrections), or skipped by the owner. A new analysis run starts it over.
 */
export type HeardCheck = 'unchecked' | 'confirmed' | 'skipped'

export interface TrackAnalysisState {
  trackId: number
  status: AnalysisStatus
  /** The latest result. Kept while a re-run is pending or running. */
  analysis: TrackAnalysis | null
  /** Why the last run failed, in words. */
  error: string | null
  /** ISO 8601 time `analysis` was made. */
  analyzedAt: string | null
  check: HeardCheck
  /** ISO 8601 time the owner confirmed or skipped the check. */
  checkedAt: string | null
}
