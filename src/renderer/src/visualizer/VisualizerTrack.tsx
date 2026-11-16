import { useEffect, useMemo, useState } from 'react'
import { dropWindow, nextInDropTour } from '../../../shared/drop-preview'
import type { FormatId } from '../../../shared/formats'
import type { Track } from '../../../shared/track'
import type { VisionSet, WorkingVision } from '../../../shared/visions'
import { useTrackAnalysis } from './AnalysisStrip'
import { HeardCheck } from './HeardCheck'
import { MediaShelfPanel, useOwnMedia } from './MediaShelf'
import { Preview } from './Preview'
import { ScenePanel } from './ScenePanel'
import { trackVisionKey } from '../../../shared/vision-history'
import { HistoryPanel } from './HistoryPanel'
import { useVisionHistory } from './use-vision-history'
import { VisionFlow } from './VisionFlow'
import { defaultVision, fitsSections, visionFitsTrack, type Vision } from './vision'
import { buildVision } from './vision-build'

/** The vision showing is saved on the track this long after it last changes. */
const SAVE_AFTER_MS = 600

/**
 * The Visualizer for one picked track. Once it's analysed, the "What I heard" check comes
 * first; after the owner saves or skips it, the vision flow (brief, tap questions, three visions
 * from Claude with their drop previews), the preview, and the scenes of the vision being edited.
 * The check can be reopened any time.
 */
export function VisualizerTrack({ track, onRenamed }: { track: Track; onRenamed: () => void }) {
  const [state] = useTrackAnalysis(track.id)
  const [reopened, setReopened] = useState(false)

  const analysis = state?.analysis ?? null
  // A fresh result the owner hasn't seen yet opens the check by itself.
  const checking = analysis && (reopened || (state?.status === 'done' && state.check === 'unchecked'))

  // One scene per section. The vision showing lives in its history (V15), which survives a restart
  // and gives every edit undo; whatever it shows (an edit, an undo, a vision put to use) is also
  // saved on the track as its working vision (V10). A track with no history yet starts from its
  // saved working vision when that still fits. Moving or relabelling sections, or a nudged grid,
  // starts the scenes over, as an edit.
  const sections = analysis?.sections ?? []
  const duration = analysis?.durationSeconds ?? 0
  const grid = { beats: analysis?.beats ?? [], downbeats: analysis?.downbeats ?? [] }
  const trackShape = JSON.stringify([sections.map((s) => [s.label, s.start, s.end]), grid.beats, grid.downbeats, duration])

  // The saved working vision and the latest set of three visions; undefined until read.
  const [saved, setSaved] = useState<{ working: WorkingVision | null; set: VisionSet | null } | undefined>(undefined)
  const [from, setFrom] = useState<WorkingVision['from']>(null)
  const [set, setSet] = useState<VisionSet | null | undefined>(undefined)
  const [touring, setTouring] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    setSaved(undefined)
    setSet(undefined)
    setTouring(null)
    Promise.all([window.elynt.visions.getWorking(track.id), window.elynt.visions.latest(track.id)])
      .then(([working, latest]) => {
        if (cancelled) return
        setSaved({ working, set: latest })
        setSet(latest)
      })
      .catch((e: unknown) => {
        console.error('Could not read the saved visions:', e)
        if (cancelled) return
        setSaved({ working: null, set: null })
        setSet(null)
      })
    return () => {
      cancelled = true
    }
  }, [track.id])
  const savedWorking = saved?.working && fitsSections(saved.working.vision, sections, grid) ? saved.working : null

  const visionKey = trackVisionKey(track.id)
  const history = useVisionHistory({
    key: visionKey,
    ready: analysis !== null && saved !== undefined,
    trackShape,
    fresh: () => (savedWorking ? (savedWorking.vision as Vision) : defaultVision(sections, duration, grid)),
    fits: (v) => visionFitsTrack(v, sections, grid, duration)
  })
  const { vision, setVision } = history
  const [section, setSection] = useState(0)
  useEffect(() => {
    if (history.loaded) setFrom(savedWorking ? savedWorking.from : null)
  }, [history.loaded])

  // The format the preview shows and the scene panel tweaks (V16). Edits to the vision apply to every format.
  const [format, setFormat] = useState<FormatId>('wide')

  // Saves the vision showing on the track a moment after it last changes, once its history is loaded.
  useEffect(() => {
    if (!history.loaded || !analysis) return
    const timer = setTimeout(() => {
      window.elynt.visions.saveWorking(track.id, vision, from).catch((e: unknown) => console.error('Could not save the vision:', e))
    }, SAVE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [vision, from, history.loaded])

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
  const credits = useMemo(() => ({ title: track.title, artist: artistName }), [track.title, artistName])
  const credited = useMemo(() => ({ ...vision, credits }), [vision, credits])

  // The three visions, built into scenes for their drop previews.
  const options = useMemo(
    () => (set && analysis ? set.visions.map((plan) => ({ ...buildVision(plan, analysis.sections, analysis.durationSeconds, analysis), credits })) : []),
    [set, analysis, credits]
  )
  const drop = useMemo(() => (analysis ? dropWindow(analysis) : null), [analysis])
  const touringVision = touring !== null ? options[touring] : undefined

  // Credits come from the track and the profile each time, so they aren't saved with the scenes.
  const edit = ({ credits: _credits, ...edited }: Vision) => setVision(edited)
  // A note's change set (V14) is one step of undo of its own, apart from slider moves around it.
  const applyNote = ({ credits: _credits, ...edited }: Vision) => history.commit(edited)

  const use = (index: number) => {
    if (!set || !analysis) return
    setTouring(null)
    setVision(buildVision(set.visions[index]!, analysis.sections, analysis.durationSeconds, analysis))
    setFrom({ setId: set.id, index })
  }

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
      {analysis && set !== undefined && (
        <VisionFlow
          trackId={track.id}
          analysis={analysis}
          set={set}
          onSet={(next) => {
            setSet(next)
            setTouring(0)
          }}
          touring={touring}
          onTour={setTouring}
          onUse={use}
          usingIndex={from && set && from.setId === set.id ? from.index : null}
        />
      )}
      <Preview
        track={track}
        analysis={analysis}
        vision={touringVision ?? credited}
        loop={touringVision && drop ? { ...drop, key: String(touring) } : null}
        onLoopEnd={() => setTouring((i) => (i === null ? null : nextInDropTour(i, options.length)))}
        onVisionChange={edit}
        section={section}
        onSection={setSection}
        format={format}
        onFormatChange={setFormat}
      />
      <ScenePanel vision={credited} trackId={track.id} format={format} media={media} onChange={edit} onApplyNote={applyNote} section={section} onSection={setSection} />
      <MediaShelfPanel media={media} actions={mediaActions} />
      <HistoryPanel visionKey={visionKey} history={history} section={section} />
    </>
  )
}
