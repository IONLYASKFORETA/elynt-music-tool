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
  | { kind: 'applied'; summary: string; skipped: string[]; before: Vision; after: Vision }

/**
 * The note box at one scope: the owner types what they want ("make the drop angrier"), Claude
 * answers with a change set for that scope, and it is checked and applied as one edit. Until
 * anything else changes, the note can be taken back in one step.
 */
export function NoteBox({
  vision,
  scope,
  trackId,
  onChange,
  placeholder
}: {
  vision: Vision
  scope: Scope
  trackId?: number
  onChange(vision: Vision): void
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
    // Applied to the vision as it was when the note was sent; one onChange, so one undo step.
    const applied = applyChangeSet(vision, scope, result.reply.changes)
    if (applied.applied.length === 0) {
      return setState({ kind: 'failed', message: `Claude's changes didn't fit here: ${applied.rejected.map((r) => r.reason).join(' ')}` })
    }
    onChange(applied.vision)
    setNote('')
    setState({ kind: 'applied', summary: result.reply.summary, skipped: applied.rejected.map((r) => r.reason), before: vision, after: applied.vision })
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
          {state.skipped.length > 0 && ` (${state.skipped.length} change${state.skipped.length === 1 ? '' : 's'} left out)`}
          {unchangedSince(vision, state.after) && (
            <button
              className="link"
              onClick={() => {
                onChange(state.before)
                setState({ kind: 'idle' })
              }}
            >
              Undo note
            </button>
          )}
        </span>
      )}
    </div>
  )
}

/** Whether nothing has been edited since `after`. The credits are set on every render, so they don't count. */
function unchangedSince(vision: Vision, after: Vision): boolean {
  return (
    vision.sections === after.sections &&
    vision.palette === after.palette &&
    vision.moments === after.moments &&
    vision.intensity === after.intensity
  )
}
