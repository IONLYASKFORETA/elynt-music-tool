import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import type { VideoEncoder } from '../../shared/export'

export interface EncodeOptions {
  width: number
  height: number
  fps: number
  encoder: VideoEncoder
  videoBitrate: number
  audioBitrate: number
  /** The mixdown, muxed as the video's audio. */
  audioPath: string
  /** Cut the audio here (only when the export renders part of the track). */
  audioSeconds?: number
  outputPath: string
}

/**
 * FFmpeg arguments for one export. Frames arrive on stdin as raw RGBA, top row
 * first, at a fixed frame rate, so frame n sits at exactly n / fps. The audio
 * starts at 0 too, which keeps the two in sync from start to end.
 *
 * Colour is converted once, explicitly, to BT.709 limited range and tagged as
 * such, so players and YouTube show the same colours as the preview.
 */
export function ffmpegArgs(o: EncodeOptions): string[] {
  const mbps = (bits: number) => `${Math.round(bits / 1_000_000)}M`
  const video =
    o.encoder === 'nvenc'
      ? [
          '-c:v', 'h264_nvenc',
          '-preset', 'p7',
          '-tune', 'hq',
          '-multipass', 'fullres',
          // CBR keeps the bitrate in YouTube's band even on mostly black frames.
          '-rc', 'cbr',
          '-b:v', mbps(o.videoBitrate),
          '-maxrate', mbps(o.videoBitrate),
          '-bufsize', mbps(o.videoBitrate * 2),
          '-profile:v', 'high',
          '-spatial-aq', '1',
          '-temporal-aq', '1'
        ]
      : [
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-b:v', mbps(o.videoBitrate),
          '-maxrate', mbps(o.videoBitrate * 1.1),
          '-bufsize', mbps(o.videoBitrate * 2),
          '-profile:v', 'high'
        ]

  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${o.width}x${o.height}`,
    '-framerate', String(o.fps),
    '-i', 'pipe:0',
    ...(o.audioSeconds !== undefined ? ['-t', o.audioSeconds.toFixed(6)] : []),
    '-i', o.audioPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
    ...video,
    // YouTube: closed GOP of half the frame rate, two B-frames.
    '-g', String(Math.round(o.fps / 2)),
    '-bf', '2',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-color_range', 'tv',
    '-c:a', 'aac',
    '-b:a', `${Math.round(o.audioBitrate / 1000)}k`,
    '-ar', '48000',
    '-movflags', '+faststart',
    o.outputPath
  ]
}

/** Which FFmpeg to run: ELYNT_FFMPEG if set, else the build that ships with the app (ffmpeg-static). */
export function resolveFfmpegPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env['ELYNT_FFMPEG']) return env['ELYNT_FFMPEG']
  const bundled = createRequire(import.meta.url)('ffmpeg-static') as string | null
  if (!bundled) throw new Error('No FFmpeg build ships for this platform. Set ELYNT_FFMPEG to an ffmpeg executable.')
  // A packaged app can't run a binary from inside its asar archive.
  return bundled.replace('app.asar', 'app.asar.unpacked')
}

export interface Encode {
  /** Writes one RGBA frame. Resolves once FFmpeg has taken it, which is the export's backpressure. */
  write(frame: Uint8Array): Promise<void>
  /** Closes the input and waits for FFmpeg to finish the file. */
  finish(): Promise<void>
  /** Stops FFmpeg and resolves once it has exited (and let go of the file, which matters on Windows). */
  abort(): Promise<void>
}

export function startEncode(ffmpegPath: string, options: EncodeOptions): Encode {
  const child = spawn(ffmpegPath, ffmpegArgs(options), { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  const failure = (what: string) =>
    new Error(`FFmpeg ${what}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' ')}` : '.'}`)

  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', (error) => reject(new Error(`FFmpeg could not start (${ffmpegPath}): ${error.message}`)))
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(failure(signal ? `was stopped (${signal})` : `exited with code ${code}`))
    })
  })
  // Errors surface through write/finish; don't let an early exit go unhandled.
  exited.catch(() => {})
  child.stdin.on('error', () => {})

  const frameBytes = options.width * options.height * 4

  return {
    write(frame) {
      if (frame.byteLength !== frameBytes) {
        return Promise.reject(new Error(`A frame must be ${frameBytes} bytes, got ${frame.byteLength}.`))
      }
      if (child.exitCode !== null || child.stdin.destroyed) return exited.then(() => Promise.reject(failure('stopped early')))
      return new Promise<void>((resolve, reject) => {
        const onExit = () => exited.then(() => reject(failure('stopped early')), reject)
        child.once('close', onExit)
        child.stdin.write(frame, (error) => {
          child.off('close', onExit)
          if (error) onExit()
          else resolve()
        })
      })
    },
    finish() {
      child.stdin.end()
      return exited
    },
    abort() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      return exited.then(
        () => {},
        () => {}
      )
    }
  }
}

export interface MediaFacts {
  video: { codec: string; width: number; height: number; fps: number; frames: number; seconds: number }
  audio: { codec: string; sampleRate: number; seconds: number }
  /** Average bitrate of the video stream in bits per second. */
  videoBitrate: number
}

/**
 * Reads an exported file back with the same FFmpeg (no ffprobe ships with it):
 * every packet's timestamp and size, via the framecrc muxer, without
 * decoding. Used by tests and the export benchmark to check frame count, sync
 * and bitrate.
 */
export function probeExport(ffmpegPath: string, file: string): Promise<MediaFacts> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', file, '-map', '0', '-c', 'copy', '-f', 'framecrc', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c: string) => (out += c))
    child.stderr.on('data', (c: string) => (err += c))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg could not read ${file}: ${err.slice(-500)}`))
      resolve(parseFramecrc(out, err))
    })
  })
}

interface StreamPackets {
  type: string
  codec: string
  tb: number
  width: number
  height: number
  sampleRate: number
  packets: number
  bytes: number
  end: number
}

function parseFramecrc(out: string, info: string): MediaFacts {
  const streams = new Map<number, StreamPackets>()
  const stream = (i: number) => {
    let s = streams.get(i)
    if (!s) streams.set(i, (s = { type: '', codec: '', tb: 0, width: 0, height: 0, sampleRate: 0, packets: 0, bytes: 0, end: 0 }))
    return s
  }
  for (const line of out.split('\n')) {
    const head = line.match(/^#(\w+) (\d+): (.+)$/)
    if (head) {
      const [, key, index, value] = head as unknown as [string, string, string, string]
      const s = stream(Number(index))
      if (key === 'tb') {
        const [num, den] = value.split('/').map(Number)
        s.tb = num! / den!
      } else if (key === 'media_type') s.type = value.trim()
      else if (key === 'codec_id') s.codec = value.trim()
      else if (key === 'dimensions') [s.width, s.height] = value.split('x').map(Number) as [number, number]
      else if (key === 'sample_rate') s.sampleRate = Number(value)
      continue
    }
    const packet = line.split(',').map((f) => f.trim())
    if (packet.length < 5 || line.startsWith('#')) continue
    const s = stream(Number(packet[0]))
    const pts = Number(packet[2])
    const duration = Number(packet[3])
    s.packets++
    s.bytes += Number(packet[4])
    s.end = Math.max(s.end, (pts + duration) * s.tb)
  }
  const all = [...streams.values()]
  const v = all.find((s) => s.type === 'video')
  const a = all.find((s) => s.type === 'audio')
  const fps = Number(info.match(/Video: [^\n]*?([\d.]+) fps/)?.[1] ?? 0)
  return {
    video: {
      codec: v?.codec ?? '',
      width: v?.width ?? 0,
      height: v?.height ?? 0,
      fps,
      frames: v?.packets ?? 0,
      seconds: v?.end ?? 0
    },
    audio: { codec: a?.codec ?? '', sampleRate: a?.sampleRate ?? 0, seconds: a?.end ?? 0 },
    videoBitrate: v && v.end > 0 ? (v.bytes * 8) / v.end : 0
  }
}

/** Decodes frame n of an exported file back to RGBA (top row first), for comparing against the render. */
export function decodeFrame(ffmpegPath: string, file: string, n: number, width: number, height: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `select=eq(n\\,${n}),scale=in_range=tv:out_range=pc:in_color_matrix=bt709`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    const chunks: Buffer[] = []
    let err = ''
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => (err += c.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      const bytes = Buffer.concat(chunks)
      if (code !== 0 || bytes.length !== width * height * 4) reject(new Error(`Could not decode frame ${n}: ${err.slice(-300)}`))
      else resolve(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    })
  })
}
