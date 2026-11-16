import { useRef, useState } from 'react'
import { EXPORT_FORMATS, type ExportFormatId } from '../../../shared/export'
import type { Track } from '../../../shared/track'
import type { MonoAudio } from './audio-features'
import { exportVideo, type ExportProgress } from './export-video'
import type { TrackSignals } from './signals'
import type { Vision } from './vision'

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: ExportProgress | null }
  | { kind: 'done'; path: string; elapsed: number }
  | { kind: 'error'; message: string }

/** Export: renders the vision, scene by scene, to a YouTube MP4, frame by frame, with the mixdown as its audio. */
export function ExportPanel({
  track,
  vision,
  signals,
  audio,
  onExportingChange
}: {
  track: Track
  vision: Vision
  /** Undefined until the preview has derived them; export waits for them like it waits for the audio. */
  signals: TrackSignals | undefined
  audio: (MonoAudio & { duration: number }) | undefined
  onExportingChange(exporting: boolean): void
}) {
  const [format, setFormat] = useState<ExportFormatId>('youtube-4k60')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const start = async () => {
    const outputPath = await window.elynt.exports.chooseOutput(track.title, format)
    if (!outputPath) return
    const controller = new AbortController()
    abortRef.current = controller
    setState({ kind: 'running', progress: null })
    onExportingChange(true)
    try {
      const run = await exportVideo({
        track,
        vision,
        signals: signals!,
        format,
        encoder: 'nvenc',
        outputPath,
        audio,
        signal: controller.signal,
        onProgress: (progress) => setState({ kind: 'running', progress })
      })
      setState({ kind: 'done', path: run.outputPath, elapsed: run.elapsed })
    } catch (e) {
      setState(controller.signal.aborted ? { kind: 'idle' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      abortRef.current = null
      onExportingChange(false)
    }
  }

  const running = state.kind === 'running'

  return (
    <div className="export-panel">
      <select aria-label="Export format" value={format} disabled={running} onChange={(e) => setFormat(e.target.value as ExportFormatId)}>
        {Object.values(EXPORT_FORMATS).map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      {running ? (
        <button className="add" onClick={() => abortRef.current?.abort()}>
          Cancel export
        </button>
      ) : (
        <button className="add" disabled={!audio || !signals} onClick={() => void start()}>
          Export video
        </button>
      )}
      <ExportStatus state={state} />
    </div>
  )
}

function ExportStatus({ state }: { state: State }) {
  switch (state.kind) {
    case 'idle':
      return null
    case 'error':
      return <p className="export-status error">The export failed: {state.message}</p>
    case 'done':
      return (
        <p className="export-status">
          Exported in {formatClock(state.elapsed)}.{' '}
          <button className="link" onClick={() => void window.elynt.exports.reveal(state.path)}>
            Show in folder
          </button>
        </p>
      )
    case 'running': {
      const p = state.progress
      if (!p) return <p className="export-status">Starting the export…</p>
      const fps = p.elapsed > 0 ? p.framesWritten / p.elapsed : 0
      const left = fps > 0 ? (p.frames - p.framesWritten) / fps : 0
      return (
        <div className="export-status">
          <progress max={p.frames} value={p.framesWritten} />
          <span>
            {p.framesWritten} / {p.frames} frames · {fps.toFixed(1)} fps · about {formatClock(left)} left
          </span>
        </div>
      )
    }
  }
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
