import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { snapToGrid, type Snap } from './beat-grid'
import { MOMENT_KINDS, MOMENT_NAMES, type MomentKind } from './moments'
import { TRANSITION_NAMES, TRANSITION_STYLES, type TransitionStyle } from './transitions'
import { addMoment, moveMoment, removeMoment, setTransition, transitionWindow, type Vision } from './vision'

interface Props {
  vision: Vision
  /** Seconds. */
  time: number
  duration: number
  disabled: boolean
  onSeek(t: number): void
  onChange(vision: Vision): void
  /** The picked section, whose scene the scene panel shows. */
  section: number
  onSection(index: number): void
}

/**
 * The editor's timeline, under the preview: the track's sections on the beat grid, the moments
 * pinned to it and the transition at each boundary. Dragging on the grid scrubs the preview;
 * moments drag along the grid, snapping to the bar or beat.
 */
export function Timeline({ vision, time, duration, disabled, onSeek, onChange, section, onSection }: Props) {
  const areaRef = useRef<HTMLDivElement>(null)
  const [kind, setKind] = useState<MomentKind>('flash')
  const [snap, setSnap] = useState<Snap>('beat')
  const [picked, setPicked] = useState<number | null>(null)
  const [dragging, setDragging] = useState<{ id: number; at: number } | null>(null)
  const length = Math.max(duration, vision.sections.at(-1)?.end ?? 0, 1)
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), length) / length) * 100}%`
  const pickedMoment = vision.moments.find((m) => m.id === picked)
  const index = Math.min(section, vision.sections.length - 1)
  const hasNext = index < vision.sections.length - 1

  const timeAt = (clientX: number): number => {
    const box = areaRef.current!.getBoundingClientRect()
    return (Math.min(Math.max(clientX - box.left, 0), box.width) / Math.max(box.width, 1)) * length
  }

  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    onSeek(timeAt(e.clientX))
  }

  const add = (t: number) => {
    const next = addMoment(vision, kind, t, snap)
    setPicked(Math.max(...next.moments.map((m) => m.id)))
    onChange(next)
  }

  const remove = (id: number) => {
    onChange(removeMoment(vision, id))
    setPicked(null)
  }

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-tools">
        <label>
          Moment{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value as MomentKind)}>
            {MOMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {MOMENT_NAMES[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Snap to{' '}
          <select value={snap} onChange={(e) => setSnap(e.target.value as Snap)}>
            <option value="beat">Beat</option>
            <option value="bar">Bar</option>
          </select>
        </label>
        <button className="add" onClick={() => add(time)}>
          Add at playhead
        </button>
        {pickedMoment && (
          <button className="link" onClick={() => remove(pickedMoment.id)}>
            Delete {MOMENT_NAMES[pickedMoment.kind].toLowerCase()}
          </button>
        )}
        {hasNext && (
          <label className="timeline-transition">
            {label(vision.sections[index]!.label)} hands over with{' '}
            <select
              value={vision.sections[index]!.transition ?? 'cut'}
              onChange={(e) => onChange(setTransition(vision, index, e.target.value as TransitionStyle))}
            >
              {TRANSITION_STYLES.map((s) => (
                <option key={s} value={s}>
                  {TRANSITION_NAMES[s]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="timeline-area" ref={areaRef}>
        <div className="timeline-sections">
          {vision.sections.map((s, i) => (
            <button
              key={i}
              className={i === index ? 'timeline-section picked' : 'timeline-section'}
              style={{ left: pct(s.start), width: `calc(${pct(s.end)} - ${pct(s.start)})` }}
              onClick={() => onSection(i)}
              title={`${label(s.label)}, ${clock(s.start)}`}
            >
              {label(s.label)}
            </button>
          ))}
          {vision.sections.slice(0, -1).map((s, i) => {
            const w = transitionWindow(vision, i)
            return (
              <span
                key={i}
                className="timeline-handover"
                style={{ left: pct(w.start), width: `max(2px, calc(${pct(w.end)} - ${pct(w.start)}))` }}
                title={TRANSITION_NAMES[s.transition ?? 'cut']}
              />
            )
          })}
        </div>

        <div
          className="timeline-grid"
          onPointerDown={scrub}
          onPointerMove={(e) => e.buttons === 1 && !disabled && onSeek(timeAt(e.clientX))}
          aria-label="Scrub"
        >
          <svg viewBox={`0 0 ${length} 1`} preserveAspectRatio="none" aria-hidden>
            {vision.grid.beats.map((b, i) => (
              <line key={`b${i}`} x1={b} x2={b} y1={0.55} y2={1} className="timeline-beat" vectorEffect="non-scaling-stroke" />
            ))}
            {vision.grid.downbeats.map((b, i) => (
              <line key={`d${i}`} x1={b} x2={b} y1={0} y2={1} className="timeline-bar" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        </div>

        <div
          className="timeline-moments"
          onDoubleClick={(e) => e.target === e.currentTarget && add(timeAt(e.clientX))}
          title="Double-click to add a moment"
        >
          {vision.moments.map((m) => {
            const at = dragging?.id === m.id ? dragging.at : m.at
            return (
              <button
                key={m.id}
                className={`timeline-moment ${m.kind}${m.id === picked ? ' picked' : ''}`}
                style={{ left: pct(at) }}
                aria-label={`${MOMENT_NAMES[m.kind]} at ${clock(m.at)}`}
                title={`${MOMENT_NAMES[m.kind]}, ${clock(m.at)}. Drag to move, Delete to remove.`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setPicked(m.id)
                  setDragging({ id: m.id, at: m.at })
                }}
                onPointerMove={(e) => dragging?.id === m.id && setDragging({ id: m.id, at: snapToGrid(vision.grid, timeAt(e.clientX), snap) })}
                onPointerUp={() => {
                  if (dragging?.id === m.id && dragging.at !== m.at) onChange(moveMoment(vision, m.id, dragging.at, snap))
                  setDragging(null)
                }}
                onKeyDown={(e) => (e.key === 'Delete' || e.key === 'Backspace') && remove(m.id)}
              />
            )
          })}
        </div>

        <span className="timeline-playhead" style={{ left: pct(time) }} />
      </div>
    </section>
  )
}

function label(s: string): string {
  return s[0]!.toUpperCase() + s.slice(1)
}

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  const hundredths = Math.round((seconds - s) * 100) % 100
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${hundredths ? `.${String(hundredths).padStart(2, '0')}` : ''}`
}
