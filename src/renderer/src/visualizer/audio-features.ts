/**
 * What a layer hears at one instant of a track. Computed straight from the
 * mixdown's samples for any time t, with no state carried between frames, so
 * the live preview and the offline export see exactly the same values.
 */
export interface AudioFeatures {
  /** Loudness of each log-spaced frequency band, low to high, 0 to 1. */
  bands: Float32Array
  /** Overall loudness around t, 0 to 1. */
  energy: number
}

/** A mono mixdown held in memory. */
export interface MonoAudio {
  samples: Float32Array
  sampleRate: number
}

export const BAND_COUNT = 64
const WINDOW = 2048
const LOW_HZ = 30
const HIGH_HZ = 16_000
/** dB range mapped to 0..1 for the spectrum and the energy. */
const BAND_FLOOR_DB = -75
const BAND_CEIL_DB = -10
const ENERGY_FLOOR_DB = -48
const ENERGY_CEIL_DB = -3

const hann = Float32Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)))
const windowGain = hann.reduce((sum, w) => sum + w, 0) / 2

export function featuresAt(audio: MonoAudio, t: number): AudioFeatures {
  // The window ends at t: the picture reacts to what has just been heard.
  const end = Math.round(t * audio.sampleRate)
  const start = end - WINDOW
  const re = new Float32Array(WINDOW)
  const im = new Float32Array(WINDOW)
  let sumSquares = 0
  for (let i = 0; i < WINDOW; i++) {
    const s = audio.samples[start + i] ?? 0
    sumSquares += s * s
    re[i] = s * hann[i]!
  }
  fft(re, im)

  const bands = new Float32Array(BAND_COUNT)
  const binHz = audio.sampleRate / WINDOW
  for (let b = 0; b < BAND_COUNT; b++) {
    const lo = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (b / BAND_COUNT)
    const hi = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((b + 1) / BAND_COUNT)
    const first = Math.max(1, Math.floor(lo / binHz))
    const last = Math.max(first, Math.min(WINDOW / 2 - 1, Math.ceil(hi / binHz) - 1))
    let peak = 0
    for (let k = first; k <= last; k++) peak = Math.max(peak, Math.hypot(re[k]!, im[k]!))
    bands[b] = toUnit(peak / windowGain, BAND_FLOOR_DB, BAND_CEIL_DB)
  }

  return { bands, energy: toUnit(Math.sqrt(sumSquares / WINDOW), ENERGY_FLOOR_DB, ENERGY_CEIL_DB) }
}

/** Maps a linear amplitude onto 0..1 across a dB range. Silence is exactly 0. */
function toUnit(amplitude: number, floorDb: number, ceilDb: number): number {
  if (amplitude <= 0) return 0
  const db = 20 * Math.log10(amplitude)
  return Math.min(1, Math.max(0, (db - floorDb) / (ceilDb - floorDb)))
}

/** In-place radix-2 FFT. Length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k)
        const wi = Math.sin(step * k)
        const a = i + k
        const b = a + size / 2
        const tr = re[b]! * wr - im[b]! * wi
        const ti = re[b]! * wi + im[b]! * wr
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
      }
    }
  }
}

/** Folds a decoded buffer's channels into one mono signal. */
export function toMono(channels: Float32Array[], sampleRate: number): MonoAudio {
  const length = channels[0]?.length ?? 0
  const samples = new Float32Array(length)
  for (const ch of channels) for (let i = 0; i < length; i++) samples[i]! += ch[i]! / channels.length
  return { samples, sampleRate }
}
