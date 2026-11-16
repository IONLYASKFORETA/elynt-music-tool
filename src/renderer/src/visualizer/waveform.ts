import type { MonoAudio } from './audio-features'

/**
 * The track's outline for the "What I heard" timeline: the loudest sample in each of `count`
 * equal slices, 0 to 1. Every sample falls in exactly one slice.
 */
export function waveformPeaks(audio: MonoAudio, count: number): Float32Array {
  const { samples } = audio
  const peaks = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * samples.length) / count)
    const to = Math.floor(((i + 1) * samples.length) / count)
    let peak = 0
    for (let j = from; j < to; j++) {
      const v = Math.abs(samples[j]!)
      if (v > peak) peak = v
    }
    peaks[i] = Math.min(1, peak)
  }
  return peaks
}
