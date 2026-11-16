import type { LayerKind } from './scene'
import { SIGNAL_NAMES, SIGNALS, signalAt, type SignalName, type Tier, type TrackSignals } from './signals'

/** What one layer reacts to (its "reacts to" picker) and how strongly, 0 to 1. */
export interface Reactivity {
  reactsTo: SignalName | 'none'
  strength: number
}

/** How hard a layer is being pushed at one instant, and in which tier's way. */
export interface Reaction {
  tier: Tier
  /** 0 to 1: the signal at t times the layer's strength. */
  amount: number
}

export const NO_REACTION: Reaction = { tier: 'slow', amount: 0 }

/** The picker's choices. Hi-hats are there for the owner to pick, but no default uses them. */
export const PICKABLE_SIGNALS: readonly (SignalName | 'none')[] = [...SIGNAL_NAMES, 'none']

export function signalLabel(name: SignalName | 'none'): string {
  return name === 'none' ? 'Nothing' : SIGNALS[name].label
}

/**
 * What each layer kind reacts to when first placed: the backdrop breathes with the energy,
 * the spectrum pulses on the kick, the finish hits on downbeats. Hi-hats are off by default.
 */
export const DEFAULT_REACTIVITY: Record<LayerKind, Reactivity> = {
  ground: { reactsTo: 'energy', strength: 0.6 },
  classic: { reactsTo: 'kick', strength: 0.7 },
  finish: { reactsTo: 'downbeat', strength: 0.5 }
}

/** A layer's reaction at t. The tier comes from the signal, so a kick is always a medium pulse. */
export function reactionAt(reactivity: Reactivity, signals: TrackSignals, t: number): Reaction {
  if (reactivity.reactsTo === 'none') return NO_REACTION
  const strength = Math.min(1, Math.max(0, reactivity.strength))
  return { tier: SIGNALS[reactivity.reactsTo].tier, amount: strength * signalAt(signals, reactivity.reactsTo, t) }
}
