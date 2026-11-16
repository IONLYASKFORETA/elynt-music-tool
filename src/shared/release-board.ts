import { formatOffset, LANES, PHASES, type LaneId } from './playbook'
import { addDays, type PlanStep, type ReleasePlan } from './release-plan'

/**
 * The Board view (see #45 user story 30): the release plan as a grid, weeks as columns and
 * lanes as rows. Pure, no I/O. Weeks count from release day, so each starts on the same weekday
 * as R (a Friday in a normal release) and release week is the column that starts on R.
 */

/** The plan's first and last day from R: R−42 and R+28. */
const PLAN_FROM = Math.min(...PHASES.map((p) => p.from))
const PLAN_TO = Math.max(...PHASES.map((p) => p.to))

export interface BoardWeek {
  /** Days from R to the week's first day: −42, −35, … 0, … 28. */
  offset: number
  /** "R−21", "Release week", "R+7". */
  label: string
  /** First and last day of the week inside the plan, YYYY-MM-DD. */
  from: string
  to: string
  /** Today falls in this week. */
  isNow: boolean
}

export interface BoardLane {
  lane: LaneId
  name: string
  /** One cell per week, lined up with Board.weeks; each holds its steps in date order. */
  cells: PlanStep[][]
}

export interface Board {
  weeks: BoardWeek[]
  /** Every lane, in Board order, even when it has no steps. */
  lanes: BoardLane[]
}

/** `today` is YYYY-MM-DD in the owner's time zone; leave it out to mark no week. */
export function boardOf(plan: ReleasePlan, today?: string): Board {
  const weeks: BoardWeek[] = []
  for (let offset = PLAN_FROM; offset <= PLAN_TO; offset += 7) {
    const from = addDays(plan.releaseDay, offset)
    const to = addDays(plan.releaseDay, Math.min(offset + 6, PLAN_TO))
    weeks.push({
      offset,
      label: offset === 0 ? 'Release week' : formatOffset(offset),
      from,
      to,
      isNow: today !== undefined && today >= from && today <= to
    })
  }
  // A step sits in the week of its due date, which may have been moved; a step moved outside
  // the plan's span stays on the board in the first or last week.
  const weekIndex = (step: PlanStep): number => {
    const offset = Math.min(PLAN_TO, Math.max(PLAN_FROM, daysBetween(plan.releaseDay, step.dueDate)))
    return Math.floor((offset - PLAN_FROM) / 7)
  }
  const byDate = [...plan.steps].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const lanes = LANES.map((l) => ({
    lane: l.id,
    name: l.name,
    cells: weeks.map((_, i) => byDate.filter((s) => s.step.lane === l.id && weekIndex(s) === i))
  }))
  return { weeks, lanes }
}

/** Whole days from one YYYY-MM-DD to another; negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}
