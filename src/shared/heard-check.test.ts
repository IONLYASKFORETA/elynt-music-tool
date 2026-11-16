import { describe, expect, it } from 'vitest'
import type { TrackAnalysis } from './analysis'
import { moveBoundary, relabelSection, setTempo, shiftDownbeat } from './heard-check'

/** 120 BPM (a beat every 0.5 s), first downbeat at 1.0 s, 40 s long. */
function heard(): TrackAnalysis {
  const beats: number[] = []
  for (let t = 0; t < 40; t += 0.5) beats.push(t)
  return {
    analyzerVersion: 1,
    durationSeconds: 40,
    bpm: 120,
    beatsPerBar: 4,
    beats,
    downbeats: beats.filter((t) => t >= 1 && (t - 1) % 2 === 0),
    beatSource: 'dsp',
    constantTempo: true,
    sections: [
      { label: 'intro', start: 0, end: 9, startBar: 0, confidence: 0.9, source: 'heuristic' },
      { label: 'build', start: 9, end: 25, startBar: 4, confidence: 0.4, source: 'heuristic' },
      { label: 'drop', start: 25, end: 40, startBar: 12, confidence: 1, source: 'heuristic' }
    ],
    energy: { hz: 10, values: [0, 1] },
    mood: { label: 'euphoric', arousal: 0.3, valence: 0.5, key: null, keyConfidence: 0, source: 'heuristic' },
    notes: [],
    seconds: 0.1
  }
}

describe('dragging a section boundary', () => {
  it('snaps the dragged boundary to the nearest beat, moving both neighbouring sections', () => {
    const fixed = moveBoundary(heard(), 1, 12.2)

    expect(fixed.sections.map((s) => [s.label, s.start, s.end])).toEqual([
      ['intro', 0, 12],
      ['build', 12, 25],
      ['drop', 25, 40]
    ])
  })

  it("updates the bar a moved section starts on, and marks the owner's sections as sure", () => {
    // Bars start at 1, 3, 5, ... so 13 s is in the bar starting at 13 (bar index 6).
    const fixed = moveBoundary(heard(), 1, 13.1)

    expect(fixed.sections[1]!).toMatchObject({ start: 13, startBar: 6, confidence: 1, source: 'owner' })
    expect(fixed.sections[0]!).toMatchObject({ startBar: 0, confidence: 1, source: 'owner' })
    expect(fixed.sections[2]!).toMatchObject({ confidence: 1, source: 'heuristic' })
  })

  it('never lets a boundary pass a neighbouring one: each section keeps at least one beat', () => {
    const fixed = moveBoundary(heard(), 1, 30)

    expect(fixed.sections.map((s) => [s.start, s.end])).toEqual([
      [0, 24.5],
      [24.5, 25],
      [25, 40]
    ])
    expect(moveBoundary(heard(), 1, -3).sections[0]).toMatchObject({ start: 0, end: 0.5 })
  })
})

describe('relabelling a section', () => {
  it("gives the section the owner's label and leaves its times alone", () => {
    const fixed = relabelSection(heard(), 1, 'breakdown')

    expect(fixed.sections[1]!).toMatchObject({ label: 'breakdown', start: 9, end: 25, confidence: 1, source: 'owner' })
    expect(fixed.sections.map((s) => s.label)).toEqual(['intro', 'breakdown', 'drop'])
  })
})

describe('nudging the BPM', () => {
  it('rebuilds one constant beat grid at the new tempo, keeping the first downbeat where it was', () => {
    const fixed = setTempo(heard(), 125)
    const period = 60 / 125 // 0.48 s

    expect(fixed.bpm).toBe(125)
    expect(fixed.constantTempo).toBe(true)
    expect(fixed.beats[0]!).toBeCloseTo(0.04) // 1.0 - 2 beats
    expect(fixed.beats[2]!).toBeCloseTo(1)
    expect(fixed.beats[3]! - fixed.beats[2]!).toBeCloseTo(period)
    expect(fixed.beats.at(-1)!).toBeLessThan(40)
    expect(fixed.downbeats[0]!).toBeCloseTo(1)
    expect(fixed.downbeats[1]!).toBeCloseTo(1 + 4 * period)
  })

  it('moves each section boundary to the nearest beat of the new grid, and recounts its bar', () => {
    const fixed = setTempo(heard(), 125)

    // 9 s is nearest the beat at 1 + 17 * 0.48 = 9.16, in the bar starting at 1 + 16 * 0.48 (bar 4).
    expect(fixed.sections[1]!.start).toBeCloseTo(9.16)
    expect(fixed.sections[0]!.end).toBeCloseTo(9.16)
    expect(fixed.sections[1]!.startBar).toBe(4)
    expect(fixed.sections[0]!).toMatchObject({ start: 0, startBar: 0 })
    expect(fixed.sections[2]!.end).toBe(40)
  })
})

describe('nudging the downbeat', () => {
  it('slides the whole grid by a few milliseconds, and the sections follow', () => {
    const fixed = shiftDownbeat(heard(), 0.02)

    expect(fixed.bpm).toBe(120)
    expect(fixed.beats.slice(0, 3)).toEqual([0.02, 0.52, 1.02])
    expect(fixed.downbeats.slice(0, 2)).toEqual([1.02, 3.02])
    expect(fixed.sections.map((s) => s.start)).toEqual([0, 9.02, 25.02])
    expect(fixed.sections[1]!.startBar).toBe(4)
  })

  it('moves the one by a beat, so a different beat starts each bar', () => {
    const fixed = shiftDownbeat(heard(), -0.5)

    expect(fixed.beats.slice(0, 2)).toEqual([0, 0.5])
    expect(fixed.downbeats.slice(0, 2)).toEqual([0.5, 2.5])
  })
})
