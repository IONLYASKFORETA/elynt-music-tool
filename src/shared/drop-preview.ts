/**
 * Drop previews (Vision flow step 6): the three visions are compared at the biggest moment of
 * the track, one after another over the same stretch of audio.
 */
import type { TrackAnalysis } from './analysis'

export interface TimeWindow {
  start: number
  end: number
}

const LEAD_IN_BARS = 2
const DROP_BARS = 8

/**
 * The stretch a drop preview plays: from 2 bars before the first drop to 8 bars into it (or its
 * end, if sooner). With no section labelled a drop, the loudest section stands in for it.
 */
export function dropWindow(analysis: TrackAnalysis): TimeWindow {
  const { sections, durationSeconds } = analysis
  const drop = sections.find((s) => s.label === 'drop') ?? loudest(analysis)
  if (!drop) return { start: 0, end: Math.min(durationSeconds, 16) }
  const bar = (60 / analysis.bpm) * analysis.beatsPerBar
  return {
    start: Math.max(0, drop.start - LEAD_IN_BARS * bar),
    end: Math.min(drop.end, drop.start + DROP_BARS * bar, durationSeconds)
  }
}

function loudest(analysis: TrackAnalysis) {
  const { hz, values } = analysis.energy
  const mean = (start: number, end: number) => {
    const slice = values.slice(Math.floor(start * hz), Math.max(Math.floor(start * hz) + 1, Math.floor(end * hz)))
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0
  }
  let best = analysis.sections[0]
  for (const s of analysis.sections) if (best && mean(s.start, s.end) > mean(best.start, best.end)) best = s
  return best
}

/** Which vision plays after `current` in a tour of `count`, or null when the tour is over. */
export function nextInDropTour(current: number, count: number): number | null {
  return current + 1 < count ? current + 1 : null
}
