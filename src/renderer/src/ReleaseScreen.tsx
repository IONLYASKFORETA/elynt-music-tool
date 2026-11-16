import { Fragment, useCallback, useEffect, useState } from 'react'
import { formatOffset, LANES, STEP_RULES, TAGS } from '../../shared/playbook'
import type { Release, ReleaseWithPlan } from '../../shared/release'
import { boardOf } from '../../shared/release-board'
import { stepsByPhase, type PlanStep, type ReleasePlan } from '../../shared/release-plan'
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

/** Today as YYYY-MM-DD on this computer's clock. */
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PLAN_TABS = [
  { id: 'timeline', name: 'Timeline' },
  { id: 'board', name: 'Board' }
] as const

type PlanTab = (typeof PLAN_TABS)[number]['id']

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
  const [data, setData] = useState<ReleaseWithPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<PlanTab>('timeline')

  useEffect(() => {
    window.elynt.releases.get(releaseId).then(setData, (e: unknown) => setError(message(e)))
  }, [releaseId])

  if (error) return <p className="error">{error}</p>
  if (!data) return null
  const { release, plan } = data
  const done = plan.steps.filter((s) => s.status === 'done').length

  return (
    <section className="plan">
      <header className="plan-head">
        <div>
          <h2>{release.trackTitle}</h2>
          <p>
            Release day <strong>{formatDay(release.releaseDay)}</strong> · {done} of {plan.steps.length} steps done ·
            playbook v{release.playbookVersion}
          </p>
        </div>
      </header>
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
      {tab === 'timeline' ? <Timeline plan={plan} /> : <Board plan={plan} />}
    </section>
  )
}

function Timeline({ plan }: { plan: ReleasePlan }) {
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
                <StepRow key={s.stepId} step={s} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

/** Weeks as columns, lanes as rows (#64). Clicking a step opens the same detail as Timeline. */
function Board({ plan }: { plan: ReleasePlan }) {
  const [selected, setSelected] = useState<string | null>(null)
  const board = boardOf(plan, localToday())
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
          <StepDetail step={picked} />
        </div>
      ) : (
        <p className="hint">Click a step to see what to do, why and how.</p>
      )}
    </div>
  )
}

function StepRow({ step: s }: { step: PlanStep }) {
  const [open, setOpen] = useState(false)

  return (
    <li className={s.hardDeadline ? 'step step-hard' : 'step'}>
      <button className="step-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StepSummary step={s} />
      </button>
      {open && <StepDetail step={s} />}
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
        {s.hardDeadline && <span className="badge badge-hard">Hard deadline</span>}
        <span className={`badge badge-${s.step.tag}`}>{tag}</span>
        <span className="badge">{lane}</span>
      </span>
    </>
  )
}

/** The step detail: When (for rule steps), What, Why and How. Shared by Timeline and Board. */
function StepDetail({ step: s }: { step: PlanStep }) {
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
    </dl>
  )
}
