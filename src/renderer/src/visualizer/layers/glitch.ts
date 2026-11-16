import type { Reactivity } from '../reactivity'
import { clamp01, type LayerKindDef } from './kind'

/**
 * Glitch (house style): block tears, datamosh, pixel drag and RGB split over the picture below.
 * Nearly clean at rest, hard on drops and downbeats.
 */
export interface GlitchLayer {
  kind: 'glitch'
  reactivity: Reactivity
  /** How much of the frame tears, 0 to 1. A little stays at rest. */
  amount: number
  /** Size of a torn block, in pixels at 1080p. */
  block: number
  /** RGB split, in pixels at 1080p. */
  split: number
  /** How much pixels drag down in streaks, 0 to 1. */
  drag: number
  /** How much torn blocks smear like a datamosh, 0 to 1. */
  mosh: number
}

export const GLITCH: LayerKindDef<GlitchLayer> = {
  name: 'Glitch',
  reactivity: { reactsTo: 'dropDownbeat', strength: 0.9 },
  create: (reactivity) => ({ kind: 'glitch', amount: 0.05, block: 48, split: 3, drag: 0.1, mosh: 0.1, reactivity }),
  respond: {
    hard: (l, a) => ({
      ...l,
      amount: clamp01(l.amount + a),
      split: l.split * (1 + 4 * a),
      drag: clamp01(l.drag + 0.6 * a),
      mosh: clamp01(l.mosh + 0.8 * a)
    }),
    medium: (l, a) => ({ ...l, amount: clamp01(l.amount + 0.5 * a), split: l.split * (1 + 1.5 * a), mosh: clamp01(l.mosh + 0.3 * a) }),
    slow: (l, a) => ({ ...l, amount: clamp01(l.amount + 0.25 * a), drag: clamp01(l.drag + 0.3 * a) })
  },
  params: (l) => [l.amount, l.block, l.split, l.drag, l.mosh]
}
