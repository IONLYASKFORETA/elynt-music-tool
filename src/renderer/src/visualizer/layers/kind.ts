import type { FormatLayout } from '../../../../shared/formats'
import type { Reactivity } from '../reactivity'
import type { FrameContext, PassImage } from '../scene'
import type { Tier, TrackSignals } from '../signals'

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

/** What a frame gives a layer besides its own settings: where it falls in the vision, the signals, the time. */
export interface FrameInput {
  context: FrameContext
  signals: TrackSignals
  t: number
}

/**
 * A layer kind whose pass needs more than its own settings (the poster layers, V8): its place
 * in the vision, the signals, and a picture to draw from.
 */
export interface FramedLayerKindDef<L extends { kind: string; reactivity: Reactivity }> extends Omit<LayerKindDef<L>, 'params'> {
  /**
   * Re-flows the layer for the frame's format (V16), before it reacts: where it sits and how big,
   * with the owner's tweaks for that format. Kinds without it look the same in every format.
   */
  place?(layer: L, layout: FormatLayout): L
  /** Up to 8 floats (p0 then p1), and the picture the shader reads as layerTex, if any. */
  pass(layer: L, frame: FrameInput): { params: number[]; image?: PassImage }
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
