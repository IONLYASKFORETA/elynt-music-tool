import { useCallback, useEffect, useState } from 'react'
import type { SplitJob, Stem } from '../../shared/stems'

const cleanError = (e: unknown) => String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * A track's stems: attach your own, or have the helper split the mixdown.
 * Each stem says whether it is yours or AI-split. Your own replace a split set.
 */
export function TrackStems({ trackId }: { trackId: number }) {
  const [stems, setStems] = useState<Stem[]>([])
  const [job, setJob] = useState<SplitJob | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => setStems(await window.elynt.stems.list(trackId)), [trackId])

  useEffect(() => {
    refresh().catch((e: unknown) => setError(cleanError(e)))
    window.elynt.stems
      .jobs()
      .then((jobs) => setJob(jobs.find((j) => j.trackId === trackId) ?? null))
      .catch(() => {})
    return window.elynt.stems.onJob((next) => {
      if (next.trackId !== trackId) return
      if (next.state === 'done') {
        setJob(null)
        void refresh()
      } else {
        setJob(next)
      }
    })
  }, [trackId, refresh])

  const attach = async () => {
    setError(null)
    try {
      const attached = await window.elynt.stems.attachPicked(trackId)
      if (attached) setStems(attached)
    } catch (e) {
      setError(cleanError(e))
    }
  }

  const split = async () => {
    setError(null)
    try {
      setStems(await window.elynt.stems.split(trackId))
    } catch {
      // The failed job carries the message, and stays visible until the next try.
    }
  }

  const remove = async (stemId: number) => {
    await window.elynt.stems.removeOwn(stemId)
    await refresh()
  }

  const splitting = job?.state === 'running'
  const source = stems[0]?.source

  return (
    <div className="stems">
      <div className="stems-head">
        <span className="stems-label">
          Stems
          {source === 'own' && <span className="stem-badge own">yours</span>}
          {source === 'split' && <span className="stem-badge split">AI-split · {stems[0]?.model?.replace(/\.ckpt$/, '')}</span>}
        </span>
        <button className="link" onClick={attach} disabled={splitting}>
          {source === 'own' ? 'Add more of my stems' : source === 'split' ? 'Use my own stems instead' : 'Attach my stems'}
        </button>
        {stems.length === 0 && !splitting && (
          <button className="link" onClick={split}>
            Split the mixdown
          </button>
        )}
      </div>

      {splitting && (
        <div className="split-progress" role="status">
          <span>{job.stage}…</span>
          <progress max={1} value={job.fraction} aria-label="Stem split progress" />
        </div>
      )}
      {job?.state === 'failed' && <p className="error">Split failed: {job.message}</p>}
      {error && <p className="error">{error}</p>}

      {stems.length > 0 && (
        <ul className="stem-list">
          {stems.map((s) => (
            <li key={s.id} title={s.path}>
              {s.name}
              {s.source === 'own' && (
                <button className="link remove" aria-label={`Remove ${s.name}`} onClick={() => remove(s.id)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {stems.length === 0 && !splitting && job?.state !== 'failed' && (
        <p className="stems-hint">No stems yet. Your own bounces work best; otherwise the helper can split the mixdown on the GPU.</p>
      )}
    </div>
  )
}
