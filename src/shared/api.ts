import type { Track } from './track'

/** What the preload script exposes to the UI as `window.elynt`. */
export interface ElyntApi {
  tracks: {
    list(): Promise<Track[]>
    /** Opens a file picker for a mixdown and adds its track. Resolves to null if the owner cancels. */
    addFromPickedMixdown(): Promise<Track | null>
  }
}

export const channels = {
  listTracks: 'tracks:list',
  addFromPickedMixdown: 'tracks:add-from-picked-mixdown'
} as const
