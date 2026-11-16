import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SECTION_LABELS, type SectionLabel, type TrackAnalysis } from '../../../shared/analysis'
import { correctionProblem, moveBoundary, relabelSection, setTempo, shiftDownbeat } from '../../../shared/heard-check'
import type { Track } from '../../../shared/track'
import { PlaybackClock } from './playback-clock'
import { decodeTrackAudio } from './track-audio'
import { waveformPeaks } from './waveform'

const LABEL_NAMES: Record<SectionLabel, string> = {
  intro: 'Intro',
  build: 'Build',
  drop: 'Drop',
  breakdown: 'Breakdown',
  outro: 'Outro'
}

/** How many slices the waveform is drawn from. */
const PEAKS = 1200

interface Loaded {
  context: AudioContext
  buffer: AudioBuffer
  clock: PlaybackClock
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * The "What I heard" check (V3): what the analysis heard, over the track's waveform, for the
 * owner to fix before any vision is made. Corrections replace the analysis on the track.
 */
export function HeardCheck({
  track,
  analysis,
  onDone
}: {
  track: Track
  analysis: TrackAnalysis
  /** Called after the owner saves or skips. */
  onDone: (renamed: Track | null) => void
}) {
  const [draft, setDraft] = useState(analysis)
  const [title, setTitle] = useState(track.title)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const loadedRef = useRef<Loaded | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const laneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<number | null>(null)

  const duration = draft.durationSeconds
  const pct = (t: number) => `${(Math.min(Math.max(t / duration, 0), 1) * 100).toFixed(4)}%`

  // Decode the mixdown once, for the waveform and for playback.
  useEffect(() => {
    let cancelled = false
    let frame = 0
    const context = new AudioContext({ latencyHint: 'interactive' })
    decodeTrackAudio(track.id, context)
      .then(({ buffer, mono }) => {
        if (cancelled) return
        const clockNow = new PlaybackClock(
          () => context.currentTime,
          () => context.outputLatency + context.baseLatency,
          buffer.duration
        )
        loadedRef.current = { context, buffer, clock: clockNow }
        setPeaks(waveformPeaks(mono, PEAKS))
        setStatus('ready')
        const tick = () => {
          frame = requestAnimationFrame(tick)
          const loaded = loadedRef.current
          if (!loaded) return
          if (loaded.clock.playing && loaded.clock.ended) stop(true)
          const t = loaded.clock.time()
          setTime((shown) => (Math.abs(shown - t) >= 0.03 ? t : shown))
        }
        tick()
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      sourceRef.current?.stop()
      sourceRef.current = null
      loadedRef.current = null
      void context.close()
    }
  }, [track.id])

  // Draw the waveform whenever it or the canvas size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks) return
    const draw = () => {
      const width = Math.round(canvas.clientWidth * devicePixelRatio)
      const height = Math.round(canvas.clientHeight * devicePixelRatio)
      canvas.width = width
      canvas.height = height
      const g = canvas.getContext('2d')
      if (!g) return
      g.clearRect(0, 0, width, height)
      g.fillStyle = 'rgba(232, 232, 240, 0.55)'
      const mid = height / 2
      for (let x = 0; x < width; x++) {
        const peak = peaks[Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length))] ?? 0
        const h = Math.max(1, peak * mid)
        g.fillRect(x, mid - h, 1, h * 2)
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [peaks])

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

  const timeAt = (clientX: number) => {
    const lane = laneRef.current
    if (!lane) return 0
    const box = lane.getBoundingClientRect()
    return ((clientX - box.left) / box.width) * duration
  }

  const startDrag = (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = index
  }
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const index = dragRef.current
    if (index === null) return
    setDraft((d) => moveBoundary(d, index, timeAt(e.clientX)))
  }
  const endDrag = () => {
    dragRef.current = null
  }

  const nudgeBpm = (by: number) => setDraft((d) => setTempo(d, Math.round((d.bpm + by) * 100) / 100))
  const nudgeGrid = (seconds: number) => setDraft((d) => shiftDownbeat(d, seconds))
  const beat = 60 / draft.bpm

  const problem = correctionProblem(draft)
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const cleanTitle = title.trim()
      const renamed = cleanTitle && cleanTitle !== track.title ? await window.elynt.tracks.rename(track.id, cleanTitle) : null
      await window.elynt.analysis.saveCorrection(track.id, draft)
      onDone(renamed)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }
  const skip = async () => {
    setSaving(true)
    setError(null)
    try {
      await window.elynt.analysis.skipCheck(track.id)
      onDone(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="heard" aria-label="What I heard">
      <header className="heard-head">
        <div>
          <h2>What I heard</h2>
          <p>Fix anything I got wrong before the visuals are planned. Every tool reads what you save.</p>
        </div>
        <label className="heard-title">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Track title" />
        </label>
      </header>

      <div className="heard-facts">
        <div className="heard-control" role="group" aria-label="BPM">
          <span className="bpm">{draft.bpm.toFixed(draft.bpm % 1 === 0 ? 0 : 2)} BPM</span>
          <button onClick={() => nudgeBpm(-1)}>−1</button>
          <button onClick={() => nudgeBpm(-0.1)}>−0.1</button>
          <button onClick={() => nudgeBpm(0.1)}>+0.1</button>
          <button onClick={() => nudgeBpm(1)}>+1</button>
        </div>
        <div className="heard-control" role="group" aria-label="Downbeat">
          <span>Downbeat</span>
          <button onClick={() => nudgeGrid(-beat)} title="Make the beat before the one">
            ◀ beat
          </button>
          <button onClick={() => nudgeGrid(-0.01)} title="10 ms earlier">
            ◀ 10 ms
          </button>
          <button onClick={() => nudgeGrid(0.01)} title="10 ms later">
            10 ms ▶
          </button>
          <button onClick={() => nudgeGrid(beat)} title="Make the beat after the one">
            beat ▶
          </button>
        </div>
      </div>

      <div className="heard-timeline" ref={laneRef} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <ol className="heard-sections" aria-label="Sections">
          {draft.sections.map((s, i) => (
            <li
              key={i}
              className={`heard-section section-${s.label}${s.confidence < 0.5 ? ' unsure' : ''}`}
              style={{ left: pct(s.start), width: pct(s.end - s.start) }}
              title={`${LABEL_NAMES[s.label]} · ${clock(s.start)}–${clock(s.end)} · bar ${s.startBar + 1}`}
            >
              <select
                aria-label={`Section ${i + 1} label`}
                value={s.label}
                onChange={(e) => setDraft((d) => relabelSection(d, i, e.target.value as SectionLabel))}
              >
                {SECTION_LABELS.map((l) => (
                  <option key={l} value={l}>
                    {LABEL_NAMES[l]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ol>
        <div className="heard-wave" onClick={(e) => seek(timeAt(e.clientX))}>
          <canvas ref={canvasRef} />
          <div className="heard-grid" aria-hidden>
            {draft.downbeats.map((t) => (
              <span key={t} className="downbeat" style={{ left: pct(t) }} />
            ))}
          </div>
          <span className="heard-playhead" style={{ left: pct(time) }} aria-hidden />
        </div>
        {draft.sections.slice(1).map((s, i) => (
          <div
            key={i + 1}
            className="heard-boundary"
            style={{ left: pct(s.start) }}
            role="slider"
            aria-label={`Start of section ${i + 2}`}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={s.start}
            onPointerDown={startDrag(i + 1)}
          />
        ))}
      </div>

      <div className="preview-controls">
        <button className="add" disabled={status !== 'ready'} onClick={() => (playing ? stop(false) : void play())}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="preview-time">
          {clock(time)} / {clock(duration)}
        </span>
        {status === 'loading' && <span className="analysis-status">Loading {track.title}…</span>}
        <span className="heard-actions">
          <button className="link" disabled={saving} onClick={() => void skip()}>
            Skip this step
          </button>
          <button className="add" disabled={saving || problem !== null || !title.trim()} onClick={() => void save()}>
            Looks right · save
          </button>
        </span>
      </div>
      {(error || problem) && <p className="error">{error ?? problem}</p>}
    </section>
  )
}
