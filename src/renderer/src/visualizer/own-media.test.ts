import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { WIDE_LAYOUT } from '../../../shared/formats'
import { BAND_COUNT } from './audio-features'
import { newClipMedia, newImageMedia, type ClipMedia } from './media'
import { DEFAULT_PALETTE } from './palette'
import {
  newLayer,
  planFrame,
  type ChromeLayer,
  type FrameContext,
  type GroundLayer,
  type Layer,
  type PosterFrameLayer,
  type Scene,
  type SubjectLayer
} from './scene'
import { NO_SIGNALS } from './signals'
import {
  acceptCoverArt,
  addSectionLayer,
  coverArtOffer,
  defaultVision,
  planVisionFrame,
  updateSectionLayer,
  visionClips,
  visionImages
} from './vision'

const features = { bands: new Float32Array(BAND_COUNT).fill(0.5), energy: 0.5 }
const size = { width: 1920, height: 1080 }
const context = (sectionStart = 0): FrameContext => ({
  sectionIndex: 0,
  sectionStart,
  credits: { title: '', artist: '' },
  layout: WIDE_LAYOUT
})
const pass = (layer: Layer, t: number, sectionStart = 0) =>
  planFrame({ layers: [layer] } as Scene, features, t, size, NO_SIGNALS, DEFAULT_PALETTE, context(sectionStart)).passes[0]!

const photo = newImageMedia({ url: 'elynt-media://shelf/1', name: 'portrait.jpg' })
const smoke: ClipMedia = newClipMedia({ url: 'elynt-media://shelf/2', name: 'smoke.mp4', durationSeconds: 10, fps: 30 })
const logo = newImageMedia({ url: 'elynt-media://shelf/3', name: 'logo.png' })

const subject = (patch: Partial<SubjectLayer>): SubjectLayer => ({ ...(newLayer('subject') as SubjectLayer), ...patch })
const ground = (patch: Partial<GroundLayer>): GroundLayer => ({ ...(newLayer('ground') as GroundLayer), ...patch })
const chrome = (patch: Partial<ChromeLayer>): ChromeLayer => ({ ...(newLayer('chrome') as ChromeLayer), ...patch })
const frame = (patch: Partial<PosterFrameLayer>): PosterFrameLayer => ({ ...(newLayer('posterFrame') as PosterFrameLayer), ...patch })

describe('own media on the Subject, Ground and Chrome layers', () => {
  it('starts every layer with no media: no vision needs it', () => {
    for (const kind of ['subject', 'ground', 'chrome', 'posterFrame'] as const) {
      expect(newLayer(kind)).toMatchObject(kind === 'posterFrame' ? { logoMedia: null } : { media: null })
    }
    expect(pass(newLayer('ground'), 1).image).toBeUndefined()
    expect(pass(newLayer('chrome'), 1).image).toBeUndefined()
  })

  it('draws an image from the shelf on each of the three layers', () => {
    for (const layer of [subject({ media: photo }), ground({ media: photo }), chrome({ media: photo })]) {
      expect(pass(layer, 1).image).toEqual({ kind: 'picture', url: 'elynt-media://shelf/1' })
    }
  })

  it("shows own media on the Subject in place of a picked or generated image", () => {
    expect(pass(subject({ image: 'blob:generated', media: photo }), 1).image).toEqual({ kind: 'picture', url: photo.url })
    expect(pass(subject({ image: 'blob:generated', media: null }), 1).image).toEqual({ kind: 'picture', url: 'blob:generated' })
  })

  it("plays a clip from the start of the layer's section", () => {
    expect(pass(ground({ media: smoke }), 6, 4).image).toMatchObject({ kind: 'clip', url: smoke.url, frame: 60 })
    expect(pass(chrome({ media: { ...smoke, speed: 2 } }), 6, 4).image).toMatchObject({ kind: 'clip', frame: 120 })
  })

  it('tells the shader to give media the house-style treatment, unless the item is set untreated', () => {
    // Subject: p1.x; Ground: p0.z; Chrome: p1.x. 0 = no media, 1 = treated, 2 = untreated.
    expect(pass(subject({ media: photo }), 1).uniforms[8]).toBe(1)
    expect(pass(subject({ media: { ...photo, untreated: true } }), 1).uniforms[8]).toBe(2)
    expect(pass(subject({ image: 'blob:generated' }), 1).uniforms[8]).toBe(0)
    expect(pass(ground({ media: photo }), 1).uniforms[6]).toBe(1)
    expect(pass(ground({ media: { ...smoke, untreated: true } }), 1).uniforms[6]).toBe(2)
    expect(pass(chrome({ media: photo }), 1).uniforms[8]).toBe(1)
    expect(pass(chrome({}), 1).uniforms[8]).toBe(0)
  })
})

describe('the logo as a Poster Frame mark', () => {
  it('draws the shelf logo in place of the drawn mark when chosen', () => {
    const plain = pass(frame({}), 1)
    expect(plain.image).toBeUndefined()
    expect(plain.uniforms[11]).toBe(0)
    const marked = pass(frame({ logoMedia: logo }), 1)
    expect(marked.image).toEqual({ kind: 'picture', url: logo.url })
    expect(marked.uniforms[11]).toBe(1)
  })
})

describe('own media across a vision', () => {
  const section = (label: Section['label'], start: number, end: number): Section => ({
    label,
    start,
    end,
    startBar: 0,
    confidence: 1,
    source: 'heuristic'
  })
  const sections = [section('intro', 0, 4), section('drop', 4, 12)]

  it('restarts a clip at its own section, so preview and export pick the same frame at any t', () => {
    let vision = defaultVision(sections, 12)
    vision = updateSectionLayer(vision, 1, 0, { media: smoke } as Partial<Layer>)
    const groundPass = planVisionFrame(vision, features, 5, size, NO_SIGNALS).passes[0]!
    expect(groundPass.image).toMatchObject({ kind: 'clip', frame: 30 })
  })

  it('lists every image and clip to load before an export starts, once each', () => {
    let vision = defaultVision(sections, 12)
    vision = updateSectionLayer(vision, 0, 0, { media: photo } as Partial<Layer>)
    vision = addSectionLayer(vision, 0, subject({ media: photo }))
    vision = addSectionLayer(vision, 1, chrome({ media: smoke }))
    vision = addSectionLayer(vision, 1, subject({ media: smoke }))
    vision = addSectionLayer(vision, 1, subject({ media: { ...smoke, loop: true } }))
    vision = addSectionLayer(vision, 1, frame({ logoMedia: logo }))
    expect(visionImages(vision)).toEqual([photo.url, logo.url])
    expect(visionClips(vision).map((c) => c.loop)).toEqual([false, true])
  })
})

describe("the track's cover art", () => {
  const sections: Section[] = [
    { label: 'intro', start: 0, end: 4, startBar: 0, confidence: 1, source: 'heuristic' },
    { label: 'drop', start: 4, end: 12, startBar: 2, confidence: 1, source: 'heuristic' }
  ]
  const cover = { url: 'elynt-media://cover/7', name: 'cover.jpg' }

  it('is never put in a vision by itself', () => {
    expect(visionImages(defaultVision(sections, 12))).toEqual([])
    expect(coverArtOffer(null)).toBeNull()
  })

  it('is offered as a Subject when the track has it, and taking the offer places it', () => {
    expect(coverArtOffer(cover)).toMatchObject({ kind: 'subject', media: { type: 'image', url: cover.url, untreated: false } })
    const vision = acceptCoverArt(defaultVision(sections, 12), 1, cover)
    expect(vision.sections[1]!.scene.layers.map((l) => l.kind)).toEqual(['ground', 'classic', 'subject', 'finish'])
    expect(visionImages(vision)).toEqual([cover.url])
  })
})
