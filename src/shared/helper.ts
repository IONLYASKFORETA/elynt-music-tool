/**
 * The calls the app can make to the Python helper, and what comes back.
 * Keep this in step with helper/src/elynt_helper/methods.py.
 */

/** Bump together with PROTOCOL_VERSION in helper/src/elynt_helper/__init__.py. */
export const HELPER_PROTOCOL_VERSION = 1

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

export interface HelperMethods {
  'helper.info': { params: Record<string, never>; result: HelperInfo }
  /** Reads an audio file's header. `path` is as the helper sees it (a WSL path under WSL2). */
  'audio.probe': { params: { path: string }; result: AudioProbe }
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
