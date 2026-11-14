/**
 * Where a stem came from. Other tools read this: the Mix & Master Assistant only ever
 * uses 'own' stems, because it measures real bounces, not AI guesses.
 */
export type StemSource =
  /** Bounced out of Live by the owner. */
  | 'own'
  /** Split from the mixdown by the helper's separation model. */
  | 'split'

/** One stem of a track (see GLOSSARY.md). The database holds its path, never the audio. */
export interface Stem {
  id: number
  trackId: number
  /** "drums", "bass"... for split stems; the file name for the owner's own ("SUPERFLY Kick"). */
  name: string
  path: string
  source: StemSource
  /** The separation model, for split stems. */
  model?: string
  addedAt: string
}

/** Where a track's stem split has got to. Only one split per track runs at a time. */
export type SplitJob =
  | { trackId: number; state: 'running'; stage: string; fraction?: number }
  | { trackId: number; state: 'failed'; message: string }
