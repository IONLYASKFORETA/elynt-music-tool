import { paletteProblem } from './palette'
import { PICKABLE_SIGNALS, type Reactivity } from './reactivity'
import { addLayer, EXEMPT_KINDS, LAYER_NAMES, newLayer, type Layer, type LayerKind } from './scene'
import { TRANSITION_STYLES, type TransitionStyle } from './transitions'
import type { Vision, VisionSection } from './vision'

/**
 * Controls at every scope (V14): the whole video, each section and each layer have their own
 * sliders, and a note box whose note Claude turns into a change set at that scope. Every edit
 * from a slider or a note is a `VisionChange` applied through `applyChange`, the one seam
 * history (V15) can watch.
 */

/** Where a control or a note applies. */
export type Scope = { kind: 'video' } | { kind: 'section'; section: number } | { kind: 'layer'; section: number; layer: number }

/** What a slider sets: the video (both null), one section (layer null), or one layer. */
export interface Target {
  section: number | null
  layer: number | null
}

export type VisionChange =
  /** Moves one slider. */
  | { op: 'set'; section: number | null; layer: number | null; param: string; value: number }
  /** Changes what one layer reacts to. */
  | { op: 'reactTo'; section: number; layer: number; signal: Reactivity['reactsTo'] }
  /** Changes how a section hands over to the next. */
  | { op: 'transition'; section: number; style: TransitionStyle }
  | { op: 'palette'; colors: string[] }
  /** Adds a layer of the library to a section, in its starting look. */
  | { op: 'addLayer'; section: number; kind: LayerKind }
  | { op: 'removeLayer'; section: number; layer: number }

export interface Slider {
  param: string
  label: string
  min: number
  max: number
  step: number
}

/** How hard everything in the video, or in one section, reacts: 1 is as the layers say, 0 is still, 2 is twice as hard. */
const INTENSITY: Slider = { param: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.05 }
const STRENGTH: Slider = { param: 'strength', label: 'Strength', min: 0, max: 1, step: 0.05 }

const unit = (param: string, label: string): Slider => ({ param, label, min: 0, max: 1, step: 0.01 })
const range = (param: string, label: string, min: number, max: number, step: number): Slider => ({ param, label, min, max, step })

/**
 * Each layer kind's own sliders, from the layer library. Settings that reactivity sets (Color
 * Bleed's jolt) and settings that are not numbers (words, images) have none.
 */
export const LAYER_SLIDERS: Record<LayerKind, readonly Slider[]> = {
  ground: [range('hueSpeed', 'Color shift', 0, 6, 0.1), unit('lift', 'Lift')],
  classic: [unit('height', 'Height'), range('bleed', 'Bleed', 0, 24, 0.5), unit('barFill', 'Bar fill'), unit('glitch', 'Glitch')],
  finish: [unit('grain', 'Grain'), unit('scanlines', 'Scanlines'), unit('vignette', 'Vignette'), unit('energyResponse', 'Energy response')],
  colorBleed: [unit('drip', 'Drip'), range('smear', 'Smear', 0, 24, 0.5), unit('tint', 'Palette tint'), unit('growth', 'Build growth'), unit('band', 'Band')],
  chrome: [unit('size', 'Size'), unit('spikes', 'Spikes'), unit('film', 'Film'), range('flow', 'Flow', 0, 12, 0.1)],
  glitch: [unit('amount', 'Amount'), range('block', 'Block size', 4, 160, 1), range('split', 'RGB split', 0, 24, 0.5), unit('drag', 'Drag'), unit('mosh', 'Mosh')],
  lightPillar: [unit('fire', 'Fire at rest'), range('count', 'Beams', 1, 7, 1), range('width', 'Width', 1, 60, 1), unit('bloom', 'Bloom')],
  posterFrame: [
    range('columns', 'Columns', 1, 8, 1),
    range('rows', 'Rows', 1, 6, 1),
    unit('weight', 'Line weight'),
    unit('marks', 'Crop marks'),
    unit('logo', 'Logo mark'),
    unit('opacity', 'Opacity')
  ],
  posterType: [unit('chrome', 'Chrome tint'), unit('glitch', 'Glitch')],
  subject: [range('scale', 'Size', 0.1, 1, 0.01), unit('x', 'Across'), unit('y', 'Down'), unit('glow', 'Glow')]
}

/** The sliders at a target: intensity for the video and for a section; strength and the layer's own settings for a layer. */
export function slidersAt(vision: Vision, target: Target): readonly Slider[] {
  if (target.section === null) return [INTENSITY]
  const section = vision.sections[target.section]
  if (!section) return []
  if (target.layer === null) return [INTENSITY]
  const layer = section.scene.layers[target.layer]
  return layer ? [STRENGTH, ...LAYER_SLIDERS[layer.kind]] : []
}

/** A slider's current value. Missing intensities read as 1. */
export function controlValue(vision: Vision, target: Target, param: string): number {
  if (target.section === null) return vision.intensity ?? 1
  const section = vision.sections[target.section]
  if (target.layer === null) return section?.intensity ?? 1
  const layer = section?.scene.layers[target.layer]
  if (!layer) return NaN
  if (param === 'strength') return layer.reactivity.strength
  return (layer as unknown as Record<string, number>)[param] ?? NaN
}

/**
 * Makes one change, checked against the layer library: a slider that doesn't exist at its
 * target, a layer kind outside the library, a signal or transition that doesn't exist, a bad
 * palette or a sixth active layer all throw, with a reason the owner can read. Values are
 * clamped to the slider's range and whole-number settings rounded.
 */
export function applyChange(vision: Vision, change: VisionChange): Vision {
  switch (change.op) {
    case 'set': {
      const target = { section: change.section, layer: change.layer }
      const slider = slidersAt(vision, target).find((s) => s.param === change.param)
      if (!slider) throw new Error(`There is no "${change.param}" control ${whereLabel(vision, target)}.`)
      if (typeof change.value !== 'number' || !Number.isFinite(change.value)) throw new Error(`"${String(change.value)}" is not a number.`)
      const value = fit(slider, change.value)
      if (change.section === null) return { ...vision, intensity: value }
      if (change.layer === null) return withSection(vision, change.section, (s) => ({ ...s, intensity: value }))
      return withLayer(vision, change.section, change.layer, (l) =>
        change.param === 'strength' ? { ...l, reactivity: { ...l.reactivity, strength: value } } : ({ ...l, [change.param]: value } as Layer)
      )
    }
    case 'reactTo':
      if (!PICKABLE_SIGNALS.includes(change.signal)) throw new Error(`Layers can't react to "${String(change.signal)}".`)
      return withLayer(vision, change.section, change.layer, (l) => ({ ...l, reactivity: { ...l.reactivity, reactsTo: change.signal } }))
    case 'transition':
      if (!TRANSITION_STYLES.includes(change.style)) throw new Error(`"${String(change.style)}" is not a transition.`)
      if (change.section >= vision.sections.length - 1) throw new Error('The last section hands over to nothing.')
      return withSection(vision, change.section, (s) => ({ ...s, transition: change.style }))
    case 'palette': {
      const problem = Array.isArray(change.colors) ? paletteProblem(change.colors) : 'A palette is a list of colors.'
      if (problem) throw new Error(problem)
      return { ...vision, palette: [...change.colors] }
    }
    case 'addLayer':
      if (!(change.kind in LAYER_NAMES)) throw new Error(`"${String(change.kind)}" is not in the layer library.`)
      if (EXEMPT_KINDS.includes(change.kind)) throw new Error(`Every section already has a ${LAYER_NAMES[change.kind]}.`)
      return withSection(vision, change.section, (s) => ({ ...s, scene: addLayer(s.scene, newLayer(change.kind)) }))
    case 'removeLayer': {
      const layer = sectionOf(vision, change.section).scene.layers[change.layer]
      if (!layer) throw new Error(`Section ${change.section + 1} has no layer ${change.layer + 1}.`)
      if (EXEMPT_KINDS.includes(layer.kind)) throw new Error(`${LAYER_NAMES[layer.kind]} can't be removed.`)
      return withSection(vision, change.section, (s) => ({ ...s, scene: { layers: s.scene.layers.filter((_, i) => i !== change.layer) } }))
    }
    default:
      throw new Error(`"${String((change as { op: unknown }).op)}" is not a change the editor knows.`)
  }
}

/** Why a change reaches outside a scope, or null when it stays inside. A video note may change anything. */
export function outsideScope(scope: Scope, change: VisionChange): string | null {
  if (scope.kind === 'video') return null
  const section = 'section' in change ? change.section : null
  if (section !== scope.section) return 'It changes something outside this section.'
  if (scope.kind === 'section') return null
  const layer = change.op === 'set' || change.op === 'reactTo' ? change.layer : null
  return layer === scope.layer ? null : 'It changes something outside this layer.'
}

export interface ChangeSetResult {
  vision: Vision
  /** The changes that were made, in order. */
  applied: VisionChange[]
  /** The ones left out, and why. */
  rejected: { change: unknown; reason: string }[]
}

/**
 * Applies a change set (from Claude, so unchecked) at one scope, in order, each change seeing the
 * vision the earlier ones left. A change outside the scope or the layer library is left out and
 * the rest still apply. The result is one new vision, so one note is one undo step.
 */
export function applyChangeSet(vision: Vision, scope: Scope, changes: unknown): ChangeSetResult {
  const result: ChangeSetResult = { vision, applied: [], rejected: [] }
  if (!Array.isArray(changes)) return { ...result, rejected: [{ change: changes, reason: 'Not a list of changes.' }] }
  for (const raw of changes) {
    const change = readChange(raw)
    const reason = typeof change === 'string' ? change : outsideScope(scope, change)
    if (reason) {
      result.rejected.push({ change: raw, reason })
      continue
    }
    try {
      result.vision = applyChange(result.vision, change as VisionChange)
      result.applied.push(change as VisionChange)
    } catch (error) {
      result.rejected.push({ change: raw, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}

/** Reads one change off the wire, or says why it isn't one. Values are checked when it applies. */
function readChange(raw: unknown): VisionChange | string {
  if (typeof raw !== 'object' || raw === null) return 'Not a change.'
  const c = raw as Record<string, unknown>
  const index = (key: string) => Number.isInteger(c[key]) && (c[key] as number) >= 0
  const indexOrNull = (key: string) => c[key] === null || c[key] === undefined || index(key)
  const at = (key: string) => (c[key] === undefined || c[key] === null ? null : (c[key] as number))
  switch (c.op) {
    case 'set':
      if (!indexOrNull('section') || !indexOrNull('layer') || typeof c.param !== 'string') return 'A slider change needs a target and a setting.'
      if (at('section') === null && at('layer') !== null) return 'A layer is always in a section.'
      return { op: 'set', section: at('section'), layer: at('layer'), param: c.param, value: c.value as number }
    case 'reactTo':
      return index('section') && index('layer') ? { op: 'reactTo', section: c.section as number, layer: c.layer as number, signal: c.signal as Reactivity['reactsTo'] } : 'It names no layer.'
    case 'transition':
      return index('section') ? { op: 'transition', section: c.section as number, style: c.style as TransitionStyle } : 'It names no section.'
    case 'palette':
      return { op: 'palette', colors: c.colors as string[] }
    case 'addLayer':
      return index('section') ? { op: 'addLayer', section: c.section as number, kind: c.kind as LayerKind } : 'It names no section.'
    case 'removeLayer':
      return index('section') && index('layer') ? { op: 'removeLayer', section: c.section as number, layer: c.layer as number } : 'It names no layer.'
    default:
      return `"${String(c.op)}" is not a change the editor knows.`
  }
}

function fit(slider: Slider, value: number): number {
  const clamped = Math.min(slider.max, Math.max(slider.min, value))
  return slider.step >= 1 ? Math.round(clamped) : clamped
}

function sectionOf(vision: Vision, index: number): VisionSection {
  const section = vision.sections[index]
  if (!section) throw new Error(`There is no section ${index + 1}.`)
  return section
}

function withSection(vision: Vision, index: number, change: (section: VisionSection) => VisionSection): Vision {
  sectionOf(vision, index)
  return { ...vision, sections: vision.sections.map((s, i) => (i === index ? change(s) : s)) }
}

function withLayer(vision: Vision, sectionIndex: number, layerIndex: number, change: (layer: Layer) => Layer): Vision {
  if (!sectionOf(vision, sectionIndex).scene.layers[layerIndex]) throw new Error(`Section ${sectionIndex + 1} has no layer ${layerIndex + 1}.`)
  return withSection(vision, sectionIndex, (s) => ({
    ...s,
    scene: { layers: s.scene.layers.map((l, i) => (i === layerIndex ? change(l) : l)) }
  }))
}

function whereLabel(vision: Vision, target: Target): string {
  if (target.section === null) return 'on the whole video'
  const layer = target.layer === null ? undefined : vision.sections[target.section]?.scene.layers[target.layer]
  return layer ? `on ${LAYER_NAMES[layer.kind]}` : 'on a section'
}
