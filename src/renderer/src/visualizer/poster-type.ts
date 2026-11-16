/**
 * Poster Type's words and where they sit. Pure: the renderer rasterizes the layout this gives,
 * and nothing here touches a canvas, so it is the same for the preview and the export.
 *
 * Every block hangs off an anchor given as a share of the frame, with its size a share of the
 * frame's shorter side. Another aspect ratio (V16 formats) re-flows the type by passing other
 * anchors, or the same ones, to `layoutPosterType`.
 */
import { toKatakana } from './katakana'
import type { Reactivity } from './reactivity'
import type { Credits, FrameContext, PassImage } from './scene'
import type { Tier } from './signals'

/** The blocks of Poster Type, in the order downbeats reveal them. */
export const TYPE_BLOCKS = ['title', 'artist', 'katakana', 'words'] as const
export type TypeBlockId = (typeof TYPE_BLOCKS)[number]

/** What each block says. An empty string leaves the block out. */
export type TypeText = Record<TypeBlockId, string>

export interface TypeAnchor {
  /** Where the anchor point sits, as a share of the frame's width and height. */
  x: number
  y: number
  /** Which point of the block sits on the anchor: 0 is its left (top) edge, 0.5 its middle, 1 its right (bottom) edge. */
  alignX: 0 | 0.5 | 1
  alignY: 0 | 0.5 | 1
  /** Type size as a share of the frame's shorter side. */
  size: number
  /** Longest a line may run, as a share of the frame's width (of its height, for vertical type). */
  maxLength: number
  /** Set top to bottom, one character under the next. */
  vertical?: boolean
}

export type TypeAnchors = Record<TypeBlockId, TypeAnchor>

/**
 * The 16:9 poster: big title low on the left with the artist under it, katakana running down
 * the right edge, the owner's words in a small column beside the artist.
 */
export const POSTER_ANCHORS: TypeAnchors = {
  title: { x: 0.06, y: 0.8, alignX: 0, alignY: 1, size: 0.17, maxLength: 0.72 },
  artist: { x: 0.065, y: 0.84, alignX: 0, alignY: 0, size: 0.045, maxLength: 0.45 },
  katakana: { x: 0.94, y: 0.08, alignX: 1, alignY: 0, size: 0.075, maxLength: 0.84, vertical: true },
  words: { x: 0.6, y: 0.84, alignX: 0, alignY: 0, size: 0.026, maxLength: 0.24 }
}

interface TypeStyle {
  family: string
  weight: number
  uppercase: boolean
  /** Line advance as a share of the type size. */
  lineHeight: number
  /** Too long for its line: shrink the type, or wrap onto more lines. */
  fit: 'shrink' | 'wrap'
}

/** Fonts that ship with Windows first, so the export looks the same on the owner's PC. */
const STYLES: Record<TypeBlockId, TypeStyle> = {
  title: { family: '"Arial Black", "Helvetica Neue", Impact, sans-serif', weight: 900, uppercase: true, lineHeight: 0.92, fit: 'shrink' },
  artist: { family: '"Segoe UI", "Helvetica Neue", Arial, sans-serif', weight: 700, uppercase: true, lineHeight: 1.1, fit: 'shrink' },
  katakana: { family: '"Yu Gothic", "Hiragino Sans", Meiryo, "Noto Sans JP", sans-serif', weight: 700, uppercase: false, lineHeight: 1.05, fit: 'shrink' },
  words: { family: 'Consolas, "Courier New", ui-monospace, monospace', weight: 400, uppercase: false, lineHeight: 1.3, fit: 'wrap' }
}

/** The width of a line of text set in a CSS font. The renderer measures with a 2D canvas; tests fake it. */
export type Measure = (text: string, font: string) => number

export interface TypeLine {
  text: string
  /** Where the line is drawn from, in pixels: its left, middle or right per the block's align, and its top. */
  x: number
  y: number
}

export interface TypeBlock {
  id: TypeBlockId
  /** A CSS font, ready for a canvas. */
  font: string
  fontPx: number
  align: 'left' | 'center' | 'right'
  lines: TypeLine[]
  box: { x: number; y: number; width: number; height: number }
}

export interface TypeLayout {
  width: number
  height: number
  blocks: TypeBlock[]
}

export function layoutPosterType(
  text: TypeText,
  anchors: TypeAnchors,
  size: { width: number; height: number },
  measure: Measure
): TypeLayout {
  const blocks: TypeBlock[] = []
  for (const id of TYPE_BLOCKS) {
    const content = text[id].trim()
    if (content) blocks.push(layoutBlock(id, content, anchors[id], size, measure))
  }
  return { ...size, blocks }
}

const fontOf = (style: TypeStyle, px: number) => `${style.weight} ${px.toFixed(2)}px ${style.family}`

function layoutBlock(
  id: TypeBlockId,
  content: string,
  anchor: TypeAnchor,
  size: { width: number; height: number },
  measure: Measure
): TypeBlock {
  const style = STYLES[id]
  const textToSet = style.uppercase ? content.toUpperCase() : content
  let fontPx = anchor.size * Math.min(size.width, size.height)
  const maxLength = anchor.maxLength * (anchor.vertical ? size.height : size.width)

  let rows: string[]
  let width: number
  if (anchor.vertical) {
    rows = [...textToSet.replace(/\s+/g, '')].map((c) => (c === 'ー' ? '｜' : c))
    const length = rows.length * style.lineHeight * fontPx
    if (length > maxLength) fontPx *= maxLength / length
    width = fontPx
  } else if (style.fit === 'wrap') {
    rows = wrap(textToSet, maxLength, (line) => measure(line, fontOf(style, fontPx)))
    width = Math.max(...rows.map((r) => measure(r, fontOf(style, fontPx))))
  } else {
    rows = textToSet.split('\n').map((r) => r.trim())
    // Measuring is close to linear in the size; a second pass mops up what rounding leaves over.
    for (let pass = 0; pass < 2; pass++) {
      const widest = Math.max(...rows.map((r) => measure(r, fontOf(style, fontPx))))
      if (widest > maxLength) fontPx *= maxLength / widest
    }
    width = Math.min(maxLength, Math.max(...rows.map((r) => measure(r, fontOf(style, fontPx)))))
  }

  const advance = style.lineHeight * fontPx
  const height = rows.length * advance
  const x = anchor.x * size.width - anchor.alignX * width
  const y = anchor.y * size.height - anchor.alignY * height
  const align = anchor.vertical ? 'center' : anchor.alignX === 0 ? 'left' : anchor.alignX === 1 ? 'right' : 'center'
  const lineX = align === 'left' ? x : align === 'right' ? x + width : x + width / 2
  return {
    id,
    font: fontOf(style, fontPx),
    fontPx,
    align,
    lines: rows.map((r, i) => ({ text: r, x: lineX, y: y + i * advance })),
    box: { x, y, width, height }
  }
}

/** Greedy word wrap, keeping the line breaks that were typed. A word too long for a line gets one to itself. */
function wrap(text: string, maxWidth: number, widthOf: (line: string) => number): string[] {
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && widthOf(next) > maxWidth) {
        out.push(line)
        line = word
      } else line = next
    }
    out.push(line)
  }
  return out
}

/** How long a block takes to snap in after its downbeat, in seconds. */
const REVEAL_SECONDS = 0.12
/** A downbeat this close before the section's start still belongs to it. */
const EARLY = 0.02

/**
 * How far each block is revealed at t, 0 to 1. Each block with something in it comes in on the
 * next downbeat of its section, in order. With no downbeats in the section everything shows from
 * its start; when the section runs out of downbeats the rest come in on the last one.
 */
export function typeReveals(text: TypeText, downbeats: readonly number[], sectionStart: number, t: number): Record<TypeBlockId, number> {
  const beats = downbeats.filter((d) => d >= sectionStart - EARLY)
  const out = { title: 0, artist: 0, katakana: 0, words: 0 }
  let order = 0
  for (const id of TYPE_BLOCKS) {
    if (!text[id].trim()) continue
    const at = beats.length === 0 ? sectionStart - REVEAL_SECONDS : beats[Math.min(order, beats.length - 1)]!
    out[id] = Math.min(1, Math.max(0, (t - at) / REVEAL_SECONDS))
    order++
  }
  return out
}

/**
 * Poster Type (layer library): big set type for the title, the artist's name, katakana and the
 * owner's own words, each block snapping in on a downbeat. The title comes from the track and the
 * name from the artist profile (through the vision's credits), so neither is stored here.
 */
export interface PosterTypeLayer {
  kind: 'posterType'
  reactivity: Reactivity
  /** The owner's own words, set small. Empty leaves them out. */
  words: string
  /** Katakana as the owner edited it; null means generate it from the title. */
  katakana: string | null
  /** How much the spectral chrome tints the white type, 0 to 1. */
  chrome: number
  /** How hard the type slices sideways as it snaps in, 0 to 1. */
  glitch: number
}

export const POSTER_TYPE_DEFAULTS: Omit<PosterTypeLayer, 'kind' | 'reactivity'> = {
  words: '',
  katakana: null,
  chrome: 0.35,
  glitch: 0.5
}

/** The katakana a Poster Type shows: the owner's edit, or what the title reads as. */
export function posterKatakana(layer: PosterTypeLayer, title: string): string {
  return layer.katakana ?? toKatakana(title)
}

export function posterTypeText(layer: PosterTypeLayer, credits: Credits): TypeText {
  return { title: credits.title, artist: credits.artist, katakana: posterKatakana(layer, credits.title), words: layer.words }
}

export const POSTER_TYPE_RESPONSES: Record<Tier, (layer: PosterTypeLayer, amount: number) => PosterTypeLayer> = {
  hard: (l, a) => ({ ...l, glitch: clamp01(l.glitch + a), chrome: clamp01(l.chrome + 0.5 * a) }),
  medium: (l, a) => ({ ...l, glitch: clamp01(l.glitch + 0.4 * a) }),
  slow: (l, a) => ({ ...l, chrome: clamp01(l.chrome + 0.3 * a) })
}

/**
 * One frame of Poster Type: the text and anchors to rasterize, and its uniforms, each block's
 * reveal (p0, in TYPE_BLOCKS order) then (chrome, glitch).
 */
export function posterTypePass(
  layer: PosterTypeLayer,
  context: FrameContext,
  downbeats: readonly number[],
  t: number
): { params: number[]; image: PassImage } {
  const text = posterTypeText(layer, context.credits)
  const reveals = typeReveals(text, downbeats, context.sectionStart, t)
  return {
    params: [...TYPE_BLOCKS.map((id) => reveals[id]), layer.chrome, layer.glitch],
    image: { kind: 'type', key: JSON.stringify([text, POSTER_ANCHORS]), text, anchors: POSTER_ANCHORS }
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
