import { describe, expect, it } from 'vitest'
import type { Playbook, PlaybookStep } from './playbook'
import { currentPlaybook } from './playbooks'
import { emptyProfile } from './profile'
import { buildPlan, stepsByPhase, type NewRelease } from './release-plan'

/** A normal Friday release: 15 January 2027 is a Friday. */
const fridayRelease: NewRelease = { releaseDay: '2027-01-15' }

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

function playbook(steps: PlaybookStep[], version = 1): Playbook {
  return { version, steps }
}

describe('buildPlan: a normal Friday release', () => {
  it.each([
    // offset, phase, expected date (counted from Friday 2027-01-15)
    [-42, 'prep', '2026-12-04'],
    [-29, 'prep', '2026-12-17'],
    [-28, 'setup', '2026-12-18'],
    [-21, 'setup', '2026-12-25'],
    [-15, 'setup', '2026-12-31'],
    [-14, 'pre-release', '2027-01-01'],
    [-7, 'pre-release', '2027-01-08'],
    [-1, 'pre-release', '2027-01-14'],
    [0, 'release-day', '2027-01-15'],
    [1, 'post-release', '2027-01-16'],
    [14, 'post-release', '2027-01-29'],
    [28, 'post-release', '2027-02-12']
  ] as const)('dates a step at R%i in %s on %s', (offset, phase, date) => {
    const plan = buildPlan(playbook([step('s', { phase, when: { offset } })]), emptyProfile(), fridayRelease)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({ stepId: 's', offset, phase, dueDate: date, status: 'open', movedFrom: null })
  })
})

describe('buildPlan: order and fixed content', () => {
  it('lists steps in date order, keeping playbook order on the same day', () => {
    const plan = buildPlan(
      playbook([
        step('late', { phase: 'post-release', when: { offset: 7 } }),
        step('early', { phase: 'prep', when: { offset: -42 } }),
        step('same-day-a', { phase: 'release-day', when: { offset: 0 } }),
        step('same-day-b', { phase: 'release-day', when: { offset: 0 } })
      ]),
      emptyProfile(),
      fridayRelease
    )

    expect(plan.steps.map((s) => s.stepId)).toEqual(['early', 'same-day-a', 'same-day-b', 'late'])
  })

  it('dates a rule step on the day the rule suggests', () => {
    const plan = buildPlan(
      playbook([step('pitch', { phase: 'setup', when: { rule: 'in-upcoming', offset: -25 } })]),
      emptyProfile(),
      fridayRelease
    )

    expect(plan.steps[0]).toMatchObject({ offset: -25, dueDate: '2026-12-21' })
  })

  it('records the playbook version and carries each step’s fixed What, Why, How and tag', () => {
    const pitch = step('pitch', {
      phase: 'pre-release',
      lane: 'spotify',
      when: { offset: -7 },
      hardDeadline: true,
      tag: 'rule'
    })
    const plan = buildPlan(playbook([pitch], 3), emptyProfile(), fridayRelease)

    expect(plan.playbookVersion).toBe(3)
    expect(plan.releaseDay).toBe('2027-01-15')
    expect(plan.steps[0]).toMatchObject({ hardDeadline: true, step: pitch })
  })
})

describe('buildPlan with the shipped playbook: a normal Friday release on 2027-01-15', () => {
  const plan = buildPlan(currentPlaybook(), emptyProfile(), fridayRelease)
  const byId = (id: string) => plan.steps.find((s) => s.stepId === id)

  it.each([
    ['pick-release-day', '2026-12-04', 'prep', false],
    ['upload-distrokid', '2026-12-18', 'setup', false],
    ['spotify-pitch', '2026-12-21', 'setup', false],
    ['distrokid-deadline', '2026-12-25', 'setup', true],
    ['start-teasers', '2027-01-01', 'pre-release', false],
    ['spotify-pitch-deadline', '2027-01-08', 'pre-release', true],
    ['release-day-posts', '2027-01-15', 'release-day', false],
    ['check-in-d7', '2027-01-22', 'post-release', false],
    ['soundcloud-boost-deadline', '2027-01-29', 'post-release', true],
    ['check-in-d28', '2027-02-12', 'post-release', false]
  ] as const)('dates %s on %s in %s (hard deadline: %s)', (id, date, phase, hard) => {
    expect(byId(id)).toMatchObject({ dueDate: date, phase, hardDeadline: hard, status: 'open' })
  })

  it('runs from R−42 to R+28 with every step open and in date order', () => {
    const dates = plan.steps.map((s) => s.dueDate)

    expect(dates[0]).toBe('2026-12-04')
    expect(dates.at(-1)).toBe('2027-02-12')
    expect([...dates].sort()).toEqual(dates)
    expect(plan.steps.every((s) => s.status === 'open' && s.movedFrom === null)).toBe(true)
  })
})

describe('stepsByPhase (the Timeline)', () => {
  it('groups every step under its phase, listing all five phases in order even when empty', () => {
    const plan = buildPlan(
      playbook([
        step('boost', { phase: 'post-release', when: { offset: 14 } }),
        step('upload', { phase: 'setup', when: { offset: -28 } }),
        step('master', { phase: 'prep', when: { offset: -42 } }),
        step('pitch', { phase: 'setup', when: { offset: -21 } })
      ]),
      emptyProfile(),
      fridayRelease
    )

    expect(stepsByPhase(plan).map((g) => [g.phase, g.from, g.to, g.steps.map((s) => s.stepId)])).toEqual([
      ['prep', '2026-12-04', '2026-12-17', ['master']],
      ['setup', '2026-12-18', '2026-12-31', ['upload', 'pitch']],
      ['pre-release', '2027-01-01', '2027-01-14', []],
      ['release-day', '2027-01-15', '2027-01-15', []],
      ['post-release', '2027-01-16', '2027-02-12', ['boost']]
    ])
  })
})
