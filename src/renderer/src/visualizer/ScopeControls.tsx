import { useState } from 'react'
import { applyChange, applyChangeSet, controlValue, slidersAt, type Scope, type Target } from './controls'
import type { Vision } from './vision'
import { noteRequest } from './vision-note'

/** The sliders at one target (the video, a section or a layer). Each move is one change through `applyChange`. */
export function ScopeSliders({
  vision,
  target,
  onChange,
  skip = []
}: {
  vision: Vision
  target: Target
  onChange(vision: Vision): void
  /** Params drawn elsewhere, such as a layer's strength next to its "reacts to" picker. */
  skip?: string[]
}) {
  return (
    <>
      {slidersAt(vision, target)
        .filter((s) => !skip.includes(s.param))
        .map((s) => (
          <label key={s.param} className="scope-slider">
            {s.label}{' '}
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={controlValue(vision, target, s.param)}
              onChange={(e) => onChange(applyChange(vision, { op: 'set', ...target, param: s.param, value: Number(e.target.value) }))}
            />
          </label>
        ))}
    </>
  )
}

type NoteState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'failed'; message: string }
  | { kind: 'applied'; summary: string; skipped: number }

/**
 * The note box at one scope: the owner types what they want ("make the drop angrier"), Claude
 * answers with a change set for that scope, and it is checked and applied as one edit, which
 * the editor's history (V15) undoes in one step.
 */
export function NoteBox({
  vision,
  scope,
  trackId,
  onApply,
  placeholder
}: {
  vision: Vision
  scope: Scope
  trackId?: number
  /** Takes the vision with the whole change set applied. */
  onApply(vision: Vision): void
  placeholder: string
}) {
  const [note, setNote] = useState('')
  const [state, setState] = useState<NoteState>({ kind: 'idle' })

  const send = async () => {
    const text = note.trim()
    if (!text) return
    setState({ kind: 'sending' })
    const result = await window.elynt.visualizer.askNote(noteRequest(vision, scope, text, trackId)).catch(
      (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })
    )
    if (!result.ok) return setState({ kind: 'failed', message: result.message })
    // Applied to the vision as it was when the note was sent, in one go.
    const applied = applyChangeSet(vision, scope, result.reply.changes)
    if (applied.applied.length === 0) {
      return setState({ kind: 'failed', message: `Claude's changes didn't fit here: ${applied.rejected.map((r) => r.reason).join(' ')}` })
    }
    onApply(applied.vision)
    setNote('')
    setState({ kind: 'applied', summary: result.reply.summary, skipped: applied.rejected.length })
  }

  return (
    <div className="note-box">
      <textarea
        rows={1}
        value={note}
        placeholder={placeholder}
        disabled={state.kind === 'sending'}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void send()
          }
        }}
      />
      <button className="add" disabled={state.kind === 'sending' || !note.trim()} onClick={() => void send()}>
        {state.kind === 'sending' ? 'Asking Claude…' : 'Send note'}
      </button>
      {state.kind === 'failed' && <span className="note-error">{state.message}</span>}
      {state.kind === 'applied' && (
        <span className="note-summary">
          {state.summary}
          {state.skipped > 0 && ` (${state.skipped} change${state.skipped === 1 ? '' : 's'} left out)`}
        </span>
      )}
    </div>
  )
}
