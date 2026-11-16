import type { Reactivity } from '../reactivity'
import { clamp01, type FramedLayerKindDef } from './kind'

/**
 * Subject (layer library): an image of the track's motif, generated (V9) or the owner's own
 * (V18), fitted into the frame with a medium kick pulse and a glow off its edges in the vision's
 * palette. Any image works; one with transparency shows what is below through it.
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
  /** How much glow bleeds from its edges, 0 to 1. */
  glow: number
}

export const SUBJECT: FramedLayerKindDef<SubjectLayer> = {
  name: 'Subject',
  reactivity: { reactsTo: 'kick', strength: 0.6 },
  create: (reactivity) => ({ kind: 'subject', image: null, scale: 0.62, x: 0.5, y: 0.5, glow: 0.35, reactivity }),
  // The kick swells it; hard hits punch it bigger and flare the glow; energy breathes it a little.
  respond: {
    hard: (l, a) => ({ ...l, scale: l.scale * (1 + 0.2 * a), glow: clamp01(l.glow + 0.6 * a) }),
    medium: (l, a) => ({ ...l, scale: l.scale * (1 + 0.12 * a), glow: clamp01(l.glow + 0.25 * a) }),
    slow: (l, a) => ({ ...l, scale: l.scale * (1 + 0.06 * a) })
  },
  /** p0 = (scale, x, y, glow); the image is the layer's picture. */
  pass: (l) => ({
    params: [l.scale, l.x, l.y, l.glow],
    ...(l.image ? { image: { kind: 'picture' as const, url: l.image } } : {})
  })
}
