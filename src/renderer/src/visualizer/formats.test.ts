import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { DEFAULT_SAFE_ZONES, formatLayout, type FormatId } from '../../../shared/formats'
import { BAND_COUNT } from './audio-features'
import { clearFormatTweaks, setFormatTweak } from './formats'
import { newLayer, type PosterFrameLayer, type SubjectLayer } from './scene'
import { NO_SIGNALS } from './signals'
import { addSectionLayer, defaultVision, planVisionFrame, type Vision } from './vision'

const features = { bands: new Float32Array(BAND_COUNT).fill(0.5), energy: 0.5 }
const sizes: Record<FormatId, { width: number; height: number }> = {
  wide: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 }
}
const sections: Section[] = [{ label: 'intro', start: 0, end: 10, startBar: 0, confidence: 1, source: 'heuristic' }]
const still = { reactsTo: 'none' as const, strength: 0 }

/** One section with a Poster Frame, Poster Type and Subject (layers 2, 3 and 4), none of them reacting. */
function posterVision(): Vision {
  let vision: Vision = { ...defaultVision(sections, 10), credits: { title: 'Neon Drive', artist: 'Elynt' } }
  for (const kind of ['posterFrame', 'posterType', 'subject'] as const) {
    vision = addSectionLayer(vision, 0, { ...newLayer(kind), reactivity: still })
  }
  return vision
}
const FRAME = 2
const TYPE = 3
const SUBJECT = 4

const plan = (vision: Vision, format: FormatId) =>
  planVisionFrame(vision, features, 1, sizes[format], NO_SIGNALS, formatLayout(DEFAULT_SAFE_ZONES, format))
const passOf = (vision: Vision, format: FormatId, kind: string) => plan(vision, format).passes.find((p) => p.kind === kind)!
const subjectAt = (vision: Vision, format: FormatId) => {
  const u = passOf(vision, format, 'subject').uniforms
  return { scale: u[4]!, x: u[5]!, y: u[6]! }
}
const typeImage = (vision: Vision, format: FormatId) => {
  const image = passOf(vision, format, 'posterType').image
  if (image?.kind !== 'type') throw new Error('no type image')
  return image
}
const grid = (vision: Vision, format: FormatId) => Array.from(passOf(vision, format, 'posterFrame').uniforms.slice(4, 6))

describe('one vision, laid out in each format', () => {
  it('draws 16:9 exactly as before when no format is given', () => {
    const vision = posterVision()
    const plain = planVisionFrame(vision, features, 1, sizes.wide, NO_SIGNALS)
    expect(plain).toEqual(plan(vision, 'wide'))
    expect(subjectAt(vision, 'wide')).toEqual({ scale: expect.closeTo(0.62), x: 0.5, y: 0.5 })
  })

  it('re-flows Poster Type to its own layout for 9:16 and 1:1, kept inside the safe zone', () => {
    const vision = posterVision()
    const wide = typeImage(vision, 'wide')
    const vertical = typeImage(vision, 'vertical')
    const square = typeImage(vision, 'square')
    expect(vertical.anchors).not.toEqual(wide.anchors)
    expect(square.anchors).not.toEqual(wide.anchors)
    expect(square.anchors).not.toEqual(vertical.anchors)
    expect(vertical.bounds).toEqual(formatLayout(DEFAULT_SAFE_ZONES, 'vertical').safe)
    expect(vertical.key).not.toEqual(wide.key)
    // Every anchor point sits inside the safe zone.
    const safe = vertical.bounds
    for (const a of Object.values(vertical.anchors)) {
      expect(a.x).toBeGreaterThanOrEqual(safe.x)
      expect(a.x).toBeLessThanOrEqual(safe.x + safe.width)
      expect(a.y).toBeGreaterThanOrEqual(safe.y)
      expect(a.y).toBeLessThanOrEqual(safe.y + safe.height)
    }
  })

  it('moves the Subject into the middle of the safe zone and sizes it to it', () => {
    const vision = posterVision()
    const safe = formatLayout(DEFAULT_SAFE_ZONES, 'vertical').safe
    const at = subjectAt(vision, 'vertical')
    expect(at.x).toBeCloseTo(safe.x + safe.width / 2)
    expect(at.y).toBeCloseTo(safe.y + safe.height / 2)
    expect(at.scale).toBeCloseTo(0.62 * safe.height)
  })

  it('turns the Poster Frame grid on its side for 9:16 and squares it for 1:1', () => {
    const vision = posterVision()
    expect(grid(vision, 'wide')).toEqual([4, 3])
    expect(grid(vision, 'vertical')).toEqual([3, 4])
    expect(grid(vision, 'square')).toEqual([4, 4])
  })
})

describe('tweaks per format', () => {
  it('change only the format they were made in', () => {
    const before = posterVision()
    const vision = setFormatTweak(before, 0, SUBJECT, 'vertical', { x: 0.2, scale: 0.5 })
    const safe = formatLayout(DEFAULT_SAFE_ZONES, 'vertical').safe
    expect(subjectAt(vision, 'vertical').x).toBeCloseTo(safe.x + 0.2 * safe.width)
    expect(subjectAt(vision, 'vertical').scale).toBeCloseTo(0.5 * safe.height)
    expect(subjectAt(vision, 'wide')).toEqual(subjectAt(before, 'wide'))
    expect(subjectAt(vision, 'square')).toEqual(subjectAt(before, 'square'))
    // The owner's one edit (the layer's own settings) stays as it was.
    const layer = vision.sections[0]!.scene.layers[SUBJECT] as SubjectLayer
    expect([layer.x, layer.scale]).toEqual([0.5, 0.62])
  })

  it('are saved per format, so a second format keeps its own and the first keeps adding up', () => {
    let vision = setFormatTweak(posterVision(), 0, SUBJECT, 'vertical', { x: 0.2 })
    vision = setFormatTweak(vision, 0, SUBJECT, 'square', { y: 0.3 })
    vision = setFormatTweak(vision, 0, SUBJECT, 'vertical', { y: 0.7 })
    expect((vision.sections[0]!.scene.layers[SUBJECT] as SubjectLayer).formats).toEqual({
      vertical: { x: 0.2, y: 0.7 },
      square: { y: 0.3 }
    })
  })

  it('can move one block of Poster Type in one format without moving the others', () => {
    const before = posterVision()
    const vision = setFormatTweak(before, 0, TYPE, 'square', { anchors: { title: { y: 0.4 } } })
    const moved = typeImage(vision, 'square').anchors
    const was = typeImage(before, 'square').anchors
    expect(moved.title.y).not.toBeCloseTo(was.title.y)
    expect(moved.title.x).toBeCloseTo(was.title.x)
    expect(moved.artist).toEqual(was.artist)
    expect(typeImage(vision, 'vertical')).toEqual(typeImage(before, 'vertical'))
  })

  it('can set the Poster Frame grid for one format', () => {
    const vision = setFormatTweak(posterVision(), 0, FRAME, 'vertical', { columns: 2 })
    expect(grid(vision, 'vertical')).toEqual([2, 4])
    expect(grid(vision, 'wide')).toEqual([4, 3])
  })

  it('never carry the Subject out of the safe zone', () => {
    const vision = setFormatTweak(posterVision(), 0, SUBJECT, 'vertical', { x: 1.4, y: -0.3 })
    const safe = formatLayout(DEFAULT_SAFE_ZONES, 'vertical').safe
    expect(subjectAt(vision, 'vertical').x).toBeCloseTo(safe.x + safe.width)
    expect(subjectAt(vision, 'vertical').y).toBeCloseTo(safe.y)
  })

  it('can be cleared for one format, going back to the automatic layout', () => {
    const before = posterVision()
    let vision = setFormatTweak(before, 0, SUBJECT, 'vertical', { x: 0.2 })
    vision = setFormatTweak(vision, 0, SUBJECT, 'square', { x: 0.3 })
    vision = clearFormatTweaks(vision, 0, SUBJECT, 'vertical')
    expect(subjectAt(vision, 'vertical')).toEqual(subjectAt(before, 'vertical'))
    expect((vision.sections[0]!.scene.layers[SUBJECT] as SubjectLayer).formats).toEqual({ square: { x: 0.3 } })
    const frame = vision.sections[0]!.scene.layers[FRAME] as PosterFrameLayer
    expect(frame.formats).toBeUndefined()
  })
})
