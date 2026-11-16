import type { Reactivity } from './reactivity'
import type { PassImage } from './scene'
import type { Tier } from './signals'

/**
 * Subject (layer library): an image of the track's motif, generated (V9) or the owner's own
 * (V18), fitted into the frame with a medium kick pulse. Any image works; one with transparency
 * shows what is below through it.
 */
export interface SubjectLayer {
  kind: 'subject'
  reactivity: Reactivity
  /** A URL the renderer can load (a file, blob or data URL); null shows nothing yet. */
  image: string | null
  /** The image's height as a share of the frame's height, fitted so it never overflows the width. */
  scale: number
  /** Where its centre sits, as a share of the frame. */
  x: number
  y: number
  /** How much spectral glow bleeds from its edges, 0 to 1. */
  glow: number
}

export const SUBJECT_DEFAULTS: Omit<SubjectLayer, 'kind' | 'reactivity'> = {
  image: null,
  scale: 0.62,
  x: 0.5,
  y: 0.5,
  glow: 0.35
}

/** Uniforms: p0 = (scale, x, y, glow). */
export function subjectPass(layer: SubjectLayer): { params: number[]; image?: PassImage } {
  return {
    params: [layer.scale, layer.x, layer.y, layer.glow],
    ...(layer.image ? { image: { kind: 'picture' as const, url: layer.image } } : {})
  }
}

/** The kick swells it; hard hits punch it bigger and flare the glow; energy breathes it a little. */
export const SUBJECT_RESPONSES: Record<Tier, (layer: SubjectLayer, amount: number) => SubjectLayer> = {
  hard: (l, a) => ({ ...l, scale: l.scale * (1 + 0.2 * a), glow: clamp01(l.glow + 0.6 * a) }),
  medium: (l, a) => ({ ...l, scale: l.scale * (1 + 0.12 * a), glow: clamp01(l.glow + 0.25 * a) }),
  slow: (l, a) => ({ ...l, scale: l.scale * (1 + 0.06 * a) })
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
