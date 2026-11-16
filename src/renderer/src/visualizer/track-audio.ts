import { toMono, type MonoAudio } from './audio-features'

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
  const bytes = await window.elynt.tracks.readMixdown(trackId)
  const buffer = await context.decodeAudioData(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  )
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  return { buffer, mono: toMono(channels, buffer.sampleRate) }
}
