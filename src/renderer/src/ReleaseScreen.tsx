import { Fragment, useCallback, useEffect, useState } from 'react'
import { formatOffset, LANES, STEP_RULES, TAGS } from '../../shared/playbook'
import type { Release, ReleaseToday, ReleaseWithPlan } from '../../shared/release'
import { boardOf } from '../../shared/release-board'
import { stepsByPhase, type PlanStep, type ReleasePlan } from '../../shared/release-plan'
import {
  countdownLabel,
  stepActionWarning,
  todayView,
  type LostDeadline,
  type StepAction,
  type TodayView
} from '../../shared/release-plan-actions'
import type { Track } from '../../shared/track'

function message(e: unknown): string {
  return String(e).replace(/^Error: Error invoking remote method '[^']+': (Error: )?/, '')
}

/** "Fri 15 Jan 2027". Dates are calendar days, so they are read and shown in UTC. */
function formatDay(date: string, withYear = true): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {})
  })
}

const PLAN_TABS = [
  { id: 'today', name: 'Today' },
  { id: 'timeline', name: 'Timeline' },
  { id: 'board', name: 'Board' }
] as const

type PlanTab = (typeof PLAN_TABS)[number]['id']
type OnAct = (step: PlanStep, action: StepAction) => void

/** The Release Assistant: start a release, then see its plan. */
export function ReleaseScreen({ tracks }: { tracks: Track[] }) {
  const [releases, setReleases] = useState<Release[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.elynt.releases.list()
    setReleases(list)
    return list
  }, [])

  useEffect(() => {
    refresh()
      .then((list) => setOpenId((id) => id ?? list[0]?.id ?? null))
      .catch((e: unknown) => setError(message(e)))
  }, [refresh])

  return (
    <div className="release">
      {error && <p className="error">{error}</p>}
      <div className="release-bar">
        {releases.map((r) => (
          <button
            key={r.id}
            className={r.id === openId ? 'track-pick active' : 'track-pick'}
            aria-pressed={r.id === openId}
            onClick={() => setOpenId(r.id)}
          >
            <span className="title">{r.trackTitle}</span>
            <span className="path">Release day {formatDay(r.releaseDay)}</span>
          </button>
        ))}
        <button className={openId === null ? 'track-pick active' : 'track-pick'} onClick={() => setOpenId(null)}>
          <span className="title">+ New release</span>
          <span className="path">Pick a track and a Friday</span>
        </button>
      </div>

      {openId === null ? (
        <StartRelease
          tracks={tracks}
          onStarted={async (started) => {
            await refresh()
            setOpenId(started.release.id)
          }}
        />
      ) : (
        <ReleasePlanView key={openId} releaseId={openId} />
      )}
    </div>
  )
}

function StartRelease({ tracks, onStarted }: { tracks: Track[]; onStarted: (r: ReleaseWithPlan) => Promise<void> }) {
  const [trackId, setTrackId] = useState<number | ''>('')
  const [releaseDay, setReleaseDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    if (trackId === '' || !releaseDay) return
    setBusy(true)
    setError(null)
    try {
      await onStarted(await window.elynt.releases.start({ trackId, releaseDay }))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="release-start">
      <h2>Start a release</h2>
      <p className="hint">
        Pick the track, or add it with + Add track by choosing its mixdown. Then pick a Friday about six weeks away: the
        plan counts back from that day.
      </p>
      <div className="release-start-row">
        <label className="field">
          <span>Track</span>
          <select value={trackId} onChange={(e) => setTrackId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Pick a track…</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Release day</span>
          <input type="date" value={releaseDay} onChange={(e) => setReleaseDay(e.target.value)} />
        </label>
        <button className="add" onClick={start} disabled={busy || trackId === '' || !releaseDay}>
          {busy ? 'Building plan…' : 'Build the plan'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function ReleasePlanView({ releaseId }: { releaseId: number }) {
  const [data, setData] = useState<ReleaseToday | null>(null)
  const [lost, setLost] = useState<LostDeadline[]>([])
  const [tab, setTab] = useState<PlanTab>('today')
  const [newDay, setNewDay] = useState('')
  const [error, setError] = useState<string | null>(null)

  const show = useCallback((next: ReleaseToday | null) => {
    setData(next)
    if (next && next.lost.length > 0) setLost((old) => [...old, ...next.lost])
  }, [])

  useEffect(() => {
    window.elynt.releases.openToday(releaseId).then(show, (e: unknown) => setError(message(e)))
  }, [releaseId, show])

  const run = async (call: () => Promise<ReleaseToday>) => {
    setError(null)
    try {
      show(await call())
    } catch (e) {
      setError(message(e))
    }
  }

  const act: OnAct = (step, action) => {
    const warning = stepActionWarning(step, action)
    if (warning && !window.confirm(warning)) return
    void run(() => window.elynt.releases.actOnStep(releaseId, step.stepId, action))
  }

  const moveDay = () => {
    if (!newDay || !data || newDay === data.release.releaseDay) return
    const ok = window.confirm(
      `Move release day to ${formatDay(newDay)}? Every step moves with it; steps you finished stay finished.`
    )
    if (ok) void run(() => window.elynt.releases.moveReleaseDay(releaseId, newDay)).then(() => setNewDay(''))
  }

  if (!data) return error ? <p className="error">{error}</p> : null
  const { release, plan } = data
  const view = todayView(plan, data.today)

  return (
    <section className="plan">
      <header className="plan-head">
        <div>
          <h2>{release.trackTitle}</h2>
          <p>
            Release day <strong>{formatDay(release.releaseDay)}</strong> · playbook v{release.playbookVersion}
          </p>
        </div>
        <div className="plan-stats">
          <div>
            <strong>{countdownLabel(view.daysToRelease)}</strong>
          </div>
          <div>
            <strong>
              {view.stepsDone} of {view.stepsTotal}
            </strong>{' '}
            steps done
          </div>
          <label className="plan-move-day">
            <span>Move release day</span>
            <input type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
            <button onClick={moveDay} disabled={!newDay || newDay === release.releaseDay}>
              Move
            </button>
          </label>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {lost.map((l) => (
        <p key={l.stepId} className="plan-lost" role="alert">
          {l.message}
        </p>
      ))}
      <div className="plan-tabs" role="tablist">
        {PLAN_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'plan-tab active' : 'plan-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {tab === 'today' && <Today view={view} today={data.today} onAct={act} />}
      {tab === 'timeline' && <Timeline plan={plan} onAct={act} />}
      {tab === 'board' && <Board plan={plan} today={data.today} onAct={act} />}
    </section>
  )
}

/** Today (#63): what to do now, what slipped, the week ahead and the deadlines that matter. */
function Today({ view, today, onAct }: { view: TodayView; today: string; onAct: OnAct }) {
  const section = (title: string, steps: PlanStep[], empty: string | null) =>
    steps.length === 0 && empty === null ? null : (
      <section className="phase">
        <h3>{title}</h3>
        {steps.length === 0 ? (
          <p className="empty">{empty}</p>
        ) : (
          <ul className="steps">
            {steps.map((s) => (
              <StepRow key={s.stepId} step={s} onAct={onAct} />
            ))}
          </ul>
        )}
      </section>
    )
  return (
    <div className="timeline">
      {section(`Today · ${formatDay(today)}`, view.today, 'Nothing due today.')}
      {section('Overdue', view.overdue, null)}
      {section('Next 7 days', view.nextWeek, 'Nothing due in the next week.')}
      {section('Upcoming hard deadlines', view.hardDeadlines, 'No hard deadlines left.')}
    </div>
  )
}

function Timeline({ plan, onAct }: { plan: ReleasePlan; onAct: OnAct }) {
  return (
    <div className="timeline">
      {stepsByPhase(plan).map((group) => (
        <section key={group.phase} className="phase">
          <h3>
            {group.name}
            <span>
              {group.from === group.to
                ? formatDay(group.from)
                : `${formatDay(group.from, false)} – ${formatDay(group.to)}`}
            </span>
          </h3>
          {group.steps.length === 0 ? (
            <p className="empty">No steps in this phase.</p>
          ) : (
            <ul className="steps">
              {group.steps.map((s) => (
                <StepRow key={s.stepId} step={s} onAct={onAct} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

/** Weeks as columns, lanes as rows (#64). Clicking a step opens the same detail as Timeline. */
function Board({ plan, today, onAct }: { plan: ReleasePlan; today: string; onAct: OnAct }) {
  const [selected, setSelected] = useState<string | null>(null)
  const board = boardOf(plan, today)
  const picked = plan.steps.find((s) => s.stepId === selected) ?? null

  return (
    <div className="board">
      <div className="board-scroll">
        <div className="board-grid" style={{ ['--weeks' as string]: board.weeks.length }}>
          <div className="board-head board-corner">Lane</div>
          {board.weeks.map((w) => (
            <div key={w.offset} className={w.isNow ? 'board-head now' : 'board-head'}>
              <strong>{w.label}</strong>
              {formatDay(w.from, false)}
            </div>
          ))}
          {board.lanes.map((lane) => (
            <Fragment key={lane.lane}>
              <div className="board-lane">{lane.name}</div>
              {lane.cells.map((cell, i) => (
                <div key={i} className={board.weeks[i]?.isNow ? 'board-cell now' : 'board-cell'}>
                  {cell.map((s) => (
                    <button
                      key={s.stepId}
                      className={[
                        'board-step',
                        s.hardDeadline && 'hard',
                        s.status !== 'open' && `is-${s.status}`,
                        s.stepId === selected && 'picked'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={s.stepId === selected}
                      title={`${formatDay(s.dueDate)} · ${formatOffset(s.offset)}${s.hardDeadline ? ' · Hard deadline' : ''}`}
                      onClick={() => setSelected(s.stepId === selected ? null : s.stepId)}
                    >
                      {s.status === 'done' && <span aria-label="Done">✓ </span>}
                      {s.step.title}
                    </button>
                  ))}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
      {picked ? (
        <div className={picked.hardDeadline ? 'step step-hard board-detail' : 'step board-detail'}>
          <div className="step-row">
            <StepSummary step={picked} />
          </div>
          <StepDetail step={picked} onAct={onAct} />
        </div>
      ) : (
        <p className="hint">Click a step to see what to do, why and how.</p>
      )}
    </div>
  )
}

function StepRow({ step: s, onAct }: { step: PlanStep; onAct: OnAct }) {
  const [open, setOpen] = useState(false)

  return (
    <li className={`step${s.hardDeadline ? ' step-hard' : ''} step-${s.status}`}>
      <button className="step-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepSummary step={s} />
      </button>
      {open && <StepDetail step={s} onAct={onAct} />}
    </li>
  )
}

/** The step's date, title and tags, as one row. Shared by Timeline and Board. */
function StepSummary({ step: s }: { step: PlanStep }) {
  const tag = TAGS.find((t) => t.id === s.step.tag)?.name
  const lane = LANES.find((l) => l.id === s.step.lane)?.name
  return (
    <>
      <span className="step-date">
        {formatDay(s.dueDate, false)}
        <small>{formatOffset(s.offset)}</small>
      </span>
      <span className="step-title">{s.step.title}</span>
      <span className="step-tags">
        {STATUS_NAMES[s.status] && <span className={`badge badge-status-${s.status}`}>{STATUS_NAMES[s.status]}</span>}
        {s.movedFrom && <span className="badge">Moved from {formatDay(s.movedFrom, false)}</span>}
        {s.hardDeadline && <span className="badge badge-hard">Hard deadline</span>}
        <span className={`badge badge-${s.step.tag}`}>{tag}</span>
        <span className="badge">{lane}</span>
      </span>
    </>
  )
}

const STATUS_NAMES: Record<PlanStep['status'], string | null> = {
  open: null,
  done: 'Done',
  skipped: 'Skipped',
  missed: 'Missed'
}

/**
 * The step detail: When (for rule steps), What, Why and How, and the step actions (done, skip,
 * move, undo). Shared by Today, Timeline and Board.
 */
function StepDetail({ step: s, onAct }: { step: PlanStep; onAct: OnAct }) {
  const [moveTo, setMoveTo] = useState('')
  const when = s.step.when
  const rule = 'rule' in when ? STEP_RULES.find((r) => r.id === when.rule) : null

  return (
    <dl className="step-detail">
      {rule && (
        <>
          <dt>When</dt>
          <dd>
            {rule.name}. Suggested for {formatDay(s.dueDate)}.
          </dd>
        </>
      )}
      <dt>What</dt>
      <dd>{s.step.what}</dd>
      <dt>Why</dt>
      <dd>{s.step.why}</dd>
      <dt>How</dt>
      <dd>{s.step.how}</dd>
      <dd className="step-actions">
        {s.status === 'done' || s.status === 'skipped' ? (
          <button onClick={() => onAct(s, { kind: 'reopen' })}>{s.status === 'done' ? 'Mark not done' : 'Unskip'}</button>
        ) : (
          <>
            <button className="add" onClick={() => onAct(s, { kind: 'done' })}>
              Mark done
            </button>
            <button onClick={() => onAct(s, { kind: 'skip' })}>Skip</button>
          </>
        )}
        <input type="date" aria-label="Move to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} />
        <button
          disabled={!moveTo || moveTo === s.dueDate}
          onClick={() => {
            onAct(s, { kind: 'move', to: moveTo })
            setMoveTo('')
          }}
        >
          Move
        </button>
      </dd>
    </dl>
  )
}
