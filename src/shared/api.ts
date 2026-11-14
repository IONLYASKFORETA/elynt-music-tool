import type { AudioProbe, HelperStatus } from './helper'
import type { Track } from './track'

/** What the preload script exposes to the UI as `window.elynt`. */
export interface ElyntApi {
  tracks: {
    list(): Promise<Track[]>
    /** Opens a file picker for a mixdown and adds its track. Resolves to null if the owner cancels. */
    addFromPickedMixdown(): Promise<Track | null>
  }
  helper: {
    status(): Promise<HelperStatus>
    /** Calls back on every status change. Returns a function that stops listening. */
    onStatus(listener: (status: HelperStatus) => void): () => void
    /** Asks the helper to read a track's mixdown header: duration, sample rate, channels. */
    probeTrack(trackId: number): Promise<AudioProbe>
  }
}

export const channels = {
  listTracks: 'tracks:list',
  addFromPickedMixdown: 'tracks:add-from-picked-mixdown',
  helperStatus: 'helper:status',
  helperStatusChanged: 'helper:status-changed',
  probeTrack: 'helper:probe-track'
} as const
