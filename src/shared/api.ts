import type { BenchConfig, BenchReport, FileCheck } from './bench'
import type { ExportFormatId, ExportJob, ExportRequest, ExportResult } from './export'
import type { TrackAnalysis, TrackAnalysisState } from './analysis'
import type { AudioProbe, HelperStatus } from './helper'
import type { KeyName, KeyStatus, KeyTestResult } from './keys'
import type { BackupStatus } from './backup'
import type { MixSetup } from './mix-setup'
import type { ArtistProfile } from './profile'
import type { Release, ReleaseWithPlan, StartRelease } from './release'
import type { SplitJob, Stem } from './stems'
import type { SubjectImage, SubjectImageRequest, SubjectJob } from './subject-images'
import type { Track } from './track'

/** What the preload script exposes to the UI as `window.elynt`. */
export interface ElyntApi {
  tracks: {
    list(): Promise<Track[]>
    /** Opens a file picker for a mixdown and adds its track. Resolves to null if the owner cancels. */
    addFromPickedMixdown(): Promise<Track | null>
    /** The bytes of a track's mixdown file, for the Visualizer to decode and play. */
    readMixdown(trackId: number): Promise<Uint8Array>
    /** Gives a track the owner's title (the "What I heard" check). Rejects an empty title. */
    rename(trackId: number, title: string): Promise<Track>
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
    /** The bytes of one of a track's stems, for the Visualizer to decode and react to. */
    read(trackId: number, stemId: number): Promise<Uint8Array>
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
  /** Release Assistant: releases and their dated plans, built from the playbook. */
  releases: {
    /** Every release, newest first. */
    list(): Promise<Release[]>
    /** A release and its plan. Null if there is no such release. */
    get(releaseId: number): Promise<ReleaseWithPlan | null>
    /** Builds the plan from the newest playbook and saves it. Rejects an unknown track or a bad date. */
    start(input: StartRelease): Promise<ReleaseWithPlan>
  }
  /** Video export. The window renders frames; the main process owns FFmpeg and the file. */
  exports: {
    /** Opens a save dialog for the video. Resolves to the path, or null if cancelled. */
    chooseOutput(trackTitle: string, format: ExportFormatId): Promise<string | null>
    start(request: ExportRequest): Promise<ExportJob>
    /** One RGBA frame, top row first. Resolves once FFmpeg has taken it. */
    writeFrame(jobId: string, frame: Uint8Array): Promise<void>
    finish(jobId: string): Promise<ExportResult>
    cancel(jobId: string): Promise<void>
    /** Shows a finished video in Explorer. */
    reveal(path: string): Promise<void>
  }
  /** The export benchmark: only active when the app was started with --bench-export. */
  bench: {
    config(): Promise<BenchConfig | null>
    /** Reads an exported file back and compares its frame n with each RGBA render given. */
    checkFile(path: string, frame: number, renders: Uint8Array[], width: number, height: number): Promise<FileCheck>
    report(report: BenchReport): Promise<void>
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
    /** Saves the owner's corrections from the "What I heard" check over the heard analysis. */
    saveCorrection(trackId: number, analysis: TrackAnalysis): Promise<TrackAnalysisState>
    /** The owner skipped the "What I heard" check. */
    skipCheck(trackId: number): Promise<TrackAnalysisState>
    /** Calls back whenever any track's analysis changes. Returns a function that stops listening. */
    onChange(listener: (state: TrackAnalysisState) => void): () => void
  }
  /**
   * Subject images (V9): options for a track's Subject layers, made ahead of time by the helper's
   * local image model. Show one with mediaUrl(image.path) from shared/subject-images.
   */
  subjectImages: {
    list(trackId: number): Promise<SubjectImage[]>
    /** Generates `count` options of one motif, one after another. Resolves to the new ones. */
    generate(trackId: number, request: SubjectImageRequest, count: number): Promise<SubjectImage[]>
    /** A new option from the same prompt with a fresh seed. */
    regenerate(imageId: number): Promise<SubjectImage>
    /** Drops an option and deletes its file. */
    remove(imageId: number): Promise<void>
    jobs(): Promise<SubjectJob[]>
    /** Calls back as a generation starts, reports progress, finishes ('done') or fails. */
    onJob(listener: (job: SubjectJob | { trackId: number; state: 'done' }) => void): () => void
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
  renameTrack: 'tracks:rename',
  listStems: 'stems:list',
  attachPickedStems: 'stems:attach-picked',
  removeOwnStem: 'stems:remove-own',
  readStem: 'stems:read',
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
  listReleases: 'releases:list',
  getRelease: 'releases:get',
  startRelease: 'releases:start',
  getMixSetup: 'mix-setup:get',
  saveMixSetup: 'mix-setup:save',
  pickReferenceTracks: 'mix-setup:pick-reference-tracks',
  getAnalysis: 'analysis:get',
  rerunAnalysis: 'analysis:rerun',
  saveAnalysisCorrection: 'analysis:save-correction',
  skipAnalysisCheck: 'analysis:skip-check',
  analysisChanged: 'analysis:changed',
  helperStatus: 'helper:status',
  helperStatusChanged: 'helper:status-changed',
  probeTrack: 'helper:probe-track',
  chooseExportOutput: 'exports:choose-output',
  startExport: 'exports:start',
  writeExportFrame: 'exports:write-frame',
  finishExport: 'exports:finish',
  cancelExport: 'exports:cancel',
  revealExport: 'exports:reveal',
  benchConfig: 'bench:config',
  benchCheckFile: 'bench:check-file',
  benchReport: 'bench:report',
  listSubjectImages: 'subject-images:list',
  generateSubjectImages: 'subject-images:generate',
  regenerateSubjectImage: 'subject-images:regenerate',
  removeSubjectImage: 'subject-images:remove',
  subjectJobs: 'subject-images:jobs',
  subjectJobChanged: 'subject-images:job-changed'
} as const
