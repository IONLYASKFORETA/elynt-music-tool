import { describe, expect, it } from 'vitest'
import { layoutPosterType, POSTER_ANCHORS, typeReveals, type Measure, type TypeAnchors, type TypeText } from './type-layout'

/** Every character is 0.6 of the font size wide. */
const measure: Measure = (text, font) => text.length * 0.6 * Number(/([\d.]+)px/.exec(font)![1])

const text: TypeText = { title: 'Neon Drive', artist: 'Elynt', katakana: 'ネオン', words: '' }
const landscape = { width: 1920, height: 1080 }

const block = (layout: ReturnType<typeof layoutPosterType>, id: string) => layout.blocks.find((b) => b.id === id)

describe('layoutPosterType', () => {
  it('sits each block on its anchor, a share of the frame', () => {
    const anchors: TypeAnchors = {
      ...POSTER_ANCHORS,
      title: { x: 0.1, y: 0.8, alignX: 0, alignY: 1, size: 0.1, maxLength: 0.8 }
    }
    const title = block(layoutPosterType(text, anchors, landscape, measure), 'title')!
    // Bottom-left corner of the block on (192, 864); the size is a share of the shorter side.
    expect(title.box.x).toBeCloseTo(192)
    expect(title.box.y + title.box.height).toBeCloseTo(864)
    expect(title.fontPx).toBeCloseTo(108)
    expect(title.lines[0]!.x).toBeCloseTo(192)
  })

  it('re-flows the same anchors onto a frame of another shape', () => {
    const portrait = { width: 1080, height: 1920 }
    const wide = block(layoutPosterType(text, POSTER_ANCHORS, landscape, measure), 'artist')!
    const tall = block(layoutPosterType(text, POSTER_ANCHORS, portrait, measure), 'artist')!
    expect(tall.box.x / portrait.width).toBeCloseTo(wide.box.x / landscape.width)
    expect(tall.box.y / portrait.height).toBeCloseTo(wide.box.y / landscape.height)
    expect(tall.fontPx).toBeCloseTo(wide.fontPx)
  })

  it('right-aligns a block anchored by its right edge', () => {
    const anchors: TypeAnchors = { ...POSTER_ANCHORS, artist: { x: 0.9, y: 0.1, alignX: 1, alignY: 0, size: 0.05, maxLength: 0.5 } }
    const artist = block(layoutPosterType(text, anchors, landscape, measure), 'artist')!
    expect(artist.align).toBe('right')
    expect(artist.box.x + artist.box.width).toBeCloseTo(1728)
    expect(artist.lines[0]!.x).toBeCloseTo(1728)
  })

  it('sets the title and artist in capitals', () => {
    const layout = layoutPosterType(text, POSTER_ANCHORS, landscape, measure)
    expect(block(layout, 'title')!.lines.map((l) => l.text)).toEqual(['NEON DRIVE'])
    expect(block(layout, 'artist')!.lines.map((l) => l.text)).toEqual(['ELYNT'])
  })

  it('shrinks a long title until it fits its width', () => {
    const anchors: TypeAnchors = { ...POSTER_ANCHORS, title: { x: 0, y: 1, alignX: 0, alignY: 1, size: 0.2, maxLength: 0.5 } }
    const long = { ...text, title: 'A Very Long Title For A Track' }
    const title = block(layoutPosterType(long, anchors, landscape, measure), 'title')!
    expect(title.lines).toHaveLength(1)
    expect(title.box.width).toBeLessThanOrEqual(960 + 0.01)
    expect(title.fontPx).toBeLessThan(0.2 * 1080)
  })

  it("wraps the owner's words to their width and keeps their own line breaks", () => {
    const anchors: TypeAnchors = { ...POSTER_ANCHORS, words: { x: 0, y: 0, alignX: 0, alignY: 0, size: 0.1, maxLength: 0.25 } }
    // 108 px type: 64.8 px a character, so 7 characters fit in 480 px.
    const words = { ...text, words: 'one two three\nfour' }
    const lines = block(layoutPosterType(words, anchors, landscape, measure), 'words')!.lines
    expect(lines.map((l) => l.text)).toEqual(['one two', 'three', 'four'])
    expect(lines[1]!.y).toBeGreaterThan(lines[0]!.y)
  })

  it('sets katakana vertically, one character under the next, with the long mark turned upright', () => {
    const anchors: TypeAnchors = {
      ...POSTER_ANCHORS,
      katakana: { x: 0.9, y: 0.1, alignX: 1, alignY: 0, size: 0.05, maxLength: 0.8, vertical: true }
    }
    const kana = block(layoutPosterType({ ...text, katakana: 'スター' }, anchors, landscape, measure), 'katakana')!
    expect(kana.lines.map((l) => l.text)).toEqual(['ス', 'タ', '｜'])
    expect(new Set(kana.lines.map((l) => l.x)).size).toBe(1)
    expect(kana.lines[2]!.y).toBeGreaterThan(kana.lines[1]!.y)
    expect(kana.box.y).toBeCloseTo(108)
  })

  it('keeps every block inside the safe zone it is given, moving and shrinking it to fit', () => {
    const portrait = { width: 1080, height: 1920 }
    // Anchors that would run off every edge of a 1080x1920 frame.
    const anchors: TypeAnchors = {
      title: { x: 0, y: 1, alignX: 0, alignY: 1, size: 0.3, maxLength: 1 },
      artist: { x: 1, y: 1, alignX: 1, alignY: 0, size: 0.05, maxLength: 1 },
      katakana: { x: 1, y: 0, alignX: 1, alignY: 0, size: 0.1, maxLength: 1, vertical: true },
      words: { x: 0, y: 0, alignX: 0, alignY: 1, size: 0.03, maxLength: 1 }
    }
    const bounds = { x: 0.06, y: 0.15, width: 0.78, height: 0.62 }
    const layout = layoutPosterType({ ...text, katakana: 'ネオンドライブ', words: 'out now' }, anchors, portrait, measure, bounds)
    expect(layout.blocks).toHaveLength(4)
    for (const b of layout.blocks) {
      expect(b.box.x).toBeGreaterThanOrEqual(0.06 * 1080 - 0.01)
      expect(b.box.y).toBeGreaterThanOrEqual(0.15 * 1920 - 0.01)
      expect(b.box.x + b.box.width).toBeLessThanOrEqual(0.84 * 1080 + 0.01)
      expect(b.box.y + b.box.height).toBeLessThanOrEqual(0.77 * 1920 + 0.01)
      for (const line of b.lines) expect(line.y).toBeGreaterThanOrEqual(b.box.y - 0.01)
    }
    const title = block(layout, 'title')!
    expect(title.lines[0]!.x).toBeCloseTo(title.box.x)
  })

  it('leaves out a block with nothing in it', () => {
    const layout = layoutPosterType(text, POSTER_ANCHORS, landscape, measure)
    expect(layout.blocks.map((b) => b.id)).toEqual(['title', 'artist', 'katakana'])
  })
})

describe('typeReveals', () => {
  const downbeats = [0, 2, 4, 6, 8, 10]
  const all: TypeText = { title: 'Neon', artist: 'Elynt', katakana: 'ネオン', words: 'hi' }

  it('reveals one block on each downbeat of the section, in order', () => {
    expect(typeReveals(all, downbeats, 2, 1.9)).toEqual({ title: 0, artist: 0, katakana: 0, words: 0 })
    expect(typeReveals(all, downbeats, 2, 2.5)).toEqual({ title: 1, artist: 0, katakana: 0, words: 0 })
    expect(typeReveals(all, downbeats, 2, 6.5)).toEqual({ title: 1, artist: 1, katakana: 1, words: 0 })
    expect(typeReveals(all, downbeats, 2, 8.5)).toEqual({ title: 1, artist: 1, katakana: 1, words: 1 })
  })

  it('snaps in quickly on the downbeat', () => {
    const title = typeReveals(all, downbeats, 2, 2.05).title
    expect(title).toBeGreaterThan(0)
    expect(title).toBeLessThan(1)
  })

  it('skips empty blocks so they never take a downbeat', () => {
    expect(typeReveals({ ...all, katakana: '' }, downbeats, 2, 6.5).words).toBe(1)
  })

  it('shows everything from the start of the section when there are no downbeats to reveal on', () => {
    expect(typeReveals(all, [], 2, 2)).toEqual({ title: 1, artist: 1, katakana: 1, words: 1 })
  })

  it('reveals the blocks left over on the last downbeat when a section runs short', () => {
    expect(typeReveals(all, [0, 2, 4], 2, 4.5)).toEqual({ title: 1, artist: 1, katakana: 1, words: 1 })
  })
})
