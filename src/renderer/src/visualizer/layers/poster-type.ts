import { toKatakana } from '../katakana'
import type { Reactivity } from '../reactivity'
import type { Credits } from '../scene'
import { POSTER_ANCHORS, TYPE_BLOCKS, typeReveals, type TypeText } from '../type-layout'
import { clamp01, type FramedLayerKindDef } from './kind'

/**
 * Poster Type (layer library): big set type for the title, the artist's name, katakana and the
 * owner's own words, each block snapping in on a downbeat (layout in type-layout.ts). The title
 * comes from the track and the name from the artist profile, through the vision's credits, so
 * neither is stored here.
 */
export interface PosterTypeLayer {
  kind: 'posterType'
  reactivity: Reactivity
  /** The owner's own words, set small. Empty leaves them out. */
  words: string
  /** Katakana as the owner edited it; null means generate it from the title. */
  katakana: string | null
  /** How much the palette's chrome tints the white type, 0 to 1. */
  chrome: number
  /** How hard the type slices sideways as it snaps in, 0 to 1. */
  glitch: number
}

/** The katakana a Poster Type shows: the owner's edit, or what the title reads as. */
export function posterKatakana(layer: PosterTypeLayer, title: string): string {
  return layer.katakana ?? toKatakana(title)
}

export function posterTypeText(layer: PosterTypeLayer, credits: Credits): TypeText {
  return { title: credits.title, artist: credits.artist, katakana: posterKatakana(layer, credits.title), words: layer.words }
}

export const POSTER_TYPE: FramedLayerKindDef<PosterTypeLayer> = {
  name: 'Poster Type',
  // It is revealed on downbeats whatever it reacts to; this makes each one hit as well.
  reactivity: { reactsTo: 'downbeat', strength: 0.5 },
  create: (reactivity) => ({ kind: 'posterType', words: '', katakana: null, chrome: 0.35, glitch: 0.5, reactivity }),
  respond: {
    hard: (l, a) => ({ ...l, glitch: clamp01(l.glitch + a), chrome: clamp01(l.chrome + 0.5 * a) }),
    medium: (l, a) => ({ ...l, glitch: clamp01(l.glitch + 0.4 * a) }),
    slow: (l, a) => ({ ...l, chrome: clamp01(l.chrome + 0.3 * a) })
  },
  /**
   * p0 = each block's reveal in TYPE_BLOCKS order, p1 = (chrome, glitch). The picture is the text
   * and the anchors it hangs from, which the renderer rasterizes at the frame's size.
   */
  pass: (l, { context, signals, t }) => {
    const text = posterTypeText(l, context.credits)
    const reveals = typeReveals(text, signals.events.downbeat, context.sectionStart, t)
    return {
      params: [...TYPE_BLOCKS.map((id) => reveals[id]), l.chrome, l.glitch],
      image: { kind: 'type', key: JSON.stringify([text, POSTER_ANCHORS]), text, anchors: POSTER_ANCHORS }
    }
  }
}
