import { useCallback, useEffect, useState } from 'react'
import { formatOffset, LANES, STEP_RULES, TAGS } from '../../shared/playbook'
import type { Release, ReleaseWithPlan } from '../../shared/release'
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
        <button role="tab" aria-selected="true" className="plan-tab active">
          Timeline
        </button>
      </div>
      <Timeline plan={plan} />
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

function StepRow({ step: s }: { step: PlanStep }) {
  const [open, setOpen] = useState(false)
  const tag = TAGS.find((t) => t.id === s.step.tag)?.name
  const lane = LANES.find((l) => l.id === s.step.lane)?.name
  const when = s.step.when
  const rule = 'rule' in when ? STEP_RULES.find((r) => r.id === when.rule) : null

  return (
    <li className={s.hardDeadline ? 'step step-hard' : 'step'}>
      <button className="step-row" aria-expanded={open} onClick={() => setOpen(!open)}>
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
      </button>
      {open && (
        <dl className="step-detail">
          {rule && (
            <>
              <dt>When</dt>
              <dd>{rule.name}. Suggested for {formatDay(s.dueDate)}.</dd>
            </>
          )}
          <dt>What</dt>
          <dd>{s.step.what}</dd>
          <dt>Why</dt>
          <dd>{s.step.why}</dd>
          <dt>How</dt>
          <dd>{s.step.how}</dd>
        </dl>
      )}
    </li>
  )
}
