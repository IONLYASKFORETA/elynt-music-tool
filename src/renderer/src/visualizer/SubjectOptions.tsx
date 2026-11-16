import { useCallback, useEffect, useState } from 'react'
import { mediaPath, mediaUrl, SUBJECT_MOTIF_IDEAS, type SubjectGround, type SubjectImage, type SubjectJob } from '../../../shared/subject-images'

/** How many options one press of Generate makes. */
const OPTIONS_PER_PRESS = 3

const cleanError = (e: unknown) => String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Generated options for a Subject layer (V9): describe a motif, have the helper's local image
 * model make a few, then pick one to show. Any option can be made again with a fresh seed or
 * dropped. Options belong to the track, so every section's Subject can pick from them.
 */
export function SubjectOptions({
  trackId,
  image,
  palette,
  onPick
}: {
  trackId: number
  /** The image the layer shows now. */
  image: string | null
  palette: readonly string[]
  onPick(url: string | null): void
}) {
  const [options, setOptions] = useState<SubjectImage[]>([])
  const [job, setJob] = useState<SubjectJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [motif, setMotif] = useState('')
  const [ground, setGround] = useState<SubjectGround>('black')

  const refresh = useCallback(async () => setOptions(await window.elynt.subjectImages.list(trackId)), [trackId])

  useEffect(() => {
    refresh().catch((e: unknown) => setError(cleanError(e)))
    window.elynt.subjectImages
      .jobs()
      .then((jobs) => setJob(jobs.find((j) => j.trackId === trackId) ?? null))
      .catch(() => {})
    return window.elynt.subjectImages.onJob((next) => {
      if (next.trackId !== trackId) return
      if (next.state === 'done') setJob(null)
      else setJob(next)
      // Each finished image shows as soon as it lands, not only at the end of the batch.
      void refresh()
    })
  }, [trackId, refresh])

  const shown = image ? mediaPath(image) : null
  const running = job?.state === 'running'

  const generate = async () => {
    setError(null)
    try {
      const made = await window.elynt.subjectImages.generate(trackId, { motif, ground, palette: [...palette] }, OPTIONS_PER_PRESS)
      // A layer with nothing yet takes the first new option.
      if (!image && made[0]) onPick(mediaUrl(made[0].path))
    } catch (e) {
      setError(cleanError(e))
    }
  }

  const again = async (option: SubjectImage) => {
    setError(null)
    try {
      const fresh = await window.elynt.subjectImages.regenerate(option.id)
      // Making the shown image again swaps the layer to the new one.
      if (shown === option.path) onPick(mediaUrl(fresh.path))
    } catch (e) {
      setError(cleanError(e))
    }
  }

  const remove = async (option: SubjectImage) => {
    await window.elynt.subjectImages.remove(option.id)
    if (shown === option.path) onPick(null)
    await refresh()
  }

  return (
    <div className="subject-options">
      <div className="subject-generate">
        <input
          className="subject-motif"
          list="subject-motif-ideas"
          placeholder="What to draw: a chrome mecha, a sigil…"
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
        />
        <datalist id="subject-motif-ideas">
          {SUBJECT_MOTIF_IDEAS.map((idea) => (
            <option key={idea} value={idea} />
          ))}
        </datalist>
        <select value={ground} aria-label="Ground" onChange={(e) => setGround(e.target.value as SubjectGround)}>
          <option value="black">on black</option>
          <option value="off-white">on off-white</option>
        </select>
        <button className="add" disabled={running || !motif.trim()} onClick={generate}>
          Generate {OPTIONS_PER_PRESS}
        </button>
      </div>

      {running && (
        <div className="split-progress" role="status">
          <span>
            Image {job.image} of {job.of}: {job.stage}…
          </span>
          <progress max={1} value={job.fraction} aria-label="Image generation progress" />
        </div>
      )}
      {/* A failure from this window's own press shows once, as its error; one from before shows from the job. */}
      {error ? <p className="error">{error}</p> : job?.state === 'failed' && <p className="error">Generating failed: {job.message}</p>}

      {options.length > 0 && (
        <ul className="subject-list">
          {options.map((option) => (
            <li key={option.id} className={shown === option.path ? 'picked' : undefined}>
              <button
                className="subject-thumb"
                title={`${option.motif} (seed ${option.seed}, made in ${option.seconds.toFixed(1)} s)`}
                aria-pressed={shown === option.path}
                onClick={() => onPick(mediaUrl(option.path))}
              >
                <img src={mediaUrl(option.path)} alt={option.motif} loading="lazy" />
              </button>
              <span className="subject-meta">{option.seconds.toFixed(1)} s</span>
              <button className="link" disabled={running} onClick={() => again(option)} title="Make it again with a new seed">
                Again
              </button>
              <button className="link remove" aria-label={`Remove this ${option.motif}`} onClick={() => remove(option)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
