import type { Reactivity } from '../reactivity'
import { clamp01, type FramedLayerKindDef } from './kind'

/**
 * Poster Frame (layer library): a poster's grid, border, crop marks and a logo mark, drawn over
 * what is below. Mostly static: it holds still through a section and cuts to a new arrangement
 * at the next one. Flashes on drops.
 */
export interface PosterFrameLayer {
  kind: 'posterFrame'
  reactivity: Reactivity
  /** Grid columns and rows in the first section; later sections step from these. */
  columns: number
  rows: number
  /** Line weight of the grid and border, 0 to 1. */
  weight: number
  /** How strongly the crop marks show, 0 to 1. */
  marks: number
  /** How strongly the logo mark shows, 0 to 1. */
  logo: number
  /** How bright the whole frame is over the picture, 0 to 1. */
  opacity: number
}

/** Where the logo mark sits, clockwise from top left. */
export type Corner = 0 | 1 | 2 | 3

/**
 * The arrangement for a section: the grid gains a column every other section and a row every
 * fourth, and the logo mark moves one corner clockwise each section.
 */
export function posterFrameCut(layer: PosterFrameLayer, sectionIndex: number): { columns: number; rows: number; logoCorner: Corner } {
  return {
    columns: layer.columns + (sectionIndex % 2),
    rows: layer.rows + (Math.floor(sectionIndex / 2) % 2),
    logoCorner: (sectionIndex % 4) as Corner
  }
}

export const POSTER_FRAME: FramedLayerKindDef<PosterFrameLayer> = {
  name: 'Poster Frame',
  reactivity: { reactsTo: 'drop', strength: 0.5 },
  create: (reactivity) => ({ kind: 'posterFrame', columns: 4, rows: 3, weight: 0.4, marks: 1, logo: 0.9, opacity: 0.5, reactivity }),
  // Hits flash the lines up; the rest barely move it, since a frame should mostly sit still.
  respond: {
    hard: (l, a) => ({ ...l, opacity: clamp01(l.opacity + 0.45 * a), weight: clamp01(l.weight + 0.3 * a) }),
    medium: (l, a) => ({ ...l, opacity: clamp01(l.opacity + 0.15 * a) }),
    slow: (l, a) => ({ ...l, opacity: clamp01(l.opacity + 0.1 * a) })
  },
  /** p0 = (columns, rows, weight, marks), p1 = (logo, opacity, logo corner). */
  pass: (l, { context }) => {
    const cut = posterFrameCut(l, context.sectionIndex)
    return { params: [cut.columns, cut.rows, l.weight, l.marks, l.logo, l.opacity, cut.logoCorner] }
  }
}
