import type { Section, SectionLabel } from '../../../shared/analysis'
import { WIDE_LAYOUT, type FormatLayout } from '../../../shared/formats'
import type { AudioFeatures } from './audio-features'
import { beatSeconds, NO_GRID, snapToGrid, type BeatGrid, type Snap } from './beat-grid'
import { momentPasses, type Moment, type MomentKind } from './moments'
import { clipKey, newImageMedia, type ClipMedia, type LayerMedia } from './media'
import { DEFAULT_PALETTE, paletteProblem, type Palette } from './palette'
import { addLayer, newLayer, NO_CONTEXT, passUniforms, planFrame, type Credits, type FramePlan, type Layer, type Scene, type SubjectLayer } from './scene'
import { signalAt, type TrackSignals } from './signals'
import {
  TRANSITION_STYLES,
  transitionBlend,
  transitionWindow as windowBetween,
  type TransitionBlend,
  type TransitionStyle,
  type TransitionWindow
} from './transitions'

/**
 * The part of a vision (GLOSSARY: Vision) the renderer reads: one scene per section of the
 * track, in order, covering it start to end. Plain data, shared by the preview and the export.
 */
export interface Vision {
  sections: VisionSection[]
  /** The track's 3 to 5 colors, which every house-style layer takes. */
  palette: Palette
  /** Visual events pinned to the grid, on top of the scenes, in time order. */
  moments: Moment[]
  /** The track's beats and bars, from the analysis: what moments snap to and transitions are timed in. */
  grid: BeatGrid
  /** What the poster layers set: the track's title and the artist's name. Blank until given. */
  credits?: Credits
}

export interface VisionSection {
  label: SectionLabel
  /** Seconds, from the track analysis. */
  start: number
  end: number
  scene: Scene
  /** How this section hands over to the next. The last section's is never used. Missing reads as a cut. */
  transition?: TransitionStyle
}

/** How hard each kind of section pushes its layers by default. */
const SECTION_STRENGTH: Record<SectionLabel, number> = {
  intro: 0.4,
  build: 0.6,
  drop: 1,
  breakdown: 0.3,
  outro: 0.4
}

/**
 * A starting vision: Ground, Classic and Finish in every section, reacting harder in drops.
 * Drops hit on the drop itself; other sections hit on downbeats. A track with no sections yet
 * is one section, start to end.
 */
export function defaultVision(sections: Section[], durationSeconds: number, grid: BeatGrid = NO_GRID): Vision {
  const spans: { label: SectionLabel; start: number; end: number }[] =
    sections.length > 0 ? sections : [{ label: 'intro', start: 0, end: durationSeconds }]
  return {
    sections: spans.map(({ label, start, end }) => ({ label, start, end, scene: defaultSectionScene(label), transition: 'cut' })),
    palette: DEFAULT_PALETTE,
    moments: [],
    grid: { beats: [...grid.beats], downbeats: [...grid.downbeats] }
  }
}

/**
 * Whether a saved vision still belongs to the track as analysed now: the same sections, in the
 * same places, on the same beat grid. When it doesn't, the editor starts the scenes over.
 */
export function visionFitsTrack(vision: Vision, sections: Section[], grid: BeatGrid, durationSeconds: number): boolean {
  const spans = sections.length > 0 ? sections : [{ label: 'intro', start: 0, end: durationSeconds }]
  const shape = (list: { label: string; start: number; end: number }[]) => JSON.stringify(list.map((s) => [s.label, s.start, s.end]))
  return (
    shape(vision.sections) === shape(spans) &&
    JSON.stringify([vision.grid.beats, vision.grid.downbeats]) === JSON.stringify([grid.beats, grid.downbeats])
  )
}

function defaultSectionScene(label: SectionLabel): Scene {
  const strength = SECTION_STRENGTH[label]
  const layers = (['ground', 'classic', 'finish'] as const).map((kind) => {
    const layer = newLayer(kind)
    const reactsTo = kind === 'finish' && label === 'drop' ? 'drop' : layer.reactivity.reactsTo
    return { ...layer, reactivity: { reactsTo, strength: Math.min(1, layer.reactivity.strength * (0.5 + strength)) } }
  })
  return { layers }
}

/** The section playing at t. Before the start it is the first; past the end, the last. */
export function sectionIndexAt(vision: Vision, t: number): number {
  const { sections } = vision
  for (let i = sections.length - 1; i > 0; i--) if (t >= sections[i]!.start) return i
  return 0
}

/**
 * Where the handover from section `index` to the next happens (see transitions.ts). For the
 * last section, which hands over to nothing, it is an empty window at its end.
 */
export function transitionWindow(vision: Vision, index: number): TransitionWindow {
  const outgoing = vision.sections[index]!
  const incoming = vision.sections[index + 1]
  if (!incoming) return { start: outgoing.end, at: outgoing.end, end: outgoing.end }
  return windowBetween(outgoing.transition ?? 'cut', outgoing, incoming, vision.grid)
}

/** The scene at t. Each section's scene takes over where its transition lands (for a cut, on the downbeat). */
export function sceneAt(vision: Vision, t: number): Scene {
  return vision.sections[sceneIndexAt(vision, t)]!.scene
}

function sceneIndexAt(vision: Vision, t: number): number {
  let index = 0
  for (let i = 0; i < vision.sections.length - 1; i++) if (t >= transitionWindow(vision, i).at) index = i + 1
  return index
}

/** The boundary whose transition is being drawn at t, and how far along it is. */
export function transitionAt(vision: Vision, t: number): (TransitionBlend & { index: number }) | null {
  for (let i = 0; i < vision.sections.length - 1; i++) {
    const window = transitionWindow(vision, i)
    if (window.start < window.end && t >= window.start && t < window.end) {
      return { index: i, ...transitionBlend(vision.sections[i]!.transition ?? 'cut', window, t) }
    }
  }
  return null
}

/** Chooses how section `index` hands over to the next. */
export function setTransition(vision: Vision, index: number, transition: TransitionStyle): Vision {
  return { ...vision, sections: vision.sections.map((s, i) => (i === index ? { ...s, transition } : s)) }
}

/**
 * One frame of the whole track: the preview and the export both draw through this. Through a
 * transition both scenes are drawn, the outgoing one set aside by a hold step, and the
 * transition pass composites them. Moments go on top of everything. `layout` is the format the
 * frame is for and its safe zone (V16); the poster layers re-flow to it.
 */
export function planVisionFrame(
  vision: Vision,
  features: AudioFeatures,
  t: number,
  size: { width: number; height: number },
  signals: TrackSignals,
  layout: FormatLayout = WIDE_LAYOUT
): FramePlan {
  const { palette } = vision
  const build = signalAt(signals, 'build', t)
  const credits = vision.credits ?? NO_CONTEXT.credits
  const scenePlan = (sectionIndex: number) => {
    const section = vision.sections[sectionIndex]!
    return planFrame(section.scene, features, t, size, signals, palette, { sectionIndex, sectionStart: section.start, credits, layout })
  }
  const transition = transitionAt(vision, t)
  let plan: FramePlan
  if (transition) {
    const outgoing = scenePlan(transition.index)
    const incoming = scenePlan(transition.index + 1)
    const params = [TRANSITION_STYLES.indexOf(transition.style), transition.mix, transition.intensity, transition.progress]
    plan = {
      spectrum: incoming.spectrum,
      passes: [
        ...outgoing.passes,
        { kind: 'hold', uniforms: passUniforms(t, features, size, [], build, palette) },
        ...incoming.passes,
        { kind: 'transition', uniforms: passUniforms(t, features, size, params, build, palette) }
      ]
    }
  } else plan = scenePlan(sceneIndexAt(vision, t))
  const moments = momentPasses(vision.moments, t, beatSeconds(vision.grid), { features, size, build, palette })
  return { ...plan, passes: [...plan.passes, ...moments] }
}

/** The media a layer shows: a Subject's image or own media, a Ground's or Chrome's media, a Poster Frame's logo. */
function layerMedia(layer: Layer): (LayerMedia | string)[] {
  switch (layer.kind) {
    case 'subject':
      return layer.media ? [layer.media] : layer.image ? [layer.image] : []
    case 'ground':
    case 'chrome':
      return layer.media ? [layer.media] : []
    case 'posterFrame':
      return layer.logoMedia ? [layer.logoMedia] : []
    default:
      return []
  }
}

function allMedia(vision: Vision): (LayerMedia | string)[] {
  return vision.sections.flatMap((s) => s.scene.layers.flatMap(layerMedia))
}

/** Every image the vision shows, once each: an export loads them all before its first frame. */
export function visionImages(vision: Vision): string[] {
  const urls = allMedia(vision).flatMap((m) => (typeof m === 'string' ? [m] : m.type === 'image' ? [m.url] : []))
  return [...new Set(urls)]
}

/** Every clip the vision plays, once per clip and timing: an export opens them all before its first frame. */
export function visionClips(vision: Vision): ClipMedia[] {
  const clips = new Map<string, ClipMedia>()
  for (const m of allMedia(vision)) if (typeof m !== 'string' && m.type === 'clip' && !clips.has(clipKey(m))) clips.set(clipKey(m), m)
  return [...clips.values()]
}

/**
 * The track's cover art as a Subject the vision can offer (V18). A vision never asks for media:
 * with no cover art there is no offer, and nothing is placed until the owner takes it.
 */
export function coverArtOffer(cover: { url: string; name: string } | null): SubjectLayer | null {
  if (!cover) return null
  return { ...(newLayer('subject') as SubjectLayer), media: newImageMedia(cover) }
}

/** Takes the cover-art offer in one section: a Subject showing the cover art. Throws past the layer limit. */
export function acceptCoverArt(vision: Vision, sectionIndex: number, cover: { url: string; name: string }): Vision {
  return addSectionLayer(vision, sectionIndex, coverArtOffer(cover)!)
}

/** Swaps the vision's palette. Throws for one that isn't 3 to 5 #rrggbb colors. */
export function setVisionPalette(vision: Vision, palette: Palette): Vision {
  const problem = paletteProblem(palette)
  if (problem) throw new Error(problem)
  return { ...vision, palette: [...palette] }
}

function withScene(vision: Vision, index: number, change: (scene: Scene) => Scene): Vision {
  return { ...vision, sections: vision.sections.map((s, i) => (i === index ? { ...s, scene: change(s.scene) } : s)) }
}

/** Adds a layer to one section's scene. Throws past the active-layer limit. */
export function addSectionLayer(vision: Vision, sectionIndex: number, layer: Layer): Vision {
  return withScene(vision, sectionIndex, (scene) => addLayer(scene, layer))
}

export function removeSectionLayer(vision: Vision, sectionIndex: number, layerIndex: number): Vision {
  return withScene(vision, sectionIndex, (scene) => ({ layers: scene.layers.filter((_, i) => i !== layerIndex) }))
}

/** Changes some of one layer's settings in one section, such as its reactivity. */
export function updateSectionLayer(vision: Vision, sectionIndex: number, layerIndex: number, patch: Partial<Layer>): Vision {
  return withScene(vision, sectionIndex, (scene) => ({
    layers: scene.layers.map((l, i) => (i === layerIndex ? ({ ...l, ...patch, kind: l.kind } as Layer) : l))
  }))
}

/** One scene for the whole track: for benchmarks, which don't care about sections. */
export function singleSceneVision(scene: Scene, durationSeconds: number): Vision {
  return { sections: [{ label: 'intro', start: 0, end: durationSeconds, scene }], palette: DEFAULT_PALETTE, moments: [], grid: NO_GRID }
}

/** Pins a moment of a kind to the bar or beat nearest t. */
export function addMoment(vision: Vision, kind: MomentKind, t: number, snap: Snap): Vision {
  const id = Math.max(0, ...vision.moments.map((m) => m.id)) + 1
  return withMoments(vision, [...vision.moments, { id, kind, at: snapToGrid(vision.grid, t, snap) }])
}

/** Moves a moment to the bar or beat nearest t. */
export function moveMoment(vision: Vision, id: number, t: number, snap: Snap): Vision {
  const at = snapToGrid(vision.grid, t, snap)
  return withMoments(vision, vision.moments.map((m) => (m.id === id ? { ...m, at } : m)))
}

export function removeMoment(vision: Vision, id: number): Vision {
  return withMoments(vision, vision.moments.filter((m) => m.id !== id))
}

function withMoments(vision: Vision, moments: Moment[]): Vision {
  return { ...vision, moments: [...moments].sort((a, b) => a.at - b.at || a.id - b.id) }
}
