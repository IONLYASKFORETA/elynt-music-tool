import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSuiteDatabase, type SuiteDatabase } from '../db/database'
import { createTrackLibrary, type TrackLibrary } from '../tracks'
import { decodeFrame, ffmpegArgs, probeExport, resolveFfmpegPath } from './ffmpeg'
import { createVideoExports } from './exports'
import { EXPORT_FORMATS, frameCount, frameTime } from '../../shared/export'

const ffmpeg = resolveFfmpegPath()

/** A 16-bit stereo WAV of a quiet sine. */
function writeWav(path: string, seconds: number, sampleRate = 48_000): void {
  const frames = Math.round(seconds * sampleRate)
  const data = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000)
    data.writeInt16LE(s, i * 4)
    data.writeInt16LE(s, i * 4 + 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(2, 22)
  head.writeUInt32LE(sampleRate, 24)
  head.writeUInt32LE(sampleRate * 4, 28)
  head.writeUInt16LE(4, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([head, data]))
}

/** A frame filled with one colour. */
function solidFrame(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const frame = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) frame.set([rgb[0], rgb[1], rgb[2], 255], i * 4)
  return frame
}

describe('frame timing', () => {
  it('covers the whole track with frames at exact times', () => {
    expect(frameCount(1, 60)).toBe(60)
    expect(frameCount(1.001, 60)).toBe(61)
    expect(frameCount(69.333, 60)).toBe(4160)
    // Never accumulated, so frame 10 799 of a three-minute track is exactly on time.
    expect(frameTime(10_799, 60)).toBe(10_799 / 60)
  })
})

describe('ffmpegArgs', () => {
  const base = {
    width: 3840,
    height: 2160,
    fps: 60,
    videoBitrate: 60_000_000,
    audioBitrate: 384_000,
    audioPath: 'C:\\Bounces\\flip.wav',
    outputPath: 'C:\\Videos\\flip.mp4'
  }

  it('encodes with NVENC p7, tune hq, multipass fullres, at 60 Mbps CBR', () => {
    const args = ffmpegArgs({ ...base, encoder: 'nvenc' }).join(' ')
    expect(args).toContain('-f rawvideo -pix_fmt rgba -s 3840x2160 -framerate 60 -i pipe:0')
    expect(args).toContain('-c:v h264_nvenc -preset p7 -tune hq -multipass fullres -rc cbr -b:v 60M -maxrate 60M')
    expect(args).toContain('-i C:\\Bounces\\flip.wav')
    expect(args).toContain('-map 0:v:0 -map 1:a:0')
    expect(args).toContain('out_color_matrix=bt709')
    expect(args).toContain('-colorspace bt709')
    expect(args).toContain('-c:a aac -b:a 384k')
    expect(args.endsWith('C:\\Videos\\flip.mp4')).toBe(true)
  })

  it('only cuts the audio when asked', () => {
    expect(ffmpegArgs({ ...base, encoder: 'nvenc' })).not.toContain('-t')
    const args = ffmpegArgs({ ...base, encoder: 'nvenc', audioSeconds: 2.5 }).join(' ')
    expect(args).toContain('-t 2.500000 -i C:\\Bounces\\flip.wav')
  })

  it('falls back to x264 on the CPU', () => {
    expect(ffmpegArgs({ ...base, encoder: 'x264' })).toContain('libx264')
  })
})

describe('video exports', () => {
  let dir: string
  let db: SuiteDatabase
  let tracks: TrackLibrary

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'elynt-export-'))
    db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
    tracks = createTrackLibrary(db)
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it(
    'writes an MP4 with every frame and the mixdown, in sync from start to end',
    async () => {
      const wav = join(dir, 'clip.wav')
      writeWav(wav, 1.25)
      const track = tracks.addFromMixdown(wav)
      const exports = createVideoExports({ ffmpegPath: ffmpeg, tracks })
      const out = join(dir, 'clip.mp4')

      const job = exports.start({
        trackId: track.id,
        format: 'youtube-1080p60',
        encoder: 'x264',
        outputPath: out,
        durationSeconds: 1.25
      })
      expect(job.frames).toBe(75)
      const { width, height } = job
      const colours: [number, number, number][] = [
        [200, 40, 120],
        [30, 180, 220]
      ]
      for (let n = 0; n < job.frames; n++) {
        await exports.writeFrame(job.jobId, solidFrame(width, height, n < 40 ? colours[0]! : colours[1]!))
      }
      const result = await exports.finish(job.jobId)
      expect(result.frames).toBe(75)
      expect(result.bytes).toBeGreaterThan(0)

      const facts = await probeExport(ffmpeg, out)
      expect(facts.video).toMatchObject({ codec: 'h264', width: 1920, height: 1080, fps: 60, frames: 75 })
      expect(facts.audio).toMatchObject({ codec: 'aac', sampleRate: 48_000 })
      // The audio and video end within one frame of each other.
      expect(Math.abs(facts.video.seconds - facts.audio.seconds)).toBeLessThan(1 / 60 + 0.025)

      // Frames land in order and keep their colour through the BT.709 round trip.
      const near = (frame: Uint8Array, rgb: number[]) => rgb.every((c, i) => Math.abs(frame[i]! - c) <= 4)
      expect(near(await decodeFrame(ffmpeg, out, 39, width, height), colours[0]!)).toBe(true)
      expect(near(await decodeFrame(ffmpeg, out, 41, width, height), colours[1]!)).toBe(true)
    },
    60_000
  )

  it(
    'cuts the audio to match when only part of the track renders',
    async () => {
      const wav = join(dir, 'long.wav')
      writeWav(wav, 3)
      const track = tracks.addFromMixdown(wav)
      const exports = createVideoExports({ ffmpegPath: ffmpeg, tracks })
      const out = join(dir, 'part.mp4')
      const job = exports.start({
        trackId: track.id,
        format: 'youtube-1080p60',
        encoder: 'x264',
        outputPath: out,
        durationSeconds: 3,
        limitSeconds: 0.5
      })
      expect(job.frames).toBe(30)
      const black = solidFrame(job.width, job.height, [0, 0, 0])
      for (let n = 0; n < job.frames; n++) await exports.writeFrame(job.jobId, black)
      await exports.finish(job.jobId)
      const facts = await probeExport(ffmpeg, out)
      expect(facts.video.frames).toBe(30)
      expect(Math.abs(facts.audio.seconds - 0.5)).toBeLessThan(0.03)
    },
    60_000
  )

  it('a frame of the wrong size stops the export and removes its file', async () => {
    const wav = join(dir, 'clip.wav')
    writeWav(wav, 0.5)
    const track = tracks.addFromMixdown(wav)
    const exports = createVideoExports({ ffmpegPath: ffmpeg, tracks })
    const out = join(dir, 'bad.mp4')
    const job = exports.start({ trackId: track.id, format: 'youtube-1080p60', encoder: 'x264', outputPath: out, durationSeconds: 0.5 })
    await expect(exports.writeFrame(job.jobId, new Uint8Array(16))).rejects.toThrow(/must be/)
    await expect(exports.finish(job.jobId)).rejects.toThrow(/No export/)
    expect(existsSync(out)).toBe(false)
  })

  it('finishing with frames missing fails and removes the file', async () => {
    const wav = join(dir, 'clip.wav')
    writeWav(wav, 0.5)
    const track = tracks.addFromMixdown(wav)
    const exports = createVideoExports({ ffmpegPath: ffmpeg, tracks })
    const out = join(dir, 'short.mp4')
    const job = exports.start({ trackId: track.id, format: 'youtube-1080p60', encoder: 'x264', outputPath: out, durationSeconds: 0.5 })
    await exports.writeFrame(job.jobId, solidFrame(job.width, job.height, [0, 0, 0]))
    await expect(exports.finish(job.jobId)).rejects.toThrow(/1 of 30 frames/)
    expect(existsSync(out)).toBe(false)
  })

  it('cancelling stops FFmpeg and removes the partial file', async () => {
    const wav = join(dir, 'clip.wav')
    writeWav(wav, 0.5)
    const track = tracks.addFromMixdown(wav)
    const exports = createVideoExports({ ffmpegPath: ffmpeg, tracks })
    const out = join(dir, 'cancel.mp4')
    const job = exports.start({ trackId: track.id, format: 'youtube-1080p60', encoder: 'x264', outputPath: out, durationSeconds: 0.5 })
    await exports.writeFrame(job.jobId, solidFrame(job.width, job.height, [9, 9, 9]))
    await exports.cancel(job.jobId)
    expect(existsSync(out)).toBe(false)
    await expect(exports.writeFrame(job.jobId, new Uint8Array(0))).rejects.toThrow(/No export/)
  })

  it('only exports tracks the library holds, to an .mp4', () => {
    const exports = createVideoExports({ ffmpegPath: ffmpeg, tracks })
    const request = { trackId: 99, format: 'youtube-4k60', encoder: 'nvenc', outputPath: join(dir, 'x.mp4'), durationSeconds: 1 } as const
    expect(() => exports.start(request)).toThrow(/No track/)
    expect(() => exports.start({ ...request, outputPath: join(dir, 'x.exe') })).toThrow(/mp4/)
    expect(() => exports.start({ ...request, format: 'vhs' as never })).toThrow(/format/)
  })

  it('keeps the YouTube formats at the sizes the GPU readback assumes', () => {
    for (const f of Object.values(EXPORT_FORMATS)) expect((f.width * 4) % 256).toBe(0)
  })
})
