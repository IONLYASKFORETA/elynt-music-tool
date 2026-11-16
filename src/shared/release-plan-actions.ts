import { addDays, isCalendarDate, type PlanStep, type ReleasePlan } from './release-plan'

/**
 * The plan engine's step actions (see #45, R3): pure, no I/O. Each takes a plan and returns a new
 * one; the caller saves it. "today" is always the owner's local calendar day, YYYY-MM-DD.
 */

/** The plan as the Today tab shows it. Lists keep plan (date) order. */
export interface TodayView {
  /** Every step due today, done or not. */
  today: PlanStep[]
  /** Missed steps, and open steps from before today that markMissed has not caught yet. */
  overdue: PlanStep[]
  /** Every step due in the 7 days after today. */
  nextWeek: PlanStep[]
  /** Open hard deadlines from today on, however far away. */
  hardDeadlines: PlanStep[]
  /** Days from today to release day; 0 on the day, negative after it. */
  daysToRelease: number
  stepsDone: number
  stepsTotal: number
}

export function todayView(plan: ReleasePlan, today: string): TodayView {
  const weekEnd = addDays(today, 7)
  const steps = plan.steps
  return {
    today: steps.filter((s) => s.dueDate === today),
    overdue: steps.filter((s) => s.status === 'missed' || (s.status === 'open' && s.dueDate < today)),
    nextWeek: steps.filter((s) => s.dueDate > today && s.dueDate <= weekEnd),
    hardDeadlines: steps.filter((s) => s.hardDeadline && s.status === 'open' && s.dueDate >= today),
    daysToRelease: daysBetween(today, plan.releaseDay),
    stepsDone: steps.filter((s) => s.status === 'done').length,
    stepsTotal: steps.length
  }
}

/** "26 days to release", "Release day is today", "3 days since release". */
export function countdownLabel(daysToRelease: number): string {
  const n = Math.abs(daysToRelease)
  const days = `${n} day${n === 1 ? '' : 's'}`
  if (daysToRelease > 0) return `${days} to release`
  if (daysToRelease < 0) return `${days} since release`
  return 'Release day is today'
}

/** What the owner can do to any step: tick it off, skip it, move it to another day, or undo. */
export type StepAction = { kind: 'done' } | { kind: 'skip' } | { kind: 'move'; to: string } | { kind: 'reopen' }

/** Reads a step action sent from the window, keeping only the fields it needs. */
export function parseStepAction(raw: unknown): StepAction {
  const r = (raw ?? {}) as { kind?: unknown; to?: unknown }
  if (r.kind === 'done' || r.kind === 'skip' || r.kind === 'reopen') return { kind: r.kind }
  if (r.kind === 'move' && typeof r.to === 'string') return { kind: 'move', to: r.to }
  throw new Error(`Unknown step action: ${JSON.stringify(raw)}`)
}

/**
 * Applies one step action. A moved step remembers the day it was first due (forgotten when moved
 * back), and a missed step moved to a new day is open again. The plan stays in date order.
 */
export function applyStepAction(plan: ReleasePlan, stepId: string, action: StepAction): ReleasePlan {
  if (!plan.steps.some((s) => s.stepId === stepId)) throw new Error(`This plan has no step "${stepId}"`)
  if (action.kind === 'move' && !isCalendarDate(action.to)) throw new Error('Pick a day to move the step to')

  const steps = plan.steps.map((s) => (s.stepId === stepId ? applyTo(s, action) : s))
  if (action.kind === 'move') steps.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
  return { ...plan, steps }
}

function applyTo(s: PlanStep, action: StepAction): PlanStep {
  switch (action.kind) {
    case 'done':
      return { ...s, status: 'done' }
    case 'skip':
      return { ...s, status: 'skipped' }
    case 'reopen':
      return { ...s, status: 'open' }
    case 'move': {
      const firstDue = s.movedFrom ?? s.dueDate
      return {
        ...s,
        dueDate: action.to,
        movedFrom: action.to === firstDue ? null : firstDue,
        status: s.status === 'missed' ? 'open' : s.status
      }
    }
  }
}

/**
 * The warning to show before an action that costs reach: skipping a hard deadline, or moving one
 * past the day it is really due. Null when the action is safe.
 */
export function stepActionWarning(s: PlanStep, action: StepAction): string | null {
  if (!s.hardDeadline) return null
  const name = `“${s.step.title}” is a hard deadline`
  if (action.kind === 'skip') return `${name}. ${s.step.why} Skip it anyway?`
  if (action.kind === 'move') {
    const deadline = s.movedFrom ?? s.dueDate
    if (action.to <= deadline) return null
    return `${name} on ${shortDay(deadline)}. ${s.step.why} Move it to ${shortDay(action.to)} anyway?`
  }
  return null
}

/** A hard deadline that passed without being done or skipped, and what it cost. */
export interface LostDeadline {
  stepId: string
  /** Step ids taken off the plan because they no longer make sense, in plan order. */
  dropped: string[]
  /** Plain words for the owner: what was missed, what that loses, and what left the plan. */
  message: string
}

export interface MarkMissedResult {
  plan: ReleasePlan
  /** Hard deadlines newly missed by this call; empty when nothing new was lost. */
  lost: LostDeadline[]
}

/**
 * Marks every open step due before today as missed, so it stays in Overdue. A newly missed hard
 * deadline also drops the open or missed steps that depend on it (directly or through another
 * dropped step) and says plainly what was lost. Done and skipped steps are never touched.
 */
export function markMissed(plan: ReleasePlan, today: string): MarkMissedResult {
  let steps = plan.steps.map((s) => (s.status === 'open' && s.dueDate < today ? { ...s, status: 'missed' as const } : s))
  const newlyMissedDeadlines = steps.filter(
    (s, i) => s.hardDeadline && s.status === 'missed' && plan.steps[i]?.status === 'open'
  )

  const lost: LostDeadline[] = []
  for (const deadline of newlyMissedDeadlines) {
    if (!steps.includes(deadline)) continue // dropped by an earlier deadline
    const dropped = dependentsToDrop(steps, deadline.stepId)
    lost.push({ stepId: deadline.stepId, dropped: dropped.map((s) => s.stepId), message: lostMessage(deadline, dropped) })
    steps = steps.filter((s) => !dropped.includes(s))
  }

  if (lost.length === 0 && steps.every((s, i) => s === plan.steps[i])) return { plan, lost }
  return { plan: { ...plan, steps }, lost }
}

/** Open or missed steps that depend on the given step, directly or through each other. */
function dependentsToDrop(steps: PlanStep[], stepId: string): PlanStep[] {
  const gone = new Set([stepId])
  let grew = true
  while (grew) {
    grew = false
    for (const s of steps) {
      if (gone.has(s.stepId) || (s.status !== 'open' && s.status !== 'missed')) continue
      if (s.step.dependsOn.some((d) => gone.has(d))) {
        gone.add(s.stepId)
        grew = true
      }
    }
  }
  return steps.filter((s) => s.stepId !== stepId && gone.has(s.stepId))
}

function lostMessage(deadline: PlanStep, dropped: PlanStep[]): string {
  const parts = [`You missed “${deadline.step.title}” (${shortDay(deadline.dueDate)}).`, deadline.step.why]
  if (dropped.length > 0) parts.push(`Taken off the plan: ${dropped.map((s) => s.step.title).join(', ')}.`)
  return parts.join(' ')
}

/** "Fri 25 Dec". Calendar days are read in UTC so time zones never shift them. */
function shortDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
}

/**
 * Moves release day. Every step shifts by the same number of days, steps the owner moved keep
 * their move, done and skipped steps stay that way, and missed steps reopen on their new day
 * (the next markMissed decides whether they are still missed).
 */
export function moveReleaseDay(plan: ReleasePlan, newDay: string): ReleasePlan {
  if (!isCalendarDate(newDay)) throw new Error('Pick a release day (year, month and day)')
  const shift = daysBetween(plan.releaseDay, newDay)
  return {
    ...plan,
    releaseDay: newDay,
    steps: plan.steps.map((s) => ({
      ...s,
      dueDate: addDays(s.dueDate, shift),
      movedFrom: s.movedFrom === null ? null : addDays(s.movedFrom, shift),
      status: s.status === 'missed' ? 'open' : s.status
    }))
  }
}

/** Whole days from one calendar day to another (negative when "to" is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

