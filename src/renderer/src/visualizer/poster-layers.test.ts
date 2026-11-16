import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { BAND_COUNT } from './audio-features'
import { DEFAULT_PALETTE } from './palette'
import { DEFAULT_REACTIVITY } from './reactivity'
import {
  addLayer,
  defaultScene,
  LAYER_NAMES,
  newLayer,
  planFrame,
  type FrameContext,
  type PosterTypeLayer,
  type Scene,
  type SubjectLayer
} from './scene'
import { NO_SIGNALS, SIGNALS, type TrackSignals } from './signals'
import { addSectionLayer, defaultVision, planVisionFrame, visionImages, type Vision } from './vision'

const features = { bands: new Float32Array(BAND_COUNT).fill(0.5), energy: 0.5 }
const size = { width: 1920, height: 1080 }
const credits = { title: 'Neon Drive', artist: 'Elynt' }
const context = (sectionIndex = 0, sectionStart = 0): FrameContext => ({ sectionIndex, sectionStart, credits })
const signals: TrackSignals = {
  ...NO_SIGNALS,
  events: { ...NO_SIGNALS.events, kick: [3], downbeat: [0, 2, 4, 6, 8, 10] }
}
const only = (layer: Scene['layers'][number]): Scene => ({ layers: [layer] })
const pass = (scene: Scene, t: number, ctx = context()) => planFrame(scene, features, t, size, signals, DEFAULT_PALETTE, ctx).passes[0]!

describe('the poster layers in the layer library', () => {
  it('can place a Poster Frame, Poster Type and Subject, each counting as an active layer', () => {
    expect([LAYER_NAMES.posterFrame, LAYER_NAMES.posterType, LAYER_NAMES.subject]).toEqual([
      'Poster Frame',
      'Poster Type',
      'Subject'
    ])
    let scene = defaultScene
    for (const kind of ['posterFrame', 'posterType', 'subject'] as const) scene = addLayer(scene, newLayer(kind))
    expect(scene.layers.map((l) => l.kind)).toEqual(['ground', 'classic', 'posterFrame', 'posterType', 'subject', 'finish'])
  })

  it('gives the Subject a medium kick pulse and Poster Type a hit on downbeats by default', () => {
    expect(DEFAULT_REACTIVITY.subject.reactsTo).toBe('kick')
    expect(SIGNALS[DEFAULT_REACTIVITY.subject.reactsTo as 'kick'].tier).toBe('medium')
    expect(DEFAULT_REACTIVITY.posterType.reactsTo).toBe('downbeat')
  })
})

describe('Poster Type in a frame', () => {
  const type = (patch: Partial<PosterTypeLayer> = {}): PosterTypeLayer => ({ ...(newLayer('posterType') as PosterTypeLayer), ...patch })

  it("sets the track's title, the artist's name, katakana from the title and the owner's words", () => {
    const image = pass(only(type({ words: 'out now' })), 1).image
    expect(image).toMatchObject({
      kind: 'type',
      text: { title: 'Neon Drive', artist: 'Elynt', katakana: 'ネオン・ドライブ', words: 'out now' }
    })
  })

  it('uses the katakana the owner typed instead of the generated one', () => {
    const image = pass(only(type({ katakana: 'ネオンドライブ' })), 1).image
    expect(image?.kind === 'type' && image.text.katakana).toBe('ネオンドライブ')
  })

  it("reveals its blocks on the section's downbeats", () => {
    const reveals = (t: number) => Array.from(pass(only(type({ words: 'hi' })), t, context(1, 4)).uniforms.slice(4, 8))
    expect(reveals(3.9)).toEqual([0, 0, 0, 0])
    expect(reveals(4.5)).toEqual([1, 0, 0, 0])
    expect(reveals(8.5)).toEqual([1, 1, 1, 0])
    expect(reveals(10.5)).toEqual([1, 1, 1, 1])
  })

  it('carries the anchors the layout hangs from, so another format can swap them', () => {
    const image = pass(only(type()), 1).image
    expect(image?.kind === 'type' && image.anchors.title).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
  })
})

describe('Subject in a frame', () => {
  const subject = (patch: Partial<SubjectLayer> = {}): SubjectLayer => ({
    ...(newLayer('subject') as SubjectLayer),
    image: 'blob:motif',
    ...patch
  })
  const scale = (layer: SubjectLayer, t: number) => pass(only(layer), t).uniforms[4]!

  it('shows the image it is given', () => {
    expect(pass(only(subject()), 1).image).toEqual({ kind: 'picture', url: 'blob:motif' })
    expect(pass(only(subject({ image: null })), 1).image).toBeUndefined()
  })

  it('pulses bigger on the kick and settles back between kicks', () => {
    const layer = subject()
    const rest = scale(layer, 2.9)
    expect(rest).toBeCloseTo(layer.scale)
    expect(scale(layer, 3.01)).toBeGreaterThan(rest * 1.03)
    expect(scale(layer, 3.8)).toBeLessThan(rest * 1.01)
  })
})

describe('Poster Frame in a frame', () => {
  const frame = { ...newLayer('posterFrame'), reactivity: { reactsTo: 'none' as const, strength: 0 } }
  const params = (t: number, sectionIndex: number) => Array.from(pass(only(frame), t, context(sectionIndex)).uniforms.slice(4))

  it('holds still through a section', () => {
    expect(params(1, 0)).toEqual(params(7, 0))
  })

  it('cuts to a new arrangement at each section', () => {
    expect(params(1, 1)).not.toEqual(params(1, 0))
    expect(params(1, 2)).not.toEqual(params(1, 1))
  })
})

describe('poster layers across a vision', () => {
  const section = (label: Section['label'], start: number, end: number): Section => ({
    label,
    start,
    end,
    startBar: 0,
    confidence: 1,
    source: 'heuristic'
  })
  const sections = [section('intro', 0, 4), section('drop', 4, 12)]

  it("reads the credits from the vision and each section's own start", () => {
    let vision: Vision = { ...defaultVision(sections, 12), credits }
    vision = addSectionLayer(vision, 1, newLayer('posterType'))
    const plan = planVisionFrame(vision, features, 4.5, size, signals)
    const typePass = plan.passes.find((p) => p.kind === 'posterType')!
    expect(typePass.image).toMatchObject({ kind: 'type', text: { title: 'Neon Drive', artist: 'Elynt' } })
    expect(typePass.uniforms[4]).toBe(1)
    expect(typePass.uniforms[5]).toBe(0)
  })

  it('lists every image its Subjects show, once each, so an export can load them first', () => {
    let vision = defaultVision(sections, 12)
    vision = addSectionLayer(vision, 0, { ...newLayer('subject'), image: 'blob:a' } as SubjectLayer)
    vision = addSectionLayer(vision, 1, { ...newLayer('subject'), image: 'blob:a' } as SubjectLayer)
    vision = addSectionLayer(vision, 1, { ...newLayer('subject'), image: 'blob:b' } as SubjectLayer)
    vision = addSectionLayer(vision, 1, newLayer('subject'))
    expect(visionImages(vision)).toEqual(['blob:a', 'blob:b'])
  })
})
