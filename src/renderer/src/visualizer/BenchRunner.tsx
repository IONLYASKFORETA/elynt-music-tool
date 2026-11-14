import { useEffect, useState } from 'react'
import type { BenchConfig, BenchReport, FrameCompare } from '../../../shared/bench'
import { EXPORT_FORMATS, frameTime } from '../../../shared/export'
import { featuresAt, type MonoAudio } from './audio-features'
import { decodeForExport, exportVideo } from './export-video'
import { SceneRenderer } from './renderer'
import { defaultScene, planFrame } from './scene'

/**
 * The export benchmark and frame check (ticket #54), shown instead of the app
 * when it starts with --bench-export. It reports back to the main process,
 * which writes the report and quits.
 */
export function BenchRunner({ config }: { config: BenchConfig }) {
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    const say = (line: string) => {
      console.log(`[bench] ${line}`)
      setLog((l) => [...l, line])
    }
    void runBench(config, say).then((report) => window.elynt.bench.report(report))
  }, [config])

  return <pre className="bench">{['Export benchmark', ...log].join('\n')}</pre>
}

async function runBench(config: BenchConfig, say: (line: string) => void): Promise<BenchReport> {
  const report: BenchReport = { config, gpu: await gpuName(), startedAt: new Date().toISOString(), results: [], compares: [] }
  const scene = defaultScene
  try {
    const track = (await window.elynt.tracks.list()).find((t) => t.id === config.trackId)
    if (!track) throw new Error('The benchmark track is missing.')
    say(`GPU: ${report.gpu}`)
    const audio = await decodeForExport(track.id)
    const seconds = Math.min(config.limitSeconds ?? Infinity, audio.duration)
    say(`Track: ${track.title}, ${audio.duration.toFixed(2)} s, rendering ${seconds.toFixed(2)} s`)

    // Export vs preview: the same frame drawn both ways must match pixel for pixel.
    const first = EXPORT_FORMATS[config.formats[0]!]
    for (const t of [0.5, seconds / 2, Math.max(0, seconds - 0.1)]) {
      const compare = await compareWithPreview(audio, t, first.width, first.height)
      report.compares.push(compare)
      say(`Compare at t=${t.toFixed(3)} s: max difference ${compare.maxDiff}, ${(compare.differing * 100).toFixed(3)}% of pixels differ`)
    }

    for (const id of config.formats) {
      const format = EXPORT_FORMATS[id]
      const file = `${config.outDir}/${id}.mp4`
      say(`Exporting ${format.label} with ${config.encoder}…`)
      const run = await exportVideo({
        track,
        scene,
        format: id,
        encoder: config.encoder,
        outputPath: file,
        limitSeconds: config.limitSeconds,
        audio,
        onProgress: (p) => {
          if (p.framesWritten % 300 === 0 || p.framesWritten === p.frames) {
            say(`  ${p.framesWritten}/${p.frames} frames, ${(p.framesWritten / p.elapsed).toFixed(1)} fps`)
          }
        }
      })

      // Decode a frame from the middle of the file and hold it against its own render and the renders either side.
      const n = Math.max(1, Math.floor(run.frames / 2))
      const renderer = await SceneRenderer.create()
      renderer.setRenderSize(format.width, format.height)
      const renders: Uint8Array[] = []
      for (const k of [n - 1, n, n + 1]) {
        const t = frameTime(k, format.fps)
        renders.push(await renderer.renderPixels(planFrame(scene, featuresAt(audio, t), t, renderer.renderSize)))
      }
      renderer.destroy()
      const check = await window.elynt.bench.checkFile(run.outputPath, n, renders, format.width, format.height)
      const [before, own, after] = check.psnr as [number, number, number]

      const result = {
        format: id,
        width: format.width,
        height: format.height,
        fps: format.fps,
        frames: run.frames,
        videoSeconds: run.videoSeconds,
        elapsed: run.elapsed,
        realtimeFactor: run.elapsed / run.videoSeconds,
        file: run.outputPath,
        bytes: run.bytes,
        videoBitrate: check.videoBitrate,
        audioSeconds: check.audioSeconds,
        videoFileSeconds: check.videoSeconds,
        encodedPsnr: own,
        encodedFrame: n,
        encodedFrameInPlace: own > before && own > after
      }
      report.results.push(result)
      say(
        `  done in ${run.elapsed.toFixed(1)} s = ${result.realtimeFactor.toFixed(2)}× real time, ` +
          `${(check.videoBitrate / 1e6).toFixed(1)} Mbps, audio ${check.audioSeconds.toFixed(3)} s vs video ${check.videoSeconds.toFixed(3)} s, ` +
          `frame ${n} luma PSNR ${own.toFixed(1)} dB (neighbours ${before.toFixed(1)} / ${after.toFixed(1)})`
      )
    }
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e)
    say(`Error: ${report.error}`)
  }
  return report
}

/** Draws frame t the preview's way (onto a canvas) and the export's way (offscreen), and diffs them. */
async function compareWithPreview(audio: MonoAudio, t: number, width: number, height: number): Promise<FrameCompare> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const preview = await SceneRenderer.create(canvas)
  const offscreen = await SceneRenderer.create()
  try {
    preview.setRenderSize(width, height)
    offscreen.setRenderSize(width, height)
    const plan = planFrame(defaultScene, featuresAt(audio, t), t, { width, height })
    const [shown, exported] = await Promise.all([preview.drawAndCapture(plan), offscreen.renderPixels(plan)])
    let maxDiff = 0
    let differing = 0
    for (let i = 0; i < shown.length; i += 4) {
      let pixel = 0
      for (let c = 0; c < 3; c++) pixel = Math.max(pixel, Math.abs(shown[i + c]! - exported[i + c]!))
      maxDiff = Math.max(maxDiff, pixel)
      if (pixel > 0) differing++
    }
    return { t, maxDiff, differing: differing / (width * height) }
  } finally {
    preview.destroy()
    offscreen.destroy()
  }
}

async function gpuName(): Promise<string> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return 'no WebGPU adapter'
  const { vendor, architecture, description, device } = adapter.info
  return [description, vendor, architecture, device].filter(Boolean).join(' · ') || 'unknown GPU'
}
