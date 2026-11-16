import { describe, expect, it } from 'vitest'
import type { MoodDetail, Section, TrackAnalysis } from './analysis'
import { describeAnswers, tapQuestions } from './tap-questions'

const section = (label: Section['label'], start: number, end: number, confidence = 1, source: Section['source'] = 'heuristic'): Section => ({
  label,
  start,
  end,
  startBar: Math.round(start / 2),
  confidence,
  source
})

function analysis(overrides: Partial<TrackAnalysis> = {}): TrackAnalysis {
  return {
    analyzerVersion: 1,
    durationSeconds: 120,
    bpm: 120,
    beatsPerBar: 4,
    beats: [],
    downbeats: [],
    beatSource: 'dsp',
    constantTempo: true,
    sections: [section('intro', 0, 30), section('build', 30, 60), section('drop', 60, 120)],
    energy: { hz: 1, values: [] },
    mood: { label: 'dark', arousal: 0.9, valence: -0.9, key: 'A minor', keyConfidence: 0.8, source: 'heuristic' },
    notes: [],
    seconds: 1,
    ...overrides
  }
}

const detail = (valence: number, arousal: number): MoodDetail => ({
  source: 'gemini',
  model: 'gemini-3-flash',
  label: 'euphoric',
  arousal,
  valence,
  words: [],
  summary: '',
  sections: []
})

describe('tap questions', () => {
  it('asks nothing when the analysis is sure of the mood, the energy and every section', () => {
    expect(tapQuestions(analysis())).toEqual([])
  })

  it('asks "dark or euphoric drop?" when the mood sits between dark and bright', () => {
    const questions = tapQuestions(analysis({ mood: { ...analysis().mood, valence: 0.05 } }))

    expect(questions.map((q) => q.id)).toEqual(['drop-mood'])
    expect(questions[0]!.prompt).toBe('Dark or euphoric drop?')
    expect(questions[0]!.options.map((o) => o.id)).toEqual(['dark', 'euphoric', 'both'])
  })

  it('trusts a Gemini listen over the coarse read, so a clear Gemini valence asks nothing', () => {
    const unsure = { ...analysis().mood, valence: 0 }
    expect(tapQuestions(analysis({ mood: unsure, moodDetail: detail(0.85, 0.9) }))).toEqual([])
  })

  it('asks whether an unsure drop is really the drop, naming where it starts', () => {
    const sections = [section('intro', 0, 30), section('build', 30, 62.5), section('drop', 62.5, 120, 0.3)]
    const [question] = tapQuestions(analysis({ sections }))

    expect(question!.id).toBe('section-2')
    expect(question!.prompt).toBe('Is 1:02 the drop, or still building?')
  })

  it("doesn't ask about a section the owner set in the What I heard check", () => {
    const sections = [section('intro', 0, 30), section('build', 30, 60), section('drop', 60, 120, 0.2, 'owner')]
    expect(tapQuestions(analysis({ sections }))).toEqual([])
  })

  it('asks at most three, the least sure first', () => {
    const sections = [
      section('intro', 0, 20, 0.5),
      section('build', 20, 40, 0.35),
      section('drop', 40, 60, 0.1),
      section('breakdown', 60, 80, 0.25),
      section('drop', 80, 120, 0.2)
    ]
    const mood = { ...analysis().mood, valence: 0.3, arousal: 0 }
    const questions = tapQuestions(analysis({ sections, mood }))

    // Unsureness: drop at 40 s 0.9, energy 1.0, drop at 80 s 0.8, breakdown 0.75, mood 0.7 ...
    expect(questions.map((q) => q.id)).toEqual(['drop-energy', 'section-2', 'section-4'])
  })
})

describe('answers for Claude', () => {
  it('spells out each answered question and its option, and leaves skipped ones out', () => {
    const questions = tapQuestions(analysis({ mood: { ...analysis().mood, valence: 0, arousal: 0 } }))

    expect(describeAnswers(questions, { 'drop-mood': 'dark' })).toEqual([
      'Dark or euphoric drop? Dark: menacing, heavy, low-lit.'
    ])
  })

  it('ignores answers to questions that were not asked or options that do not exist', () => {
    const questions = tapQuestions(analysis({ mood: { ...analysis().mood, valence: 0 } }))
    expect(describeAnswers(questions, { 'drop-mood': 'sideways', nope: 'dark' })).toEqual([])
  })
})
