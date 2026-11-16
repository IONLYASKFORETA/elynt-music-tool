import { useEffect, useMemo, useRef, useState } from 'react'
import { dropWindow, nextInDropTour } from '../../../shared/drop-preview'
import type { Track } from '../../../shared/track'
import type { VisionSet, WorkingVision } from '../../../shared/visions'
import { useTrackAnalysis } from './AnalysisStrip'
import { HeardCheck } from './HeardCheck'
import { Preview } from './Preview'
import { ScenePanel } from './ScenePanel'
import { VisionFlow } from './VisionFlow'
import { defaultVision, fitsSections, type Vision } from './vision'
import { buildVision } from './vision-build'

/** Scene edits are saved this long after the last change. */
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

  // One scene per section, saved on the track. Moving or relabelling sections starts the scenes over.
  const sections = analysis?.sections ?? []
  const duration = analysis?.durationSeconds ?? 0
  const grid = { beats: analysis?.beats ?? [], downbeats: analysis?.downbeats ?? [] }
  // Moments and transitions sit on the beat grid, so a nudged grid starts them over too.
  const sectionsKey = JSON.stringify([sections.map((s) => [s.label, s.start, s.end]), grid.beats.length, grid.downbeats[0], analysis?.bpm])
  const [vision, setVision] = useState(() => defaultVision(sections, duration, grid))
  const [section, setSection] = useState(0)
  const [from, setFrom] = useState<WorkingVision['from']>(null)
  const [set, setSet] = useState<VisionSet | null | undefined>(undefined)
  const [touring, setTouring] = useState<number | null>(null)
  const loaded = useRef(false)

  useEffect(() => {
    let cancelled = false
    loaded.current = false
    setTouring(null)
    Promise.all([window.elynt.visions.getWorking(track.id), window.elynt.visions.latest(track.id)])
      .then(([working, latest]) => {
        if (cancelled) return
        const fits = working && fitsSections(working.vision, sections, grid)
        setVision(fits ? (working.vision as Vision) : defaultVision(sections, duration, grid))
        setFrom(fits ? working.from : null)
        setSet(latest)
        loaded.current = true
      })
      .catch((e: unknown) => {
        console.error('Could not read the saved visions:', e)
        if (cancelled) return
        setVision(defaultVision(sections, duration, grid))
        setSet(null)
        loaded.current = true
      })
    return () => {
      cancelled = true
    }
  }, [track.id, sectionsKey])

  // Saves scene edits a moment after the last one, once the saved vision has been read.
  useEffect(() => {
    if (!loaded.current || !analysis) return
    const timer = setTimeout(() => {
      window.elynt.visions.saveWorking(track.id, vision, from).catch((e: unknown) => console.error('Could not save the vision:', e))
    }, SAVE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [vision, from])

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
      />
      <ScenePanel vision={credited} trackId={track.id} onChange={edit} section={section} onSection={setSection} />
    </>
  )
}
