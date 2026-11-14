import { describe, expect, it } from 'vitest'
import { BAND_COUNT } from './audio-features'
import { defaultScene, planFrame, UNIFORM_FLOATS, type Scene } from './scene'

const features = { bands: new Float32Array(BAND_COUNT).fill(0.5), energy: 0.8 }
const size = { width: 960, height: 540 }

describe('planFrame', () => {
  it('draws the layers of a scene in the order given', () => {
    const scene: Scene = {
      layers: [
        { kind: 'finish', grain: 0.2, scanlines: 0.3, vignette: 0.4, energyResponse: 1 },
        { kind: 'ground', hueSpeed: 1, lift: 0.05 }
      ]
    }
    expect(planFrame(scene, features, 2, size).passes.map((p) => p.kind)).toEqual(['finish', 'ground'])
  })

  it('gives every pass the time, energy and frame size, then its own parameters', () => {
    const plan = planFrame(defaultScene, features, 12.5, size)
    const classic = plan.passes.find((p) => p.kind === 'classic')!
    expect(classic.uniforms).toHaveLength(UNIFORM_FLOATS)
    expect(Array.from(classic.uniforms.slice(0, 4))).toEqual([12.5, Math.fround(0.8), 960, 540])
    const layer = defaultScene.layers.find((l) => l.kind === 'classic')!
    expect(classic.uniforms[4]).toBeCloseTo(layer.kind === 'classic' ? layer.height : NaN)
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
