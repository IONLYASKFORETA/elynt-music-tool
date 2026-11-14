import { describe, expect, it } from 'vitest'
import { BAND_COUNT, featuresAt, fft } from './audio-features'

const RATE = 48_000

function sine(freq: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(RATE * seconds))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE)
  return out
}

function loudestBand(bands: Float32Array): number {
  let best = 0
  for (let i = 1; i < bands.length; i++) if (bands[i]! > bands[best]!) best = i
  return best
}

describe('fft', () => {
  it('puts a pure tone in its frequency bin', () => {
    const n = 256
    const re = new Float32Array(n)
    const im = new Float32Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / n)
    fft(re, im)
    const mag = Array.from(re, (r, i) => Math.hypot(r, im[i]!))
    expect(mag[10]).toBeCloseTo(n / 2, 3)
    expect(mag[11]).toBeLessThan(1e-3)
  })
})

describe('featuresAt', () => {
  it('reads silence as no spectrum and no energy', () => {
    const f = featuresAt({ samples: new Float32Array(RATE), sampleRate: RATE }, 0.5)
    expect(f.bands).toHaveLength(BAND_COUNT)
    expect(Math.max(...f.bands)).toBe(0)
    expect(f.energy).toBe(0)
  })

  it('places a low tone in a lower band than a high tone', () => {
    const low = featuresAt({ samples: sine(80, 1), sampleRate: RATE }, 0.5)
    const high = featuresAt({ samples: sine(5000, 1), sampleRate: RATE }, 0.5)
    expect(loudestBand(low.bands)).toBeLessThan(BAND_COUNT / 3)
    expect(loudestBand(high.bands)).toBeGreaterThan(BAND_COUNT / 2)
  })

  it('gives more energy to a louder signal, within 0 to 1', () => {
    const quiet = featuresAt({ samples: sine(440, 1, 0.05), sampleRate: RATE }, 0.5)
    const loud = featuresAt({ samples: sine(440, 1, 0.9), sampleRate: RATE }, 0.5)
    expect(loud.energy).toBeGreaterThan(quiet.energy)
    expect(loud.energy).toBeLessThanOrEqual(1)
    expect(quiet.energy).toBeGreaterThan(0)
  })

  it('is the same every time for the same t, so export matches the preview', () => {
    const audio = { samples: sine(300, 1), sampleRate: RATE }
    expect(featuresAt(audio, 0.37)).toEqual(featuresAt(audio, 0.37))
  })

  it('reads before the start and past the end as silence instead of failing', () => {
    const audio = { samples: sine(300, 1), sampleRate: RATE }
    expect(featuresAt(audio, -2).energy).toBe(0)
    expect(featuresAt(audio, 5).energy).toBe(0)
  })

  it('hears what plays at t, not what came before it', () => {
    const samples = new Float32Array(RATE * 2)
    samples.set(sine(440, 1), RATE) // silent first second, tone in the second
    const audio = { samples, sampleRate: RATE }
    expect(featuresAt(audio, 0.5).energy).toBe(0)
    expect(featuresAt(audio, 1.5).energy).toBeGreaterThan(0)
  })
})
