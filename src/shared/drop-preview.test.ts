import { describe, expect, it } from 'vitest'
import type { Section, TrackAnalysis } from './analysis'
import { dropWindow, nextInDropTour } from './drop-preview'

const section = (label: Section['label'], start: number, end: number): Section => ({
  label,
  start,
  end,
  startBar: 0,
  confidence: 1,
  source: 'heuristic'
})

/** 120 BPM, so a bar is 2 s; 100 s long; energy rises in the second half. */
function analysis(sections: Section[]): TrackAnalysis {
  return {
    analyzerVersion: 1,
    durationSeconds: 100,
    bpm: 120,
    beatsPerBar: 4,
    beats: [],
    downbeats: [],
    beatSource: 'dsp',
    constantTempo: true,
    sections,
    energy: { hz: 1, values: Array.from({ length: 100 }, (_, i) => (i >= 50 && i < 70 ? 0.9 : 0.3)) },
    mood: { label: 'dark', arousal: 0, valence: 0, key: null, keyConfidence: 0, source: 'heuristic' },
    notes: [],
    seconds: 1
  }
}

describe('the drop preview window', () => {
  it('runs from 2 bars before the first drop to 8 bars into it', () => {
    const a = analysis([section('intro', 0, 30), section('drop', 30, 80), section('outro', 80, 100)])
    expect(dropWindow(a)).toEqual({ start: 26, end: 46 })
  })

  it('stops at the end of a drop shorter than 8 bars', () => {
    const a = analysis([section('build', 0, 30), section('drop', 30, 40), section('outro', 40, 100)])
    expect(dropWindow(a)).toEqual({ start: 26, end: 40 })
  })

  it('uses the loudest section when no section is labelled a drop', () => {
    const a = analysis([section('intro', 0, 50), section('breakdown', 50, 70), section('outro', 70, 100)])
    expect(dropWindow(a)).toEqual({ start: 46, end: 66 })
  })

  it('never starts before the track does', () => {
    const a = analysis([section('drop', 0, 100)])
    expect(dropWindow(a)).toEqual({ start: 0, end: 16 })
  })
})

describe('the drop tour', () => {
  it('plays the three visions one after another, then stops', () => {
    expect(nextInDropTour(0, 3)).toBe(1)
    expect(nextInDropTour(1, 3)).toBe(2)
    expect(nextInDropTour(2, 3)).toBeNull()
  })
})
