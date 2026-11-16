/**
 * Video export (ADR 0001): the Visualizer renders every frame offline at an
 * exact time and pipes it to FFmpeg, which encodes it and muxes the mixdown.
 * "Format" is used here, not "preset": a Preset is a saved visualizer look
 * (GLOSSARY.md).
 */
import type { FormatId } from './formats'

export type ExportFormatId = 'youtube-4k60' | 'youtube-1080p60'

export interface ExportFormat {
  id: ExportFormatId
  label: string
  width: number
  height: number
  fps: number
  /** Target video bitrate in bits per second. */
  videoBitrate: number
  /** AAC bitrate in bits per second. */
  audioBitrate: number
  /** The layout format (16:9, 9:16 or 1:1) the vision re-flows to for this export, with its safe zone. */
  layout: FormatId
}

/** YouTube upload formats. Both widths are multiples of 64, so GPU readback rows need no padding. */
export const EXPORT_FORMATS: Record<ExportFormatId, ExportFormat> = {
  'youtube-4k60': {
    id: 'youtube-4k60',
    label: 'YouTube 4K 60 fps',
    width: 3840,
    height: 2160,
    fps: 60,
    videoBitrate: 60_000_000,
    audioBitrate: 384_000,
    layout: 'wide'
  },
  'youtube-1080p60': {
    id: 'youtube-1080p60',
    label: 'YouTube 1080p 60 fps',
    width: 1920,
    height: 1080,
    fps: 60,
    videoBitrate: 12_000_000,
    audioBitrate: 384_000,
    layout: 'wide'
  }
}

export function isExportFormatId(value: unknown): value is ExportFormatId {
  return typeof value === 'string' && Object.hasOwn(EXPORT_FORMATS, value)
}

/** NVENC on the owner's RTX card. x264 is the CPU fallback, used by tests and machines without NVIDIA. */
export type VideoEncoder = 'nvenc' | 'x264'

/** How many frames cover a track: the last frame starts before the audio ends. */
export function frameCount(durationSeconds: number, fps: number): number {
  return Math.max(1, Math.ceil(durationSeconds * fps - 1e-6))
}

/** The exact time of frame n. Computed from n, never accumulated, so the picture can't drift from the audio. */
export function frameTime(n: number, fps: number): number {
  return n / fps
}

export interface ExportRequest {
  trackId: number
  format: ExportFormatId
  encoder: VideoEncoder
  outputPath: string
  /** Duration of the decoded mixdown, which fixes the frame count. */
  durationSeconds: number
  /** Render only the first part of the track (benchmarks and smoke tests). */
  limitSeconds?: number
}

export interface ExportJob {
  jobId: string
  width: number
  height: number
  fps: number
  frames: number
}

export interface ExportResult {
  outputPath: string
  frames: number
  bytes: number
}
