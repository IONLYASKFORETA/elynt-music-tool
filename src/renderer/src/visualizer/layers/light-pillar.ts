import type { Reactivity } from '../reactivity'
import { clamp01, type LayerKindDef } from './kind'

/**
 * Light Pillar (house style): vertical beams of light that slam down on the biggest moments, in
 * the vision's colors with white-hot cores. Dark at rest, hard on drops and downbeats.
 */
export interface LightPillarLayer {
  kind: 'lightPillar'
  reactivity: Reactivity
  /** How brightly the beams burn, 0 (off) to 1. Pushed up by reactivity. */
  fire: number
  /** How many beams, 1 to 7. */
  count: number
  /** Beam core width, in pixels at 1080p. */
  width: number
  /** Glow around the beams and on the floor, 0 to 1. */
  bloom: number
}

export const LIGHT_PILLAR: LayerKindDef<LightPillarLayer> = {
  name: 'Light Pillar',
  reactivity: { reactsTo: 'dropDownbeat', strength: 1 },
  create: (reactivity) => ({ kind: 'lightPillar', fire: 0, count: 3, width: 10, bloom: 0.6, reactivity }),
  respond: {
    hard: (l, a) => ({ ...l, fire: clamp01(l.fire + a), width: l.width * (1 + 0.8 * a) }),
    medium: (l, a) => ({ ...l, fire: clamp01(l.fire + 0.5 * a) }),
    slow: (l, a) => ({ ...l, fire: clamp01(l.fire + 0.35 * a) })
  },
  params: (l) => [l.fire, Math.min(7, Math.max(1, Math.round(l.count))), l.width, l.bloom]
}
