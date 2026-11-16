import type { TrackAnalysisState } from './analysis'
import type { AudioProbe, HelperStatus } from './helper'
import type { KeyName, KeyStatus, KeyTestResult } from './keys'
import type { BackupStatus } from './backup'
import type { MixSetup } from './mix-setup'
import type { ArtistProfile } from './profile'
import type { SplitJob, Stem } from './stems'
import type { Track } from './track'

/** What the preload script exposes to the UI as `window.elynt`. */
export interface ElyntApi {
  tracks: {
    list(): Promise<Track[]>
    /** Opens a file picker for a mixdown and adds its track. Resolves to null if the owner cancels. */
    addFromPickedMixdown(): Promise<Track | null>
    /** The bytes of a track's mixdown file, for the Visualizer to decode and play. */
    readMixdown(trackId: number): Promise<Uint8Array>
  }
  /**
   * A track's stems: all the owner's own, or all AI-split by the helper. Own stems always win.
   * Each stem's `source` says which; the Mix & Master Assistant only uses 'own'.
   */
  stems: {
    list(trackId: number): Promise<Stem[]>
    /** Opens a multi-file picker; the picked stems replace any split set. Null if cancelled. */
    attachPicked(trackId: number): Promise<Stem[] | null>
    removeOwn(stemId: number): Promise<void>
    /** Splits the mixdown in the helper if the track has no stems yet. Resolves when done. */
    split(trackId: number): Promise<Stem[]>
    /** Splits running or failed right now. */
    jobs(): Promise<SplitJob[]>
    /** Calls back as a split starts, reports progress, finishes ('done') or fails. Returns a function that stops listening. */
    onJob(listener: (job: SplitJob | { trackId: number; state: 'done' }) => void): () => void
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
  /** Mix & Master per-track setup: subgenre, loudness target and reference tracks. */
  mixSetup: {
    /** Null if the track was never set up. */
    get(trackId: number): Promise<MixSetup | null>
    /** Saves the whole setup. Rejects unknown values, missing files and more than 3 references. */
    save(setup: MixSetup): Promise<MixSetup>
    /** Opens a file picker for reference tracks. Resolves to the picked paths, empty if cancelled. */
    pickReferenceTracks(): Promise<string[]>
    /** The path on disk of a file dropped onto the window. */
    pathForDroppedFile(file: File): string
  }
  /** Track analysis (V1): tempo, beats, sections, energy and mood, saved on the track. */
  analysis: {
    /** Null until the track has been queued for analysis. */
    get(trackId: number): Promise<TrackAnalysisState | null>
    /** Queues the track to be analysed again. */
    rerun(trackId: number): Promise<TrackAnalysisState>
    /** Calls back whenever any track's analysis changes. Returns a function that stops listening. */
    onChange(listener: (state: TrackAnalysisState) => void): () => void
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
  readMixdown: 'tracks:read-mixdown',
  listStems: 'stems:list',
  attachPickedStems: 'stems:attach-picked',
  removeOwnStem: 'stems:remove-own',
  splitStems: 'stems:split',
  splitJobs: 'stems:jobs',
  splitJobChanged: 'stems:job-changed',
  keyStatus: 'keys:status',
  saveKey: 'keys:save',
  removeKey: 'keys:remove',
  testAnthropicKey: 'keys:test-anthropic',
  backupStatus: 'backup:status',
  chooseBackupFolder: 'backup:choose-folder',
  exportEverything: 'backup:export-everything',
  getProfile: 'profile:get',
  saveProfile: 'profile:save',
  getMixSetup: 'mix-setup:get',
  saveMixSetup: 'mix-setup:save',
  pickReferenceTracks: 'mix-setup:pick-reference-tracks',
  getAnalysis: 'analysis:get',
  rerunAnalysis: 'analysis:rerun',
  analysisChanged: 'analysis:changed',
  helperStatus: 'helper:status',
  helperStatusChanged: 'helper:status-changed',
  probeTrack: 'helper:probe-track'
} as const
