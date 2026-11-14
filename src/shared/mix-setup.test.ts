import { describe, expect, it } from 'vitest'
import {
  addReferencePaths,
  DEFAULT_LOUDNESS_TARGET,
  defaultMixSetup,
  LOUDNESS_TARGETS,
  mixTargets,
  ROUGH_ELECTRONIC_CONTOUR,
  SUBGENRE_DYNAMICS
} from './mix-setup'
import { SUBGENRES } from './subgenres'

describe('loudness targets', () => {
  it('defaults to Club', () => {
    expect(DEFAULT_LOUDNESS_TARGET).toBe('club')
    expect(defaultMixSetup(1).loudnessTarget).toBe('club')
  })

  it('aims Club at about -9 to -6 LUFS and Streaming at about -14, both under -1 dBTP', () => {
    expect(LOUDNESS_TARGETS.club.integratedLufs).toEqual({ min: -9, max: -6 })
    const streaming = LOUDNESS_TARGETS.streaming.integratedLufs
    expect(streaming.min).toBeLessThanOrEqual(-14)
    expect(streaming.max).toBeGreaterThanOrEqual(-14)
    expect(LOUDNESS_TARGETS.club.truePeakCeilingDbtp).toBe(-1)
    expect(LOUDNESS_TARGETS.streaming.truePeakCeilingDbtp).toBe(-1)
  })
})

describe('mix targets', () => {
  it('lets the subgenre shift Club loudness and dynamics', () => {
    const deep = mixTargets({ ...defaultMixSetup(1), subgenre: 'deep-house' })
    const riddim = mixTargets({ ...defaultMixSetup(1), subgenre: 'riddim' })
    expect(riddim.integratedLufs.max).toBeGreaterThan(deep.integratedLufs.max)
    expect(riddim.minPlrDb).toBeLessThan(deep.minPlrDb)
  })

  it("uses Club's general range for a track with no subgenre", () => {
    expect(mixTargets(defaultMixSetup(1)).integratedLufs).toEqual({ min: -9, max: -6 })
  })

  it('keeps Streaming at about -14 whatever the subgenre, with the stricter ceiling when louder', () => {
    const t = mixTargets({ ...defaultMixSetup(1), subgenre: 'hardstyle', loudnessTarget: 'streaming' })
    expect(t.integratedLufs).toEqual(LOUDNESS_TARGETS.streaming.integratedLufs)
    expect(t.louderCeiling).toEqual({ aboveLufs: -14, truePeakCeilingDbtp: -2 })
  })

  it('compares tone with the references when there are any', () => {
    const tracks = [{ path: 'C:\\Refs\\A.wav', title: 'A' }]
    expect(mixTargets({ ...defaultMixSetup(1), referenceTracks: tracks }).tone).toEqual({
      kind: 'references',
      rough: false,
      tracks
    })
  })

  it('falls back to the rough electronic curve, labelled rough, with no references', () => {
    const tone = mixTargets(defaultMixSetup(1)).tone
    expect(tone).toMatchObject({ kind: 'rough-contour', rough: true, contour: ROUGH_ELECTRONIC_CONTOUR })
    expect(tone.kind === 'rough-contour' && tone.label).toMatch(/rough/i)
  })

  it('places every suite subgenre in a dynamics style', () => {
    for (const s of SUBGENRES) expect(SUBGENRE_DYNAMICS[s.id]).toBeDefined()
  })
})

describe('first-time setup', () => {
  it("starts from the artist profile's main subgenre", () => {
    expect(defaultMixSetup(1, 'bass-house').subgenre).toBe('bass-house')
    expect(defaultMixSetup(1).subgenre).toBeNull()
  })
})

describe('adding reference files', () => {
  it('adds audio files, skips duplicates and other files, and stops at 3', () => {
    const added = addReferencePaths(
      [{ path: 'C:\\Refs\\A.wav', title: 'A' }],
      ['c:\\refs\\a.WAV', 'C:\\Refs\\cover.jpg', 'C:\\Refs\\B.mp3', 'C:\\Refs\\C.flac', 'C:\\Refs\\D.wav']
    )
    expect(added.map((r) => r.title)).toEqual(['A', 'B', 'C'])
  })
})
