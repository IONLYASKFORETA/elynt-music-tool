import type { Reactivity } from '../reactivity'
import type { Tier } from '../signals'

/**
 * Everything one layer kind brings to the layer library, kept in one file per kind: its name,
 * starting look, default reactivity, how it answers each tier, and the uniforms its shader reads.
 */
export interface LayerKindDef<L extends { kind: string; reactivity: Reactivity }> {
  name: string
  reactivity: Reactivity
  create(reactivity: Reactivity): L
  /** How the layer answers a reaction of `amount` (0 to 1) in each tier. */
  respond: Record<Tier, (layer: L, amount: number) => L>
  /** Up to 8 floats: p0 then p1 in common.wgsl. */
  params(layer: L): number[]
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
