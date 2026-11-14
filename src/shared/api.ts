import type { KeyName, KeyStatus, KeyTestResult } from './keys'
import type { BackupStatus } from './backup'
import type { ArtistProfile } from './profile'
import type { Track } from './track'

/** What the preload script exposes to the UI as `window.elynt`. */
export interface ElyntApi {
  tracks: {
    list(): Promise<Track[]>
    /** Opens a file picker for a mixdown and adds its track. Resolves to null if the owner cancels. */
    addFromPickedMixdown(): Promise<Track | null>
  }
  /** API keys live in the Windows credential vault. The UI can save and remove them but never read them back. */
  keys: {
    status(): Promise<KeyStatus>
    save(name: KeyName, value: string): Promise<KeyStatus>
    remove(name: KeyName): Promise<KeyStatus>
    /** Makes one tiny Claude call with the saved Anthropic key. */
    testAnthropic(): Promise<KeyTestResult>
  }
  backup: {
    status(): Promise<BackupStatus>
    /** Opens a folder picker; the folder is remembered and backed up to straight away. Null if cancelled. */
    chooseFolder(): Promise<BackupStatus | null>
    /** Opens a save dialog and writes the whole database to one file. Resolves to its path, or null if cancelled. */
    exportEverything(): Promise<string | null>
  }
  /** The suite's one artist profile, read by every tool. */
  profile: {
    get(): Promise<ArtistProfile>
    /** Saves the whole profile, half-filled or not. Rejects values the suite doesn't know. */
    save(profile: ArtistProfile): Promise<ArtistProfile>
  }
}

export const channels = {
  listTracks: 'tracks:list',
  addFromPickedMixdown: 'tracks:add-from-picked-mixdown',
  keyStatus: 'keys:status',
  saveKey: 'keys:save',
  removeKey: 'keys:remove',
  testAnthropicKey: 'keys:test-anthropic',
  backupStatus: 'backup:status',
  chooseBackupFolder: 'backup:choose-folder',
  exportEverything: 'backup:export-everything',
  getProfile: 'profile:get',
  saveProfile: 'profile:save'
} as const
