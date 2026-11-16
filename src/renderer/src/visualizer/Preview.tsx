import { useEffect, useRef, useState } from 'react'
import type { TrackAnalysis } from '../../../shared/analysis'
import { DEFAULT_SAFE_ZONES, FORMAT_IDS, FORMATS, formatLayout, type FormatId, type SafeZones } from '../../../shared/formats'
import type { Track } from '../../../shared/track'
import { featuresAt, type MonoAudio } from './audio-features'
import { ExportPanel } from './ExportPanel'
import { SafeZoneGuides } from './SafeZoneGuides'
import { PlaybackClock } from './playback-clock'
import { SceneRenderer } from './renderer'
import { NO_SIGNALS, type TrackSignals } from './signals'
import { loadTrackSignals, decodeTrackAudio } from './track-audio'
import { planVisionFrame, sectionIndexAt, type Vision } from './vision'

/** The longest side the preview canvas gets, in pixels: 4K's width. */
const MAX_CANVAS_SIDE = 3840

/** Share of the canvas's pixels the layers render at. The preview runs reduced; export will run full. */
const RENDER_SCALES = [
  { label: 'Half res', value: 0.5 },
  { label: 'Full res', value: 1 }
] as const

interface Loaded {
  context: AudioContext
  buffer: AudioBuffer
  mono: MonoAudio
  clock: PlaybackClock
}

/**
 * The Visualizer's live preview: plays a track's mixdown and draws the vision in time with it,
 * cutting to each section's scene as playback crosses into it, every layer reacting to the
 * track's signals. It shows one format at a time (16:9, 9:16 or 1:1, V16), re-flowed from the
 * same vision, with guides for the format's safe zone.
 */
export function Preview({
  track,
  analysis,
  vision,
  format,
  onFormatChange
}: {
  track: Track
  analysis: TrackAnalysis | null
  vision: Vision
  format: FormatId
  onFormatChange(format: FormatId): void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loadedRef = useRef<Loaded | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const visionRef = useRef(vision)
  const signalsRef = useRef<TrackSignals>(NO_SIGNALS)
  const [signals, setSignals] = useState<TrackSignals | undefined>(undefined)
  const scaleRef = useRef<number>(RENDER_SCALES[0].value)
  /** While a video exports, the preview stops drawing so the GPU is free for the export. */
  const exportingRef = useRef(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [fps, setFps] = useState(0)
  const [scale, setScale] = useState<number>(RENDER_SCALES[0].value)
  const [zones, setZones] = useState<SafeZones>(DEFAULT_SAFE_ZONES)
  const [guides, setGuides] = useState(true)
  const layoutRef = useRef(formatLayout(zones, format))

  visionRef.current = vision
  scaleRef.current = scale
  layoutRef.current = formatLayout(zones, format)

  // The owner's safe-zones.json, if any, replaces the shipped margins.
  useEffect(() => {
    let cancelled = false
    window.elynt.visualizer
      .safeZones()
      .then((loaded) => !cancelled && setZones(loaded))
      .catch((e: unknown) => console.error('Could not read the safe zones:', e))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let frame = 0
    let renderer: SceneRenderer | null = null
    setStatus('loading')
    setError(null)
    setPlaying(false)
    setTime(0)

    const start = async () => {
      const canvas = canvasRef.current!
      const context = new AudioContext({ latencyHint: 'interactive' })
      const [{ buffer, mono }, created] = await Promise.all([decodeTrackAudio(track.id, context), SceneRenderer.create(canvas)])
      if (cancelled) {
        created.destroy()
        return void context.close()
      }
      renderer = created
      const clock = new PlaybackClock(
        () => context.currentTime,
        () => context.outputLatency + context.baseLatency,
        buffer.duration
      )
      loadedRef.current = { context, buffer, mono, clock }
      setDuration(buffer.duration)
      setStatus('ready')

      let frames = 0
      let fpsSince = performance.now()
      const tick = () => {
        frame = requestAnimationFrame(tick)
        const loaded = loadedRef.current
        if (!loaded || !renderer || exportingRef.current) return
        const fit = Math.min(1, MAX_CANVAS_SIDE / (Math.max(canvas.clientWidth, canvas.clientHeight, 1) * devicePixelRatio))
        const width = canvas.clientWidth * devicePixelRatio * fit
        const height = canvas.clientHeight * devicePixelRatio * fit
        if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
          canvas.width = Math.round(width)
          canvas.height = Math.round(height)
        }
        renderer.setRenderSize(width * scaleRef.current, height * scaleRef.current)

        const t = loaded.clock.time()
        if (loaded.clock.playing && loaded.clock.ended) stop(true)
        renderer.draw(
          planVisionFrame(visionRef.current, featuresAt(loaded.mono, t), t, renderer.renderSize, signalsRef.current, layoutRef.current)
        )

        setTime((shown) => (Math.abs(shown - t) >= 0.05 ? t : shown))
        frames++
        const now = performance.now()
        if (now - fpsSince >= 500) {
          setFps(Math.round((frames * 1000) / (now - fpsSince)))
          frames = 0
          fpsSince = now
        }
      }
      tick()
    }

    start().catch((e: unknown) => {
      if (cancelled) return
      setStatus('error')
      setError(e instanceof Error ? e.message : String(e))
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      sourceRef.current?.stop()
      sourceRef.current = null
      void loadedRef.current?.context.close()
      loadedRef.current = null
      renderer?.destroy()
    }
  }, [track.id])

  // Signals come from the analysis and the stems, so they are derived again when either changes.
  // Until they are ready the layers draw without reacting, and export waits.
  useEffect(() => {
    const loaded = loadedRef.current
    if (status !== 'ready' || !loaded) return
    let cancelled = false
    signalsRef.current = NO_SIGNALS
    setSignals(undefined)
    loadTrackSignals(track.id, analysis, loaded.mono, loaded.context)
      .then((next) => {
        if (cancelled) return
        signalsRef.current = next
        setSignals(next)
      })
      .catch((e: unknown) => console.error('Could not derive the track signals:', e))
    return () => {
      cancelled = true
    }
  }, [track.id, analysis, status])

  const stop = (rewind: boolean) => {
    const loaded = loadedRef.current
    if (!loaded) return
    sourceRef.current?.stop()
    sourceRef.current = null
    loaded.clock.pause()
    if (rewind) loaded.clock.seek(0)
    setPlaying(false)
  }

  const play = async () => {
    const loaded = loadedRef.current
    if (!loaded) return
    await loaded.context.resume()
    if (loaded.clock.ended) loaded.clock.seek(0)
    const source = loaded.context.createBufferSource()
    source.buffer = loaded.buffer
    source.connect(loaded.context.destination)
    // The source and the clock start on the same audio-clock instant.
    source.start(0, loaded.clock.time())
    loaded.clock.play()
    sourceRef.current = source
    setPlaying(true)
  }

  const seek = (t: number) => {
    const loaded = loadedRef.current
    if (!loaded) return
    const wasPlaying = loaded.clock.playing
    if (wasPlaying) stop(false)
    loaded.clock.seek(t)
    setTime(t)
    if (wasPlaying) void play()
  }

  return (
    <section className="preview" aria-label="Live preview">
      <div className="preview-stage" style={stageStyle(format)}>
        <canvas ref={canvasRef} className="preview-canvas" />
        {guides && <SafeZoneGuides zones={zones} format={format} />}
        {status !== 'ready' && (
          <p className={status === 'error' ? 'preview-note error' : 'preview-note'}>
            {status === 'error' ? `The preview could not start: ${error}` : `Loading ${track.title}…`}
          </p>
        )}
        <span className="preview-fps">{fps} fps</span>
      </div>
      <div className="preview-controls">
        <button className="add" disabled={status !== 'ready'} onClick={() => (playing ? stop(false) : void play())}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          aria-label="Position"
          min={0}
          max={duration || 1}
          step={0.01}
          value={time}
          disabled={status !== 'ready'}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="preview-time">
          {formatTime(time)} / {formatTime(duration)}
          {vision.sections.length > 1 && ` · ${sectionName(vision, time)}`}
        </span>
        <span className="preview-formats" role="radiogroup" aria-label="Format">
          {FORMAT_IDS.map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={id === format}
              className={id === format ? 'preview-format picked' : 'preview-format'}
              onClick={() => onFormatChange(id)}
            >
              {FORMATS[id].label}
            </button>
          ))}
        </span>
        <label className="preview-guides">
          <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Safe zones
        </label>
        <select aria-label="Preview resolution" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
          {RENDER_SCALES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <ExportPanel
        track={track}
        vision={vision}
        signals={signals}
        audio={status === 'ready' && loadedRef.current ? { ...loadedRef.current.mono, duration } : undefined}
        onExportingChange={(exporting) => {
          exportingRef.current = exporting
          if (exporting) stop(false)
        }}
      />
    </section>
  )
}

/** The stage keeps the format's shape, as wide as the panel allows and never taller than most of the window. */
function stageStyle(format: FormatId): React.CSSProperties {
  const { width, height } = FORMATS[format]
  return { aspectRatio: `${width} / ${height}`, width: `min(100%, calc(70vh * ${(width / height).toFixed(4)}))`, marginInline: 'auto' }
}

function sectionName(vision: Vision, t: number): string {
  const i = sectionIndexAt(vision, t)
  const label = vision.sections[i]!.label
  return `${label[0]!.toUpperCase()}${label.slice(1)} (${i + 1}/${vision.sections.length})`
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
