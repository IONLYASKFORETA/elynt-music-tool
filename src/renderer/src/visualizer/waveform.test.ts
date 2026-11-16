import { describe, expect, it } from 'vitest'
import { waveformPeaks } from './waveform'

describe('waveform peaks', () => {
  it('gives the loudest sample of each slice of the track, as a fraction of full scale', () => {
    const samples = new Float32Array([0.1, -0.5, 0.2, 0.0, 0.9, -0.3, 0.05, -0.05])

    expect(Array.from(waveformPeaks({ samples, sampleRate: 8 }, 4))).toEqual([
      expect.closeTo(0.5),
      expect.closeTo(0.2),
      expect.closeTo(0.9),
      expect.closeTo(0.05)
    ])
  })

  it('covers every sample when the track does not split evenly, and clips anything past full scale', () => {
    const samples = new Float32Array([0, 0, 0, 0, 0, 1.4, 0])

    expect(Array.from(waveformPeaks({ samples, sampleRate: 7 }, 2))).toEqual([0, 1])
    expect(Array.from(waveformPeaks({ samples: new Float32Array(), sampleRate: 1 }, 3))).toEqual([0, 0, 0])
  })
})
