import { describe, expect, it } from 'vitest'
import type { Playbook, PlaybookStep } from './playbook'
import { currentPlaybook } from './playbooks'
import { emptyProfile } from './profile'
import { buildPlan, type PlanStepStatus, type ReleasePlan } from './release-plan'
import {
  applyStepAction,
  countdownLabel,
  markMissed,
  moveReleaseDay,
  parseStepAction,
  stepActionWarning,
  todayView
} from './release-plan-actions'

/** 15 January 2027 is a Friday. */
const releaseDay = '2027-01-15'

function step(id: string, offset: number, changes: Partial<PlaybookStep> = {}): PlaybookStep {
  const phase = offset < -28 ? 'prep' : offset < -14 ? 'setup' : offset < 0 ? 'pre-release' : offset === 0 ? 'release-day' : 'post-release'
  return {
    id,
    phase,
    lane: 'distribution',
    when: { offset },
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
  const playbook: Playbook = { version: 1, steps }
  return buildPlan(playbook, emptyProfile(), { releaseDay })
}

function withStatus(plan: ReleasePlan, statuses: Record<string, PlanStepStatus>): ReleasePlan {
  return { ...plan, steps: plan.steps.map((s) => ({ ...s, status: statuses[s.stepId] ?? s.status })) }
}

const statuses = (plan: ReleasePlan) => Object.fromEntries(plan.steps.map((s) => [s.stepId, s.status]))

describe('markMissed: open steps whose day has passed', () => {
  const plan = planOf([step('a', -30), step('b', -29), step('c', -28)])

  it.each([
    // today, expected statuses (a is due 2026-12-16, b 2026-12-17, c 2026-12-18)
    ['2026-12-16', { a: 'open', b: 'open', c: 'open' }],
    ['2026-12-17', { a: 'missed', b: 'open', c: 'open' }],
    ['2026-12-19', { a: 'missed', b: 'missed', c: 'missed' }]
  ] as const)('on %s marks %j', (today, expected) => {
    expect(statuses(markMissed(plan, today).plan)).toEqual(expected)
  })

  it('leaves done and skipped steps alone, and keeps every step in the plan', () => {
    const result = markMissed(withStatus(plan, { a: 'done', b: 'skipped' }), '2026-12-25')

    expect(statuses(result.plan)).toEqual({ a: 'done', b: 'skipped', c: 'missed' })
    expect(result.lost).toEqual([])
  })

  it('counts a moved step from its new day', () => {
    const moved = { ...plan, steps: plan.steps.map((s) => (s.stepId === 'a' ? { ...s, dueDate: '2026-12-20', movedFrom: s.dueDate } : s)) }

    expect(statuses(markMissed(moved, '2026-12-19').plan)).toMatchObject({ a: 'open', b: 'missed' })
  })
})

describe('markMissed: a missed hard deadline', () => {
  const plan = planOf([
    step('upload', -28),
    step('upload-deadline', -21, { hardDeadline: true, title: 'Last day to upload', why: 'Upload later and the pitch is lost.' }),
    step('pitch', -14, { dependsOn: ['upload-deadline'], title: 'Pitch the song' }),
    step('pitch-follow-up', -10, { dependsOn: ['pitch'], title: 'Follow up the pitch' }),
    step('posts', -10, { title: 'Post teasers' }),
    step('done-already', -12, { dependsOn: ['upload-deadline'] })
  ])

  it('stays in the plan as missed, drops the open steps that depend on it, and says what was lost', () => {
    const result = markMissed(withStatus(plan, { 'done-already': 'done' }), '2026-12-26')

    expect(statuses(result.plan)).toEqual({ upload: 'missed', 'upload-deadline': 'missed', posts: 'open', 'done-already': 'done' })
    expect(result.lost).toEqual([
      {
        stepId: 'upload-deadline',
        dropped: ['pitch', 'pitch-follow-up'],
        message:
          'You missed “Last day to upload” (Fri 25 Dec). Upload later and the pitch is lost. Taken off the plan: Pitch the song, Follow up the pitch.'
      }
    ])
  })

  it('says only what was lost when nothing depends on it', () => {
    const lone = planOf([step('deadline', -21, { hardDeadline: true, title: 'Last day', why: 'It closes.' })])

    expect(markMissed(lone, '2026-12-26').lost).toEqual([
      { stepId: 'deadline', dropped: [], message: 'You missed “Last day” (Fri 25 Dec). It closes.' }
    ])
  })

  it('reports a hard deadline only once: a deadline already missed is not lost again', () => {
    const once = markMissed(plan, '2026-12-26').plan

    expect(markMissed(once, '2026-12-27')).toEqual({ plan: once, lost: [] })
  })

  it('does nothing to a hard deadline that was done or skipped on purpose', () => {
    expect(markMissed(withStatus(plan, { 'upload-deadline': 'done' }), '2026-12-26').lost).toEqual([])
    expect(markMissed(withStatus(plan, { 'upload-deadline': 'skipped' }), '2026-12-26').lost).toEqual([])
  })
})

describe('markMissed with the shipped playbook', () => {
  const plan = buildPlan(currentPlaybook(), emptyProfile(), { releaseDay })

  it('missing the DistroKid deadline loses the Spotify pitch deadline too', () => {
    const result = markMissed(plan, '2026-12-26')

    expect(result.lost.map((l) => [l.stepId, l.dropped])).toEqual([['distrokid-deadline', ['spotify-pitch-deadline']]])
    expect(result.lost[0]?.message).toMatch(/^You missed “Last day to upload to DistroKid” \(Fri 25 Dec\)\. .*Spotify pitch.*Taken off the plan: Last day to pitch to Spotify\.$/)
    expect(result.plan.steps.some((s) => s.stepId === 'spotify-pitch-deadline')).toBe(false)
  })
})

describe('todayView', () => {
  // Today is Sun 2026-12-20 (R−26).
  const today = '2026-12-20'
  const plan = withStatus(
    planOf([
      step('missed', -30), // 12-16
      step('late-open', -27), // 12-19, not yet marked missed
      step('late-done', -27, { title: 'done late' }),
      step('today-a', -26),
      step('today-done', -26),
      step('day-7', -19), // 12-27
      step('day-8', -18), // 12-28
      step('hard-soon', -22, { hardDeadline: true }), // 12-24
      step('hard-far', -7, { hardDeadline: true }), // 01-08
      step('hard-done', -10, { hardDeadline: true }),
      step('release', 0)
    ]),
    { missed: 'missed', 'late-done': 'done', 'today-done': 'done', 'hard-done': 'done' }
  )
  const ids = (steps: { stepId: string }[]) => steps.map((s) => s.stepId)

  it('splits the plan into today, overdue, the next 7 days and upcoming hard deadlines', () => {
    const view = todayView(plan, today)

    expect(ids(view.today)).toEqual(['today-a', 'today-done'])
    expect(ids(view.overdue)).toEqual(['missed', 'late-open'])
    expect(ids(view.nextWeek)).toEqual(['hard-soon', 'day-7'])
    expect(ids(view.hardDeadlines)).toEqual(['hard-soon', 'hard-far'])
  })

  it('counts down to release day and counts steps done', () => {
    expect(todayView(plan, today)).toMatchObject({ daysToRelease: 26, stepsDone: 3, stepsTotal: 11 })
  })

  it.each([
    [26, '26 days to release'],
    [1, '1 day to release'],
    [0, 'Release day is today'],
    [-1, '1 day since release'],
    [-9, '9 days since release']
  ])('says %i days as “%s”', (days, label) => {
    expect(countdownLabel(days)).toBe(label)
  })
})

describe('applyStepAction', () => {
  const plan = planOf([step('a', -28), step('b', -21), step('c', -14)])
  const byId = (p: ReleasePlan, id: string) => p.steps.find((s) => s.stepId === id)

  it.each([
    // action, status before, status after
    [{ kind: 'done' }, 'open', 'done'],
    [{ kind: 'done' }, 'missed', 'done'],
    [{ kind: 'skip' }, 'open', 'skipped'],
    [{ kind: 'skip' }, 'missed', 'skipped'],
    [{ kind: 'reopen' }, 'done', 'open'],
    [{ kind: 'reopen' }, 'skipped', 'open']
  ] as const)('%j turns a %s step %s', (action, before, after) => {
    const result = applyStepAction(withStatus(plan, { b: before }), 'b', action)

    expect(statuses(result)).toEqual({ a: 'open', b: after, c: 'open' })
  })

  it('moves a step to a new day, remembering the day it was due, and keeps the plan in date order', () => {
    const moved = applyStepAction(plan, 'a', { kind: 'move', to: '2026-12-29' })

    expect(byId(moved, 'a')).toMatchObject({ dueDate: '2026-12-29', movedFrom: '2026-12-18', offset: -28 })
    expect(moved.steps.map((s) => s.stepId)).toEqual(['b', 'a', 'c'])
  })

  it('remembers the first due day across several moves, and forgets it when moved back', () => {
    const twice = applyStepAction(applyStepAction(plan, 'a', { kind: 'move', to: '2026-12-20' }), 'a', { kind: 'move', to: '2026-12-22' })
    const back = applyStepAction(twice, 'a', { kind: 'move', to: '2026-12-18' })

    expect(byId(twice, 'a')).toMatchObject({ dueDate: '2026-12-22', movedFrom: '2026-12-18' })
    expect(byId(back, 'a')).toMatchObject({ dueDate: '2026-12-18', movedFrom: null })
  })

  it('reopens a missed step moved to a new day', () => {
    const moved = applyStepAction(withStatus(plan, { a: 'missed' }), 'a', { kind: 'move', to: '2027-01-02' })

    expect(byId(moved, 'a')).toMatchObject({ status: 'open', dueDate: '2027-01-02' })
  })

  it('refuses a step that is not in the plan, or a day that is not a calendar date', () => {
    expect(() => applyStepAction(plan, 'nope', { kind: 'done' })).toThrow(/no step "nope"/)
    expect(() => applyStepAction(plan, 'a', { kind: 'move', to: '2026-13-01' })).toThrow(/day/)
  })
})

describe('parseStepAction (from the window)', () => {
  it.each([
    [{ kind: 'done' }, { kind: 'done' }],
    [{ kind: 'skip', extra: 1 }, { kind: 'skip' }],
    [{ kind: 'reopen' }, { kind: 'reopen' }],
    [{ kind: 'move', to: '2027-01-02' }, { kind: 'move', to: '2027-01-02' }]
  ])('reads %j', (raw, expected) => {
    expect(parseStepAction(raw)).toEqual(expected)
  })

  it.each([[null], [{ kind: 'delete' }], [{ kind: 'move' }], [{ kind: 'move', to: 5 }]])('refuses %j', (raw) => {
    expect(() => parseStepAction(raw)).toThrow(/step action/)
  })
})

describe('stepActionWarning', () => {
  const plan = planOf([
    step('soft', -28),
    step('deadline', -21, { hardDeadline: true, title: 'Last day to upload', why: 'Upload later and the pitch is lost.' })
  ])
  const soft = plan.steps[0]!
  const deadline = plan.steps[1]!

  it.each([
    ['skipping a hard deadline', deadline, { kind: 'skip' }, '“Last day to upload” is a hard deadline. Upload later and the pitch is lost. Skip it anyway?'],
    [
      'moving a hard deadline later',
      deadline,
      { kind: 'move', to: '2026-12-28' },
      '“Last day to upload” is a hard deadline on Fri 25 Dec. Upload later and the pitch is lost. Move it to Mon 28 Dec anyway?'
    ],
    ['moving a hard deadline earlier', deadline, { kind: 'move', to: '2026-12-22' }, null],
    ['marking a hard deadline done', deadline, { kind: 'done' }, null],
    ['skipping an ordinary step', soft, { kind: 'skip' }, null],
    ['moving an ordinary step later', soft, { kind: 'move', to: '2027-01-01' }, null]
  ] as const)('%s', (_name, s, action, expected) => {
    expect(stepActionWarning(s, action)).toBe(expected)
  })

  it('warns against the real deadline even after the step was moved once', () => {
    const movedEarly = applyStepAction(plan, 'deadline', { kind: 'move', to: '2026-12-20' }).steps.find((s) => s.stepId === 'deadline')!

    expect(stepActionWarning(movedEarly, { kind: 'move', to: '2026-12-24' })).toBeNull()
    expect(stepActionWarning(movedEarly, { kind: 'move', to: '2026-12-26' })).toMatch(/hard deadline on Fri 25 Dec/)
  })
})

describe('moveReleaseDay', () => {
  const plan = planOf([step('a', -28), step('b', -21, { hardDeadline: true }), step('c', -7), step('d', 0), step('e', 7)])
  const dates = (p: ReleasePlan) => Object.fromEntries(p.steps.map((s) => [s.stepId, s.dueDate]))

  it.each([
    ['a week later', '2027-01-22', { a: '2026-12-25', b: '2027-01-01', c: '2027-01-15', d: '2027-01-22', e: '2027-01-29' }],
    ['two weeks earlier', '2027-01-01', { a: '2026-12-04', b: '2026-12-11', c: '2026-12-25', d: '2027-01-01', e: '2027-01-08' }],
    ['to the same day', '2027-01-15', { a: '2026-12-18', b: '2026-12-25', c: '2027-01-08', d: '2027-01-15', e: '2027-01-22' }]
  ] as const)('moving %s shifts every step by the same days', (_name, newDay, expected) => {
    const moved = moveReleaseDay(plan, newDay)

    expect(moved.releaseDay).toBe(newDay)
    expect(dates(moved)).toEqual(expected)
    expect(moved.steps.map((s) => s.offset)).toEqual([-28, -21, -7, 0, 7])
  })

  it('keeps done and skipped steps as they were, and reopens missed ones on their new day', () => {
    const moved = moveReleaseDay(withStatus(plan, { a: 'done', b: 'missed', c: 'skipped' }), '2027-01-22')

    expect(statuses(moved)).toEqual({ a: 'done', b: 'open', c: 'skipped', d: 'open', e: 'open' })
  })

  it('carries a step the owner moved along with it, keeping how far it was moved', () => {
    const own = { ...plan, steps: plan.steps.map((s) => (s.stepId === 'c' ? { ...s, dueDate: '2027-01-10', movedFrom: '2027-01-08' } : s)) }

    expect(moveReleaseDay(own, '2027-01-22').steps.find((s) => s.stepId === 'c')).toMatchObject({
      dueDate: '2027-01-17',
      movedFrom: '2027-01-15'
    })
  })

  it('refuses a day that is not a calendar date', () => {
    expect(() => moveReleaseDay(plan, '2027-02-30')).toThrow(/release day/i)
  })
})

describe('moving release day, then today passes', () => {
  it('a missed deadline reopens when release day moves late enough, and is not lost while it is still ahead', () => {
    const plan = buildPlan(currentPlaybook(), emptyProfile(), { releaseDay })
    const missed = markMissed(withStatus(plan, { 'upload-distrokid': 'done' }), '2026-12-26').plan
    const later = moveReleaseDay(missed, '2027-01-29')

    expect(later.steps.find((s) => s.stepId === 'distrokid-deadline')).toMatchObject({ dueDate: '2027-01-08', status: 'open' })
    expect(later.steps.find((s) => s.stepId === 'upload-distrokid')).toMatchObject({ dueDate: '2027-01-01', status: 'done' })
    expect(markMissed(later, '2026-12-26').lost).toEqual([])
  })
})
