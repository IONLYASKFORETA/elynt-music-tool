import { describe, expect, it } from 'vitest'
import type { LaneId, PlaybookStep } from './playbook'
import { currentPlaybook } from './playbooks'
import { emptyProfile } from './profile'
import { boardOf } from './release-board'
import { buildPlan, type ReleasePlan } from './release-plan'

/** 15 January 2027 is a Friday. */
const releaseDay = '2027-01-15'

function step(id: string, changes: Partial<PlaybookStep> = {}): PlaybookStep {
  return {
    id,
    phase: 'setup',
    lane: 'distribution',
    when: { offset: -28 },
    hardDeadline: false,
    tag: 'thumb',
    title: `Step ${id}`,
    what: `What ${id}`,
    why: `Why ${id}`,
    how: `How ${id}`,
    eligibility: {},
    draftKinds: [],
    dependsOn: [],
    ...changes
  }
}

function planOf(steps: PlaybookStep[]): ReleasePlan {
  return buildPlan({ version: 1, steps }, emptyProfile(), { releaseDay })
}

describe('boardOf: weeks', () => {
  it('has one column per week from R−42 to R+28, each starting on a Friday', () => {
    const board = boardOf(planOf([]))
    expect(board.weeks.map((w) => [w.label, w.from, w.to])).toEqual([
      ['R−42', '2026-12-04', '2026-12-10'],
      ['R−35', '2026-12-11', '2026-12-17'],
      ['R−28', '2026-12-18', '2026-12-24'],
      ['R−21', '2026-12-25', '2026-12-31'],
      ['R−14', '2027-01-01', '2027-01-07'],
      ['R−7', '2027-01-08', '2027-01-14'],
      ['Release week', '2027-01-15', '2027-01-21'],
      ['R+7', '2027-01-22', '2027-01-28'],
      ['R+14', '2027-01-29', '2027-02-04'],
      ['R+21', '2027-02-05', '2027-02-11'],
      ['R+28', '2027-02-12', '2027-02-12']
    ])
  })

  it('marks the week today falls in, and none when today is outside the plan', () => {
    const now = (today: string) =>
      boardOf(planOf([]), today)
        .weeks.filter((w) => w.isNow)
        .map((w) => w.label)
    expect(now('2026-12-31')).toEqual(['R−21'])
    expect(now('2027-01-15')).toEqual(['Release week'])
    expect(now('2026-11-01')).toEqual([])
    expect(now('2027-02-13')).toEqual([])
    expect(boardOf(planOf([])).weeks.some((w) => w.isNow)).toBe(false)
  })
})

describe('boardOf: lanes', () => {
  /** Step ids in each lane's week cells. */
  function grid(plan: ReleasePlan): Record<LaneId, string[][]> {
    const out = {} as Record<LaneId, string[][]>
    for (const lane of boardOf(plan).lanes) out[lane.lane] = lane.cells.map((c) => c.map((s) => s.stepId))
    return out
  }

  it('has a row for every lane in Board order, even with no steps in it', () => {
    expect(boardOf(planOf([])).lanes.map((l) => [l.lane, l.name])).toEqual([
      ['distribution', 'Distribution'],
      ['spotify', 'Spotify'],
      ['social', 'Social'],
      ['outreach', 'Outreach'],
      ['soundcloud', 'SoundCloud'],
      ['check-ins', 'Check-ins']
    ])
  })

  it('puts each step in its lane, in the week its due date falls in', () => {
    const plan = planOf([
      step('first-day', { phase: 'prep', when: { offset: -42 } }),
      step('end-of-week-one', {
        phase: 'prep',
        lane: 'spotify',
        when: { offset: -36 }
      }),
      step('week-two', {
        phase: 'prep',
        lane: 'spotify',
        when: { offset: -35 }
      }),
      step('eve', {
        phase: 'pre-release',
        lane: 'social',
        when: { offset: -1 }
      }),
      step('release', {
        phase: 'release-day',
        lane: 'social',
        when: { offset: 0 }
      }),
      step('last-day', {
        phase: 'post-release',
        lane: 'check-ins',
        when: { offset: 28 }
      })
    ])
    const empty = (): string[][] => Array.from({ length: 11 }, () => [])
    const expected: Record<LaneId, string[][]> = {
      distribution: empty(),
      spotify: empty(),
      social: empty(),
      outreach: empty(),
      soundcloud: empty(),
      'check-ins': empty()
    }
    expected.distribution[0] = ['first-day']
    expected.spotify[0] = ['end-of-week-one']
    expected.spotify[1] = ['week-two']
    expected.social[5] = ['eve']
    expected.social[6] = ['release']
    expected['check-ins'][10] = ['last-day']
    expect(grid(plan)).toEqual(expected)
  })

  it('keeps steps in a cell in date order', () => {
    const plan = planOf([step('later', { when: { offset: -24 } }), step('sooner', { when: { offset: -28 } })])
    expect(grid(plan).distribution[2]).toEqual(['sooner', 'later'])
  })

  it('shows a moved step in the week of its new date, kept inside the board at either end', () => {
    const plan = planOf([step('a'), step('b'), step('c')])
    const newDates: Record<string, string> = {
      a: '2027-01-16', // R+1
      b: '2026-11-01', // before R−42
      c: '2027-03-01' // after R+28
    }
    const moved: ReleasePlan = {
      ...plan,
      steps: plan.steps.map((s) => ({
        ...s,
        dueDate: newDates[s.stepId] ?? s.dueDate,
        movedFrom: s.dueDate
      }))
    }
    const g = grid(moved).distribution
    expect(g[6]).toEqual(['a'])
    expect(g[0]).toEqual(['b'])
    expect(g[10]).toEqual(['c'])
  })

  it('places every step of the shipped playbook exactly once', () => {
    const plan = buildPlan(currentPlaybook(), emptyProfile(), { releaseDay })
    const placed = boardOf(plan).lanes.flatMap((l) => l.cells.flat().map((s) => s.stepId))
    expect(placed.sort()).toEqual(plan.steps.map((s) => s.stepId).sort())
  })
})
