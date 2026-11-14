import { useEffect, useState, type DragEvent } from 'react'
import {
  addReferencePaths,
  defaultMixSetup,
  dynamicsFor,
  LOUDNESS_TARGET_IDS,
  LOUDNESS_TARGETS,
  MAX_REFERENCE_TRACKS,
  mixTargets,
  ROUGH_TONE_LABEL,
  type MixSetup,
  type Range
} from '../../shared/mix-setup'
import { SUBGENRES } from '../../shared/subgenres'
import type { Track } from '../../shared/track'

/**
 * First-time setup for a track in the Mix & Master Assistant (M3):
 * subgenre, loudness target and 1 to 3 reference tracks. Shown again to edit later.
 */
export function MixSetupScreen({ track }: { track: Track }) {
  const [setup, setSetup] = useState<MixSetup | null>(null)
  const [firstTime, setFirstTime] = useState(false)
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([window.elynt.mixSetup.get(track.id), window.elynt.profile.get()])
      .then(([saved, profile]) => {
        if (!live) return
        setFirstTime(saved === null)
        setSetup(saved ?? defaultMixSetup(track.id, profile.subgenres.main))
      })
      .catch((e: unknown) => live && setStatus({ kind: 'error', text: errorText(e) }))
    return () => {
      live = false
    }
  }, [track.id])

  if (!setup) return status ? <p className="error">{status.text}</p> : null

  const change = (next: MixSetup) => {
    setSetup(next)
    setStatus(null)
  }

  const addPaths = (paths: string[]) => {
    const next = addReferencePaths(setup.referenceTracks, paths)
    const skipped = paths.length - (next.length - setup.referenceTracks.length)
    change({ ...setup, referenceTracks: next })
    if (skipped > 0) {
      setStatus({
        kind: 'error',
        text: `Skipped ${skipped} file${skipped === 1 ? '' : 's'}: only audio files, no repeats, and at most ${MAX_REFERENCE_TRACKS}.`
      })
    }
  }

  const pick = async () => {
    try {
      addPaths(await window.elynt.mixSetup.pickReferenceTracks())
    } catch (e) {
      setStatus({ kind: 'error', text: errorText(e) })
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addPaths([...e.dataTransfer.files].map((f) => window.elynt.mixSetup.pathForDroppedFile(f)).filter(Boolean))
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await window.elynt.mixSetup.save(setup)
      setSetup(saved)
      setFirstTime(false)
      setStatus({ kind: 'saved', text: 'Saved. Analyze will aim for these targets.' })
    } catch (e) {
      setStatus({ kind: 'error', text: errorText(e) })
    } finally {
      setSaving(false)
    }
  }

  const targets = mixTargets(setup)
  const full = setup.referenceTracks.length >= MAX_REFERENCE_TRACKS

  return (
    <form
      className="profile mix-setup"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <h2>{firstTime ? `Set up ${track.title}` : `${track.title} · setup`}</h2>
      {firstTime && (
        <p className="hint">Once per track. The subgenre sets loudness and dynamics, and reference tracks set tone.</p>
      )}

      <section>
        <span className="label">Subgenre</span>
        <div className="chips" role="radiogroup" aria-label="Subgenre">
          {SUBGENRES.map((s) => {
            const on = setup.subgenre === s.id
            return (
              <button
                type="button"
                key={s.id}
                role="radio"
                aria-checked={on}
                className={on ? 'chip main' : 'chip'}
                onClick={() => change({ ...setup, subgenre: on ? null : s.id })}
              >
                {s.name}
              </button>
            )
          })}
        </div>
        <p className="hint">
          {setup.subgenre
            ? `${dynamicsFor(setup.subgenre).name} dynamics: keep at least ${targets.minPlrDb} dB between peaks and loudness.`
            : 'No subgenre yet, so general electronic dynamics are used.'}
        </p>
      </section>

      <section>
        <span className="label">Loudness target</span>
        <div className="targets" role="radiogroup" aria-label="Loudness target">
          {LOUDNESS_TARGET_IDS.map((id) => {
            const t = LOUDNESS_TARGETS[id]
            const on = setup.loudnessTarget === id
            const lufs = id === 'club' ? dynamicsFor(setup.subgenre).clubLufs : t.integratedLufs
            return (
              <button
                type="button"
                key={id}
                role="radio"
                aria-checked={on}
                className={on ? 'target on' : 'target'}
                onClick={() => change({ ...setup, loudnessTarget: id })}
              >
                <span className="target-name">{t.name}</span>
                <span className="target-numbers">
                  {lufsText(lufs)} · ceiling {t.truePeakCeilingDbtp} dBTP
                </span>
                <span className="target-blurb">{t.blurb}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <span className="label">
          Reference tracks ({setup.referenceTracks.length} of {MAX_REFERENCE_TRACKS})
        </span>
        {setup.referenceTracks.length > 0 && (
          <ul className="refs">
            {setup.referenceTracks.map((r) => (
              <li key={r.path}>
                <div>
                  <div className="title">{r.title}</div>
                  <div className="path">{r.path}</div>
                </div>
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove ${r.title}`}
                  onClick={() =>
                    change({ ...setup, referenceTracks: setup.referenceTracks.filter((x) => x.path !== r.path) })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {!full && (
          <div
            className={dragging ? 'dropzone over' : 'dropzone'}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <span>Drag released songs here</span>
            <button type="button" className="secondary" onClick={() => void pick()}>
              Pick files
            </button>
          </div>
        )}
        {targets.tone.rough && <p className="hint rough">{ROUGH_TONE_LABEL}</p>}
      </section>

      <div className="profile-foot">
        <button className="add" type="submit" disabled={saving}>
          {saving ? 'Saving…' : firstTime ? 'Save setup' : 'Save changes'}
        </button>
        {status && <span className={status.kind === 'saved' ? 'saved' : 'error'}>{status.text}</span>}
      </div>
    </form>
  )
}

function lufsText({ min, max }: Range): string {
  return `${min} to ${max} LUFS`
}

function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
