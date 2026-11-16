import { describe, expect, it } from 'vitest'
import { DEFAULT_PALETTE, MAX_COLORS, MIN_COLORS, packPalette, PALETTE_FLOATS, paletteProblem } from './palette'

describe('a palette', () => {
  it('holds 3 to 5 colors', () => {
    expect([MIN_COLORS, MAX_COLORS]).toEqual([3, 5])
    expect(paletteProblem(['#ff0000', '#00ff00'])).toMatch(/3/)
    expect(paletteProblem(['#000000', '#111111', '#222222', '#333333', '#444444', '#555555'])).toMatch(/5/)
    expect(paletteProblem(['#ff0000', '#00ff00', '#0000ff'])).toBeNull()
  })

  it('takes colors only as #rrggbb', () => {
    expect(paletteProblem(['#ff0000', 'red', '#0000ff'])).toMatch(/red/)
  })

  it('starts from a valid house palette', () => {
    expect(paletteProblem(DEFAULT_PALETTE)).toBeNull()
  })
})

describe('packPalette', () => {
  it('packs each color as an RGB row from 0 to 1, then how many colors there are', () => {
    const packed = packPalette(['#ff0000', '#00ff80', '#0000ff'])
    expect(packed).toHaveLength(PALETTE_FLOATS)
    expect(Array.from(packed.slice(0, 4))).toEqual([1, 0, 0, 0])
    expect(packed[4]).toBe(0)
    expect(packed[5]).toBe(1)
    expect(packed[6]).toBeCloseTo(128 / 255)
    expect(packed[PALETTE_FLOATS - 1]).toBe(3)
  })

  it('repeats the colors it has into unused rows, so a shader never reads black', () => {
    const packed = packPalette(['#ff0000', '#00ff00', '#0000ff'])
    expect(Array.from(packed.slice(12, 15))).toEqual([1, 0, 0])
    expect(Array.from(packed.slice(16, 19))).toEqual([0, 1, 0])
  })

  it('falls back to the house palette for a palette that is not valid', () => {
    expect(packPalette(['nope'])).toEqual(packPalette(DEFAULT_PALETTE))
  })
})
