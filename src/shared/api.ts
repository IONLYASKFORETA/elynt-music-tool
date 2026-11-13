import type { Track } from './track'

/** What the preload script exposes to the UI as `window.elynt`. */
export interface ElyntApi {
  tracks: {
    list(): Promise<Track[]>
    /** Opens a file picker for a mixdown. Resolves to null if the owner cancels. */
    pickMixdown(): Promise<Track | null>
  }
}

export const channels = {
  listTracks: 'tracks:list',
  pickMixdown: 'tracks:pick-mixdown'
} as const
