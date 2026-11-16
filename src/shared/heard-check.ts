/**
 * The "What I heard" check (V3): the owner's corrections to a track analysis.
 * Each function takes an analysis and returns a corrected copy; nothing is changed in place.
 * The corrected analysis replaces the heard one on the track, so every tool reads the fix.
 */
import { SECTION_LABELS, type Section, type SectionLabel, type TrackAnalysis } from './analysis'

/** The beat nearest to `time` among those strictly between `after` and `before`, or null if there is none. */
function nearestBeatBetween(beats: number[], time: number, after: number, before: number): number | null {
  let best: number | null = null
  for (const b of beats) {
    if (b <= after || b >= before) continue
    if (best === null || Math.abs(b - time) < Math.abs(best - time)) best = b
  }
  return best
}

/** Which bar `time` falls in, counting the first full bar as 0 (anything before it is bar 0 too). */
function barAt(downbeats: number[], time: number): number {
  let bar = 0
  for (const [i, d] of downbeats.entries()) if (d <= time + 1e-6) bar = i
  return bar
}

function owned(section: Section, downbeats: number[]): Section {
  return { ...section, startBar: barAt(downbeats, section.start), confidence: 1, source: 'owner' }
}

/**
 * Moves the boundary at the start of section `index` (1 or more) to the beat nearest `time`.
 * The section before it ends there and section `index` starts there. A boundary can't pass
 * its neighbours: each of the two sections keeps at least one beat.
 */
export function moveBoundary(analysis: TrackAnalysis, index: number, time: number): TrackAnalysis {
  const sections = analysis.sections.slice()
  const before = sections[index - 1]
  const after = sections[index]
  if (!before || !after) return analysis
  const at = nearestBeatBetween(analysis.beats, time, before.start, after.end)
  if (at === null) return analysis
  sections[index - 1] = owned({ ...before, end: at }, analysis.downbeats)
  sections[index] = owned({ ...after, start: at }, analysis.downbeats)
  return { ...analysis, sections }
}

/** Gives section `index` the owner's label. */
export function relabelSection(analysis: TrackAnalysis, index: number, label: SectionLabel): TrackAnalysis {
  const section = analysis.sections[index]
  if (!section) return analysis
  const sections = analysis.sections.slice()
  sections[index] = owned({ ...section, label }, analysis.downbeats)
  return { ...analysis, sections }
}

/** The slowest and fastest tempo the check accepts. */
export const MIN_BPM = 40
export const MAX_BPM = 300

/** Where the grid hangs from: the first downbeat, or the first beat if no bar was found. */
function gridAnchor(analysis: TrackAnalysis): number {
  return analysis.downbeats[0] ?? analysis.beats[0] ?? 0
}

/** One constant-tempo grid through `anchor`, a downbeat, covering the whole track. */
function buildGrid(anchor: number, bpm: number, durationSeconds: number, beatsPerBar: number) {
  const period = 60 / bpm
  const first = -Math.floor(anchor / period + 1e-9)
  const beats: number[] = []
  const downbeats: number[] = []
  for (let k = first; ; k++) {
    const t = round(anchor + k * period)
    if (t >= durationSeconds) break
    if (t < 0) continue
    beats.push(t)
    if (((k % beatsPerBar) + beatsPerBar) % beatsPerBar === 0) downbeats.push(t)
  }
  return { beats, downbeats }
}

/** To the microsecond, so repeated nudges don't pile up float noise. */
function round(t: number): number {
  return Math.round(t * 1e6) / 1e6
}

/** Puts the inner section boundaries back on the nearest beat of a new grid, keeping their order. */
function resnap(analysis: TrackAnalysis): TrackAnalysis {
  const { beats, downbeats } = analysis
  const sections = analysis.sections.map((s) => ({ ...s }))
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1]!
    const cur = sections[i]!
    const at = nearestBeatBetween(beats, cur.start, prev.start, cur.end) ?? cur.start
    prev.end = at
    cur.start = at
  }
  for (const s of sections) s.startBar = barAt(downbeats, s.start)
  return { ...analysis, sections }
}

/** Rebuilds the beat grid at the owner's tempo, keeping the first downbeat where it was. */
export function setTempo(analysis: TrackAnalysis, bpm: number): TrackAnalysis {
  const tempo = Math.min(MAX_BPM, Math.max(MIN_BPM, bpm))
  const grid = buildGrid(gridAnchor(analysis), tempo, analysis.durationSeconds, analysis.beatsPerBar)
  return resnap({ ...analysis, bpm: tempo, constantTempo: true, ...grid })
}

/**
 * Slides the beat grid by `seconds`, keeping the tempo: a few milliseconds to line the grid up
 * with the kick, or a whole beat to make a different beat the one.
 */
export function shiftDownbeat(analysis: TrackAnalysis, seconds: number): TrackAnalysis {
  const grid = buildGrid(gridAnchor(analysis) + seconds, analysis.bpm, analysis.durationSeconds, analysis.beatsPerBar)
  return resnap({ ...analysis, constantTempo: true, ...grid })
}

const EPSILON = 1e-6

/**
 * What is wrong with a corrected analysis, in words, or null if it can be saved: the sections
 * must run back to back from 0 to the end of the track with known labels, on a sane tempo.
 */
export function correctionProblem(analysis: TrackAnalysis): string | null {
  const { bpm, sections, durationSeconds, beats, downbeats } = analysis
  if (!Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM) return `The BPM must be between ${MIN_BPM} and ${MAX_BPM}.`
  const sorted = (xs: number[]) => xs.every((x, i) => Number.isFinite(x) && (i === 0 || x > xs[i - 1]!))
  if (!Array.isArray(beats) || !Array.isArray(downbeats) || !sorted(beats) || !sorted(downbeats)) return 'The beat grid is out of order.'
  if (!Array.isArray(sections) || sections.length === 0) return 'A track needs at least one section.'
  for (const [i, s] of sections.entries()) {
    if (!SECTION_LABELS.includes(s.label)) return `"${String(s.label)}" isn't a section label the suite knows.`
    if (!(s.end > s.start)) return `Section ${i + 1} ends before it starts.`
    const expectedStart = i === 0 ? 0 : sections[i - 1]!.end
    if (Math.abs(s.start - expectedStart) > EPSILON) return 'The sections must run back to back with no gaps or overlaps.'
  }
  if (Math.abs(sections[sections.length - 1]!.end - durationSeconds) > EPSILON) return 'The last of the sections must end where the track ends.'
  return null
}
