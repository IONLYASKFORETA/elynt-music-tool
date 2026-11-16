import type { Playbook } from '../shared/playbook'
import { PLAYBOOKS } from '../shared/playbooks'
import type { GoalId } from '../shared/profile'
import type { Release, ReleaseToday, ReleaseWithPlan, StartRelease } from '../shared/release'
import { buildPlan, isCalendarDate, type PlanStep, type PlanStepStatus, type ReleasePlan } from '../shared/release-plan'
import { applyStepAction, markMissed, moveReleaseDay, type StepAction } from '../shared/release-plan-actions'
import { isSubgenreId } from '../shared/subgenres'
import type { SuiteDatabase } from './db/database'
import type { ProfileStore } from './profile'
import type { TrackLibrary } from './tracks'

export interface ReleaseStore {
  /** Builds the plan from the newest playbook and saves the release with its steps. */
  start(input: StartRelease): ReleaseWithPlan
  /** A release and its plan, read through the playbook version that built it. Null if unknown. */
  get(releaseId: number): ReleaseWithPlan | null
  /** Every release, newest first. */
  list(): Release[]
  /**
   * Brings a release up to today (open steps that passed become missed, a missed hard deadline
   * drops what depends on it), saves that, and returns it. Null if unknown.
   */
  openToday(releaseId: number): ReleaseToday | null
  /** Ticks off, skips, moves or reopens one step, then brings the plan up to today. */
  actOnStep(releaseId: number, stepId: string, action: StepAction): ReleaseToday
  /** Moves release day: every step shifts, done steps stay done. Then brings the plan up to today. */
  moveReleaseDay(releaseId: number, newDay: string): ReleaseToday
}

export interface ReleaseStoreDeps {
  tracks: TrackLibrary
  profile: ProfileStore
  /** Every playbook version the app ships; the newest builds new plans. */
  playbooks?: readonly Playbook[]
  now?: () => Date
  /** The owner's calendar day, YYYY-MM-DD. Defaults to the local day of now(). */
  today?: () => string
}

interface ReleaseRow {
  id: number
  track_id: number
  track_title: string
  release_day: string
  playbook_version: number
  subgenre_override: string | null
  budget_override: number | null
  goal_override: string | null
  status: 'active' | 'closed'
  started_at: string
}

interface PlanStepRow {
  step_id: string
  offset_days: number
  due_date: string
  hard_deadline: number
  status: PlanStepStatus
  moved_from: string | null
}

const SELECT_RELEASE = `
  SELECT r.*, t.title AS track_title FROM releases r JOIN tracks t ON t.id = r.track_id
`

export function createReleaseStore(
  db: SuiteDatabase,
  { tracks, profile, playbooks = PLAYBOOKS, now = () => new Date(), today = () => localDay(now()) }: ReleaseStoreDeps
): ReleaseStore {
  if (playbooks.length === 0) throw new Error('The Release Assistant needs at least one playbook')
  const newest = playbooks.reduce((a, b) => (b.version > a.version ? b : a))

  const insertRelease = db.prepare(
    'INSERT INTO releases (track_id, release_day, playbook_version, started_at) VALUES (?, ?, ?, ?)'
  )
  const insertStep = db.prepare(`
    INSERT INTO plan_steps (release_id, position, step_id, offset_days, due_date, hard_deadline, status, moved_from)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const readRelease = db.prepare(`${SELECT_RELEASE} WHERE r.id = ?`)
  const readAll = db.prepare(`${SELECT_RELEASE} ORDER BY r.started_at DESC, r.id DESC`)
  const readSteps = db.prepare('SELECT * FROM plan_steps WHERE release_id = ? ORDER BY position')
  const updateReleaseDay = db.prepare('UPDATE releases SET release_day = ? WHERE id = ?')
  const updateStep = db.prepare(`
    UPDATE plan_steps SET position = ?, due_date = ?, status = ?, moved_from = ? WHERE release_id = ? AND step_id = ?
  `)
  const readStepIds = db.prepare('SELECT step_id FROM plan_steps WHERE release_id = ?')
  const deleteStep = db.prepare('DELETE FROM plan_steps WHERE release_id = ? AND step_id = ?')

  const get = (releaseId: number): ReleaseWithPlan | null => {
    const row = readRelease.get(releaseId) as unknown as ReleaseRow | undefined
    if (!row) return null
    const release = toRelease(row)
    const playbook = playbooks.find((p) => p.version === release.playbookVersion)
    if (!playbook) {
      throw new Error(
        `This release was planned with playbook version ${release.playbookVersion}, which this version of the app doesn’t have`
      )
    }
    const steps = (readSteps.all(releaseId) as unknown as PlanStepRow[]).map((s) => toPlanStep(s, playbook))
    const plan: ReleasePlan = { releaseDay: release.releaseDay, playbookVersion: playbook.version, steps }
    return { release, plan }
  }

  /** Saves a changed plan: release day, each step's dates and status, and steps it dropped. */
  const save = (releaseId: number, plan: ReleasePlan): void => {
    const kept = new Set(plan.steps.map((s) => s.stepId))
    db.exec('BEGIN')
    try {
      updateReleaseDay.run(plan.releaseDay, releaseId)
      plan.steps.forEach((s, position) => {
        updateStep.run(position, s.dueDate, s.status, s.movedFrom, releaseId, s.stepId)
      })
      for (const { step_id } of readStepIds.all(releaseId) as unknown as { step_id: string }[]) {
        if (!kept.has(step_id)) deleteStep.run(releaseId, step_id)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** Applies a change to a release's plan, brings it up to today, saves and returns it. */
  const change = (releaseId: number, edit: (plan: ReleasePlan) => ReleasePlan): ReleaseToday | null => {
    const current = get(releaseId)
    if (!current) return null
    const day = today()
    const { plan, lost } = markMissed(edit(current.plan), day)
    if (plan !== current.plan) save(releaseId, plan)
    return { ...(get(releaseId) as ReleaseWithPlan), today: day, lost }
  }

  const mustChange = (releaseId: number, edit: (plan: ReleasePlan) => ReleasePlan): ReleaseToday => {
    const result = change(releaseId, edit)
    if (!result) throw new Error(`No release with id ${releaseId}`)
    return result
  }

  return {
    start({ trackId, releaseDay }) {
      if (!tracks.get(trackId)) throw new Error(`No track with id ${trackId}`)
      if (!isCalendarDate(releaseDay)) throw new Error('Pick a release day (year, month and day)')
      const plan = buildPlan(newest, profile.get(), { releaseDay })

      db.exec('BEGIN')
      let releaseId: number
      try {
        releaseId = Number(insertRelease.run(trackId, releaseDay, plan.playbookVersion, now().toISOString()).lastInsertRowid)
        plan.steps.forEach((s, position) => {
          insertStep.run(releaseId, position, s.stepId, s.offset, s.dueDate, s.hardDeadline ? 1 : 0, s.status, s.movedFrom)
        })
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return get(releaseId) as ReleaseWithPlan
    },
    get,
    list() {
      return (readAll.all() as unknown as ReleaseRow[]).map(toRelease)
    },
    openToday: (releaseId) => change(releaseId, (plan) => plan),
    actOnStep: (releaseId, stepId, action) => mustChange(releaseId, (plan) => applyStepAction(plan, stepId, action)),
    moveReleaseDay: (releaseId, newDay) => mustChange(releaseId, (plan) => moveReleaseDay(plan, newDay))
  }
}

/** The machine's local calendar day, YYYY-MM-DD: the owner's "today". */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toRelease(row: ReleaseRow): Release {
  return {
    id: row.id,
    trackId: row.track_id,
    trackTitle: row.track_title,
    releaseDay: row.release_day,
    playbookVersion: row.playbook_version,
    overrides: {
      subgenre: isSubgenreId(row.subgenre_override) ? row.subgenre_override : null,
      budget: row.budget_override,
      goal: row.goal_override as GoalId | null
    },
    status: row.status,
    startedAt: row.started_at
  }
}

function toPlanStep(row: PlanStepRow, playbook: Playbook): PlanStep {
  const step = playbook.steps.find((s) => s.id === row.step_id)
  if (!step) throw new Error(`Playbook version ${playbook.version} has no step "${row.step_id}"`)
  return {
    stepId: row.step_id,
    offset: row.offset_days,
    dueDate: row.due_date,
    phase: step.phase,
    hardDeadline: row.hard_deadline === 1,
    status: row.status,
    movedFrom: row.moved_from,
    step
  }
}
