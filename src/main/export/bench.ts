import { isExportFormatId, type ExportFormatId, type VideoEncoder } from '../../shared/export'
import type { BenchReport } from '../../shared/bench'

export interface BenchArgs {
  trackPath: string
  /** Where the Markdown report goes. A .json copy is written beside it. */
  outPath: string
  encoder: VideoEncoder
  formats: ExportFormatId[]
  limitSeconds?: number
}

/**
 * `--bench-export=<mixdown> --bench-out=<report.md> [--bench-encoder=x264]
 * [--bench-formats=youtube-1080p60] [--bench-seconds=10]`. Null when the app
 * starts normally.
 */
export function parseBenchArgs(argv: string[]): BenchArgs | null {
  const value = (name: string) => {
    const prefix = `--${name}=`
    return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
  }
  const trackPath = value('bench-export')
  if (!trackPath) return null
  const outPath = value('bench-out')
  if (!outPath) throw new Error('--bench-export needs --bench-out=<report.md>.')
  const encoder = value('bench-encoder') ?? 'nvenc'
  if (encoder !== 'nvenc' && encoder !== 'x264') throw new Error(`Unknown --bench-encoder: ${encoder}`)
  const formats = (value('bench-formats') ?? 'youtube-4k60,youtube-1080p60').split(',')
  for (const f of formats) if (!isExportFormatId(f)) throw new Error(`Unknown --bench-formats entry: ${f}`)
  const seconds = value('bench-seconds')
  const limitSeconds = seconds === undefined ? undefined : Number(seconds)
  if (limitSeconds !== undefined && !(limitSeconds > 0)) throw new Error(`Bad --bench-seconds: ${seconds}`)
  return { trackPath, outPath, encoder, formats: formats as ExportFormatId[], limitSeconds }
}

/**
 * Luma PSNR of two RGBA images, in dB (Infinity if identical). Luma, because
 * YouTube's 4:2:0 chroma halves colour resolution by design, and the house
 * style's one-pixel rainbow fringes would swamp an RGB score with that alone.
 */
export function lumaPsnr(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) throw new Error('The images differ in size.')
  const luma = (x: Uint8Array, i: number) => 0.2126 * x[i]! + 0.7152 * x[i + 1]! + 0.0722 * x[i + 2]!
  let sum = 0
  for (let i = 0; i < a.length; i += 4) {
    const d = luma(a, i) - luma(b, i)
    sum += d * d
  }
  if (sum === 0) return Infinity
  return 10 * Math.log10((255 * 255) / (sum / (a.length / 4)))
}

/** Targets from ticket #54: wall-clock time over video time. */
export const REALTIME_TARGETS: Record<ExportFormatId, number> = { 'youtube-4k60': 10, 'youtube-1080p60': 3 }
/** YouTube 4K60 band from the spec, in bits per second. */
export const BITRATE_BANDS: Partial<Record<ExportFormatId, [number, number]>> = { 'youtube-4k60': [53_000_000, 68_000_000] }
/**
 * An exported frame decoded back should be at least this close to its render
 * (luma, dB). Low on purpose: the finish layer's grain is fresh noise every
 * frame, which no YouTube bitrate keeps exactly. Wrong colour, orientation or
 * frame size lands far below it; frame order is checked separately.
 */
export const MIN_ENCODED_PSNR = 25

/** Whether a run passes every check it can. */
export function benchPassed(report: BenchReport): boolean {
  if (report.error) return false
  if (report.compares.length === 0 || report.compares.some((c) => c.maxDiff > 1)) return false
  return report.results.every((r) => {
    const band = report.config.encoder === 'nvenc' ? BITRATE_BANDS[r.format] : undefined
    return (
      r.encodedPsnr >= MIN_ENCODED_PSNR &&
      r.encodedFrameInPlace &&
      Math.abs(r.audioSeconds - r.videoFileSeconds) <= 1 / r.fps + 0.025 &&
      (!band || (r.videoBitrate >= band[0] && r.videoBitrate <= band[1]))
    )
  })
}

export function formatBenchReport(report: BenchReport): string {
  const mbps = (b: number) => `${(b / 1_000_000).toFixed(1)} Mbps`
  const lines = [
    `# Export benchmark: ${report.config.trackTitle}`,
    '',
    `Run ${report.startedAt} on ${report.gpu}, encoder ${report.config.encoder === 'nvenc' ? 'NVENC (h264_nvenc p7, tune hq, multipass fullres)' : 'x264 (CPU fallback)'}.`,
    report.config.limitSeconds ? `Rendered the first ${report.config.limitSeconds} s of the track.` : 'Rendered the whole track.',
    '',
    `Overall: **${benchPassed(report) ? 'pass' : 'FAIL'}**`,
    ''
  ]
  if (report.error) lines.push(`Error: ${report.error}`, '')
  if (report.results.length > 0) {
    lines.push(
      '| Format | Frames | Video | Wall clock | × real time | Target | Bitrate | A/V end gap | Encoded luma PSNR | Frame in place |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    )
    for (const r of report.results) {
      const target = REALTIME_TARGETS[r.format]
      const factor = `${r.realtimeFactor.toFixed(2)}× ${r.realtimeFactor < target ? '(met)' : '(**missed**)'}`
      lines.push(
        `| ${r.width}×${r.height} ${r.fps} fps | ${r.frames} | ${r.videoSeconds.toFixed(2)} s | ${r.elapsed.toFixed(1)} s | ${factor} | under ${target}× | ${mbps(r.videoBitrate)} | ${(Math.abs(r.audioSeconds - r.videoFileSeconds) * 1000).toFixed(0)} ms | ${r.encodedPsnr.toFixed(1)} dB | ${r.encodedFrameInPlace ? 'yes' : '**no**'} |`
      )
    }
    lines.push('')
  }
  lines.push('## Export vs preview', '', 'The same frame drawn by the live preview (onto its canvas) and by the export (offscreen), compared pixel by pixel.', '')
  lines.push('| t | Largest channel difference | Pixels differing |', '| --- | --- | --- |')
  for (const c of report.compares) lines.push(`| ${c.t.toFixed(3)} s | ${c.maxDiff} | ${(c.differing * 100).toFixed(3)}% |`)
  lines.push('')
  return lines.join('\n')
}
