import { useMemo, useState } from 'react'
import type { TrackAnalysis } from '../../../shared/analysis'
import { tapQuestions, type TapAnswers } from '../../../shared/tap-questions'
import type { VisionSet } from '../../../shared/visions'

/** An IPC rejection's message without Electron's "Error invoking remote method" prefix. */
export function ipcMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

/**
 * The vision flow (V10), steps 2, 5 and 6: an optional brief, up to three tap questions where the
 * analysis is unsure, then Claude's three visions side by side, each with a drop preview played
 * one after another in the preview above.
 */
export function VisionFlow({
  trackId,
  analysis,
  set,
  onSet,
  touring,
  onTour,
  onUse,
  usingIndex
}: {
  trackId: number
  analysis: TrackAnalysis
  set: VisionSet | null
  onSet(set: VisionSet): void
  /** Which vision's drop is playing in the preview, or null. */
  touring: number | null
  /** Plays the drops from this vision on (each one after the other), or stops with null. */
  onTour(index: number | null): void
  onUse(index: number): void
  /** Which of the set's visions the editor below is working on, if any. */
  usingIndex: number | null
}) {
  const questions = useMemo(() => tapQuestions(analysis), [analysis])
  const [asking, setAsking] = useState(set === null)
  const [brief, setBrief] = useState(set?.brief ?? '')
  const [answers, setAnswers] = useState<TapAnswers>(set?.answers ?? {})
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cost, setCost] = useState<{ run: number; track: number } | null>(null)

  const write = async () => {
    setWriting(true)
    setError(null)
    onTour(null)
    try {
      const result = await window.elynt.visions.generate({ trackId, brief, answers })
      setCost({ run: result.set.costUsd, track: result.trackCostUsd })
      onSet(result.set)
      setAsking(false)
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setWriting(false)
    }
  }

  if (asking || !set) {
    return (
      <section className="vision-flow" aria-label="Visions">
        <h2>Three visions</h2>
        <label className="vision-brief">
          <span>Your brief (optional)</span>
          <textarea
            rows={2}
            placeholder="The idea in a sentence or two, or leave it blank."
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        </label>
        {questions.map((q) => (
          <fieldset key={q.id} className="vision-question">
            <legend>{q.prompt}</legend>
            {q.options.map((o) => (
              <button
                key={o.id}
                className={answers[q.id] === o.id ? 'ghost picked' : 'ghost'}
                aria-pressed={answers[q.id] === o.id}
                onClick={() =>
                  setAnswers((a) => {
                    // Tapping the picked answer again takes it back, which skips the question.
                    const { [q.id]: current, ...rest } = a
                    return current === o.id ? rest : { ...rest, [q.id]: o.id }
                  })
                }
              >
                {o.label}
              </button>
            ))}
          </fieldset>
        ))}
        <div className="vision-actions">
          <button className="add" disabled={writing} onClick={() => void write()}>
            {writing ? 'Claude is writing three visions…' : brief.trim() ? 'Write three visions' : 'Skip the brief and write three visions'}
          </button>
          {set && !writing && (
            <button className="link" onClick={() => setAsking(false)}>
              Back to the last three
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </section>
    )
  }

  return (
    <section className="vision-flow" aria-label="Visions">
      <header className="vision-head">
        <h2>Three visions</h2>
        <button className="add" onClick={() => onTour(touring === null ? 0 : null)}>
          {touring === null ? 'Play the three drops' : 'Stop'}
        </button>
        <button className="link" onClick={() => setAsking(true)}>
          Write new visions
        </button>
        {cost && (
          <span className="vision-cost">
            ${cost.run.toFixed(2)} this time · ${cost.track.toFixed(2)} on this track
          </span>
        )}
      </header>
      <ol className="vision-cards">
        {set.visions.map((v, i) => (
          <li key={i} className={touring === i ? 'vision-card playing' : 'vision-card'}>
            <h3>{v.name || `Vision ${i + 1}`}</h3>
            <p className="vision-concept">{v.concept}</p>
            <div className="vision-palette" aria-label="Palette">
              {v.palette.map((c, j) => (
                <span key={j} className="vision-swatch" style={{ background: c }} title={c} />
              ))}
            </div>
            <p className="vision-detail">
              <strong>Motifs</strong> {v.motifs.join(', ')}
            </p>
            <p className="vision-detail">
              <strong>Drop</strong> {v.drop.lands}
            </p>
            <p className="vision-detail">
              <strong>Type</strong> {v.type.treatment}
            </p>
            <div className="vision-actions">
              <button className="ghost" onClick={() => onTour(touring === i ? null : i)}>
                {touring === i ? 'Playing its drop…' : 'Play its drop'}
              </button>
              <button className="ghost" disabled={usingIndex === i} onClick={() => onUse(i)}>
                {usingIndex === i ? 'In the editor' : 'Edit this one'}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
