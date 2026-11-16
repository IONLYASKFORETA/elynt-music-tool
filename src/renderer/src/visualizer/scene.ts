import type { AudioFeatures } from './audio-features'
import { DEFAULT_REACTIVITY, reactionAt, type Reaction, type Reactivity } from './reactivity'
import { COLOR_BLEED, type ColorBleedLayer } from './layers/color-bleed'
import { CHROME, type ChromeLayer } from './layers/chrome'
import { GLITCH, type GlitchLayer } from './layers/glitch'
import { LIGHT_PILLAR, type LightPillarLayer } from './layers/light-pillar'
import { DEFAULT_PALETTE, packPalette, PALETTE_FLOATS, type Palette } from './palette'
import { NO_SIGNALS, signalAt, type Tier, type TrackSignals } from './signals'

/**
 * The layer data model (GLOSSARY: Layer, Scene). A scene is plain data: the
 * renderer draws whatever stack it is given, bottom to top, and the export
 * reads the same data. Each section of a track has its own scene (see vision.ts).
 */
export type Layer = GroundLayer | ClassicLayer | FinishLayer | HitLayer
/** The house-style hit layers (V7), one file each under layers/. */
export type HitLayer = ColorBleedLayer | ChromeLayer | GlitchLayer | LightPillarLayer
export type { ColorBleedLayer, ChromeLayer, GlitchLayer, LightPillarLayer }
export type LayerKind = Layer['kind']

/** Every layer has a "reacts to" picker and a strength (GLOSSARY: Reactivity). */
interface LayerBase {
  reactivity: Reactivity
}

/** Black field with a slow color shift. */
export interface GroundLayer extends LayerBase {
  kind: 'ground'
  /** Full trips around the color wheel per minute. */
  hueSpeed: number
  /** How far the field lifts off pure black, 0 to 1. */
  lift: number
}

/** The spectrum, drawn in the house style. Follows the spectrum directly. */
export interface ClassicLayer extends LayerBase {
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
export interface FinishLayer extends LayerBase {
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

/** Ground and Finish sit under and over every scene; only the layers between them count toward the limit. */
export const EXEMPT_KINDS: readonly LayerKind[] = ['ground', 'finish']

/** At most this many active layers per scene (per section), Ground and Finish not counted. */
export const MAX_ACTIVE_LAYERS = 5

const HIT_LAYERS = { colorBleed: COLOR_BLEED, chrome: CHROME, glitch: GLITCH, lightPillar: LIGHT_PILLAR }

export const LAYER_NAMES: Record<LayerKind, string> = {
  ground: 'Ground',
  classic: 'Classic',
  finish: 'Finish',
  colorBleed: COLOR_BLEED.name,
  chrome: CHROME.name,
  glitch: GLITCH.name,
  lightPillar: LIGHT_PILLAR.name
}

/** A layer of a kind with its starting look and default reactivity. */
export function newLayer(kind: LayerKind): Layer {
  const reactivity = { ...DEFAULT_REACTIVITY[kind] }
  switch (kind) {
    case 'ground':
      return { kind, hueSpeed: 1.5, lift: 0.06, reactivity }
    case 'classic':
      return { kind, height: 0.8, bleed: 6, barFill: 0.72, glitch: 0.6, reactivity }
    case 'finish':
      return { kind, grain: 0.12, scanlines: 0.25, vignette: 0.55, energyResponse: 0.8, reactivity }
    case 'colorBleed':
    case 'chrome':
    case 'glitch':
    case 'lightPillar':
      return HIT_LAYERS[kind].create(reactivity)
  }
}

export const defaultScene: Scene = { layers: [newLayer('ground'), newLayer('classic'), newLayer('finish')] }

export function countsTowardLimit(kind: LayerKind): boolean {
  return !EXEMPT_KINDS.includes(kind)
}

export function activeLayerCount(scene: Scene): number {
  return scene.layers.filter((l) => countsTowardLimit(l.kind)).length
}

export function canAddLayer(scene: Scene, kind: LayerKind): boolean {
  return !countsTowardLimit(kind) || activeLayerCount(scene) < MAX_ACTIVE_LAYERS
}

/**
 * Adds a layer, refusing a sixth active one. Active layers go on top of the others but under
 * the Finish; a Ground goes at the bottom and a Finish at the top.
 */
export function addLayer(scene: Scene, layer: Layer): Scene {
  if (!canAddLayer(scene, layer.kind)) {
    throw new Error(`A section can have at most ${MAX_ACTIVE_LAYERS} active layers (Ground and Finish don't count).`)
  }
  const layers = [...scene.layers]
  if (layer.kind === 'ground') layers.unshift(layer)
  else if (layer.kind === 'finish') layers.push(layer)
  else {
    const finish = layers.findIndex((l) => l.kind === 'finish')
    layers.splice(finish === -1 ? layers.length : finish, 0, layer)
  }
  return { layers }
}

/** The layers that get drawn: past the limit, extra active layers are left out. */
function drawnLayers(scene: Scene): Layer[] {
  let active = 0
  return scene.layers.filter((l) => !countsTowardLimit(l.kind) || ++active <= MAX_ACTIVE_LAYERS)
}

/**
 * Uniforms for one pass, in 4-float rows matching `Frame` in common.wgsl:
 * row 0 = (t, energy, width, height); rows 1 and 2 = the layer's own parameters;
 * row 3 = (build, 0, 0, 0), how far into a build the track is; then the vision's palette.
 */
export const BUILD_OFFSET = 12
export const PALETTE_OFFSET = 16
export const UNIFORM_FLOATS = PALETTE_OFFSET + PALETTE_FLOATS

export interface LayerPass {
  kind: LayerKind
  uniforms: Float32Array
}

export interface FramePlan {
  passes: LayerPass[]
  spectrum: Float32Array
}

/**
 * Turns a scene plus what the audio sounds like at t into the passes the GPU runs. Each layer's
 * reaction at t (from the track's signals) pushes its parameters the way its tier says.
 */
export function planFrame(
  scene: Scene,
  features: AudioFeatures,
  t: number,
  size: { width: number; height: number },
  signals: TrackSignals = NO_SIGNALS,
  palette: Palette = DEFAULT_PALETTE
): FramePlan {
  const colors = packPalette(palette)
  const build = signalAt(signals, 'build', t)
  return {
    spectrum: features.bands,
    passes: drawnLayers(scene).map((layer) => {
      const uniforms = new Float32Array(UNIFORM_FLOATS)
      uniforms.set([t, features.energy, size.width, size.height])
      uniforms.set(layerParams(react(layer, reactionAt(layer.reactivity, signals, t))), 4)
      uniforms[BUILD_OFFSET] = build
      uniforms.set(colors, PALETTE_OFFSET)
      return { kind: layer.kind, uniforms }
    })
  }
}

type LayerOf<K extends LayerKind> = Extract<Layer, { kind: K }>
type TierResponse<K extends LayerKind> = Record<Tier, (layer: LayerOf<K>, amount: number) => LayerOf<K>>

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/**
 * How each layer kind answers each tier. Hard hits cut through (glitch, flash), medium pulses
 * swell with the drums, slow follows the energy. A new layer kind adds its own row here.
 */
const TIER_RESPONSES: { [K in LayerKind]: TierResponse<K> } = {
  ground: {
    hard: (l, a) => ({ ...l, lift: clamp01(l.lift + 0.3 * a) }),
    medium: (l, a) => ({ ...l, lift: clamp01(l.lift + 0.1 * a) }),
    slow: (l, a) => ({ ...l, lift: clamp01(l.lift + 0.12 * a) })
  },
  classic: {
    hard: (l, a) => ({ ...l, glitch: clamp01(l.glitch + a), bleed: l.bleed * (1 + 2 * a) }),
    medium: (l, a) => ({ ...l, height: clamp01(l.height * (1 + 0.5 * a)), bleed: l.bleed * (1 + a) }),
    slow: (l, a) => ({ ...l, height: clamp01(l.height * (1 + 0.3 * a)) })
  },
  finish: {
    hard: (l, a) => ({ ...l, grain: clamp01(l.grain + 0.4 * a), vignette: clamp01(l.vignette * (1 - 0.5 * a)) }),
    medium: (l, a) => ({ ...l, grain: clamp01(l.grain + 0.15 * a) }),
    slow: (l, a) => ({ ...l, energyResponse: clamp01(l.energyResponse * (1 + 0.5 * a)) })
  },
  colorBleed: COLOR_BLEED.respond,
  chrome: CHROME.respond,
  glitch: GLITCH.respond,
  lightPillar: LIGHT_PILLAR.respond
}

function react(layer: Layer, reaction: Reaction): Layer {
  if (reaction.amount <= 0) return layer
  const respond = TIER_RESPONSES[layer.kind][reaction.tier] as (l: Layer, a: number) => Layer
  return respond(layer, reaction.amount)
}

function layerParams(layer: Layer): number[] {
  switch (layer.kind) {
    case 'ground':
      return [layer.hueSpeed, layer.lift]
    case 'classic':
      return [layer.height, layer.bleed, layer.barFill, layer.glitch]
    case 'finish':
      return [layer.grain, layer.scanlines, layer.vignette, layer.energyResponse]
    case 'colorBleed':
      return COLOR_BLEED.params(layer)
    case 'chrome':
      return CHROME.params(layer)
    case 'glitch':
      return GLITCH.params(layer)
    case 'lightPillar':
      return LIGHT_PILLAR.params(layer)
  }
}
