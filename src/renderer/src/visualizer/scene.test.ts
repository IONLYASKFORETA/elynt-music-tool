import { describe, expect, it } from 'vitest'
import { BAND_COUNT } from './audio-features'
import {
  activeLayerCount,
  addLayer,
  BUILD_OFFSET,
  PALETTE_OFFSET,
  canAddLayer,
  defaultScene,
  MAX_ACTIVE_LAYERS,
  newLayer,
  planFrame,
  UNIFORM_FLOATS,
  type ClassicLayer,
  type Scene
} from './scene'
import { DEFAULT_PALETTE, packPalette } from './palette'
import { NO_SIGNALS, type TrackSignals } from './signals'

const features = { bands: new Float32Array(BAND_COUNT).fill(0.5), energy: 0.8 }
const size = { width: 960, height: 540 }

const classic = (reactsTo: ClassicLayer['reactivity']['reactsTo'] = 'none'): ClassicLayer => ({
  ...(newLayer('classic') as ClassicLayer),
  height: 0.5,
  glitch: 0.2,
  reactivity: { reactsTo, strength: 1 }
})

describe('planFrame', () => {
  it('draws the layers of a scene in the order given', () => {
    const scene: Scene = { layers: [newLayer('finish'), newLayer('ground')] }
    expect(planFrame(scene, features, 2, size).passes.map((p) => p.kind)).toEqual(['finish', 'ground'])
  })

  it('gives every pass the time, energy and frame size, then its own parameters', () => {
    const plan = planFrame({ layers: [classic()] }, features, 12.5, size)
    const pass = plan.passes[0]!
    expect(pass.uniforms).toHaveLength(UNIFORM_FLOATS)
    expect(Array.from(pass.uniforms.slice(0, 4))).toEqual([12.5, Math.fround(0.8), 960, 540])
    expect(pass.uniforms[4]).toBeCloseTo(0.5)
  })

  it("gives every pass the vision's palette, and the house palette when none is given", () => {
    const palette = ['#ff0000', '#00ff00', '#0000ff']
    const own = planFrame(defaultScene, features, 0, size, NO_SIGNALS, palette)
    for (const pass of own.passes) expect(Array.from(pass.uniforms.slice(PALETTE_OFFSET))).toEqual(Array.from(packPalette(palette)))
    const house = planFrame(defaultScene, features, 0, size).passes[0]!
    expect(Array.from(house.uniforms.slice(PALETTE_OFFSET))).toEqual(Array.from(packPalette(DEFAULT_PALETTE)))
  })

  it('tells every pass how far into a build the track is', () => {
    const building: TrackSignals = { ...NO_SIGNALS, levels: { ...NO_SIGNALS.levels, build: { hz: 1, values: Float32Array.of(0, 0.5, 1) } } }
    const pass = planFrame(defaultScene, features, 1, size, building).passes[1]!
    expect(pass.uniforms[BUILD_OFFSET]).toBeCloseTo(0.5)
  })

  it('passes the spectrum through for the frame', () => {
    expect(planFrame(defaultScene, features, 0, size).spectrum).toBe(features.bands)
  })

  it('draws an empty stack as no passes', () => {
    expect(planFrame({ layers: [] }, features, 0, size).passes).toEqual([])
  })

  it('starts from Ground, Classic, Finish', () => {
    expect(defaultScene.layers.map((l) => l.kind)).toEqual(['ground', 'classic', 'finish'])
  })
})

describe('reactivity in a frame', () => {
  const kickAt2: TrackSignals = { ...NO_SIGNALS, events: { ...NO_SIGNALS.events, kick: [2], drop: [2] } }
  const height = (scene: Scene, t: number) => planFrame(scene, features, t, size, kickAt2).passes[0]!.uniforms[4]!
  const glitch = (scene: Scene, t: number) => planFrame(scene, features, t, size, kickAt2).passes[0]!.uniforms[7]!

  it('lifts the spectrum on a kick (medium tier), and lets it settle between kicks', () => {
    const scene = { layers: [classic('kick')] }
    expect(height(scene, 2.01)).toBeGreaterThan(0.6)
    expect(height(scene, 1.9)).toBeCloseTo(0.5)
    expect(height(scene, 3)).toBeLessThan(0.52)
  })

  it('glitches hard on a drop (hard tier) rather than pulsing the height', () => {
    const scene = { layers: [classic('drop')] }
    expect(glitch(scene, 2.01)).toBeGreaterThan(0.9)
    expect(height(scene, 2.01)).toBeCloseTo(0.5)
  })

  it('leaves a layer that reacts to nothing as it is', () => {
    const scene = { layers: [classic('none')] }
    expect(height(scene, 2.01)).toBeCloseTo(0.5)
    expect(glitch(scene, 2.01)).toBeCloseTo(0.2)
  })
})

describe('the layer limit', () => {
  const full: Scene = {
    layers: [newLayer('ground'), ...Array.from({ length: MAX_ACTIVE_LAYERS }, () => newLayer('classic')), newLayer('finish')]
  }

  it('allows five active layers per scene, not counting Ground and Finish', () => {
    expect(MAX_ACTIVE_LAYERS).toBe(5)
    expect(activeLayerCount(full)).toBe(5)
    expect(canAddLayer(full, 'classic')).toBe(false)
    expect(() => addLayer(full, newLayer('classic'))).toThrow(/5/)
  })

  it('still takes a Ground or Finish when the scene is full', () => {
    expect(canAddLayer(full, 'finish')).toBe(true)
    expect(addLayer(full, newLayer('ground')).layers).toHaveLength(full.layers.length + 1)
  })

  it('adds a new active layer under the Finish', () => {
    const scene = addLayer(defaultScene, newLayer('classic'))
    expect(scene.layers.map((l) => l.kind)).toEqual(['ground', 'classic', 'classic', 'finish'])
  })

  it('never draws more than five active layers, even from a scene built by hand', () => {
    const over: Scene = { layers: [...full.layers, newLayer('classic')] }
    const kinds = planFrame(over, features, 0, size).passes.map((p) => p.kind)
    expect(kinds.filter((k) => k === 'classic')).toHaveLength(5)
    expect(kinds).toContain('finish')
  })
})
