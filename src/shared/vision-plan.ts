/**
 * A vision plan (GLOSSARY: Vision): the art direction Claude writes for one track, as data.
 * A one-line concept, a 3 to 5 color palette, motifs, a plan per section built only from the
 * layer library, how the drop lands, and the type treatment. The Visualizer builds a plan into
 * real scenes (renderer/src/visualizer/vision-build.ts).
 *
 * Shared, because the main process checks Claude's reply against it and the window builds it.
 */

/** Every layer kind in the layer library. Must match `LayerKind` in the renderer's scene.ts. */
export const LAYER_KINDS = [
  'ground',
  'classic',
  'finish',
  'colorBleed',
  'chrome',
  'glitch',
  'lightPillar',
  'posterFrame',
  'posterType',
  'subject'
] as const
export type PlanLayerKind = (typeof LAYER_KINDS)[number]

/** What a layer can react to: the renderer's signal names plus 'none'. Must match PICKABLE_SIGNALS. */
export const REACTS_TO = ['kick', 'snare', 'bass', 'hihat', 'downbeat', 'drop', 'energy', 'kickSnare', 'dropDownbeat', 'build', 'none'] as const
export type PlanReactsTo = (typeof REACTS_TO)[number]

/** Ground and Finish sit under and over every scene and don't count toward the limit. */
export const PLAN_EXEMPT_KINDS: readonly PlanLayerKind[] = ['ground', 'finish']
export const PLAN_MAX_ACTIVE_LAYERS = 5

interface ParamSpec {
  min: number
  max: number
  /** Whole numbers only. */
  integer?: boolean
  about: string
}

interface KindSpec {
  name: string
  about: string
  /** The settings Claude may set. Anything else on a layer (an image, the words) is not Claude's to set here. */
  params: Record<string, ParamSpec>
}

const unit = (about: string): ParamSpec => ({ min: 0, max: 1, about })

/**
 * The layer library as Claude sees it: each kind's settings and their ranges. A renderer test
 * checks these against the layers' own defaults, so the two can't drift apart.
 */
export const LAYER_CATALOG: Record<PlanLayerKind, KindSpec> = {
  ground: {
    name: 'Ground',
    about: 'Black field under everything, with a slow color shift. Always present.',
    params: { hueSpeed: { min: 0, max: 6, about: 'trips around the color wheel per minute' }, lift: { min: 0, max: 0.3, about: 'how far it lifts off black' } }
  },
  classic: {
    name: 'Classic',
    about: 'The spectrum drawn in the house style; follows the audio directly.',
    params: {
      height: unit('tallest bar, share of half the frame'),
      bleed: { min: 0, max: 24, about: 'rainbow bleed width in px at 1080p' },
      barFill: { min: 0.1, max: 1, about: 'share of each band drawn' },
      glitch: unit('how hard loud frames slice the picture')
    }
  },
  finish: {
    name: 'Finish',
    about: 'Grain, scanlines, vignette and chromatic edge over everything. Always present.',
    params: {
      grain: { min: 0, max: 0.5, about: 'film grain' },
      scanlines: unit('scanline strength'),
      vignette: unit('vignette'),
      energyResponse: unit('how much energy pushes grain and aberration')
    }
  },
  colorBleed: {
    name: 'Color Bleed',
    about: 'Spectral rainbow smear dripping off shapes and type.',
    params: {
      drip: unit('longest drip, share of frame height'),
      smear: { min: 0, max: 24, about: 'sideways RGB smear in px at 1080p' },
      tint: unit('0 pure spectrum, 1 the palette'),
      growth: unit('how much the drips grow through builds'),
      band: unit('its own band of spectrum across the frame')
    }
  },
  chrome: {
    name: 'Chrome',
    about: 'Iridescent holographic liquid metal.',
    params: {
      size: { min: 0.1, max: 1, about: 'size, share of frame height' },
      spikes: unit('0 smooth to 1 spiky'),
      film: unit('thin-film rainbow on the metal'),
      flow: { min: 0, max: 12, about: 'drift speed in loops per minute' }
    }
  },
  glitch: {
    name: 'Glitch',
    about: 'Block tears, datamosh, pixel drag and RGB split. Nearly clean at rest.',
    params: {
      amount: { min: 0, max: 0.5, about: 'share of the frame torn at rest' },
      block: { min: 8, max: 160, about: 'torn block size in px at 1080p' },
      split: { min: 0, max: 16, about: 'RGB split in px at 1080p' },
      drag: unit('pixel drag streaks'),
      mosh: unit('datamosh smear')
    }
  },
  lightPillar: {
    name: 'Light Pillar',
    about: 'Vertical beams that slam down on the biggest moments. Dark at rest.',
    params: {
      fire: unit('how brightly the beams burn at rest; usually 0'),
      count: { min: 1, max: 7, integer: true, about: 'number of beams' },
      width: { min: 2, max: 40, about: 'beam core width in px at 1080p' },
      bloom: unit('glow around the beams')
    }
  },
  posterFrame: {
    name: 'Poster Frame',
    about: 'Grid, border, crop marks and logo mark; holds still and cuts at each section.',
    params: {
      columns: { min: 1, max: 8, integer: true, about: 'grid columns' },
      rows: { min: 1, max: 6, integer: true, about: 'grid rows' },
      weight: unit('line weight'),
      marks: unit('crop marks'),
      logo: unit('logo mark'),
      opacity: unit('brightness over the picture')
    }
  },
  posterType: {
    name: 'Poster Type',
    about: "Big set type: title, artist, katakana and the owner's words, revealed on downbeats.",
    params: { chrome: unit('chrome tint on the white type'), glitch: unit('how hard type slices as it snaps in') }
  },
  subject: {
    name: 'Subject',
    about: "An image of the track's motif (generated or the owner's own), pulsing on the kick.",
    params: {
      scale: { min: 0.1, max: 1, about: 'height, share of the frame' },
      x: unit('centre, share of frame width'),
      y: unit('centre, share of frame height'),
      glow: unit('glow off its edges')
    }
  }
}

export interface PlannedLayer {
  kind: PlanLayerKind
  reactsTo: PlanReactsTo
  /** 0 to 1. */
  strength: number
  /** Some or all of the kind's settings; the rest keep the layer's own defaults. */
  params: Record<string, number>
}

export interface SectionPlan {
  /** Which section of the track, by its place in the analysis, from 0. */
  section: number
  /** The look in a few words. */
  look: string
  layers: PlannedLayer[]
}

export interface VisionPlan {
  /** A short name to tell the three apart. */
  name: string
  /** The one-line concept. */
  concept: string
  /** 3 to 5 #rrggbb colors. */
  palette: string[]
  motifs: string[]
  sections: SectionPlan[]
  /** How the drop lands: in words, and how hard, 0 to 1. */
  drop: { lands: string; intensity: number }
  /** The type treatment: in words, the owner's words on screen (may be empty), and katakana on or off. */
  type: { treatment: string; words: string; katakana: boolean }
}

export const VISION_COUNT = 3
export const MIN_PALETTE = 3
export const MAX_PALETTE = 5
const HEX = /^#[0-9a-f]{6}$/i

const str = (description?: string) => ({ type: 'string', ...(description && { description }) })
const num = (description: string) => ({ type: 'number', description })
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false
})

/**
 * The JSON schema Claude's reply is constrained to. Layers are one variant per kind in the layer
 * library, each with only that kind's settings. Structured outputs can't express number ranges,
 * counts or string patterns, so `checkVisionsReply` checks those.
 */
export function visionsSchema(): Record<string, unknown> {
  const layerVariants = LAYER_KINDS.map((kind) => {
    const spec = LAYER_CATALOG[kind]
    const params = Object.fromEntries(
      Object.entries(spec.params).map(([name, p]) => [
        name,
        { type: p.integer ? 'integer' : 'number', description: `${p.about} (${p.min} to ${p.max})` }
      ])
    )
    return obj({
      kind: { type: 'string', enum: [kind], description: `${spec.name}: ${spec.about}` },
      reactsTo: { type: 'string', enum: [...REACTS_TO] },
      strength: num('0 to 1'),
      params: obj(params)
    })
  })
  const vision = obj({
    name: str('two or three words'),
    concept: str('one line'),
    palette: { type: 'array', items: str('#rrggbb'), description: '3 to 5 colors' },
    motifs: { type: 'array', items: str() },
    sections: {
      type: 'array',
      description: 'one entry per section of the track, in order',
      items: obj({
        section: { type: 'integer', description: 'the section index, from 0' },
        look: str('a few words'),
        layers: { type: 'array', items: { anyOf: layerVariants } }
      })
    },
    drop: obj({ lands: str('how the drop lands, one or two sentences'), intensity: num('0 to 1') }),
    type: obj({ treatment: str(), words: str('short words to set on screen, or empty'), katakana: { type: 'boolean' } })
  })
  return obj({ visions: { type: 'array', items: vision, description: 'exactly 3 visions' } })
}

export type CheckResult = { ok: true; visions: VisionPlan[] } | { ok: false; problems: string[] }

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x))
const words = (x: unknown) => (typeof x === 'string' ? x : '')
const wordList = (x: unknown) => (Array.isArray(x) ? x.filter((w): w is string => typeof w === 'string') : [])

/**
 * Checks Claude's reply for a track of `sectionCount` sections. Anything outside the layer
 * library, an unknown setting or signal, a bad palette, a section planned twice or left out,
 * or a crowded section is a problem, and the reply is rejected so it can be asked for again.
 * Numbers out of range are pulled back into range rather than rejected.
 */
export function checkVisionsReply(reply: unknown, sectionCount: number): CheckResult {
  if (!isObject(reply) || !Array.isArray(reply.visions)) return { ok: false, problems: ['The reply must be an object with a "visions" list.'] }
  if (reply.visions.length !== VISION_COUNT) return { ok: false, problems: [`Send exactly ${VISION_COUNT} visions, not ${reply.visions.length}.`] }
  const problems: string[] = []
  const visions = reply.visions.map((raw, i) => checkVision(raw, sectionCount, `Vision ${i + 1}`, problems))
  return problems.length ? { ok: false, problems } : { ok: true, visions }
}

function checkVision(raw: unknown, sectionCount: number, where: string, problems: string[]): VisionPlan {
  const v = isObject(raw) ? raw : {}
  const palette = wordList(v.palette)
  if (palette.length < MIN_PALETTE || palette.length > MAX_PALETTE) {
    problems.push(`${where}: a palette has ${MIN_PALETTE} to ${MAX_PALETTE} colors, not ${palette.length}.`)
  } else {
    const bad = palette.find((c) => !HEX.test(c))
    if (bad !== undefined) problems.push(`${where}: "${bad}" is not a color like #ff2e88.`)
  }

  const rawSections = Array.isArray(v.sections) ? v.sections : []
  const indices = rawSections.map((s) => (isObject(s) ? s.section : undefined))
  const covered = new Set(indices)
  if (rawSections.length !== sectionCount || covered.size !== sectionCount || [...Array(sectionCount).keys()].some((i) => !covered.has(i))) {
    problems.push(`${where}: plan each of the ${sectionCount} sections once, by index 0 to ${sectionCount - 1}.`)
  }
  const sections = rawSections
    .map((s, i) => checkSection(isObject(s) ? s : {}, `${where}, section ${i + 1}`, problems))
    .sort((a, b) => a.section - b.section)

  const drop = isObject(v.drop) ? v.drop : {}
  const type = isObject(v.type) ? v.type : {}
  return {
    name: words(v.name),
    concept: words(v.concept),
    palette: palette.map((c) => c.toLowerCase()),
    motifs: wordList(v.motifs),
    sections,
    drop: { lands: words(drop.lands), intensity: clamp(Number(drop.intensity) || 0, 0, 1) },
    type: { treatment: words(type.treatment), words: words(type.words), katakana: type.katakana !== false }
  }
}

function checkSection(s: Record<string, unknown>, where: string, problems: string[]): SectionPlan {
  const layers: PlannedLayer[] = []
  for (const raw of Array.isArray(s.layers) ? s.layers : []) {
    const layer = checkLayer(isObject(raw) ? raw : {}, where, problems)
    if (layer) layers.push(layer)
  }
  const active = layers.filter((l) => !PLAN_EXEMPT_KINDS.includes(l.kind)).length
  if (active > PLAN_MAX_ACTIVE_LAYERS) problems.push(`${where}: ${active} active layers; a section has at most ${PLAN_MAX_ACTIVE_LAYERS}.`)
  return { section: typeof s.section === 'number' ? s.section : -1, look: words(s.look), layers }
}

function checkLayer(l: Record<string, unknown>, where: string, problems: string[]): PlannedLayer | null {
  const kind = l.kind as PlanLayerKind
  if (!LAYER_KINDS.includes(kind)) {
    problems.push(`${where}: "${String(l.kind)}" is not a layer in the layer library.`)
    return null
  }
  const spec = LAYER_CATALOG[kind]
  const reactsTo = l.reactsTo as PlanReactsTo
  if (!REACTS_TO.includes(reactsTo)) problems.push(`${where}: ${spec.name} can't react to "${String(l.reactsTo)}".`)
  const params: Record<string, number> = {}
  for (const [name, value] of Object.entries(isObject(l.params) ? l.params : {})) {
    const p = spec.params[name]
    if (!p) {
      problems.push(`${where}: ${spec.name} has no parameter "${name}".`)
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(`${where}: ${spec.name} "${name}" must be a number.`)
      continue
    }
    const clamped = clamp(value, p.min, p.max)
    params[name] = p.integer ? Math.round(clamped) : clamped
  }
  return { kind, reactsTo, strength: clamp(Number(l.strength) || 0, 0, 1), params }
}
