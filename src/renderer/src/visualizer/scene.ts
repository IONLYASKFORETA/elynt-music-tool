import type { AudioFeatures } from './audio-features'

/**
 * The layer data model (GLOSSARY: Layer, Scene). A scene is plain data: the
 * renderer draws whatever stack it is given, bottom to top. The export will
 * read the same data later.
 */
export type Layer = GroundLayer | ClassicLayer | FinishLayer
export type LayerKind = Layer['kind']

/** Black field with a slow color shift. */
export interface GroundLayer {
  kind: 'ground'
  /** Full trips around the color wheel per minute. */
  hueSpeed: number
  /** How far the field lifts off pure black, 0 to 1. */
  lift: number
}

/** The spectrum, drawn in the house style. Follows the spectrum directly. */
export interface ClassicLayer {
  kind: 'classic'
  /** Tallest bar as a share of half the frame height, 0 to 1. */
  height: number
  /** Width of the rainbow color bleed, in pixels at 1080p. */
  bleed: number
  /** Share of each band's width that is drawn, 0 to 1. */
  barFill: number
  /** How hard loud frames slice and shift the picture, 0 to 1. */
  glitch: number
}

/** Grain, scanlines and vignette over everything below. Follows overall energy. */
export interface FinishLayer {
  kind: 'finish'
  grain: number
  scanlines: number
  vignette: number
  /** How much energy pushes grain and aberration up, 0 to 1. */
  energyResponse: number
}

export interface Scene {
  layers: Layer[]
}

export const defaultScene: Scene = {
  layers: [
    { kind: 'ground', hueSpeed: 1.5, lift: 0.06 },
    { kind: 'classic', height: 0.8, bleed: 6, barFill: 0.72, glitch: 0.6 },
    { kind: 'finish', grain: 0.12, scanlines: 0.25, vignette: 0.55, energyResponse: 0.8 }
  ]
}

/**
 * Uniforms for one pass, in 4-float rows matching `Frame` in common.wgsl:
 * row 0 = (t, energy, width, height); rows 1 and 2 = the layer's own parameters.
 */
export const UNIFORM_FLOATS = 12

export interface LayerPass {
  kind: LayerKind
  uniforms: Float32Array
}

export interface FramePlan {
  passes: LayerPass[]
  spectrum: Float32Array
}

/** Turns a scene plus what the audio sounds like at t into the passes the GPU runs. */
export function planFrame(
  scene: Scene,
  features: AudioFeatures,
  t: number,
  size: { width: number; height: number }
): FramePlan {
  return {
    spectrum: features.bands,
    passes: scene.layers.map((layer) => {
      const uniforms = new Float32Array(UNIFORM_FLOATS)
      uniforms.set([t, features.energy, size.width, size.height])
      uniforms.set(layerParams(layer), 4)
      return { kind: layer.kind, uniforms }
    })
  }
}

function layerParams(layer: Layer): number[] {
  switch (layer.kind) {
    case 'ground':
      return [layer.hueSpeed, layer.lift]
    case 'classic':
      return [layer.height, layer.bleed, layer.barFill, layer.glitch]
    case 'finish':
      return [layer.grain, layer.scanlines, layer.vignette, layer.energyResponse]
  }
}
