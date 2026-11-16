import { useEffect, useState } from 'react'
import { BOUNCE_SETTINGS, BOUNCES_FOLDER, type MixProject, type MixProjectChange } from '../../shared/mix-project'
import type { Track } from '../../shared/track'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
}

function when(iso: string): string {
  return new Date(iso).toLocaleString()
}

function changeText(change: MixProjectChange): string {
  if (change.kind === 'live-set') return `Live Set saved ${when(change.savedAt)}`
  const parts = [
    change.added.length > 0 ? `${change.added.length} new bounce${change.added.length === 1 ? '' : 's'}` : '',
    change.updated.length > 0 ? `${change.updated.length} re-bounced` : ''
  ]
  return parts.filter(Boolean).join(', ')
}

/**
 * The project folder (M2): pick the track's Ableton project folder once; the app reads the newest
 * Live Set there and lists what it found in `Elynt Bounces`, re-looking when the watcher sees a change.
 */
export function MixProjectPanel({ track }: { track: Track }) {
  const [project, setProject] = useState<MixProject | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastChange, setLastChange] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const load = async (run: () => Promise<MixProject | null>, keepIfNull = false) => {
    setBusy(true)
    setError(null)
    try {
      const opened = await run()
      if (opened || !keepIfNull) setProject(opened)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
      setLoaded(true)
    }
  }

  useEffect(() => {
    void load(() => window.elynt.mixProject.open(track.id))
    return window.elynt.mixProject.onChange((event) => {
      if (event.trackId !== track.id) return
      setLastChange(event.changes.map(changeText).join(' · '))
      void load(() => window.elynt.mixProject.open(track.id))
    })
  }, [track.id])

  const pick = () => void load(() => window.elynt.mixProject.pickFolder(track.id), true)

  const help = (
    <div className="bounce-help">
      <button type="button" className="link" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>
        {helpOpen ? 'Hide bounce settings' : 'How to bounce for the assistant'}
      </button>
      {helpOpen && (
        <dl>
          {BOUNCE_SETTINGS.map((s) => (
            <div key={s.setting}>
              <dt>
                {s.setting}: <strong>{s.value}</strong>
              </dt>
              <dd>{s.why}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )

  return (
    <section className="live-set mix-project">
      <div className="live-set-head">
        <h2>Project folder</h2>
        <button type="button" className="secondary" disabled={busy} onClick={pick}>
          {busy ? 'Looking…' : project ? 'Pick another folder' : 'Pick project folder'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {loaded && !project && (
        <p className="hint">
          Pick {track.title}'s Ableton project folder once. The app always reads the newest .als in it, and the bounces
          you export to its {BOUNCES_FOLDER} subfolder.
        </p>
      )}
      {project && <ProjectView project={project} />}
      {project && lastChange && <p className="hint">Just noticed: {lastChange}.</p>}
      {help}
    </section>
  )
}

function ProjectView({ project }: { project: MixProject }) {
  if (!project.folderFound) {
    return <p className="error">Can't find {project.folder}. Was it moved, or is the drive not plugged in? Pick it again.</p>
  }
  const { liveSet } = project
  return (
    <>
      <p className="hint">{project.folder}</p>

      <h3>Live Set</h3>
      {!liveSet ? (
        <p className="hint">No .als at the top of this folder yet.</p>
      ) : (
        <p>
          {liveSet.path.split(/[\\/]/).pop()} · saved {when(liveSet.savedAt)}
          {liveSet.read && ` · ${liveSet.read.creator}`}
          {liveSet.readError && <span className="error"> · couldn't read it: {liveSet.readError}</span>}
        </p>
      )}

      {project.staleBounces && (
        <p className="warning" role="status">
          The Live Set was saved ({when(project.staleBounces.liveSetSavedAt)}) after{' '}
          {project.staleBounces.files.length === project.mixdowns.length + project.stems.length
            ? 'your bounces'
            : `${project.staleBounces.files.length} of your bounces`}
          , so advice may be about an old mix. Bounce again to be sure, or run anyway.
        </p>
      )}

      <h3>Bounces in {BOUNCES_FOLDER}</h3>
      {!project.bouncesFolderFound ? (
        <p className="hint">No {BOUNCES_FOLDER} folder yet. Make one in the project folder and bounce into it.</p>
      ) : project.mixdowns.length + project.stems.length === 0 ? (
        <p className="hint">Nothing bounced yet.</p>
      ) : (
        <>
          <p>
            <strong>Mixdown:</strong>{' '}
            {project.mixdowns.length === 0 ? <span className="hint">none found</span> : project.mixdowns.map((m) => m.file).join(', ')}
          </p>
          {project.stems.length > 0 && (
            <ul className="tree">
              {project.stems.map((s) => (
                <li key={s.file}>
                  {s.file} → {s.liveTrack ?? <span className="warning-text">no Live track with this name</span>}
                </li>
              ))}
            </ul>
          )}
          {project.unmatchedLiveTracks.length > 0 && (
            <p className="hint">No stem found for: {project.unmatchedLiveTracks.join(', ')}.</p>
          )}
        </>
      )}
    </>
  )
}
