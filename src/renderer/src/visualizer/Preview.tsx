import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../../shared/track'
import { featuresAt, toMono, type MonoAudio } from './audio-features'
import { PlaybackClock } from './playback-clock'
import { SceneRenderer } from './renderer'
import { defaultScene, planFrame, type Scene } from './scene'

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

/** The Visualizer's live preview: plays a track's mixdown and draws the scene in time with it. */
export function Preview({ track, scene = defaultScene }: { track: Track; scene?: Scene }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loadedRef = useRef<Loaded | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const sceneRef = useRef(scene)
  const scaleRef = useRef<number>(RENDER_SCALES[0].value)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [fps, setFps] = useState(0)
  const [scale, setScale] = useState<number>(RENDER_SCALES[0].value)

  sceneRef.current = scene
  scaleRef.current = scale

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
      const [bytes, created] = await Promise.all([window.elynt.tracks.readMixdown(track.id), SceneRenderer.create(canvas)])
      if (cancelled) return created.destroy()
      renderer = created
      const context = new AudioContext({ latencyHint: 'interactive' })
      const buffer = await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      if (cancelled) return void context.close()
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
      const clock = new PlaybackClock(
        () => context.currentTime,
        () => context.outputLatency + context.baseLatency,
        buffer.duration
      )
      loadedRef.current = { context, buffer, mono: toMono(channels, buffer.sampleRate), clock }
      setDuration(buffer.duration)
      setStatus('ready')

      let frames = 0
      let fpsSince = performance.now()
      const tick = () => {
        frame = requestAnimationFrame(tick)
        const loaded = loadedRef.current
        if (!loaded || !renderer) return
        const width = Math.min(canvas.clientWidth * devicePixelRatio, 3840)
        const height = Math.min(canvas.clientHeight * devicePixelRatio, 2160)
        if (canvas.width !== Math.round(width) || canvas.height !== Math.round(height)) {
          canvas.width = Math.round(width)
          canvas.height = Math.round(height)
        }
        renderer.setRenderSize(width * scaleRef.current, height * scaleRef.current)

        const t = loaded.clock.time()
        if (loaded.clock.playing && loaded.clock.ended) stop(true)
        renderer.draw(planFrame(sceneRef.current, featuresAt(loaded.mono, t), t, renderer.renderSize))

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
      <div className="preview-stage">
        <canvas ref={canvasRef} className="preview-canvas" />
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
        </span>
        <select aria-label="Preview resolution" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
          {RENDER_SCALES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
