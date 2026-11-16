import type { VisionNoteRequest } from '../../../shared/vision-note'
import { controlValue, LAYER_SLIDERS, slidersAt, type Scope, type Slider, type VisionChange } from './controls'
import { PICKABLE_SIGNALS } from './reactivity'
import { EXEMPT_KINDS, LAYER_NAMES, MAX_ACTIVE_LAYERS, type Layer, type LayerKind } from './scene'
import { SIGNALS } from './signals'
import { TRANSITION_NAMES, TRANSITION_STYLES } from './transitions'
import type { Vision } from './vision'

/**
 * Builds the request for a note typed in the note box at one scope (V14): the note, the vision
 * data at that scope, what can change there, and a schema offering only the changes the scope
 * allows. Claude's change set comes back through `applyChangeSet` (controls.ts), which checks it.
 */
export function noteRequest(vision: Vision, scope: Scope, note: string, trackId?: number): VisionNoteRequest {
  const context = {
    scope: scopeLabel(vision, scope),
    note,
    vision: scopeData(vision, scope),
    library: {
      // Sliders per layer kind, with their ranges: a "set" change names one of these.
      layerSettings: Object.fromEntries(
        (Object.keys(LAYER_SLIDERS) as LayerKind[]).map((k) => [k, ['strength', ...LAYER_SLIDERS[k].map((s) => s.param)].join(', ')])
      ),
      sliders: sliderGuide(),
      signals: Object.fromEntries(PICKABLE_SIGNALS.map((s) => [s, s === 'none' ? 'reacts to nothing' : `${SIGNALS[s].label} (${SIGNALS[s].tier} tier)`])),
      ...(scope.kind !== 'layer' && {
        addableLayers: ADDABLE.map((k) => `${k} (${LAYER_NAMES[k]})`),
        transitions: Object.fromEntries(TRANSITION_STYLES.map((t) => [t, TRANSITION_NAMES[t]]))
      })
    }
  }
  return {
    trackId,
    system: SYSTEM,
    prompt: `Note from the owner: "${note}"\n\n${JSON.stringify(context, null, 2)}`,
    schema: changeSetSchema(vision, scope)
  }
}

const ADDABLE = (Object.keys(LAYER_NAMES) as LayerKind[]).filter((k) => !EXEMPT_KINDS.includes(k))

const SYSTEM = `You edit a music visualizer's vision for an EDM producer. A vision has one scene per section of the track (intro, build, drop, breakdown, outro); each scene is a stack of layers from a fixed layer library in one house style: graphic, glitchy, spectral, poster-like, black or off-white grounds, spectral color bleed, iridescent chrome, glitch and datamosh, light pillars, poster type.

The owner typed a note at one scope: the whole video, one section, or one layer. Turn it into a short list of concrete changes inside that scope only, using only the settings, layer kinds, signals and transitions listed. Prefer a few strong changes over many small ones. Keep values inside each slider's range.

Rules:
- Sections and layers are counted from 0, as given. Changes apply in order, each to the vision the earlier ones left: a layer you add goes just under the Finish, so the Finish's index goes up by one.
- "intensity" (0 to 2, 1 is neutral) sets how hard everything reacts, on the whole video (section and layer null) or one section (layer null).
- "strength" (0 to 1) is how strongly one layer reacts to its signal. Hard-tier signals (drops, downbeats) hit hardest.
- At most ${MAX_ACTIVE_LAYERS} active layers per section; Ground and Finish don't count and can't be added or removed.
- In the summary, tell the owner in one plain sentence what you changed.`

function sliderGuide(): Record<string, string> {
  const all: Slider[] = Object.values(LAYER_SLIDERS).flat()
  const guide: Record<string, string> = {}
  for (const s of all) guide[s.param] ??= `${s.label}, ${s.min} to ${s.max}${s.step >= 1 ? ', whole numbers' : ''}`
  return guide
}

function scopeLabel(vision: Vision, scope: Scope): string {
  if (scope.kind === 'video') return 'the whole video'
  const section = vision.sections[scope.section]!
  const name = `section ${scope.section} (${section.label})`
  if (scope.kind === 'section') return name
  return `layer ${scope.layer} (${LAYER_NAMES[section.scene.layers[scope.layer]!.kind]}) of ${name}`
}

function layerData(vision: Vision, section: number, layer: Layer, index: number) {
  const target = { section, layer: index }
  return {
    layer: index,
    kind: layer.kind,
    reactsTo: layer.reactivity.reactsTo,
    settings: Object.fromEntries(slidersAt(vision, target).map((s) => [s.param, round(controlValue(vision, target, s.param))]))
  }
}

function sectionData(vision: Vision, index: number) {
  const s = vision.sections[index]!
  return {
    section: index,
    label: s.label,
    start: round(s.start),
    end: round(s.end),
    intensity: s.intensity ?? 1,
    ...(index < vision.sections.length - 1 && { transitionToNext: s.transition ?? 'cut' }),
    layers: s.scene.layers.map((l, i) => layerData(vision, index, l, i))
  }
}

function scopeData(vision: Vision, scope: Scope) {
  if (scope.kind === 'video') {
    return { intensity: vision.intensity ?? 1, palette: vision.palette, sections: vision.sections.map((_, i) => sectionData(vision, i)) }
  }
  if (scope.kind === 'section') return sectionData(vision, scope.section)
  const section = vision.sections[scope.section]!
  return { section: scope.section, label: section.label, ...layerData(vision, scope.section, section.scene.layers[scope.layer]!, scope.layer) }
}

const round = (x: number) => Math.round(x * 1000) / 1000

/** The JSON schema of a change set at a scope: only the change kinds the scope allows. */
function changeSetSchema(vision: Vision, scope: Scope): Record<string, unknown> {
  const index = { type: 'integer' }
  const indexOrNull = { anyOf: [{ type: 'integer' }, { type: 'null' }] }
  const variant = (op: VisionChange['op'], properties: Record<string, unknown>) => ({
    type: 'object',
    properties: { op: { type: 'string', enum: [op] }, ...properties },
    required: ['op', ...Object.keys(properties)],
    additionalProperties: false
  })
  const set = variant('set', { section: indexOrNull, layer: indexOrNull, param: { type: 'string' }, value: { type: 'number' } })
  const reactTo = variant('reactTo', { section: index, layer: index, signal: { type: 'string', enum: [...PICKABLE_SIGNALS] } })
  const transition = variant('transition', { section: index, style: { type: 'string', enum: [...TRANSITION_STYLES] } })
  const palette = variant('palette', { colors: { type: 'array', items: { type: 'string', description: 'A color like #ff2e88' } } })
  const addLayer = variant('addLayer', { section: index, kind: { type: 'string', enum: ADDABLE } })
  const removeLayer = variant('removeLayer', { section: index, layer: index })

  const handsOver = scope.kind === 'section' ? scope.section < vision.sections.length - 1 : vision.sections.length > 1
  const variants =
    scope.kind === 'layer'
      ? [set, reactTo]
      : [set, reactTo, ...(handsOver ? [transition] : []), addLayer, removeLayer, ...(scope.kind === 'video' ? [palette] : [])]
  return {
    type: 'object',
    properties: { summary: { type: 'string' }, changes: { type: 'array', items: { anyOf: variants } } },
    required: ['summary', 'changes'],
    additionalProperties: false
  }
}
