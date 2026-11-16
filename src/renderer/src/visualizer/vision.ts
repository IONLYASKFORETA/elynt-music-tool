import type { Section, SectionLabel } from '../../../shared/analysis'
import { WIDE_LAYOUT, type FormatLayout } from '../../../shared/formats'
import type { AudioFeatures } from './audio-features'
import { DEFAULT_PALETTE, paletteProblem, type Palette } from './palette'
import { addLayer, newLayer, NO_CONTEXT, planFrame, type Credits, type FramePlan, type Layer, type Scene } from './scene'
import type { TrackSignals } from './signals'

/**
 * The part of a vision (GLOSSARY: Vision) the renderer reads: one scene per section of the
 * track, in order, covering it start to end. Plain data, shared by the preview and the export.
 */
export interface Vision {
  sections: VisionSection[]
  /** The track's 3 to 5 colors, which every house-style layer takes. */
  palette: Palette
  /** What the poster layers set: the track's title and the artist's name. Blank until given. */
  credits?: Credits
}

export interface VisionSection {
  label: SectionLabel
  /** Seconds, from the track analysis. */
  start: number
  end: number
  scene: Scene
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
export function defaultVision(sections: Section[], durationSeconds: number): Vision {
  const spans: { label: SectionLabel; start: number; end: number }[] =
    sections.length > 0 ? sections : [{ label: 'intro', start: 0, end: durationSeconds }]
  return {
    sections: spans.map(({ label, start, end }) => ({ label, start, end, scene: defaultSectionScene(label) })),
    palette: DEFAULT_PALETTE
  }
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

/** The scene at t. Scenes switch with a hard cut at each section boundary (transitions come later). */
export function sceneAt(vision: Vision, t: number): Scene {
  return vision.sections[sectionIndexAt(vision, t)]!.scene
}

/**
 * One frame of the whole track: the preview and the export both draw through this. `layout` is
 * the format the frame is for and its safe zone (V16); the poster layers re-flow to it.
 */
export function planVisionFrame(
  vision: Vision,
  features: AudioFeatures,
  t: number,
  size: { width: number; height: number },
  signals: TrackSignals,
  layout: FormatLayout = WIDE_LAYOUT
): FramePlan {
  const sectionIndex = sectionIndexAt(vision, t)
  const section = vision.sections[sectionIndex]!
  return planFrame(section.scene, features, t, size, signals, vision.palette, {
    sectionIndex,
    sectionStart: section.start,
    credits: vision.credits ?? NO_CONTEXT.credits,
    layout
  })
}

/** Every image the vision's Subjects show, once each: an export loads them all before its first frame. */
export function visionImages(vision: Vision): string[] {
  const urls = vision.sections.flatMap((s) => s.scene.layers.flatMap((l) => (l.kind === 'subject' && l.image ? [l.image] : [])))
  return [...new Set(urls)]
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
  return { sections: [{ label: 'intro', start: 0, end: durationSeconds, scene }], palette: DEFAULT_PALETTE }
}
