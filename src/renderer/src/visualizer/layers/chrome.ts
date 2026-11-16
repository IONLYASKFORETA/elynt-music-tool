import type { Reactivity } from '../reactivity'
import { clamp01, type LayerKindDef } from './kind'

/**
 * Chrome (house style): iridescent holographic liquid metal, a few blobs melting into each other,
 * lit by the vision's palette with a thin-film rainbow on top. Spikes on the snare.
 */
export interface ChromeLayer {
  kind: 'chrome'
  reactivity: Reactivity
  /** How big the metal is, as a share of the frame height, 0 to 1. */
  size: number
  /** How spiky its surface is, 0 (smooth) to 1. */
  spikes: number
  /** How much thin-film rainbow is on the metal, 0 to 1. */
  film: number
  /** How fast the blobs drift, in loops per minute. */
  flow: number
}

export const CHROME: LayerKindDef<ChromeLayer> = {
  name: 'Chrome',
  reactivity: { reactsTo: 'snare', strength: 0.8 },
  create: (reactivity) => ({ kind: 'chrome', size: 0.42, spikes: 0.12, film: 0.55, flow: 3, reactivity }),
  respond: {
    hard: (l, a) => ({ ...l, spikes: clamp01(l.spikes + a), size: clamp01(l.size * (1 + 0.25 * a)), film: clamp01(l.film + 0.3 * a) }),
    medium: (l, a) => ({ ...l, spikes: clamp01(l.spikes + 0.8 * a), size: clamp01(l.size * (1 + 0.1 * a)) }),
    slow: (l, a) => ({ ...l, size: clamp01(l.size * (1 + 0.3 * a)), flow: l.flow * (1 + a) })
  },
  params: (l) => [l.size, l.spikes, l.film, l.flow]
}
