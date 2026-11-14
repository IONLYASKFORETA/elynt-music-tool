import { useEffect, useState } from 'react'
import type { SectionLabel, TrackAnalysisState } from '../../../shared/analysis'

const LABEL_NAMES: Record<SectionLabel, string> = {
  intro: 'Intro',
  build: 'Build',
  drop: 'Drop',
  breakdown: 'Breakdown',
  outro: 'Outro'
}

/** The latest analysis of one track, kept up to date as the helper works. */
export function useTrackAnalysis(trackId: number): [TrackAnalysisState | null, () => void] {
  const [state, setState] = useState<TrackAnalysisState | null>(null)

  useEffect(() => {
    let live = true
    const off = window.elynt.analysis.onChange((next) => {
      if (next.trackId === trackId) setState(next)
    })
    window.elynt.analysis
      .get(trackId)
      .then((s) => live && setState((current) => current ?? s))
      .catch(() => {})
    return () => {
      live = false
      off()
    }
  }, [trackId])

  const rerun = () => {
    window.elynt.analysis.rerun(trackId).then(setState).catch(() => {})
  }
  return [state, rerun]
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** BPM, key and mood, and a strip of the track's sections in proportion to their length. */
export function AnalysisStrip({ trackId }: { trackId: number }) {
  const [state, rerun] = useTrackAnalysis(trackId)
  if (!state) return null

  const { analysis, status } = state
  const working = status === 'pending' || status === 'running'
  const statusText = status === 'running' ? 'Analysing…' : status === 'pending' ? 'Waiting for the helper to analyse…' : null

  return (
    <div className="analysis" aria-busy={working}>
      {analysis && (
        <>
          <div className="analysis-facts">
            <span className="bpm">{analysis.bpm.toFixed(analysis.bpm % 1 === 0 ? 0 : 1)} BPM</span>
            {analysis.mood.key && <span>{analysis.mood.key}</span>}
            <span>{analysis.mood.label}</span>
            {working && <span className="analysis-status">{statusText}</span>}
          </div>
          <ol className="sections" aria-label="Sections">
            {analysis.sections.map((s) => (
              <li
                key={s.start}
                className={`section section-${s.label}${s.confidence < 0.5 ? ' unsure' : ''}`}
                style={{ flexGrow: Math.max(s.end - s.start, 0.1) }}
                title={`${LABEL_NAMES[s.label]} · ${clock(s.start)}–${clock(s.end)} · bar ${s.startBar + 1}${s.confidence < 0.5 ? ' · not sure' : ''}`}
              >
                <span>{LABEL_NAMES[s.label]}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {!analysis && working && <span className="analysis-status">{statusText}</span>}
      {status === 'failed' && (
        <span className="analysis-status">
          <span className="error">Analysis failed: {state.error}</span>{' '}
          <button className="link" onClick={rerun}>
            Try again
          </button>
        </span>
      )}
      {status === 'done' && (
        <button className="link analysis-rerun" onClick={rerun}>
          Analyse again
        </button>
      )}
    </div>
  )
}
