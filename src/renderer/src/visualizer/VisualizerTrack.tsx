import { useState } from 'react'
import type { Track } from '../../../shared/track'
import { useTrackAnalysis } from './AnalysisStrip'
import { HeardCheck } from './HeardCheck'
import { Preview } from './Preview'

/**
 * The Visualizer for one picked track. Once it's analysed, the "What I heard" check comes
 * first; after the owner saves or skips it, the preview. The check can be reopened any time.
 */
export function VisualizerTrack({ track, onRenamed }: { track: Track; onRenamed: () => void }) {
  const [state] = useTrackAnalysis(track.id)
  const [reopened, setReopened] = useState(false)

  const analysis = state?.analysis ?? null
  // A fresh result the owner hasn't seen yet opens the check by itself.
  const checking = analysis && (reopened || (state?.status === 'done' && state.check === 'unchecked'))

  if (checking) {
    return (
      <HeardCheck
        key={state?.analyzedAt ?? ''}
        track={track}
        analysis={analysis}
        onDone={(renamed) => {
          setReopened(false)
          if (renamed) onRenamed()
        }}
      />
    )
  }
  return (
    <>
      {analysis && (
        <button className="link heard-reopen" onClick={() => setReopened(true)}>
          Check what I heard
        </button>
      )}
      <Preview track={track} />
    </>
  )
}
