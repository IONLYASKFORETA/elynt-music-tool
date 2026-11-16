import type { ExportFormatId, VideoEncoder } from './export'

/**
 * The export benchmark and frame check (ticket #54). The app runs it when
 * started with --bench-export; it renders a track in each format, checks the
 * export against the preview, and writes a report. See docs/benchmarks/.
 */
export interface BenchConfig {
  trackId: number
  trackTitle: string
  encoder: VideoEncoder
  formats: ExportFormatId[]
  /** Render only this many seconds of the track. Unset renders it all. */
  limitSeconds?: number
  /** Folder the test videos go in. */
  outDir: string
}

export interface FrameCompare {
  t: number
  /** Largest difference of any channel of any pixel, 0 to 255. */
  maxDiff: number
  /** Share of pixels that differ at all. */
  differing: number
}

export interface BenchFormatResult {
  format: ExportFormatId
  width: number
  height: number
  fps: number
  frames: number
  videoSeconds: number
  elapsed: number
  /** Wall-clock time over video time. Under 10 for 4K and under 3 for 1080p is the target. */
  realtimeFactor: number
  file: string
  bytes: number
  /** Measured from the file. */
  videoBitrate: number
  audioSeconds: number
  videoFileSeconds: number
  /** Luma PSNR of a frame decoded from the file against the same frame rendered, in dB. */
  encodedPsnr: number
  encodedFrame: number
  /** Whether that decoded frame matches its own render better than the renders either side of it: frames are in order. */
  encodedFrameInPlace: boolean
}

export interface BenchReport {
  config: BenchConfig
  gpu: string
  startedAt: string
  results: BenchFormatResult[]
  compares: FrameCompare[]
  error?: string
}

export interface FileCheck {
  videoBitrate: number
  audioSeconds: number
  videoSeconds: number
  frames: number
  /** Luma PSNR of the decoded frame against each render passed in, in dB. */
  psnr: number[]
}
