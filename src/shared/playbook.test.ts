import { describe, expect, it } from 'vitest'
import { parsePlaybook } from './playbook'
import { currentPlaybook, playbookByVersion, PLAYBOOKS } from './playbooks'

function rawStep(id: string, changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    phase: 'setup',
    lane: 'distribution',
    when: { offset: -28 },
    hardDeadline: false,
    tag: 'rule',
    title: 'Upload to DistroKid',
    what: 'w',
    why: 'y',
    how: 'h',
    eligibility: {},
    draftKinds: [],
    dependsOn: [],
    ...changes
  }
}

describe('parsePlaybook', () => {
  it('reads a well-formed playbook file', () => {
    const playbook = parsePlaybook({ version: 2, steps: [rawStep('upload'), rawStep('pitch', { dependsOn: ['upload'] })] })

    expect(playbook.version).toBe(2)
    expect(playbook.steps.map((s) => s.id)).toEqual(['upload', 'pitch'])
  })

  it.each([
    ['a version that is not a whole number above 0', { version: 0, steps: [rawStep('a')] }, /version/],
    ['two steps with one id', { version: 1, steps: [rawStep('a'), rawStep('a')] }, /Two steps share the id "a"/],
    ['an unknown phase', { version: 1, steps: [rawStep('a', { phase: 'later' })] }, /"a".*phase/],
    ['an unknown lane', { version: 1, steps: [rawStep('a', { lane: 'radio' })] }, /"a".*lane/],
    ['an unknown tag', { version: 1, steps: [rawStep('a', { tag: 'maybe' })] }, /"a".*tag/],
    ['an unknown draft kind', { version: 1, steps: [rawStep('a', { draftKinds: ['poem'] })] }, /"a".*draft kind/],
    ['an unknown rule', { version: 1, steps: [rawStep('a', { when: { rule: 'someday', offset: -25 } })] }, /"a".*rule/],
    ['a missing offset', { version: 1, steps: [rawStep('a', { when: {} })] }, /"a".*offset/],
    ['missing coaching text', { version: 1, steps: [rawStep('a', { how: '' })] }, /"a".*how/],
    [
      'an offset outside its phase',
      { version: 1, steps: [rawStep('a', { phase: 'prep', when: { offset: -21 } })] },
      /"a".*R−21.*setup/
    ],
    [
      'a dependency on a step that is not in the playbook',
      { version: 1, steps: [rawStep('a', { dependsOn: ['ghost'] })] },
      /"a".*"ghost"/
    ]
  ])('rejects %s', (_name, raw, message) => {
    expect(() => parsePlaybook(raw)).toThrow(message)
  })
})

describe('the shipped playbooks', () => {
  it('have unique versions, and the current one is the newest', () => {
    const versions = PLAYBOOKS.map((p) => p.version)

    expect(new Set(versions).size).toBe(versions.length)
    expect(currentPlaybook().version).toBe(Math.max(...versions))
    expect(playbookByVersion(1)?.version).toBe(1)
    expect(playbookByVersion(999)).toBeNull()
  })

  it('mark exactly the three hard deadlines: DistroKid at R−21, Spotify pitch at R−7, SoundCloud boost at R+14', () => {
    const hard = currentPlaybook()
      .steps.filter((s) => s.hardDeadline)
      .map((s) => [s.when.offset, s.lane])

    expect(hard).toEqual([
      [-21, 'distribution'],
      [-7, 'spotify'],
      [14, 'soundcloud']
    ])
  })

  it('have a step in every phase and every lane, all with What, Why and How', () => {
    const steps = currentPlaybook().steps

    for (const phase of ['prep', 'setup', 'pre-release', 'release-day', 'post-release']) {
      expect(steps.some((s) => s.phase === phase), phase).toBe(true)
    }
    for (const lane of ['distribution', 'spotify', 'social', 'outreach', 'soundcloud', 'check-ins']) {
      expect(steps.some((s) => s.lane === lane), lane).toBe(true)
    }
  })

  it('never suggest paying for playlist placement or guaranteed streams', () => {
    for (const s of currentPlaybook().steps) {
      expect(`${s.title} ${s.what} ${s.how}`, s.id).not.toMatch(/guaranteed (streams|placement)|pay for (a )?placement/i)
    }
  })
})
