import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import {
  EXPORT_FORMATS,
  frameCount,
  isExportFormatId,
  type ExportJob,
  type ExportRequest,
  type ExportResult
} from '../../shared/export'
import type { TrackLibrary } from '../tracks'
import { startEncode, type Encode } from './ffmpeg'

/**
 * The main-process half of a video export. The window renders the frames and
 * hands them over one by one; this side owns FFmpeg and the output file, and
 * reads the mixdown itself, so the UI never names a file to read.
 */
export interface VideoExports {
  start(request: ExportRequest): ExportJob
  writeFrame(jobId: string, frame: Uint8Array): Promise<void>
  finish(jobId: string): Promise<ExportResult>
  /** Stops the export and removes the partial file. */
  cancel(jobId: string): Promise<void>
}

interface Running {
  job: ExportJob
  encode: Encode
  outputPath: string
  written: number
}

export function createVideoExports({ ffmpegPath, tracks }: { ffmpegPath: string; tracks: TrackLibrary }): VideoExports {
  const running = new Map<string, Running>()

  const get = (jobId: string) => {
    const r = running.get(jobId)
    if (!r) throw new Error(`No export is running with id ${jobId}.`)
    return r
  }

  const drop = async (r: Running) => {
    running.delete(r.job.jobId)
    await r.encode.abort()
    await rm(r.outputPath, { force: true }).catch(() => {})
  }

  return {
    start(request) {
      if (!isExportFormatId(request.format)) throw new Error(`Unknown export format: ${String(request.format)}`)
      if (request.encoder !== 'nvenc' && request.encoder !== 'x264') throw new Error(`Unknown encoder: ${String(request.encoder)}`)
      if (!(request.durationSeconds > 0)) throw new Error('The track has no length to export.')
      if (!request.outputPath.toLowerCase().endsWith('.mp4')) throw new Error('The export must be an .mp4 file.')
      const track = tracks.get(request.trackId)
      if (!track) throw new Error(`No track with id ${request.trackId}.`)

      const format = EXPORT_FORMATS[request.format]
      const seconds =
        request.limitSeconds && request.limitSeconds < request.durationSeconds ? request.limitSeconds : request.durationSeconds
      const job: ExportJob = {
        jobId: randomUUID(),
        width: format.width,
        height: format.height,
        fps: format.fps,
        frames: frameCount(seconds, format.fps)
      }
      const encode = startEncode(ffmpegPath, {
        width: format.width,
        height: format.height,
        fps: format.fps,
        encoder: request.encoder,
        videoBitrate: format.videoBitrate,
        audioBitrate: format.audioBitrate,
        audioPath: track.mixdownPath,
        audioSeconds: seconds < request.durationSeconds ? seconds : undefined,
        outputPath: request.outputPath
      })
      running.set(job.jobId, { job, encode, outputPath: request.outputPath, written: 0 })
      return job
    },

    async writeFrame(jobId, frame) {
      const r = get(jobId)
      if (r.written >= r.job.frames) throw new Error(`The export already has all ${r.job.frames} frames.`)
      r.written++
      try {
        await r.encode.write(frame)
      } catch (error) {
        await drop(r)
        throw error
      }
    },

    async finish(jobId) {
      const r = get(jobId)
      if (r.written !== r.job.frames) {
        await drop(r)
        throw new Error(`The export got ${r.written} of ${r.job.frames} frames.`)
      }
      running.delete(jobId)
      try {
        await r.encode.finish()
      } catch (error) {
        await rm(r.outputPath, { force: true }).catch(() => {})
        throw error
      }
      return { outputPath: r.outputPath, frames: r.written, bytes: (await stat(r.outputPath)).size }
    },

    async cancel(jobId) {
      const r = running.get(jobId)
      if (r) await drop(r)
    }
  }
}
