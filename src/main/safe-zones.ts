import { existsSync, readFileSync } from 'node:fs'
import { DEFAULT_SAFE_ZONES, parseSafeZones, type SafeZones } from '../shared/formats'

/**
 * The safe zones the Visualizer lays out and guides with. An owner's safe-zones.json beside the
 * database replaces the shipped margins once they are checked against the platforms' templates,
 * with no rebuild. A broken file is reported and the shipped margins are used.
 */
export function loadSafeZones(file: string, warn: (message: string) => void = console.warn): SafeZones {
  if (!existsSync(file)) return DEFAULT_SAFE_ZONES
  try {
    return parseSafeZones(JSON.parse(readFileSync(file, 'utf8')))
  } catch (e) {
    warn(`Ignoring ${file}: ${e instanceof Error ? e.message : String(e)}`)
    return DEFAULT_SAFE_ZONES
  }
}
