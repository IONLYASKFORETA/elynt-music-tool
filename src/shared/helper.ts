import type { TrackAnalysis } from './analysis'
import type { LiveSet } from './live-set'

/**
 * The calls the app can make to the Python helper, and what comes back.
 * Keep this in step with helper/src/elynt_helper/methods.py.
 */

/** Bump together with PROTOCOL_VERSION in helper/src/elynt_helper/__init__.py. */
export const HELPER_PROTOCOL_VERSION = 2

export interface GpuInfo {
  available: boolean
  via: 'torch' | 'nvidia-smi' | 'none'
  name?: string
  cudaVersion?: string
  computeCapability?: string
  memoryGb?: number
  torchVersion?: string
  driverVersion?: string
  reason?: string
}

export interface HelperInfo {
  version: string
  protocol: number
  python: string
  platform: string
  wsl: boolean
  gpu: GpuInfo
}

export interface AudioProbe {
  durationSeconds: number
  sampleRate: number
  channels: number
  frames: number
  format: string
}

/** A progress line the helper sends for a long call before its answer. */
export interface HelperProgress {
  /** What it is doing, in words ("Loading the stem model", "Splitting"). */
  stage: string
  /** 0 to 1 within the stage, when the helper can tell. */
  fraction?: number
}

export interface SplitStem {
  /** drums, bass, vocals, other, guitar or piano. */
  name: string
  /** Where the helper wrote it, as the helper sees it (a WSL path under WSL2). */
  path: string
}

export interface StemSplit {
  /** Drums and bass first: the stems the Visualizer leans on most. */
  stems: SplitStem[]
  /** The separation model's file name, e.g. BS-Roformer-SW.ckpt. */
  model: string
  seconds: number
}

export interface HelperMethods {
  /** Track analysis (V1). Errors: file_not_found, unreadable_audio, silent_audio, no_beat. Takes seconds to a minute. */
  'track.analyze': { params: { path: string }; result: TrackAnalysis }
  /** The Live Set reader (M1). Errors: file_not_found, unreadable_live_set. Never fails on a missing element. */
  'liveset.read': { params: { path: string }; result: LiveSet }
  'helper.info': { params: Record<string, never>; result: HelperInfo }
  /** Reads an audio file's header. `path` is as the helper sees it (a WSL path under WSL2). */
  'audio.probe': { params: { path: string }; result: AudioProbe }
  /** Splits a mixdown into stems on the GPU (BS-RoFormer), writing one WAV per stem into `outDir`. Sends progress. */
  'stems.split': { params: { path: string; outDir: string; model?: string }; result: StemSplit }
}

export type HelperMethod = keyof HelperMethods

export type HelperState =
  /** Spawned, waiting for its ready line. */
  | 'starting'
  /** Ready and answering calls. */
  | 'running'
  /** It died; another start is scheduled. */
  | 'restarting'
  /** The helper's Python could not be found or launched; run its setup script. */
  | 'not-installed'
  /** Stopped on purpose (the app is quitting). */
  | 'stopped'

export interface HelperStatus {
  state: HelperState
  /** 'wsl' when it runs inside WSL2, 'native' otherwise. */
  mode: 'wsl' | 'native'
  /** How many times it has been restarted since the app opened. */
  restarts: number
  /** The last thing that went wrong, in words. */
  lastError?: string
  /** Filled in once the helper is running. */
  info?: HelperInfo
}
