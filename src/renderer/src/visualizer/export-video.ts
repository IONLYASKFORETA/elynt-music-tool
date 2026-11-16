import type { ExportFormatId, ExportResult, VideoEncoder } from '../../../shared/export'
import type { Track } from '../../../shared/track'
import { featuresAt, type MonoAudio } from './audio-features'
import { pumpFrames } from './frame-pump'
import { SceneRenderer } from './renderer'
import type { TrackSignals } from './signals'
import { planVisionFrame, visionImages, type Vision } from './vision'
import { decodeTrackAudio } from './track-audio'

export interface ExportProgress {
  framesWritten: number
  frames: number
  /** Wall-clock seconds since rendering started. */
  elapsed: number
}

export interface ExportOptions {
  track: Track
  /** One scene per section; scenes cut at section boundaries exactly as in the preview. */
  vision: Vision
  /** The same signals the preview reacts to, so reactivity matches frame for frame. */
  signals: TrackSignals
  format: ExportFormatId
  encoder: VideoEncoder
  outputPath: string
  /** Render only the first part of the track (benchmarks and smoke tests). */
  limitSeconds?: number
  /** Already-decoded audio, if the caller has it. */
  audio?: MonoAudio & { duration: number }
  onProgress?(progress: ExportProgress): void
  signal?: AbortSignal
}

export interface ExportRun extends ExportResult {
  /** Seconds of video rendered. */
  videoSeconds: number
  /** Wall-clock seconds the render and encode took. */
  elapsed: number
}

/**
 * Exports a track to video (ADR 0001): every frame is drawn offscreen at its
 * exact time from the same vision, signals, spectrum and shaders as the live preview,
 * read back, and handed to FFmpeg in the main process. Nothing is captured
 * from the screen.
 */
export async function exportVideo(options: ExportOptions): Promise<ExportRun> {
  const { track, vision, signals, signal } = options
  const audio = options.audio ?? (await decodeForExport(track.id))
  signal?.throwIfAborted()

  const renderer = await SceneRenderer.create()
  const job = await window.elynt.exports.start({
    trackId: track.id,
    format: options.format,
    encoder: options.encoder,
    outputPath: options.outputPath,
    durationSeconds: audio.duration,
    limitSeconds: options.limitSeconds
  })
  try {
    renderer.setRenderSize(job.width, job.height)
    // Every frame has to show its Subject's image, the first one included.
    await renderer.loadImages(visionImages(vision))
    const size = renderer.renderSize
    const started = performance.now()
    const elapsed = () => (performance.now() - started) / 1000
    await pumpFrames({
      frames: job.frames,
      fps: job.fps,
      signal,
      render: (t) => renderer.renderPixels(planVisionFrame(vision, featuresAt(audio, t), t, size, signals)),
      write: (frame) => window.elynt.exports.writeFrame(job.jobId, frame),
      onProgress: (framesWritten) => options.onProgress?.({ framesWritten, frames: job.frames, elapsed: elapsed() })
    })
    const result = await window.elynt.exports.finish(job.jobId)
    return { ...result, videoSeconds: job.frames / job.fps, elapsed: elapsed() }
  } catch (error) {
    await window.elynt.exports.cancel(job.jobId).catch(() => {})
    throw error
  } finally {
    renderer.destroy()
  }
}

/** Decodes the way the preview does, so the export hears exactly what the preview heard. */
export async function decodeForExport(trackId: number): Promise<MonoAudio & { duration: number }> {
  const context = new AudioContext()
  try {
    const { buffer, mono } = await decodeTrackAudio(trackId, context)
    return { ...mono, duration: buffer.duration }
  } finally {
    void context.close()
  }
}
