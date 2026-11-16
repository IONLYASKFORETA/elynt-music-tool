import { describe, expect, it } from 'vitest'
import { BAND_COUNT } from './audio-features'
import { DEFAULT_REACTIVITY } from './reactivity'
import { addLayer, countsTowardLimit, defaultScene, LAYER_NAMES, newLayer, planFrame, type Layer, type LayerKind, type Scene } from './scene'
import { NO_SIGNALS, SIGNALS, type TrackSignals } from './signals'

const features = { bands: new Float32Array(BAND_COUNT).fill(0.5), energy: 0.5 }
const size = { width: 960, height: 540 }

/** A kick at 1 s, a snare at 2 s, a downbeat at 3 s and a drop at 4 s. */
const signals: TrackSignals = {
  ...NO_SIGNALS,
  events: { ...NO_SIGNALS.events, kick: [1], snare: [2], downbeat: [3], drop: [4] }
}

/** The layer's own parameters at t, as the shader gets them: p0 then p1. */
function params(layer: Layer, t: number): number[] {
  return Array.from(planFrame({ layers: [layer] }, features, t, size, signals).passes[0]!.uniforms.slice(4, 12))
}

const HIT_KINDS: LayerKind[] = ['colorBleed', 'chrome', 'glitch', 'lightPillar']

describe('the hit layers', () => {
  it('are in the layer library under their own names, and count toward the limit', () => {
    expect(HIT_KINDS.map((k) => LAYER_NAMES[k])).toEqual(['Color Bleed', 'Chrome', 'Glitch', 'Light Pillar'])
    for (const kind of HIT_KINDS) {
      expect(countsTowardLimit(kind)).toBe(true)
      expect(newLayer(kind).kind).toBe(kind)
    }
  })

  it("react by default the way the spec's table says", () => {
    const tierOf = (k: LayerKind) => SIGNALS[DEFAULT_REACTIVITY[k].reactsTo as keyof typeof SIGNALS].tier
    expect(DEFAULT_REACTIVITY.colorBleed.reactsTo).toBe('kickSnare')
    expect(tierOf('colorBleed')).toBe('medium')
    expect(DEFAULT_REACTIVITY.chrome.reactsTo).toBe('snare')
    expect(tierOf('chrome')).toBe('medium')
    expect(DEFAULT_REACTIVITY.glitch.reactsTo).toBe('dropDownbeat')
    expect(tierOf('glitch')).toBe('hard')
    expect(DEFAULT_REACTIVITY.lightPillar.reactsTo).toBe('dropDownbeat')
    expect(tierOf('lightPillar')).toBe('hard')
  })

  it('can all go into one scene with Ground and Finish', () => {
    const start: Scene = { layers: defaultScene.layers.filter((l) => l.kind !== 'classic') }
    const scene = HIT_KINDS.reduce((s, k) => addLayer(s, newLayer(k)), start)
    expect(planFrame(scene, features, 0, size).passes.map((p) => p.kind)).toEqual(['ground', ...HIT_KINDS, 'finish'])
  })
})

describe('Color Bleed', () => {
  const bleed = newLayer('colorBleed')
  const [drip, smear] = [0, 1]

  it('jolts on the kick and on the snare, and settles between them', () => {
    const rest = params(bleed, 0.5)
    expect(params(bleed, 1.01)[smear]).toBeGreaterThan(rest[smear]! * 1.3)
    expect(params(bleed, 2.01)[drip]).toBeGreaterThan(rest[drip]! * 1.2)
    expect(params(bleed, 1.9)[smear]).toBeCloseTo(rest[smear]!, 1)
  })

  it('has a growth through builds of its own, on top of what it reacts to', () => {
    const [, , , growth] = params(bleed, 0.5)
    expect(growth).toBeGreaterThan(0)
  })
})

describe('Chrome', () => {
  const chrome = newLayer('chrome')
  const spikes = 1

  it('spikes on the snare, not on the kick', () => {
    const rest = params(chrome, 0.5)[spikes]!
    expect(params(chrome, 2.01)[spikes]).toBeGreaterThan(rest + 0.3)
    expect(params(chrome, 1.01)[spikes]).toBeCloseTo(rest)
  })
})

describe('Glitch', () => {
  const glitch = newLayer('glitch')
  const amount = 0

  it('stays nearly clean between hits and tears hard on downbeats and drops', () => {
    expect(params(glitch, 0.5)[amount]).toBeLessThan(0.15)
    expect(params(glitch, 3.01)[amount]).toBeGreaterThan(0.8)
    expect(params(glitch, 4.01)[amount]).toBeGreaterThan(0.8)
  })

  it('can be moved onto another signal and turned down', () => {
    const onKick = { ...glitch, reactivity: { reactsTo: 'kick' as const, strength: 0.5 } }
    expect(params(onKick, 3.01)[amount]).toBeLessThan(0.15)
    expect(params(onKick, 1.01)[amount]).toBeGreaterThan(0.15)
    expect(params(onKick, 1.01)[amount]).toBeLessThan(params(glitch, 3.01)[amount]!)
  })
})

describe('Light Pillar', () => {
  const pillar = newLayer('lightPillar')
  const fire = 0

  it('is dark until the biggest moments, then fires', () => {
    expect(params(pillar, 0.5)[fire]).toBeLessThan(0.1)
    expect(params(pillar, 3.01)[fire]).toBeGreaterThan(0.8)
    expect(params(pillar, 4.01)[fire]).toBeGreaterThan(0.9)
  })

  it('holds a drop longer than a downbeat', () => {
    expect(params(pillar, 4.6)[fire]).toBeGreaterThan(params(pillar, 3.6)[fire]! + 0.3)
  })

  it('does not fire at all when it reacts to nothing', () => {
    const still = { ...pillar, reactivity: { reactsTo: 'none' as const, strength: 1 } }
    expect(params(still, 4.01)[fire]).toBeLessThan(0.1)
  })
})
