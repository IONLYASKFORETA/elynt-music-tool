import { beatSeconds, nearest, type BeatGrid } from './beat-grid'

/**
 * Transitions (GLOSSARY: Transition): how one section's scene hands over to the next. A cut
 * switches on the downbeat; the others draw both scenes for a few beats around the boundary
 * and let one transition pass composite them.
 */
export type TransitionStyle = 'cut' | 'glitchWipe' | 'bleedWash' | 'chromeMorph' | 'whiteFlash'

/** In this order, so a style's index is what the transition shader reads. */
export const TRANSITION_STYLES: readonly TransitionStyle[] = ['cut', 'glitchWipe', 'bleedWash', 'chromeMorph', 'whiteFlash']

export const TRANSITION_NAMES: Record<TransitionStyle, string> = {
  cut: 'Cut on downbeat',
  glitchWipe: 'Glitch wipe',
  bleedWash: 'Bleed wash',
  chromeMorph: 'Chrome morph',
  whiteFlash: 'White flash'
}

/** Beats each style takes before and after the boundary. A flash snaps in fast and fades out. */
const SPAN_BEATS: Record<TransitionStyle, { before: number; after: number }> = {
  cut: { before: 0, after: 0 },
  glitchWipe: { before: 1, after: 1 },
  bleedWash: { before: 2, after: 2 },
  chromeMorph: { before: 2, after: 2 },
  whiteFlash: { before: 0.25, after: 1 }
}

/** Seconds. The new scene takes over at `at`; the transition is drawn from `start` to `end`. */
export interface TransitionWindow {
  start: number
  at: number
  end: number
}

/** The two sections a boundary joins, as far as timing goes. */
interface Span {
  start: number
  end: number
}

/**
 * Where the handover from `outgoing` to `incoming` happens. A cut lands on the downbeat nearest
 * the boundary (within a bar, and inside both sections); the others are centred on the boundary
 * and never reach past the middle of either section.
 */
export function transitionWindow(style: TransitionStyle, outgoing: Span, incoming: Span, grid: BeatGrid): TransitionWindow {
  const boundary = incoming.start
  const beat = beatSeconds(grid)
  if (style === 'cut') {
    const at = grid.downbeats.length > 0 ? nearest(grid.downbeats, boundary) : boundary
    const ok = Math.abs(at - boundary) <= beat * 4 && at > outgoing.start && at < incoming.end
    const cut = ok ? at : boundary
    return { start: cut, at: cut, end: cut }
  }
  const span = SPAN_BEATS[style]
  const before = Math.min(span.before * beat, (boundary - outgoing.start) / 2)
  const after = Math.min(span.after * beat, (incoming.end - boundary) / 2)
  return { start: boundary - before, at: boundary, end: boundary + after }
}

/** What the transition pass is told at one instant. */
export interface TransitionBlend {
  style: TransitionStyle
  /** 0 = all the outgoing scene, 1 = all the incoming one. For a wipe, where the edge is. */
  mix: number
  /** How hard the effect itself is, 0 to 1. Peaks on the boundary. */
  intensity: number
  /** 0 to 1 across the whole window. */
  progress: number
}

export function transitionBlend(style: TransitionStyle, window: TransitionWindow, t: number): TransitionBlend {
  const { start, at, end } = window
  const progress = clamp01((t - start) / (end - start))
  const rise = at > start ? clamp01((t - start) / (at - start)) : 1
  const fall = end > at ? clamp01(1 - (t - at) / (end - at)) : 0
  const peak = t < at ? rise : fall
  const switched = t >= at ? 1 : 0
  switch (style) {
    case 'glitchWipe':
      return { style, mix: progress, intensity: peak, progress }
    case 'chromeMorph':
      return { style, mix: progress * progress * (3 - 2 * progress), intensity: peak, progress }
    case 'whiteFlash':
      return { style, mix: switched, intensity: peak * peak, progress }
    case 'bleedWash':
    case 'cut':
      return { style, mix: switched, intensity: peak, progress }
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
