import { describe, expect, it } from 'vitest'
import type { BenchReport } from '../../shared/bench'
import { benchPassed, formatBenchReport, lumaPsnr, parseBenchArgs } from './bench'

describe('parseBenchArgs', () => {
  it('is off unless --bench-export is given', () => {
    expect(parseBenchArgs(['electron', '.'])).toBeNull()
  })

  it('defaults to NVENC at 4K and 1080p over the whole track', () => {
    expect(parseBenchArgs(['--bench-export=D:\\flip.wav', '--bench-out=docs/benchmarks/x.md'])).toEqual({
      trackPath: 'D:\\flip.wav',
      outPath: 'docs/benchmarks/x.md',
      encoder: 'nvenc',
      formats: ['youtube-4k60', 'youtube-1080p60'],
      limitSeconds: undefined
    })
  })

  it('takes an encoder, formats and a length', () => {
    const args = parseBenchArgs(['--bench-export=a.wav', '--bench-out=r.md', '--bench-encoder=x264', '--bench-formats=youtube-1080p60', '--bench-seconds=2'])
    expect(args).toMatchObject({ encoder: 'x264', formats: ['youtube-1080p60'], limitSeconds: 2 })
  })

  it('rejects what it does not know', () => {
    expect(() => parseBenchArgs(['--bench-export=a.wav'])).toThrow(/bench-out/)
    expect(() => parseBenchArgs(['--bench-export=a.wav', '--bench-out=r.md', '--bench-formats=8k'])).toThrow(/8k/)
    expect(() => parseBenchArgs(['--bench-export=a.wav', '--bench-out=r.md', '--bench-seconds=0'])).toThrow(/seconds/)
  })
})

describe('lumaPsnr', () => {
  it('is infinite for identical images and ignores alpha', () => {
    expect(lumaPsnr(new Uint8Array([1, 2, 3, 0]), new Uint8Array([1, 2, 3, 255]))).toBe(Infinity)
  })
  it('falls as the images differ more', () => {
    const a = new Uint8Array(400).fill(100)
    const near = a.map((v, i) => (i % 8 === 0 ? v + 2 : v))
    const far = a.map((v, i) => (i % 8 === 0 ? v + 40 : v))
    expect(lumaPsnr(a, near)).toBeGreaterThan(lumaPsnr(a, far))
    expect(lumaPsnr(a, near)).toBeGreaterThan(40)
  })
  it('barely notices a colour swap of equal brightness, which 4:2:0 chroma would blur anyway', () => {
    const red = new Uint8Array([255, 0, 0, 255])
    const sameLuma = new Uint8Array([0, Math.round((0.2126 * 255) / 0.7152), 0, 255])
    expect(lumaPsnr(red, sameLuma)).toBeGreaterThan(45)
  })
})

const report = (over: Partial<BenchReport> = {}): BenchReport => ({
  config: { trackId: 1, trackTitle: 'flip', encoder: 'nvenc', formats: ['youtube-4k60'], outDir: '/tmp' },
  gpu: 'NVIDIA GeForce RTX 5080',
  startedAt: '2026-11-14T16:00:00Z',
  compares: [{ t: 1, maxDiff: 0, differing: 0 }],
  results: [
    {
      format: 'youtube-4k60',
      width: 3840,
      height: 2160,
      fps: 60,
      frames: 4140,
      videoSeconds: 69,
      elapsed: 300,
      realtimeFactor: 300 / 69,
      file: '/tmp/x.mp4',
      bytes: 1,
      videoBitrate: 60_100_000,
      audioSeconds: 69,
      videoFileSeconds: 69,
      encodedPsnr: 42,
      encodedFrame: 100,
      encodedFrameInPlace: true
    }
  ],
  ...over
})

describe('benchPassed and the report', () => {
  it('passes a run that meets every check, and says so', () => {
    expect(benchPassed(report())).toBe(true)
    const md = formatBenchReport(report())
    expect(md).toContain('Overall: **pass**')
    expect(md).toContain('4.35× (met)')
    expect(md).toContain('60.1 Mbps')
  })

  it('fails when the export and preview differ, or the bitrate leaves the band', () => {
    expect(benchPassed(report({ compares: [{ t: 1, maxDiff: 9, differing: 0.2 }] }))).toBe(false)
    const low = report()
    low.results[0]!.videoBitrate = 20_000_000
    expect(benchPassed(low)).toBe(false)
  })

  it('fails when a decoded frame matches a neighbouring render better than its own', () => {
    const shifted = report()
    shifted.results[0]!.encodedFrameInPlace = false
    expect(benchPassed(shifted)).toBe(false)
  })

  it('reports a missed speed target without failing the checks', () => {
    const slow = report()
    slow.results[0]!.realtimeFactor = 14
    expect(benchPassed(slow)).toBe(true)
    expect(formatBenchReport(slow)).toContain('14.00× (**missed**)')
  })
})
