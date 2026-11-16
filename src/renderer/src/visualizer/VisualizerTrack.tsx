import { useEffect, useMemo, useState } from 'react'
import type { Track } from '../../../shared/track'
import { useTrackAnalysis } from './AnalysisStrip'
import { HeardCheck } from './HeardCheck'
import { Preview } from './Preview'
import { ScenePanel } from './ScenePanel'
import { defaultVision } from './vision'

/**
 * The Visualizer for one picked track. Once it's analysed, the "What I heard" check comes
 * first; after the owner saves or skips it, the preview and its scenes, one per section.
 * The check can be reopened any time.
 */
export function VisualizerTrack({ track, onRenamed }: { track: Track; onRenamed: () => void }) {
  const [state] = useTrackAnalysis(track.id)
  const [reopened, setReopened] = useState(false)

  const analysis = state?.analysis ?? null
  // A fresh result the owner hasn't seen yet opens the check by itself.
  const checking = analysis && (reopened || (state?.status === 'done' && state.check === 'unchecked'))

  // One scene per section. Edits live for this visit; moving or relabelling sections starts the scenes over.
  // (Saving visions comes with the vision flow, V10.)
  const sections = analysis?.sections ?? []
  const duration = analysis?.durationSeconds ?? 0
  const grid = { beats: analysis?.beats ?? [], downbeats: analysis?.downbeats ?? [] }
  // Moments and transitions sit on the beat grid, so a nudged grid starts them over too.
  const sectionsKey = JSON.stringify([sections.map((s) => [s.label, s.start, s.end]), grid.beats.length, grid.downbeats[0], analysis?.bpm])
  const [vision, setVision] = useState(() => defaultVision(sections, duration, grid))
  const [section, setSection] = useState(0)
  useEffect(() => {
    setVision(defaultVision(sections, duration, grid))
  }, [track.id, sectionsKey])

  // Poster layers set the track's title and the artist's name from the artist profile.
  const [artistName, setArtistName] = useState('')
  useEffect(() => {
    let cancelled = false
    window.elynt.profile
      .get()
      .then((profile) => !cancelled && setArtistName(profile.artistName ?? ''))
      .catch((e: unknown) => console.error('Could not read the artist profile:', e))
    return () => {
      cancelled = true
    }
  }, [])
  const credited = useMemo(() => ({ ...vision, credits: { title: track.title, artist: artistName } }), [vision, track.title, artistName])

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
      <Preview
        track={track}
        analysis={analysis}
        vision={credited}
        onVisionChange={setVision}
        section={section}
        onSection={setSection}
      />
      <ScenePanel vision={credited} onChange={setVision} section={section} onSection={setSection} />
    </>
  )
}
