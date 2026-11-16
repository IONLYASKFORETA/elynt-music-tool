import type { SectionLabel } from '../../../shared/analysis'
import { snapToGrid } from './beat-grid'
import type { MomentKind } from './moments'
import type { Palette } from './palette'
import { addLayer, type Layer, type Scene } from './scene'
import type { TransitionStyle } from './transitions'
import type { Vision } from './vision'

/**
 * Presets (GLOSSARY: Preset) at three levels: a layer, a scene, or a whole vision. Layer and
 * scene presets are the layer or scene itself. A vision preset leaves out what belongs to the
 * track (its sections' times, its beat grid, its credits), so it can be applied to another track
 * inside that track's own sections.
 */
export type LayerPreset = Layer
export type ScenePreset = Scene

export interface VisionPreset {
  palette: Palette
  /** The video's intensity slider (V14). Missing reads as 1. */
  intensity?: number
  sections: PresetSection[]
}

export interface PresetSection {
  label: SectionLabel
  scene: Scene
  transition: TransitionStyle
  /** The section's intensity slider (V14). Missing reads as 1. */
  intensity?: number
  /** Where the section sat in its track: its midpoint, as a share of the track, 0 to 1. */
  position: number
  /** Each moment as a share of the way through its section, 0 to 1. */
  moments: { kind: MomentKind; at: number }[]
}

const copy = <T>(value: T): T => structuredClone(value)

/** A vision's look, without its track. */
export function visionPreset(vision: Vision): VisionPreset {
  const end = trackEnd(vision)
  return copy({
    palette: [...vision.palette],
    ...(vision.intensity !== undefined && { intensity: vision.intensity }),
    sections: vision.sections.map((s) => ({
      label: s.label,
      scene: s.scene,
      transition: s.transition ?? 'cut',
      ...(s.intensity !== undefined && { intensity: s.intensity }),
      position: (s.start + s.end) / 2 / end,
      moments: vision.moments
        .filter((m) => m.at >= s.start && m.at < s.end)
        .map((m) => ({ kind: m.kind, at: share(m.at, s.start, s.end) }))
    }))
  })
}

/**
 * Applies a vision preset over a vision, keeping its sections, grid and credits. Each section
 * takes the preset section of the same kind (the second drop takes the preset's second drop,
 * cycling when the preset has fewer); a kind the preset lacks takes the preset section at the
 * same point of the track. Moments land at the same point of their section, on the nearest beat.
 */
export function applyVisionPreset(vision: Vision, preset: VisionPreset): Vision {
  if (preset.sections.length === 0) return { ...vision, palette: [...preset.palette], intensity: preset.intensity }
  const seen = new Map<SectionLabel, number>()
  const end = trackEnd(vision)
  const sections = vision.sections.map((s) => {
    const ofKind = preset.sections.filter((p) => p.label === s.label)
    const nth = seen.get(s.label) ?? 0
    seen.set(s.label, nth + 1)
    const source = ofKind.length > 0 ? ofKind[nth % ofKind.length]! : nearestByPosition(preset.sections, (s.start + s.end) / 2 / end)
    return { section: { ...s, scene: copy(source.scene), transition: source.transition, intensity: source.intensity }, source }
  })
  const moments = sections
    .flatMap(({ section, source }) =>
      source.moments.map((m) => ({ kind: m.kind, at: snapToGrid(vision.grid, section.start + m.at * (section.end - section.start), 'beat') }))
    )
    .sort((a, b) => a.at - b.at)
    .map((m, i) => ({ id: i + 1, ...m }))
  return { ...vision, palette: [...preset.palette], intensity: preset.intensity, sections: sections.map((s) => s.section), moments }
}

/** Replaces one section's scene with a scene preset. */
export function applyScenePreset(vision: Vision, sectionIndex: number, scene: ScenePreset): Vision {
  return {
    ...vision,
    sections: vision.sections.map((s, i) => (i === sectionIndex ? { ...s, scene: copy(scene) } : s))
  }
}

/**
 * Puts a layer preset into one section's scene: in place of the layer at `replaceIndex`, or
 * added like a new layer (and refused past the active-layer limit).
 */
export function applyLayerPreset(vision: Vision, sectionIndex: number, layer: LayerPreset, replaceIndex?: number): Vision {
  const change = (scene: Scene): Scene =>
    replaceIndex === undefined
      ? addLayer(scene, copy(layer))
      : { layers: scene.layers.map((l, i) => (i === replaceIndex ? copy(layer) : l)) }
  return { ...vision, sections: vision.sections.map((s, i) => (i === sectionIndex ? { ...s, scene: change(s.scene) } : s)) }
}

function share(t: number, start: number, end: number): number {
  return end > start ? (t - start) / (end - start) : 0
}

function trackEnd(vision: Vision): number {
  return vision.sections[vision.sections.length - 1]?.end || 1
}

function nearestByPosition(sections: PresetSection[], at: number): PresetSection {
  return sections.reduce((best, s) => (Math.abs(s.position - at) < Math.abs(best.position - at) ? s : best))
}
