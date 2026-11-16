import type { FormatId } from '../../../shared/formats'
import type { PosterFrameLayer, PosterTypeLayer, SubjectLayer } from './scene'
import type { SubjectPlacement } from './layers/subject'
import type { AnchorTweaks } from './type-layout'
import { updateSectionLayer, type Vision } from './vision'

/**
 * Per-format tweaks (V16). The owner edits a vision once and every format re-flows from it
 * (each poster layer's `place`); a tweak moves one layer in one format only, and is kept on the
 * layer under that format so it travels with the layer and never touches the other formats.
 */
export type FormatTweak =
  | SubjectPlacement
  | Partial<Pick<PosterFrameLayer, 'columns' | 'rows'>>
  | { anchors: AnchorTweaks }

type TweakableLayer = SubjectLayer | PosterFrameLayer | PosterTypeLayer

const TWEAKABLE = ['subject', 'posterFrame', 'posterType'] as const

function tweakable(vision: Vision, sectionIndex: number, layerIndex: number): TweakableLayer {
  const layer = vision.sections[sectionIndex]?.scene.layers[layerIndex]
  if (!layer) throw new Error(`No layer ${layerIndex} in section ${sectionIndex}.`)
  if (!(TWEAKABLE as readonly string[]).includes(layer.kind)) throw new Error(`A ${layer.kind} layer looks the same in every format.`)
  return layer as TweakableLayer
}

/** Adds to one layer's tweak in one format. Poster Type's block moves add up block by block. */
export function setFormatTweak(vision: Vision, sectionIndex: number, layerIndex: number, format: FormatId, patch: FormatTweak): Vision {
  const layer = tweakable(vision, sectionIndex, layerIndex)
  const formats: Record<string, unknown> = { ...layer.formats }
  const old = (formats[format] ?? {}) as Record<string, unknown>
  if ('anchors' in patch) {
    const anchors = { ...(old.anchors as AnchorTweaks | undefined) }
    for (const [id, move] of Object.entries(patch.anchors)) anchors[id as keyof AnchorTweaks] = { ...anchors[id as keyof AnchorTweaks], ...move }
    formats[format] = { ...old, anchors }
  } else {
    formats[format] = { ...old, ...patch }
  }
  return updateSectionLayer(vision, sectionIndex, layerIndex, { formats } as Partial<TweakableLayer>)
}

/** Drops one layer's tweaks in one format, back to the automatic layout there. */
export function clearFormatTweaks(vision: Vision, sectionIndex: number, layerIndex: number, format: FormatId): Vision {
  const layer = tweakable(vision, sectionIndex, layerIndex)
  if (!layer.formats?.[format]) return vision
  const { [format]: _dropped, ...rest } = layer.formats
  return updateSectionLayer(vision, sectionIndex, layerIndex, {
    formats: Object.keys(rest).length > 0 ? rest : undefined
  } as Partial<TweakableLayer>)
}

/** Whether a layer has been tweaked in a format. */
export function hasFormatTweak(vision: Vision, sectionIndex: number, layerIndex: number, format: FormatId): boolean {
  const layer = vision.sections[sectionIndex]?.scene.layers[layerIndex]
  return !!layer && 'formats' in layer && !!layer.formats?.[format]
}
