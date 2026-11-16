import { describe, expect, it } from 'vitest'
import { DEFAULT_SAFE_ZONES, FORMATS, parseSafeZones, safeRect } from './formats'

describe('formats', () => {
  it('are 16:9, 9:16 and 1:1', () => {
    expect(Object.values(FORMATS).map((f) => [f.label, f.width / f.height])).toEqual([
      ['16:9', 16 / 9],
      ['9:16', 9 / 16],
      ['1:1', 1]
    ])
  })
})

describe('safe zones', () => {
  it('keep conservative margins for vertical until checked against the TikTok and Instagram templates', () => {
    expect(DEFAULT_SAFE_ZONES.checked).toBeNull()
    // The working rule on 1080x1920 (research/platform-specs): clear of the top ~250 px, bottom ~400 px, right ~150 px.
    const v = safeRect(DEFAULT_SAFE_ZONES, 'vertical')
    expect(v.y * 1920).toBeGreaterThanOrEqual(250)
    expect((1 - v.y - v.height) * 1920).toBeGreaterThanOrEqual(400)
    expect((1 - v.x - v.width) * 1080).toBeGreaterThanOrEqual(150)
  })

  it('give square a margin all round and leave 16:9 the whole frame', () => {
    const s = safeRect(DEFAULT_SAFE_ZONES, 'square')
    expect(s.x).toBeGreaterThan(0)
    expect(s.y).toBeGreaterThan(0)
    expect(s.x + s.width).toBeLessThan(1)
    expect(s.y + s.height).toBeLessThan(1)
    expect(safeRect(DEFAULT_SAFE_ZONES, 'wide')).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('read from data, so new margins need no rebuild', () => {
    const zones = parseSafeZones({
      checked: '2027-01-10',
      note: 'Checked against the TikTok template',
      formats: { vertical: { margins: { top: 0.1, right: 0.1, bottom: 0.2, left: 0.05 } } }
    })
    expect(zones.checked).toBe('2027-01-10')
    expect(safeRect(zones, 'vertical')).toEqual({ x: 0.05, y: 0.1, width: 0.85, height: expect.closeTo(0.7, 9) })
    expect(safeRect(zones, 'square')).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('refuse margins that are not shares of the frame or leave no room', () => {
    const margins = (m: object) => ({ checked: null, note: '', formats: { vertical: { margins: { top: 0, right: 0, bottom: 0, left: 0, ...m } } } })
    expect(() => parseSafeZones(margins({ top: -0.1 }))).toThrow(/top/)
    expect(() => parseSafeZones(margins({ left: '10' }))).toThrow(/left/)
    expect(() => parseSafeZones(margins({ top: 0.5, bottom: 0.5 }))).toThrow(/room/)
    expect(() => parseSafeZones({ checked: null, note: '', formats: { portrait: { margins: {} } } })).toThrow(/portrait/)
    expect(() => parseSafeZones('nope')).toThrow()
  })
})
