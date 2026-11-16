import type { TrackAnalysis } from '../../../shared/analysis'
import { toMono, type MonoAudio } from './audio-features'
import { deriveSignals, stemRole, USED_STEM_ROLES, type StemAudio, type TrackSignals } from './signals'

export interface TrackAudio {
  buffer: AudioBuffer
  mono: MonoAudio
}

/**
 * Reads and decodes a track's mixdown. The preview and the export both decode
 * through an AudioContext like this, so both compute the spectrum from the
 * same samples at the same rate, and draw the same picture at the same t.
 */
export async function decodeTrackAudio(trackId: number, context: BaseAudioContext): Promise<TrackAudio> {
  return decodeBytes(await window.elynt.tracks.readMixdown(trackId), context)
}

/**
 * Derives a track's signals for reactivity from its analysis, its stems (the ones reactivity
 * reads: drums, kick, snare, hi-hats, bass) and its mixdown. A stem that can't be read or
 * decoded is left out, and its signal falls back to the drum stem or the mixdown.
 */
export async function loadTrackSignals(
  trackId: number,
  analysis: TrackAnalysis | null,
  mixdown: MonoAudio,
  context: BaseAudioContext
): Promise<TrackSignals> {
  const stems = (await window.elynt.stems.list(trackId).catch(() => []))
    .map((stem) => ({ stem, role: stemRole(stem.name) }))
    .filter(({ role }) => USED_STEM_ROLES.includes(role))
  const decoded = await Promise.all(
    stems.map(async ({ stem, role }): Promise<StemAudio | null> => {
      try {
        const { mono } = await decodeBytes(await window.elynt.stems.read(trackId, stem.id), context)
        return { role, audio: mono }
      } catch {
        return null
      }
    })
  )
  return deriveSignals({ analysis, mixdown, stems: decoded.filter((s): s is StemAudio => s !== null) })
}

async function decodeBytes(bytes: Uint8Array, context: BaseAudioContext): Promise<TrackAudio> {
  const buffer = await context.decodeAudioData(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  return { buffer, mono: toMono(channels, buffer.sampleRate) }
}
