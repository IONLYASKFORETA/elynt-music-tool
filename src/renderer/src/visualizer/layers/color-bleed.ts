import type { Reactivity } from '../reactivity'
import { clamp01, type LayerKindDef } from './kind'

/**
 * Color Bleed (house style): a spectral rainbow smear off the shapes and type below, dripping
 * down the frame, plus an optional band of spectrum of its own (the visor in the prototype).
 * Jolts on kick and snare; the drips grow through builds on their own.
 */
export interface ColorBleedLayer {
  kind: 'colorBleed'
  reactivity: Reactivity
  /** Longest drip, as a share of the frame height, 0 to 1. */
  drip: number
  /** Sideways RGB smear, in pixels at 1080p. */
  smear: number
  /** 0 = pure spectrum, 1 = the vision's palette. */
  tint: number
  /** How much longer the drips get by the top of a build, 0 to 1. */
  growth: number
  /** The layer's own band of spectrum across the frame, 0 (none) to 1. */
  band: number
  /** How hard the last hit shoved the picture, 0 to 1. Set by reactivity, 0 at rest. */
  jolt: number
}

export const COLOR_BLEED: LayerKindDef<ColorBleedLayer> = {
  name: 'Color Bleed',
  reactivity: { reactsTo: 'kickSnare', strength: 0.7 },
  create: (reactivity) => ({ kind: 'colorBleed', drip: 0.22, smear: 5, tint: 0.45, growth: 0.8, band: 1, jolt: 0, reactivity }),
  respond: {
    hard: (l, a) => ({ ...l, drip: clamp01(l.drip * (1 + 1.2 * a)), smear: l.smear * (1 + 3 * a), jolt: clamp01(l.jolt + a) }),
    medium: (l, a) => ({ ...l, drip: clamp01(l.drip * (1 + 0.8 * a)), smear: l.smear * (1 + 1.5 * a), jolt: clamp01(l.jolt + 0.6 * a) }),
    slow: (l, a) => ({ ...l, drip: clamp01(l.drip * (1 + 0.8 * a)), smear: l.smear * (1 + 0.5 * a) })
  },
  params: (l) => [l.drip, l.smear, l.tint, l.growth, l.band, l.jolt]
}
