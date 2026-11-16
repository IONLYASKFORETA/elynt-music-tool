import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { BAND_COUNT } from './audio-features'
import { DEFAULT_PALETTE, packPalette } from './palette'
import { MAX_ACTIVE_LAYERS, newLayer, PALETTE_OFFSET, type ClassicLayer } from './scene'
import { NO_SIGNALS, type TrackSignals } from './signals'
import {
  addMoment,
  addSectionLayer,
  defaultVision,
  moveMoment,
  planVisionFrame,
  removeMoment,
  removeSectionLayer,
  sectionIndexAt,
  sceneAt,
  setTransition,
  setVisionPalette,
  transitionWindow,
  updateSectionLayer,
  type Vision
} from './vision'
import { TRANSITION_STYLES, type TransitionStyle } from './transitions'

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

// 120 BPM, 4 beats a bar: a beat every 0.5 s, a bar every 2 s, for the whole 80 s.
const grid = {
  beats: Array.from({ length: 160 }, (_, i) => i * 0.5),
  downbeats: Array.from({ length: 40 }, (_, i) => i * 2)
}

describe('moments', () => {
  it('pins a new moment to the nearest beat or bar', () => {
    const vision = defaultVision(sections, 80, grid)
    expect(addMoment(vision, 'flash', 10.3, 'beat').moments.map((m) => m.at)).toEqual([10.5])
    expect(addMoment(vision, 'flash', 10.3, 'bar').moments.map((m) => m.at)).toEqual([10])
  })

  it('moves a moment to a new beat and keeps them in time order', () => {
    let vision = defaultVision(sections, 80, grid)
    vision = addMoment(addMoment(vision, 'flash', 10, 'beat'), 'glitch', 20, 'beat')
    const flash = vision.moments[0]!.id
    vision = moveMoment(vision, flash, 24.8, 'beat')
    expect(vision.moments.map((m) => [m.kind, m.at])).toEqual([
      ['glitch', 20],
      ['flash', 25]
    ])
    expect(moveMoment(vision, flash, 24.8, 'bar').moments.find((m) => m.id === flash)!.at).toBe(24)
  })

  it('deletes one moment and leaves the rest', () => {
    let vision = addMoment(addMoment(defaultVision(sections, 80, grid), 'flash', 10, 'beat'), 'pillar', 12, 'bar')
    vision = removeMoment(vision, vision.moments[0]!.id)
    expect(vision.moments.map((m) => m.kind)).toEqual(['pillar'])
  })

  it('fires on its beat, on top of the scene, and dies away within the next bar', () => {
    const vision = addMoment(defaultVision(sections, 80, grid), 'flash', 10, 'beat')
    const kinds = (t: number) => planVisionFrame(vision, features, t, size, NO_SIGNALS).passes.map((p) => p.kind)
    const flashAmount = (t: number) => planVisionFrame(vision, features, t, size, NO_SIGNALS).passes.at(-1)!.uniforms[4]!
    expect(kinds(9.99)).toEqual(['ground', 'classic', 'finish'])
    expect(kinds(10)).toEqual(['ground', 'classic', 'finish', 'flash'])
    expect(flashAmount(10)).toBe(1)
    expect(flashAmount(10.25)).toBeGreaterThan(0)
    expect(flashAmount(10.25)).toBeLessThan(flashAmount(10.1))
    expect(kinds(12)).toEqual(['ground', 'classic', 'finish'])
  })

  it('draws each kind of moment with its own pass', () => {
    let vision = defaultVision(sections, 80, grid)
    vision = addMoment(vision, 'glitch', 4, 'beat')
    vision = addMoment(vision, 'bleed', 6, 'beat')
    vision = addMoment(vision, 'pillar', 8, 'beat')
    const last = (t: number) => planVisionFrame(vision, features, t, size, NO_SIGNALS).passes.at(-1)!.kind
    expect([last(4.05), last(6.05), last(8.05)]).toEqual(['glitch', 'colorBleed', 'lightPillar'])
  })

  it('stacks moments that overlap, oldest first', () => {
    let vision = defaultVision(sections, 80, grid)
    vision = addMoment(addMoment(vision, 'glitch', 4, 'beat'), 'flash', 4.5, 'beat')
    const kinds = planVisionFrame(vision, features, 4.6, size, NO_SIGNALS).passes.map((p) => p.kind)
    expect(kinds.slice(-2)).toEqual(['glitch', 'flash'])
  })

  it('snaps to a 120 BPM grid from 0 when the track has no beats yet', () => {
    const vision = defaultVision(sections, 80)
    expect(addMoment(vision, 'flash', 3.3, 'bar').moments[0]!.at).toBe(4)
  })
})

describe('transitions', () => {
  it('cuts on the downbeat nearest the boundary by default', () => {
    const offGrid = [section('intro', 0, 15.7), section('build', 15.7, 32), section('drop', 32, 80)]
    const vision = defaultVision(offGrid, 80, grid)
    expect(vision.sections[0]!.transition).toBe('cut')
    expect(transitionWindow(vision, 0)).toEqual({ start: 16, at: 16, end: 16 })
    expect(sceneAt(vision, 15.9)).toBe(vision.sections[0]!.scene)
    expect(sceneAt(vision, 16)).toBe(vision.sections[1]!.scene)
  })

  it('places each transition around the boundary, timed in beats', () => {
    const vision = defaultVision(sections, 80, grid)
    const around = (style: TransitionStyle) => transitionWindow(setTransition(vision, 1, style), 1)
    expect(around('glitchWipe')).toEqual({ start: 31.5, at: 32, end: 32.5 })
    expect(around('bleedWash')).toEqual({ start: 31, at: 32, end: 33 })
    expect(around('chromeMorph')).toEqual({ start: 31, at: 32, end: 33 })
    expect(around('whiteFlash')).toEqual({ start: 31.875, at: 32, end: 32.5 })
  })

  it('keeps a transition inside the two sections it joins', () => {
    const short = [section('intro', 0, 1), section('build', 1, 1.6), section('drop', 1.6, 80)]
    const vision = setTransition(defaultVision(short, 80, grid), 1, 'bleedWash')
    expect(transitionWindow(vision, 1)).toEqual({ start: 1.3, at: 1.6, end: 2.6 })
  })

  it('draws both scenes through the transition, and only one outside it', () => {
    const vision = setTransition(defaultVision(sections, 80, grid), 1, 'glitchWipe')
    const kinds = (t: number) => planVisionFrame(vision, features, t, size, NO_SIGNALS).passes.map((p) => p.kind)
    const scene = ['ground', 'classic', 'finish']
    expect(kinds(31.49)).toEqual(scene)
    expect(kinds(31.75)).toEqual([...scene, 'hold', ...scene, 'transition'])
    expect(kinds(32.5)).toEqual(scene)
    expect(sceneAt(vision, 31.75)).toBe(vision.sections[1]!.scene)
  })

  it('tells the transition pass its style, how far the new scene is in, how hard it hits, and its progress', () => {
    const p0 = (vision: Vision, t: number) =>
      Array.from(planVisionFrame(vision, features, t, size, NO_SIGNALS).passes.at(-1)!.uniforms.slice(4, 8))
    const base = defaultVision(sections, 80, grid)
    const wipe = setTransition(base, 1, 'glitchWipe')
    expect(p0(wipe, 31.75)).toEqual([TRANSITION_STYLES.indexOf('glitchWipe'), 0.25, 0.5, 0.25])
    const flash = setTransition(base, 1, 'whiteFlash')
    const [, mixBefore, peakBefore] = p0(flash, 31.95)
    const [, mixAt, peakAt] = p0(flash, 32)
    expect([mixBefore, mixAt, peakAt]).toEqual([0, 1, 1])
    expect(peakBefore).toBeGreaterThan(0)
    expect(peakBefore).toBeLessThan(1)
  })

  it('draws moments over a transition', () => {
    let vision = setTransition(defaultVision(sections, 80, grid), 1, 'chromeMorph')
    vision = addMoment(vision, 'flash', 32, 'bar')
    const kinds = planVisionFrame(vision, features, 32.1, size, NO_SIGNALS).passes.map((p) => p.kind)
    expect(kinds.slice(-2)).toEqual(['transition', 'flash'])
  })
})
