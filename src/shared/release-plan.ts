import { PHASES, type PhaseId, type Playbook, type PlaybookStep } from './playbook'
import type { ArtistProfile } from './profile'

/**
 * The plan engine (see #45): pure, no I/O. Turns the playbook, the artist profile and a release
 * into a dated release plan. All dates are calendar days (YYYY-MM-DD), counted from release day.
 */

/** What the owner picks when starting a release. */
export interface NewRelease {
  /** YYYY-MM-DD; a Friday in a normal release. */
  releaseDay: string
}

export type PlanStepStatus = 'open' | 'done' | 'skipped' | 'missed'

/** One dated step of a release plan, with the playbook step it came from. */
export interface PlanStep {
  /** The playbook step id. */
  stepId: string
  /** Days from release day: −28 is four weeks before. */
  offset: number
  /** YYYY-MM-DD. */
  dueDate: string
  phase: PhaseId
  hardDeadline: boolean
  status: PlanStepStatus
  /** The due date before the owner moved the step; null if never moved. */
  movedFrom: string | null
  /** The fixed What/Why/How, tag, lane and so on, from the playbook version that built the plan. */
  step: PlaybookStep
}

export interface ReleasePlan {
  releaseDay: string
  playbookVersion: number
  /** In date order; steps on the same day keep playbook order. */
  steps: PlanStep[]
}

export function buildPlan(playbook: Playbook, _profile: ArtistProfile, release: NewRelease): ReleasePlan {
  // Array sort is stable, so steps on the same day keep playbook order.
  const steps = playbook.steps.map((step) => planStep(step, release.releaseDay)).sort((a, b) => a.offset - b.offset)
  return { releaseDay: release.releaseDay, playbookVersion: playbook.version, steps }
}

function planStep(step: PlaybookStep, releaseDay: string): PlanStep {
  const offset = step.when.offset
  return {
    stepId: step.id,
    offset,
    dueDate: addDays(releaseDay, offset),
    phase: step.phase,
    hardDeadline: step.hardDeadline,
    status: 'open',
    movedFrom: null,
    step
  }
}

export interface PhaseGroup {
  phase: PhaseId
  name: string
  /** First and last day of the phase, YYYY-MM-DD. */
  from: string
  to: string
  steps: PlanStep[]
}

/** The plan as the Timeline shows it: all five phases in order, each with its steps (maybe none). */
export function stepsByPhase(plan: ReleasePlan): PhaseGroup[] {
  return PHASES.map((p) => ({
    phase: p.id,
    name: p.name,
    from: addDays(plan.releaseDay, p.from),
    to: addDays(plan.releaseDay, p.to),
    steps: plan.steps.filter((s) => s.phase === p.id)
  }))
}

/** True for a real YYYY-MM-DD day (not 2027-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value)
}

/** A calendar date plus some days, in YYYY-MM-DD. Works in UTC so time zones never shift a day. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
