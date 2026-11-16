import { describe, expect, it } from 'vitest'
import { DEFAULT_REACTIVITY, PICKABLE_SIGNALS, reactionAt } from './reactivity'
import { NO_SIGNALS, type TrackSignals } from './signals'

const BEAT = 0.5

/** A kick on beat 4 (2.0 s) and a downbeat on bar 2 (2.0 s), straight onto the signal seam. */
const signals: TrackSignals = {
  ...NO_SIGNALS,
  events: { ...NO_SIGNALS.events, kick: [4 * BEAT], downbeat: [4 * BEAT], hihat: [1, 1.25, 1.5] }
}

describe('reactionAt', () => {
  it('turns a kick on a known beat into a medium pulse at that time', () => {
    const reaction = reactionAt({ reactsTo: 'kick', strength: 1 }, signals, 4 * BEAT + 0.01)
    expect(reaction.tier).toBe('medium')
    expect(reaction.amount).toBeGreaterThan(0.9)
    expect(reactionAt({ reactsTo: 'kick', strength: 1 }, signals, 4 * BEAT - 0.01).amount).toBe(0)
    expect(reactionAt({ reactsTo: 'kick', strength: 1 }, signals, 4 * BEAT + 0.5).amount).toBeLessThan(0.1)
  })

  it('scales the pulse by the strength', () => {
    const full = reactionAt({ reactsTo: 'kick', strength: 1 }, signals, 2.05).amount
    expect(reactionAt({ reactsTo: 'kick', strength: 0.5 }, signals, 2.05).amount).toBeCloseTo(full / 2)
  })

  it('keeps drops and downbeats hard, and energy slow', () => {
    expect(reactionAt({ reactsTo: 'downbeat', strength: 1 }, signals, 2).tier).toBe('hard')
    expect(reactionAt({ reactsTo: 'drop', strength: 1 }, signals, 2).tier).toBe('hard')
    expect(reactionAt({ reactsTo: 'energy', strength: 1 }, signals, 2).tier).toBe('slow')
    expect(reactionAt({ reactsTo: 'snare', strength: 1 }, signals, 2).tier).toBe('medium')
  })

  it('does nothing for a layer that reacts to nothing', () => {
    expect(reactionAt({ reactsTo: 'none', strength: 1 }, signals, 2).amount).toBe(0)
  })
})

describe('defaults', () => {
  it('ignores hi-hats by default', () => {
    expect(Object.values(DEFAULT_REACTIVITY).some((r) => r.reactsTo === 'hihat')).toBe(false)
  })

  it('still lets the owner pick hi-hats, and every other signal', () => {
    expect(PICKABLE_SIGNALS).toEqual(expect.arrayContaining(['kick', 'snare', 'bass', 'energy', 'downbeat', 'drop', 'hihat', 'none']))
  })
})
