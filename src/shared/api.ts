import type { BackupStatus } from './backup'
import type { Track } from './track'

/** What the preload script exposes to the UI as `window.elynt`. */
export interface ElyntApi {
  tracks: {
    list(): Promise<Track[]>
    /** Opens a file picker for a mixdown and adds its track. Resolves to null if the owner cancels. */
    addFromPickedMixdown(): Promise<Track | null>
  }
  backup: {
    status(): Promise<BackupStatus>
    /** Opens a folder picker; the folder is remembered and backed up to straight away. Null if cancelled. */
    chooseFolder(): Promise<BackupStatus | null>
    /** Opens a save dialog and writes the whole database to one file. Resolves to its path, or null if cancelled. */
    exportEverything(): Promise<string | null>
  }
}

export const channels = {
  listTracks: 'tracks:list',
  addFromPickedMixdown: 'tracks:add-from-picked-mixdown',
  backupStatus: 'backup:status',
  chooseBackupFolder: 'backup:choose-folder',
  exportEverything: 'backup:export-everything'
} as const
