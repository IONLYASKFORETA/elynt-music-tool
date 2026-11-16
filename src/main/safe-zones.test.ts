import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SAFE_ZONES } from '../shared/formats'
import { loadSafeZones } from './safe-zones'

const file = () => join(mkdtempSync(join(tmpdir(), 'elynt-safe-')), 'safe-zones.json')

describe('loading safe zones', () => {
  it('uses the margins that ship with the app when the owner has no file of their own', () => {
    expect(loadSafeZones(file())).toEqual(DEFAULT_SAFE_ZONES)
  })

  it("reads the owner's file, so checked margins need no rebuild", () => {
    const path = file()
    const zones = { checked: '2027-01-10', note: 'From the TikTok template', formats: { vertical: { margins: { top: 0.1, right: 0.12, bottom: 0.2, left: 0.05 } } } }
    writeFileSync(path, JSON.stringify(zones))
    expect(loadSafeZones(path)).toEqual(zones)
  })

  it('falls back to the shipped margins, and says why, when the file is broken', () => {
    const path = file()
    writeFileSync(path, '{ "checked": null, "formats": { "vertical": { "margins": { "top": 2 } } } }')
    const warn = vi.fn()
    expect(loadSafeZones(path, warn)).toEqual(DEFAULT_SAFE_ZONES)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/top/))
  })
})
