import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { BAND_COUNT } from './audio-features'
import { DEFAULT_PALETTE, packPalette } from './palette'
import { MAX_ACTIVE_LAYERS, newLayer, PALETTE_OFFSET, type ClassicLayer } from './scene'
import { NO_SIGNALS, type TrackSignals } from './signals'
import {
  addSectionLayer,
  defaultVision,
  fitsSections,
  planVisionFrame,
  removeSectionLayer,
  sectionIndexAt,
  sceneAt,
  setVisionPalette,
  updateSectionLayer
} from './vision'

const section = (label: Section['label'], start: number, end: number): Section => ({
  label,
  start,
  end,
  startBar: 0,
  confidence: 1,
  source: 'heuristic'
})
const sections = [section('intro', 0, 16), section('build', 16, 32), section('drop', 32, 64), section('outro', 64, 80)]
const features = { bands: new Float32Array(BAND_COUNT).fill(0.5), energy: 0.5 }
const size = { width: 640, height: 360 }

describe('defaultVision', () => {
  it('gives every section of the track its own scene', () => {
    const vision = defaultVision(sections, 80)
    expect(vision.sections.map((s) => [s.label, s.start, s.end])).toEqual([
      ['intro', 0, 16],
      ['build', 16, 32],
      ['drop', 32, 64],
      ['outro', 64, 80]
    ])
    expect(vision.sections[0]!.scene).not.toBe(vision.sections[1]!.scene)
  })

  it('treats a track with no sections yet as one section, start to end', () => {
    const vision = defaultVision([], 200)
    expect(vision.sections).toHaveLength(1)
    expect(vision.sections[0]).toMatchObject({ start: 0, end: 200 })
  })

  it('lets a drop hit harder than an intro', () => {
    const vision = defaultVision(sections, 80)
    const strength = (i: number) => vision.sections[i]!.scene.layers.find((l) => l.kind === 'classic')!.reactivity.strength
    expect(strength(2)).toBeGreaterThan(strength(0))
  })

  it('never reacts to hi-hats by default', () => {
    const vision = defaultVision(sections, 80)
    const all = vision.sections.flatMap((s) => s.scene.layers.map((l) => l.reactivity.reactsTo))
    expect(all).not.toContain('hihat')
  })
})

describe('switching scenes', () => {
  it('cuts to the next section’s scene exactly at the boundary', () => {
    const vision = defaultVision(sections, 80)
    expect(sectionIndexAt(vision, 31.999)).toBe(1)
    expect(sectionIndexAt(vision, 32)).toBe(2)
    expect(sceneAt(vision, 32)).toBe(vision.sections[2]!.scene)
  })

  it('holds the first scene before the start and the last one past the end', () => {
    const vision = defaultVision(sections, 80)
    expect(sectionIndexAt(vision, -1)).toBe(0)
    expect(sectionIndexAt(vision, 500)).toBe(3)
  })

  it('draws each section from its own scene and reads the same signals for preview and export', () => {
    let vision = defaultVision(sections, 80)
    vision = addSectionLayer(vision, 2, newLayer('classic'))
    const kicks: TrackSignals = { ...NO_SIGNALS, events: { ...NO_SIGNALS.events, kick: [31.99, 32] } }
    expect(planVisionFrame(vision, features, 31.99, size, kicks).passes).toHaveLength(3)
    const atDrop = planVisionFrame(vision, features, 32.01, size, kicks)
    expect(atDrop.passes).toHaveLength(4)
    expect(planVisionFrame(vision, features, 32.01, size, kicks)).toEqual(atDrop)
  })
})

describe('editing a section', () => {
  it('changes what one layer of one section reacts to, and nothing else', () => {
    const vision = defaultVision(sections, 80)
    const next = updateSectionLayer(vision, 1, 1, { reactivity: { reactsTo: 'snare', strength: 0.3 } })
    expect((next.sections[1]!.scene.layers[1] as ClassicLayer).reactivity).toEqual({ reactsTo: 'snare', strength: 0.3 })
    expect(next.sections[0]).toBe(vision.sections[0])
    expect(vision.sections[1]!.scene.layers[1]!.reactivity.reactsTo).toBe('kick')
  })

  it('stops a section at five active layers', () => {
    let vision = defaultVision(sections, 80)
    while (vision.sections[0]!.scene.layers.filter((l) => l.kind === 'classic').length < MAX_ACTIVE_LAYERS) {
      vision = addSectionLayer(vision, 0, newLayer('classic'))
    }
    expect(() => addSectionLayer(vision, 0, newLayer('classic'))).toThrow()
    expect(addSectionLayer(vision, 1, newLayer('classic')).sections[1]!.scene.layers).toHaveLength(4)
  })

  it('takes a layer out of a section', () => {
    const vision = removeSectionLayer(defaultVision(sections, 80), 0, 1)
    expect(vision.sections[0]!.scene.layers.map((l) => l.kind)).toEqual(['ground', 'finish'])
  })
})

describe("a vision's palette", () => {
  const rgb = ['#ff0000', '#00ff00', '#0000ff']

  it('starts from the house palette', () => {
    expect(defaultVision(sections, 80).palette).toEqual(DEFAULT_PALETTE)
  })

  it('reaches every layer of every frame', () => {
    const vision = setVisionPalette(defaultVision(sections, 80), rgb)
    const plan = planVisionFrame(vision, features, 40, size, NO_SIGNALS)
    for (const pass of plan.passes) expect(Array.from(pass.uniforms.slice(PALETTE_OFFSET))).toEqual(Array.from(packPalette(rgb)))
  })

  it('refuses a palette of the wrong size', () => {
    expect(() => setVisionPalette(defaultVision(sections, 80), ['#ff0000'])).toThrow(/3 to 5/)
  })

  it('survives changes to the scenes', () => {
    let vision = setVisionPalette(defaultVision(sections, 80), rgb)
    vision = addSectionLayer(vision, 0, newLayer('glitch'))
    vision = updateSectionLayer(vision, 0, 1, { reactivity: { reactsTo: 'none', strength: 0 } })
    vision = removeSectionLayer(vision, 0, 1)
    expect(vision.palette).toEqual(rgb)
  })
})

describe('restoring a saved vision', () => {
  it('fits when its sections are the ones the analysis has now', () => {
    expect(fitsSections(defaultVision(sections, 80), sections)).toBe(true)
  })

  it('does not fit once a section was moved or relabelled, or for something that is not a vision', () => {
    const moved = [section('intro', 0, 18), section('build', 18, 32), section('drop', 32, 64), section('outro', 64, 80)]
    const relabelled = [section('intro', 0, 16), section('drop', 16, 32), section('drop', 32, 64), section('outro', 64, 80)]

    expect(fitsSections(defaultVision(sections, 80), moved)).toBe(false)
    expect(fitsSections(defaultVision(sections, 80), relabelled)).toBe(false)
    expect(fitsSections({ palette: [] }, sections)).toBe(false)
    expect(fitsSections(null, sections)).toBe(false)
  })
})
