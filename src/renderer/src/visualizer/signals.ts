import type { TrackAnalysis } from '../../../shared/analysis'
import type { MonoAudio } from './audio-features'

/**
 * Audio signals (GLOSSARY: Reactivity): what layers can react to, derived once per track from
 * the track analysis and the stems, then read at any time t. Nothing is carried between frames,
 * so the live preview and the export read exactly the same values.
 *
 * Event signals (kick, snare, hi-hats, downbeats, drops) are lists of times; at t they read as
 * a pulse that jumps to 1 on the latest event and dies away. Level signals (bass, energy) are
 * curves, already smoothed to their tier's pace.
 */
export type EventSignal = 'kick' | 'snare' | 'hihat' | 'downbeat' | 'drop'
export type LevelSignal = 'bass' | 'energy'
export type SignalName = EventSignal | LevelSignal

/**
 * The three reactivity tiers. Hard is kept for drops and downbeats, medium for the drums and
 * bass, slow for energy (and the camera, once there is one).
 */
export type Tier = 'hard' | 'medium' | 'slow'

interface SignalInfo {
  label: string
  tier: Tier
  /** Event signals: seconds for a pulse to fall to about a third. Level signals: smoothing, in seconds. */
  seconds: number
}

/** Every signal a layer can react to, in the order the "reacts to" picker lists them. */
export const SIGNALS: Record<SignalName, SignalInfo> = {
  kick: { label: 'Kick', tier: 'medium', seconds: 0.15 },
  snare: { label: 'Snare', tier: 'medium', seconds: 0.18 },
  bass: { label: 'Bass', tier: 'medium', seconds: 0.08 },
  hihat: { label: 'Hi-hats', tier: 'medium', seconds: 0.08 },
  downbeat: { label: 'Downbeat', tier: 'hard', seconds: 0.25 },
  drop: { label: 'Drop', tier: 'hard', seconds: 1.2 },
  energy: { label: 'Energy', tier: 'slow', seconds: 0.4 }
}

export const SIGNAL_NAMES = Object.keys(SIGNALS) as SignalName[]

/** A level over time, `hz` values a second, 0 to 1. */
export interface Curve {
  hz: number
  values: Float32Array
}

export interface TrackSignals {
  /** Times in seconds, ascending. */
  events: Record<EventSignal, number[]>
  levels: Record<LevelSignal, Curve>
}

/** What a stem holds, as far as reactivity cares. */
export type StemRole = 'drums' | 'kick' | 'snare' | 'hihat' | 'bass' | 'other'

export interface StemAudio {
  role: StemRole
  audio: MonoAudio
}

/** Signals with nothing in them: every signal reads 0. For benchmarks and before a track has loaded. */
export const NO_SIGNALS: TrackSignals = {
  events: { kick: [], snare: [], hihat: [], downbeat: [], drop: [] },
  levels: { bass: { hz: 1, values: new Float32Array(0) }, energy: { hz: 1, values: new Float32Array(0) } }
}

/** Reads what a stem is from its name: "drums" and "bass" from a split, or the owner's own file names. */
export function stemRole(name: string): StemRole {
  const n = name.toLowerCase()
  if (/hi-?hat|\bhh\b|\bhats?\b|cymbal|\bride\b/.test(n)) return 'hihat'
  if (/kick|\bkik\b|\bbd\b/.test(n)) return 'kick'
  if (/snare|clap|\bsd\b|\brim/.test(n)) return 'snare'
  if (/drum|perc|\bbeat\b/.test(n)) return 'drums'
  if (/bass|\bsub\b|808|reese/.test(n)) return 'bass'
  return 'other'
}

/** The roles worth decoding: the rest are never read. */
export const USED_STEM_ROLES: readonly StemRole[] = ['drums', 'kick', 'snare', 'hihat', 'bass']

/**
 * Derives every signal for a track. Downbeats and drops come from the analysis, energy from the
 * analysed energy curve, and the drums and bass from their stems when there are any, falling back
 * to the drum stem and then the mixdown.
 */
export function deriveSignals(input: {
  analysis: TrackAnalysis | null
  mixdown: MonoAudio
  stems: StemAudio[]
}): TrackSignals {
  const { analysis, mixdown, stems } = input
  const stem = (role: StemRole) => stems.find((s) => s.role === role)?.audio
  const drums = stem('drums') ?? mixdown

  const kickSource = stem('kick') ?? drums
  const snareSource = stem('snare') ?? drums
  const hatSource = stem('hihat') ?? drums
  const kickBand = bandLevels(kickSource, [{ type: 'lowpass', hz: 110 }])
  const snareBand = bandLevels(snareSource, [
    { type: 'highpass', hz: 1200 },
    { type: 'lowpass', hz: 5000 }
  ])
  // A kick only counts where the low end is louder than the snare's band of the same audio,
  // so a noisy snare's own bit of low end is not taken for a kick.
  const kickRival = kickSource === snareSource ? snareBand : null
  const kick = onsets(kickBand, { minGap: 0.1, rival: kickRival })
  const snare = onsets(snareBand, { minGap: 0.1 })
  const hihat = onsets(bandLevels(hatSource, [{ type: 'highpass', hz: 7000 }]), { minGap: 0.05 })

  const bassSource = stem('bass') ?? mixdown
  const bass = smooth(levelCurve(bandLevels(bassSource, [{ type: 'lowpass', hz: stem('bass') ? 250 : 120 }])), SIGNALS.bass.seconds)
  const energy = smooth(analysis ? resample(analysis.energy) : levelCurve(bandLevels(mixdown, [])), SIGNALS.energy.seconds)

  return {
    events: {
      kick,
      snare,
      hihat,
      downbeat: analysis ? [...analysis.downbeats] : [],
      drop: analysis ? analysis.sections.filter((s) => s.label === 'drop').map((s) => s.start) : []
    },
    levels: { bass, energy }
  }
}

/** One signal at time t, 0 to 1. */
export function signalAt(signals: TrackSignals, name: SignalName, t: number): number {
  if (name === 'bass' || name === 'energy') return curveAt(signals.levels[name], t)
  const events = signals.events[name]
  const last = lastAtOrBefore(events, t)
  if (last === undefined) return 0
  return Math.exp(-(t - last) / SIGNALS[name].seconds)
}

function lastAtOrBefore(times: number[], t: number): number | undefined {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid]! <= t) lo = mid + 1
    else hi = mid
  }
  return lo > 0 ? times[lo - 1] : undefined
}

function curveAt(curve: Curve, t: number): number {
  const { values, hz } = curve
  if (values.length === 0) return 0
  const x = Math.min(Math.max(t * hz, 0), values.length - 1)
  const i = Math.floor(x)
  const next = values[Math.min(i + 1, values.length - 1)]!
  return values[i]! + (next - values[i]!) * (x - i)
}

/** Curves are held at this rate; band levels are measured at it too. */
const CURVE_HZ = 200
/** Each band level is the RMS of the last 20 ms, long enough to hold a whole cycle of a 55 Hz kick. */
const LEVEL_WINDOW = 0.02
const SILENT_DB = -100
/** Quieter than this is never an event or a level. */
const FLOOR_DB = -60
/** Events and levels are judged against the loudest the band gets in the whole track. */
const RANGE_DB = 30
/** How far a band has to jump within one window to count as a hit. */
const RISE_DB = 6

/** A band's loudness in dB, CURVE_HZ times a second; value n is the window that ends at n / CURVE_HZ. */
interface BandLevels {
  db: Float32Array
  peakDb: number
}

type Filter = { type: 'lowpass' | 'highpass'; hz: number }

function bandLevels(audio: MonoAudio, filters: Filter[]): BandLevels {
  const { samples, sampleRate } = audio
  const stages = filters.map((f) => biquad(sampleRate, f))
  const hop = sampleRate / CURVE_HZ
  const window = Math.round(LEVEL_WINDOW * sampleRate)
  const frames = Math.floor(samples.length / hop) + 1
  const db = new Float32Array(frames)
  // Filtered squares of the last `window` samples, as a ring, and their running sum. Streamed, so
  // a long track never holds a filtered copy of itself in memory.
  const ring = new Float64Array(window)
  let sum = 0
  let peakDb = SILENT_DB
  let i = 0
  let slot = 0
  for (let n = 0; n < frames; n++) {
    const end = Math.min(samples.length, Math.round(n * hop))
    for (; i < end; i++) {
      let x = samples[i]!
      for (let k = 0; k < stages.length; k++) {
        const c = stages[k]!
        const y = c[0]! * x + c[1]! * c[5]! + c[2]! * c[6]! - c[3]! * c[7]! - c[4]! * c[8]!
        c[6] = c[5]!
        c[5] = x
        c[8] = c[7]!
        c[7] = y
        x = y
      }
      sum += x * x - ring[slot]!
      ring[slot] = x * x
      if (++slot === window) slot = 0
    }
    // Rounding can leave the running sum a hair under zero after silence.
    const ms = Math.max(0, sum) / window
    const level = ms > 1e-10 ? 10 * Math.log10(ms) : SILENT_DB
    db[n] = level
    if (level > peakDb) peakDb = level
  }
  return { db, peakDb }
}

/** Times where a band jumps up sharply, at least `minGap` seconds apart. */
function onsets(band: BandLevels, options: { minGap: number; rival?: BandLevels | null }): number[] {
  const { db, peakDb } = band
  const floor = Math.max(FLOOR_DB, peakDb - RANGE_DB)
  const back = Math.round(LEVEL_WINDOW * CURVE_HZ)
  const out: number[] = []
  let last = -Infinity
  for (let n = back; n < db.length; n++) {
    const t = n / CURVE_HZ
    if (t - last < options.minGap) continue
    if (db[n]! < floor || db[n]! - db[n - back]! < RISE_DB) continue
    if (options.rival && options.rival.db[n]! > db[n]!) continue
    out.push(t)
    last = t
  }
  return out
}

/** A band's loudness as 0 to 1 against its own loudest moment; quiet or silent bands read 0. */
function levelCurve(band: BandLevels): Curve {
  const top = band.peakDb
  const bottom = Math.max(FLOOR_DB, top - RANGE_DB)
  const values = new Float32Array(band.db.length)
  if (top > FLOOR_DB) for (let n = 0; n < values.length; n++) values[n] = Math.min(1, Math.max(0, (band.db[n]! - bottom) / (top - bottom)))
  return { hz: CURVE_HZ, values }
}

function resample(curve: { hz: number; values: number[] }): Curve {
  const source: Curve = { hz: curve.hz, values: Float32Array.from(curve.values) }
  const seconds = curve.values.length / curve.hz
  const values = new Float32Array(Math.ceil(seconds * CURVE_HZ))
  for (let n = 0; n < values.length; n++) values[n] = curveAt(source, n / CURVE_HZ)
  return { hz: CURVE_HZ, values }
}

/** Smooths a curve so it only ever eases toward where the level is going, never jumps. */
function smooth(curve: Curve, seconds: number): Curve {
  const a = 1 - Math.exp(-1 / (seconds * curve.hz))
  const values = new Float32Array(curve.values.length)
  let y = curve.values[0] ?? 0
  for (let n = 0; n < values.length; n++) {
    y += (curve.values[n]! - y) * a
    values[n] = y
  }
  return { hz: curve.hz, values }
}

/**
 * A second-order (RBJ) low- or high-pass filter, as its coefficients and running state:
 * [b0, b1, b2, a1, a2, x1, x2, y1, y2]. Kept in one typed array so the per-sample loop stays fast.
 */
function biquad(sampleRate: number, filter: Filter): Float64Array {
  const w = (2 * Math.PI * filter.hz) / sampleRate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const a0 = 1 + alpha
  const low = filter.type === 'lowpass'
  const b0 = (low ? (1 - cos) / 2 : (1 + cos) / 2) / a0
  const b1 = (low ? 1 - cos : -(1 + cos)) / a0
  return Float64Array.of(b0, b1, b0, (-2 * cos) / a0, (1 - alpha) / a0, 0, 0, 0, 0)
}
