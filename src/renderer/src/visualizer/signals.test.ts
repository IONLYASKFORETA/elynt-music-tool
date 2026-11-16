import { describe, expect, it } from 'vitest'
import type { TrackAnalysis } from '../../../shared/analysis'
import { deriveSignals, signalAt, stemRole } from './signals'

const RATE = 48_000
const BPM = 120
const BEAT = 60 / BPM

/** A kick: a 55 Hz thump that dies away over about 150 ms. */
function addKick(out: Float32Array, at: number, amp = 0.8): void {
  const start = Math.round(at * RATE)
  for (let i = 0; i < RATE * 0.3 && start + i < out.length; i++) {
    const s = i / RATE
    out[start + i]! += amp * Math.exp(-s / 0.06) * Math.sin(2 * Math.PI * 55 * s)
  }
}

/** A snare: a burst of noise that dies away fast. Seeded so every run is the same. */
function addSnare(out: Float32Array, at: number, amp = 0.5): void {
  let seed = 12345
  const start = Math.round(at * RATE)
  for (let i = 0; i < RATE * 0.2 && start + i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const noise = seed / 0x3fffffff - 1
    out[start + i]! += amp * Math.exp(-i / RATE / 0.04) * noise
  }
}

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(RATE * seconds))
}

function analysisOf(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    analyzerVersion: 1,
    durationSeconds: 8,
    bpm: BPM,
    beatsPerBar: 4,
    beats: Array.from({ length: 16 }, (_, i) => i * BEAT),
    downbeats: [0, 2, 4, 6],
    beatSource: 'dsp',
    constantTempo: true,
    sections: [
      { label: 'build', start: 0, end: 4, startBar: 0, confidence: 1, source: 'heuristic' },
      { label: 'drop', start: 4, end: 8, startBar: 2, confidence: 1, source: 'heuristic' }
    ],
    energy: { hz: 10, values: Array.from({ length: 80 }, (_, i) => (i < 40 ? 0.2 : 0.9)) },
    mood: { label: 'dark', arousal: 0.5, valence: -0.5, key: null, keyConfidence: 0, source: 'heuristic' },
    notes: [],
    seconds: 1,
    ...overrides
  }
}

describe('deriveSignals', () => {
  it('turns a kick on a known beat into a kick signal that peaks just after that beat', () => {
    const drums = silence(8)
    addKick(drums, 2 * BEAT)
    const signals = deriveSignals({
      analysis: analysisOf(),
      mixdown: { samples: drums, sampleRate: RATE },
      stems: [{ role: 'drums', audio: { samples: drums, sampleRate: RATE } }]
    })
    expect(signalAt(signals, 'kick', 2 * BEAT - 0.05)).toBe(0)
    expect(signalAt(signals, 'kick', 2 * BEAT + 0.02)).toBeGreaterThan(0.7)
    expect(signalAt(signals, 'kick', 2 * BEAT + 0.6)).toBeLessThan(0.1)
  })

  it('finds one kick per beat in a four-to-the-floor drum stem', () => {
    const drums = silence(8)
    for (let b = 0; b < 16; b++) addKick(drums, b * BEAT)
    const signals = deriveSignals({ analysis: analysisOf(), mixdown: { samples: drums, sampleRate: RATE }, stems: [] })
    expect(signals.events.kick).toHaveLength(16)
    signals.events.kick.forEach((t, b) => expect(Math.abs(t - b * BEAT)).toBeLessThan(0.025))
  })

  it('hears a snare as a snare, not a kick', () => {
    const drums = silence(4)
    addSnare(drums, 1)
    const signals = deriveSignals({ analysis: null, mixdown: { samples: drums, sampleRate: RATE }, stems: [] })
    expect(signals.events.kick).toEqual([])
    expect(signals.events.snare).toHaveLength(1)
    expect(Math.abs(signals.events.snare[0]! - 1)).toBeLessThan(0.025)
  })

  it('reads the drums from the drum stem rather than the mixdown when there is one', () => {
    const mix = silence(4)
    addKick(mix, 1)
    const drums = silence(4)
    addKick(drums, 3)
    const signals = deriveSignals({
      analysis: null,
      mixdown: { samples: mix, sampleRate: RATE },
      stems: [{ role: 'drums', audio: { samples: drums, sampleRate: RATE } }]
    })
    expect(signals.events.kick).toHaveLength(1)
    expect(Math.abs(signals.events.kick[0]! - 3)).toBeLessThan(0.025)
  })

  it('takes downbeats from the analysis, and a drop from where each drop section starts', () => {
    const signals = deriveSignals({ analysis: analysisOf(), mixdown: { samples: silence(8), sampleRate: RATE }, stems: [] })
    expect(signals.events.downbeat).toEqual([0, 2, 4, 6])
    expect(signals.events.drop).toEqual([4])
    expect(signalAt(signals, 'drop', 4.01)).toBeGreaterThan(0.9)
    expect(signalAt(signals, 'downbeat', 2.01)).toBeGreaterThan(0.9)
  })

  it('follows the analysed energy, slowly', () => {
    const signals = deriveSignals({ analysis: analysisOf(), mixdown: { samples: silence(8), sampleRate: RATE }, stems: [] })
    expect(signalAt(signals, 'energy', 3.5)).toBeCloseTo(0.2, 1)
    // Energy jumps at 4 s; the slow signal is still on its way up shortly after.
    expect(signalAt(signals, 'energy', 4.1)).toBeLessThan(0.6)
    expect(signalAt(signals, 'energy', 7.5)).toBeGreaterThan(0.8)
  })

  it('follows the bass stem as a level', () => {
    const bass = silence(4)
    for (let i = RATE * 2; i < RATE * 3; i++) bass[i] = 0.5 * Math.sin((2 * Math.PI * 50 * i) / RATE)
    const signals = deriveSignals({
      analysis: null,
      mixdown: { samples: silence(4), sampleRate: RATE },
      stems: [{ role: 'bass', audio: { samples: bass, sampleRate: RATE } }]
    })
    expect(signalAt(signals, 'bass', 1)).toBe(0)
    expect(signalAt(signals, 'bass', 2.6)).toBeGreaterThan(0.7)
  })

  it('reads the same value for the same t every time, and nothing outside the track', () => {
    const drums = silence(4)
    addKick(drums, 1)
    const signals = deriveSignals({ analysis: null, mixdown: { samples: drums, sampleRate: RATE }, stems: [] })
    expect(signalAt(signals, 'kick', 1.03)).toBe(signalAt(signals, 'kick', 1.03))
    expect(signalAt(signals, 'kick', -1)).toBe(0)
    expect(signalAt(signals, 'energy', 99)).toBeGreaterThanOrEqual(0)
  })
})

describe('stemRole', () => {
  it('reads what a stem is from its name', () => {
    expect(stemRole('drums')).toBe('drums')
    expect(stemRole('bass')).toBe('bass')
    expect(stemRole('SUPERFLY Kick')).toBe('kick')
    expect(stemRole('Snare Top')).toBe('snare')
    expect(stemRole('Clap')).toBe('snare')
    expect(stemRole('HiHats')).toBe('hihat')
    expect(stemRole('Sub 808')).toBe('bass')
    expect(stemRole('vocals')).toBe('other')
  })
})
