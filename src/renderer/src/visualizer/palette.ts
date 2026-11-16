/**
 * A vision's palette (GLOSSARY: Vision): the 3 to 5 colors a track gets within the house style.
 * Every house-style layer takes it, so the same layers look different from track to track.
 */
export type Palette = readonly string[]

export const MIN_COLORS = 3
export const MAX_COLORS = 5

/** Hot pink, violet, cyan and acid yellow: spectral, and loud against a black or off-white ground. */
export const DEFAULT_PALETTE: Palette = ['#ff2e88', '#7a5cff', '#22e0ff', '#d8ff3c']

const HEX = /^#[0-9a-f]{6}$/i

/** Why a palette can't be used, or null when it can. */
export function paletteProblem(palette: Palette): string | null {
  if (palette.length < MIN_COLORS || palette.length > MAX_COLORS) {
    return `A palette has ${MIN_COLORS} to ${MAX_COLORS} colors, not ${palette.length}.`
  }
  const bad = palette.find((c) => !HEX.test(c))
  return bad === undefined ? null : `"${bad}" is not a color like #ff2e88.`
}

/**
 * Uniform floats a palette takes: MAX_COLORS rows of (r, g, b, _), matching `palette` in
 * common.wgsl. The last row's fourth float is how many colors there are.
 */
export const PALETTE_FLOATS = MAX_COLORS * 4

/**
 * The palette as uniforms, 0 to 1 per channel. Rows past the last color repeat the palette from
 * the start, so a shader that reads any row gets one of the track's colors.
 */
export function packPalette(palette: Palette): Float32Array {
  const colors = paletteProblem(palette) === null ? palette : DEFAULT_PALETTE
  const out = new Float32Array(PALETTE_FLOATS)
  for (let i = 0; i < MAX_COLORS; i++) out.set(rgb(colors[i % colors.length]!), i * 4)
  out[PALETTE_FLOATS - 1] = colors.length
  return out
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
