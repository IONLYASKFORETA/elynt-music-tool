import { useEffect, useMemo, useState } from 'react'
import type { FormatId } from '../../../shared/formats'
import type { Track } from '../../../shared/track'
import { useTrackAnalysis } from './AnalysisStrip'
import { HeardCheck } from './HeardCheck'
import { MediaShelfPanel, useOwnMedia } from './MediaShelf'
import { Preview } from './Preview'
import { ScenePanel } from './ScenePanel'
import { trackVisionKey } from '../../../shared/vision-history'
import { HistoryPanel } from './HistoryPanel'
import { useVisionHistory } from './use-vision-history'
import { defaultVision, visionFitsTrack } from './vision'

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

  // One scene per section. Every edit goes into the vision's history (V15), which survives a
  // restart; moving or relabelling sections, or a nudged grid, starts the scenes over, as an edit.
  const sections = analysis?.sections ?? []
  const duration = analysis?.durationSeconds ?? 0
  const grid = { beats: analysis?.beats ?? [], downbeats: analysis?.downbeats ?? [] }
  const trackShape = JSON.stringify([sections.map((s) => [s.label, s.start, s.end]), grid.beats, grid.downbeats, duration])
  const visionKey = trackVisionKey(track.id)
  const history = useVisionHistory({
    key: visionKey,
    ready: analysis !== null,
    trackShape,
    fresh: () => defaultVision(sections, duration, grid),
    fits: (v) => visionFitsTrack(v, sections, grid, duration)
  })
  const { vision, setVision } = history
  const [section, setSection] = useState(0)
  // The format the preview shows and the scene panel tweaks (V16). Edits to the vision apply to every format.
  const [format, setFormat] = useState<FormatId>('wide')

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
  // Own media (V18): the shelf is shared by every track; cover art belongs to this one.
  const [media, mediaActions] = useOwnMedia(track.id)

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
        format={format}
        onFormatChange={setFormat}
      />
      <ScenePanel vision={credited} trackId={track.id} format={format} media={media} onChange={setVision} section={section} onSection={setSection} />
      <MediaShelfPanel media={media} actions={mediaActions} />
      <HistoryPanel visionKey={visionKey} history={history} section={section} />
    </>
  )
}
