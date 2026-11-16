import type { Reactivity } from './reactivity'
import type { FrameContext } from './scene'
import type { Tier } from './signals'

/**
 * Poster Frame (layer library): a poster's grid, border, crop marks and a logo mark, drawn over
 * what is below. Mostly static: it holds still through a section and cuts to a new arrangement
 * at the next one.
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

export const POSTER_FRAME_DEFAULTS: Omit<PosterFrameLayer, 'kind' | 'reactivity'> = {
  columns: 4,
  rows: 3,
  weight: 0.4,
  marks: 1,
  logo: 0.9,
  opacity: 0.5
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

/** Uniforms: p0 = (columns, rows, weight, marks), p1 = (logo, opacity, logo corner). */
export function posterFrameParams(layer: PosterFrameLayer, context: FrameContext): number[] {
  const cut = posterFrameCut(layer, context.sectionIndex)
  return [cut.columns, cut.rows, layer.weight, layer.marks, layer.logo, layer.opacity, cut.logoCorner]
}

/** Hits flash the lines up; the rest barely move it, since a frame should mostly sit still. */
export const POSTER_FRAME_RESPONSES: Record<Tier, (layer: PosterFrameLayer, amount: number) => PosterFrameLayer> = {
  hard: (l, a) => ({ ...l, opacity: clamp01(l.opacity + 0.45 * a), weight: clamp01(l.weight + 0.3 * a) }),
  medium: (l, a) => ({ ...l, opacity: clamp01(l.opacity + 0.15 * a) }),
  slow: (l, a) => ({ ...l, opacity: clamp01(l.opacity + 0.1 * a) })
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
