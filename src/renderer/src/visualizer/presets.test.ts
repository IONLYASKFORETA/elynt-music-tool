import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { applyChange } from './controls'
import { MAX_ACTIVE_LAYERS, newLayer, type Scene } from './scene'
import { applyLayerPreset, applyScenePreset, applyVisionPreset, visionPreset } from './presets'
import {
  addMoment,
  addSectionLayer,
  defaultVision,
  setTransition,
  setVisionPalette,
  updateSectionLayer,
  visionFitsTrack,
  type Vision
} from './vision'

const section = (label: Section['label'], start: number, end: number): Section => ({
  label,
  start,
  end,
  startBar: 0,
  confidence: 1,
  source: 'heuristic'
})

/** 120 BPM in 4/4: a beat every half second, a bar every 2 seconds. */
const grid = (seconds: number) => {
  const beats = Array.from({ length: seconds * 2 }, (_, i) => i / 2)
  return { beats, downbeats: beats.filter((_, i) => i % 4 === 0) }
}

const NEON = ['#00ff99', '#ff0066', '#3300ff']

/** A source track: intro 0-16, build 16-32, drop 32-64, outro 64-80, with its drop dressed up. */
function sourceVision(): Vision {
  let v = defaultVision([section('intro', 0, 16), section('build', 16, 32), section('drop', 32, 64), section('outro', 64, 80)], 80, grid(80))
  v = addSectionLayer(v, 2, newLayer('chrome'))
  v = setTransition(v, 1, 'whiteFlash')
  v = setVisionPalette(v, NEON)
  v = addMoment(v, 'flash', 40, 'bar') // a quarter of the way into the drop
  return v
}

const kinds = (v: Vision, i: number) => v.sections[i]!.scene.layers.map((l) => l.kind)

describe('vision presets', () => {
  it('map onto another track by section kind, keeping that track’s own sections', () => {
    const preset = visionPreset(sourceVision())
    const target = defaultVision(
      [section('intro', 0, 8), section('drop', 8, 24), section('build', 24, 32), section('drop', 32, 48), section('outro', 48, 56)],
      56,
      grid(56)
    )
    const applied = applyVisionPreset(target, preset)

    expect(applied.sections.map((s) => [s.label, s.start, s.end])).toEqual([
      ['intro', 0, 8],
      ['drop', 8, 24],
      ['build', 24, 32],
      ['drop', 32, 48],
      ['outro', 48, 56]
    ])
    expect(applied.grid).toEqual(target.grid)
    expect(applied.palette).toEqual(NEON)
    // Both drops take the source drop's scene; the build takes the build's transition.
    expect(kinds(applied, 1)).toEqual(['ground', 'classic', 'chrome', 'finish'])
    expect(kinds(applied, 3)).toEqual(['ground', 'classic', 'chrome', 'finish'])
    expect(kinds(applied, 0)).toEqual(['ground', 'classic', 'finish'])
    expect(applied.sections[2]!.transition).toBe('whiteFlash')
    expect(applied.sections[1]!.transition).toBe('cut')
  })

  it('carry the video’s and each section’s intensity (V14)', () => {
    let source = applyChange(sourceVision(), { op: 'set', section: null, layer: null, param: 'intensity', value: 0.7 })
    source = applyChange(source, { op: 'set', section: 2, layer: null, param: 'intensity', value: 1.8 })
    const target = defaultVision([section('intro', 0, 8), section('drop', 8, 24)], 24, grid(24))
    const applied = applyVisionPreset(target, visionPreset(source))
    expect(applied.intensity).toBe(0.7)
    expect(applied.sections.map((s) => s.intensity ?? 1)).toEqual([1, 1.8])
  })

  it('places moments at the same point of each matching section, on the new track’s beats', () => {
    const preset = visionPreset(sourceVision())
    const target = defaultVision([section('intro', 0, 8), section('drop', 8, 24), section('drop', 24, 40)], 40, grid(40))
    const applied = applyVisionPreset(target, preset)
    // A quarter into each drop: 8 + 4 and 24 + 4.
    expect(applied.moments.map((m) => [m.kind, m.at])).toEqual([
      ['flash', 12],
      ['flash', 28]
    ])
    expect(new Set(applied.moments.map((m) => m.id)).size).toBe(2)
  })

  it('takes the section at the same point in the track when the source has none of that kind', () => {
    const preset = visionPreset(sourceVision())
    // A breakdown in the back half of the track, where the source had its drop.
    const target = defaultVision([section('intro', 0, 20), section('breakdown', 20, 30), section('outro', 30, 40)], 40, grid(40))
    expect(kinds(applyVisionPreset(target, preset), 1)).toEqual(['ground', 'classic', 'chrome', 'finish'])
  })

  it('keeps the target track’s credits', () => {
    const target = { ...defaultVision([section('drop', 0, 10)], 10), credits: { title: 'Night Bus', artist: 'ELYNT' } }
    expect(applyVisionPreset(target, visionPreset(sourceVision())).credits).toEqual({ title: 'Night Bus', artist: 'ELYNT' })
  })

  it('is a copy, not a link to the source vision', () => {
    const source = sourceVision()
    const preset = visionPreset(source)
    const edited = updateSectionLayer(source, 2, 2, { reactivity: { reactsTo: 'kick', strength: 0.1 } })
    expect(edited).not.toEqual(source)
    // Applying the preset back over the edit brings the saved look back.
    expect(applyVisionPreset(edited, preset).sections[2]!.scene).toEqual(source.sections[2]!.scene)
  })
})

describe('scene presets', () => {
  it('replace one section’s scene and leave the others', () => {
    const scene: Scene = { layers: [newLayer('ground'), newLayer('glitch'), newLayer('lightPillar'), newLayer('finish')] }
    const v = defaultVision([section('intro', 0, 8), section('drop', 8, 16)], 16)
    const applied = applyScenePreset(v, 1, scene)
    expect(kinds(applied, 1)).toEqual(['ground', 'glitch', 'lightPillar', 'finish'])
    expect(applied.sections[0]).toEqual(v.sections[0])
  })
})

describe('layer presets', () => {
  const v = defaultVision([section('drop', 0, 8)], 8)
  const hot = { ...newLayer('chrome'), reactivity: { reactsTo: 'kick' as const, strength: 1 } }

  it('add the layer to a section', () => {
    expect(kinds(applyLayerPreset(v, 0, hot), 0)).toEqual(['ground', 'classic', 'chrome', 'finish'])
  })

  it('or replace the layer picked', () => {
    const applied = applyLayerPreset(v, 0, hot, 1)
    expect(kinds(applied, 0)).toEqual(['ground', 'chrome', 'finish'])
    expect(applied.sections[0]!.scene.layers[1]).toEqual(hot)
  })

  it('still keep to the active-layer limit', () => {
    let full = v
    while (kinds(full, 0).length < MAX_ACTIVE_LAYERS + 2) full = addSectionLayer(full, 0, newLayer('glitch'))
    expect(() => applyLayerPreset(full, 0, hot)).toThrow('at most')
  })
})

describe('a stored vision on a track', () => {
  const spans = [section('intro', 0, 8), section('drop', 8, 16)]
  const stored = addMoment(defaultVision(spans, 16, grid(16)), 'flash', 10, 'bar')

  it('still fits while the track’s sections and grid are the same', () => {
    expect(visionFitsTrack(stored, spans, grid(16), 16)).toBe(true)
  })

  it('no longer fits once a section moves, is relabelled, or the grid changes', () => {
    expect(visionFitsTrack(stored, [section('intro', 0, 6), section('drop', 6, 16)], grid(16), 16)).toBe(false)
    expect(visionFitsTrack(stored, [section('intro', 0, 8), section('build', 8, 16)], grid(16), 16)).toBe(false)
    expect(visionFitsTrack(stored, spans, grid(20), 16)).toBe(false)
  })

  it('a track with no sections fits the one-section vision made for it', () => {
    expect(visionFitsTrack(defaultVision([], 30), [], { beats: [], downbeats: [] }, 30)).toBe(true)
  })
})
