import type { AudioFeatures } from './audio-features'
import { DEFAULT_REACTIVITY, reactionAt, type Reaction, type Reactivity } from './reactivity'
import { NO_SIGNALS, type Tier, type TrackSignals } from './signals'
import { POSTER_FRAME_DEFAULTS, POSTER_FRAME_RESPONSES, posterFrameParams, type PosterFrameLayer } from './poster-frame'
import { POSTER_TYPE_DEFAULTS, POSTER_TYPE_RESPONSES, posterTypePass, type PosterTypeLayer, type TypeAnchors, type TypeText } from './poster-type'
import { SUBJECT_DEFAULTS, SUBJECT_RESPONSES, subjectPass, type SubjectLayer } from './subject'

export type { PosterFrameLayer } from './poster-frame'
export type { PosterTypeLayer } from './poster-type'
export type { SubjectLayer } from './subject'

/**
 * The layer data model (GLOSSARY: Layer, Scene). A scene is plain data: the
 * renderer draws whatever stack it is given, bottom to top, and the export
 * reads the same data. Each section of a track has its own scene (see vision.ts).
 */
export type Layer = GroundLayer | ClassicLayer | FinishLayer | PosterFrameLayer | PosterTypeLayer | SubjectLayer
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

export const LAYER_NAMES: Record<LayerKind, string> = {
  ground: 'Ground',
  classic: 'Classic',
  finish: 'Finish',
  posterFrame: 'Poster Frame',
  posterType: 'Poster Type',
  subject: 'Subject'
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
    case 'posterFrame':
      return { kind, ...POSTER_FRAME_DEFAULTS, reactivity }
    case 'posterType':
      return { kind, ...POSTER_TYPE_DEFAULTS, reactivity }
    case 'subject':
      return { kind, ...SUBJECT_DEFAULTS, reactivity }
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
 * row 0 = (t, energy, width, height); rows 1 and 2 = the layer's own parameters.
 */
export const UNIFORM_FLOATS = 12

export interface LayerPass {
  kind: LayerKind
  uniforms: Float32Array
  /** A picture the pass draws from, for the layers that need one (type, a subject image). */
  image?: PassImage
}

/**
 * What a pass draws from besides the picture below. Type is rasterized by the renderer from
 * its text and anchors (cached by `key` and the frame size); a picture is loaded from its URL.
 */
export type PassImage =
  | { kind: 'type'; key: string; text: TypeText; anchors: TypeAnchors }
  | { kind: 'picture'; url: string }

/** The track's credits, as poster layers set them: the title from the track, the name from the artist profile. */
export interface Credits {
  title: string
  artist: string
}

/** Where in the vision a frame falls, for the layers that care (Poster Type, Poster Frame). */
export interface FrameContext {
  /** Which section is playing, counted from 0, and when it started, in seconds. */
  sectionIndex: number
  sectionStart: number
  credits: Credits
}

export const NO_CONTEXT: FrameContext = { sectionIndex: 0, sectionStart: 0, credits: { title: '', artist: '' } }

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
  context: FrameContext = NO_CONTEXT
): FramePlan {
  return {
    spectrum: features.bands,
    passes: drawnLayers(scene).map((layer) => {
      const uniforms = new Float32Array(UNIFORM_FLOATS)
      uniforms.set([t, features.energy, size.width, size.height])
      const { params, image } = layerParams(react(layer, reactionAt(layer.reactivity, signals, t)), context, signals, t)
      uniforms.set(params, 4)
      return image ? { kind: layer.kind, uniforms, image } : { kind: layer.kind, uniforms }
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
  posterFrame: POSTER_FRAME_RESPONSES,
  posterType: POSTER_TYPE_RESPONSES,
  subject: SUBJECT_RESPONSES
}

function react(layer: Layer, reaction: Reaction): Layer {
  if (reaction.amount <= 0) return layer
  const respond = TIER_RESPONSES[layer.kind][reaction.tier] as (l: Layer, a: number) => Layer
  return respond(layer, reaction.amount)
}

function layerParams(
  layer: Layer,
  context: FrameContext,
  signals: TrackSignals,
  t: number
): { params: number[]; image?: PassImage } {
  switch (layer.kind) {
    case 'ground':
      return { params: [layer.hueSpeed, layer.lift] }
    case 'classic':
      return { params: [layer.height, layer.bleed, layer.barFill, layer.glitch] }
    case 'finish':
      return { params: [layer.grain, layer.scanlines, layer.vignette, layer.energyResponse] }
    case 'posterFrame':
      return { params: posterFrameParams(layer, context) }
    case 'posterType':
      return posterTypePass(layer, context, signals.events.downbeat, t)
    case 'subject':
      return subjectPass(layer)
  }
}
