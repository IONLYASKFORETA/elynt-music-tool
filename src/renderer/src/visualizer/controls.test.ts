import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { BAND_COUNT } from './audio-features'
import { applyChange, applyChangeSet, controlValue, LAYER_SLIDERS, slidersAt } from './controls'
import { LAYER_NAMES, newLayer, type LayerKind } from './scene'
import { NO_SIGNALS, type TrackSignals } from './signals'
import { defaultVision, planVisionFrame, type Vision } from './vision'

const section = (label: Section['label'], start: number, end: number): Section => ({
  label,
  start,
  end,
  startBar: 0,
  confidence: 1,
  source: 'heuristic'
})
const sections = [section('intro', 0, 16), section('build', 16, 32), section('drop', 32, 64), section('outro', 64, 80)]
const vision = defaultVision(sections, 80)
// Default scenes are Ground, Classic, Finish.
const CLASSIC = 1

describe('sliders at layer scope', () => {
  it("offer a layer's own settings and its strength, and moving one changes that layer only", () => {
    const target = { section: 2, layer: CLASSIC }
    expect(slidersAt(vision, target).map((s) => s.param)).toEqual(
      expect.arrayContaining(['strength', 'height', 'bleed', 'barFill', 'glitch'])
    )
    const changed = applyChange(vision, { op: 'set', ...target, param: 'height', value: 0.3 })
    expect(controlValue(changed, target, 'height')).toBe(0.3)
    expect(controlValue(changed, { section: 1, layer: CLASSIC }, 'height')).toBe(0.8)
  })
})

describe('intensity sliders at video and section scope', () => {
  const kicks: TrackSignals = { ...NO_SIGNALS, events: { ...NO_SIGNALS.events, kick: [40] } }
  const features = { bands: new Float32Array(BAND_COUNT).fill(0.5), energy: 0.5 }
  const size = { width: 640, height: 360 }
  // The Classic's bleed in the drop just after a kick, as the preview draws it. It rests at 6.
  const classicBleed = (v: Vision) => planVisionFrame(v, features, 40.01, size, kicks).passes[CLASSIC]!.uniforms[5]!

  it('exist at both scopes and start at 1', () => {
    expect(slidersAt(vision, { section: null, layer: null }).map((s) => s.param)).toEqual(['intensity'])
    expect(slidersAt(vision, { section: 2, layer: null }).map((s) => s.param)).toEqual(['intensity'])
    expect(controlValue(vision, { section: null, layer: null }, 'intensity')).toBe(1)
  })

  it("turned to 0 on a section, stop that section's layers reacting in the preview", () => {
    expect(classicBleed(vision)).toBeGreaterThan(6.1)
    const still = applyChange(vision, { op: 'set', section: 2, layer: null, param: 'intensity', value: 0 })
    expect(classicBleed(still)).toBeCloseTo(6, 5)
  })

  it('turned up on the video, make every section react harder', () => {
    const louder = applyChange(vision, { op: 'set', section: null, layer: null, param: 'intensity', value: 1.5 })
    expect(classicBleed(louder)).toBeGreaterThan(classicBleed(vision))
  })

  it('are clamped to their range', () => {
    const changed = applyChange(vision, { op: 'set', section: 1, layer: null, param: 'intensity', value: 9 })
    expect(controlValue(changed, { section: 1, layer: null }, 'intensity')).toBe(2)
  })
})

describe('the layer library', () => {
  it('gives every number setting of every layer kind a slider, except what reactivity sets', () => {
    for (const kind of Object.keys(LAYER_NAMES) as LayerKind[]) {
      const layer = newLayer(kind) as unknown as Record<string, unknown>
      const numeric = Object.keys(layer).filter((k) => typeof layer[k] === 'number' && k !== 'jolt')
      const sliders = LAYER_SLIDERS[kind].map((s) => s.param)
      expect(sliders.sort(), kind).toEqual(numeric.sort())
      for (const s of LAYER_SLIDERS[kind]) {
        expect(layer[s.param] as number, `${kind}.${s.param}`).toBeGreaterThanOrEqual(s.min)
        expect(layer[s.param] as number, `${kind}.${s.param}`).toBeLessThanOrEqual(s.max)
      }
    }
  })
})

describe('applying a change set at a scope', () => {
  it('makes every change inside the scope as one new vision', () => {
    const result = applyChangeSet(vision, { kind: 'section', section: 2 }, [
      { op: 'set', section: 2, layer: null, param: 'intensity', value: 1.4 },
      { op: 'addLayer', section: 2, kind: 'glitch' },
      { op: 'reactTo', section: 2, layer: CLASSIC, signal: 'snare' }
    ])
    expect(result.rejected).toEqual([])
    expect(result.applied).toHaveLength(3)
    expect(result.vision.sections[2]!.intensity).toBe(1.4)
    expect(result.vision.sections[2]!.scene.layers.map((l) => l.kind)).toEqual(['ground', 'classic', 'glitch', 'finish'])
    expect(result.vision.sections[2]!.scene.layers[CLASSIC]!.reactivity.reactsTo).toBe('snare')
    expect(result.vision.sections[1]).toBe(vision.sections[1])
  })

  it('leaves out changes that reach outside the scope and keeps the rest', () => {
    const layerScope = { kind: 'layer' as const, section: 2, layer: CLASSIC }
    const result = applyChangeSet(vision, layerScope, [
      { op: 'set', section: 2, layer: CLASSIC, param: 'glitch', value: 0.9 },
      { op: 'set', section: 1, layer: CLASSIC, param: 'glitch', value: 0.9 },
      { op: 'set', section: 2, layer: 0, param: 'lift', value: 0.5 },
      { op: 'addLayer', section: 2, kind: 'chrome' },
      { op: 'palette', colors: ['#000000', '#ffffff', '#ff0000'] }
    ])
    expect(result.applied).toHaveLength(1)
    expect(result.rejected).toHaveLength(4)
    expect(result.vision.palette).toEqual(vision.palette)
    expect(controlValue(result.vision, { section: 2, layer: CLASSIC }, 'glitch')).toBe(0.9)
  })

  it('checks changes against the layer library before they apply', () => {
    const result = applyChangeSet(vision, { kind: 'video' }, [
      { op: 'addLayer', section: 0, kind: 'laserShark' },
      { op: 'set', section: 0, layer: CLASSIC, param: 'wobble', value: 1 },
      { op: 'set', section: 0, layer: CLASSIC, param: 'height', value: 'loud' },
      { op: 'reactTo', section: 0, layer: CLASSIC, signal: 'cowbell' },
      { op: 'transition', section: 0, style: 'starWipe' },
      { op: 'removeLayer', section: 0, layer: 0 },
      { op: 'palette', colors: ['red'] },
      { op: 'explode' },
      { op: 'set', section: 9, layer: null, param: 'intensity', value: 1 }
    ])
    expect(result.applied).toEqual([])
    expect(result.rejected).toHaveLength(9)
    expect(result.vision).toBe(vision)
    for (const { reason } of result.rejected) expect(reason).toMatch(/\w/)
  })

  it('refuses a sixth active layer in a section', () => {
    const adds = Array.from({ length: 6 }, () => ({ op: 'addLayer', section: 0, kind: 'chrome' }))
    // Classic is already one of the five.
    const result = applyChangeSet(vision, { kind: 'section', section: 0 }, adds)
    expect(result.applied).toHaveLength(4)
    expect(result.rejected).toHaveLength(2)
  })

  it('rounds whole-number settings', () => {
    let v = applyChange(vision, { op: 'addLayer', section: 0, kind: 'lightPillar' })
    v = applyChange(v, { op: 'set', section: 0, layer: 2, param: 'count', value: 4.6 })
    expect(controlValue(v, { section: 0, layer: 2 }, 'count')).toBe(5)
  })
})
