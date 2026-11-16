/**
 * The track's beat grid, from the track analysis: every beat and the beats that start a bar.
 * The editor's timeline snaps to it, moments sit on it, and transitions are timed in its beats.
 */
export interface BeatGrid {
  /** Beat times in seconds, ascending. */
  beats: number[]
  /** The beats that start a bar. */
  downbeats: number[]
}

/** A track with no analysis yet: the grid reads as 120 BPM in 4/4 from 0. */
export const NO_GRID: BeatGrid = { beats: [], downbeats: [] }

const FALLBACK_BEAT = 0.5
const BEATS_PER_BAR = 4

export type Snap = 'bar' | 'beat'

/** Seconds per beat: the typical gap between beats, or 120 BPM with no grid. */
export function beatSeconds(grid: BeatGrid): number {
  const gaps = grid.beats.slice(1).map((b, i) => b - grid.beats[i]!).sort((a, b) => a - b)
  return gaps.length > 0 ? gaps[gaps.length >> 1]! : FALLBACK_BEAT
}

/** The beat or bar line nearest to t. Past either end of the grid it carries on at the same tempo. */
export function snapToGrid(grid: BeatGrid, t: number, snap: Snap): number {
  const lines = snap === 'bar' ? grid.downbeats : grid.beats
  const step = beatSeconds(grid) * (snap === 'bar' ? BEATS_PER_BAR : 1)
  if (lines.length === 0) return Math.max(0, Math.round(t / step) * step)
  const first = lines[0]!
  const last = lines[lines.length - 1]!
  if (t <= first) return Math.max(0, first - Math.round((first - t) / step) * step)
  if (t >= last) return last + Math.round((t - last) / step) * step
  return nearest(lines, t)
}

/** The value in an ascending list nearest to t. */
export function nearest(sorted: number[], t: number): number {
  let lo = 0
  let hi = sorted.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! <= t) lo = mid
    else hi = mid
  }
  return Math.abs(sorted[hi]! - t) < Math.abs(sorted[lo]! - t) ? sorted[hi]! : sorted[lo]!
}
