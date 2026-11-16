import type { FormatId, Rect } from '../../../shared/formats'

/**
 * Poster Type's words and where they sit (the layer itself is layers/poster-type.ts). Pure: the
 * renderer rasterizes the layout this gives, and nothing here touches a canvas, so it is the same
 * for the preview and the export.
 *
 * Every block hangs off an anchor given as a share of the frame, with its size a share of the
 * frame's shorter side. Each format (V16) has its own anchors, set as shares of its safe zone
 * (`anchorsInFormat` turns them into shares of the frame), and the layout keeps every block
 * inside that zone.
 */

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

/** 9:16: a tall stack low in the safe zone, title over artist over words, katakana down the right. */
export const VERTICAL_ANCHORS: TypeAnchors = {
  title: { x: 0.02, y: 0.78, alignX: 0, alignY: 1, size: 0.15, maxLength: 0.96 },
  artist: { x: 0.025, y: 0.8, alignX: 0, alignY: 0, size: 0.05, maxLength: 0.7 },
  katakana: { x: 0.98, y: 0, alignX: 1, alignY: 0, size: 0.08, maxLength: 0.6, vertical: true },
  words: { x: 0.025, y: 0.9, alignX: 0, alignY: 0, size: 0.03, maxLength: 0.6 }
}

/** 1:1: the 16:9 poster pulled in, with a narrower column for the owner's words. */
export const SQUARE_ANCHORS: TypeAnchors = {
  title: { x: 0.03, y: 0.8, alignX: 0, alignY: 1, size: 0.13, maxLength: 0.9 },
  artist: { x: 0.035, y: 0.83, alignX: 0, alignY: 0, size: 0.045, maxLength: 0.55 },
  katakana: { x: 0.97, y: 0.02, alignX: 1, alignY: 0, size: 0.07, maxLength: 0.7, vertical: true },
  words: { x: 0.62, y: 0.83, alignX: 0, alignY: 0, size: 0.026, maxLength: 0.35 }
}

/** Each format's anchors, as shares of its safe zone (16:9's zone is the whole frame). */
export const FORMAT_ANCHORS: Record<FormatId, TypeAnchors> = {
  wide: POSTER_ANCHORS,
  vertical: VERTICAL_ANCHORS,
  square: SQUARE_ANCHORS
}

/** The owner's moves of single blocks in one format, in the same shares of its safe zone. */
export type AnchorTweaks = Partial<Record<TypeBlockId, Partial<Pick<TypeAnchor, 'x' | 'y' | 'size'>>>>

/**
 * A format's anchors with the owner's tweaks, turned from shares of the safe zone into shares of
 * the frame. Anchor points are held inside the zone.
 */
export function anchorsInFormat(format: FormatId, safe: Rect, tweaks: AnchorTweaks = {}): TypeAnchors {
  const base = FORMAT_ANCHORS[format]
  const out = {} as TypeAnchors
  for (const id of TYPE_BLOCKS) {
    const a = { ...base[id], ...tweaks[id] }
    out[id] = {
      ...a,
      x: safe.x + clamp01(a.x) * safe.width,
      y: safe.y + clamp01(a.y) * safe.height,
      maxLength: a.maxLength * (a.vertical ? safe.height : safe.width)
    }
  }
  return out
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

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

/** A part of the frame, as shares of its width and height (a format's safe zone). */
export type TypeBounds = Rect

const WHOLE: TypeBounds = { x: 0, y: 0, width: 1, height: 1 }

/**
 * Lays the blocks out on their anchors. With `bounds` (a format's safe zone, V16), every block
 * is kept inside it: no line runs longer than the bounds allow, and a block that would cross
 * an edge is moved back in.
 */
export function layoutPosterType(
  text: TypeText,
  anchors: TypeAnchors,
  size: { width: number; height: number },
  measure: Measure,
  bounds: TypeBounds = WHOLE
): TypeLayout {
  const px = { x: bounds.x * size.width, y: bounds.y * size.height, width: bounds.width * size.width, height: bounds.height * size.height }
  const blocks: TypeBlock[] = []
  for (const id of TYPE_BLOCKS) {
    const content = text[id].trim()
    if (content) blocks.push(layoutBlock(id, content, anchors[id], size, measure, px))
  }
  return { ...size, blocks }
}

const fontOf = (style: TypeStyle, px: number) => `${style.weight} ${px.toFixed(2)}px ${style.family}`

function layoutBlock(
  id: TypeBlockId,
  content: string,
  anchor: TypeAnchor,
  size: { width: number; height: number },
  measure: Measure,
  bounds: TypeBounds
): TypeBlock {
  const style = STYLES[id]
  const textToSet = style.uppercase ? content.toUpperCase() : content
  let fontPx = anchor.size * Math.min(size.width, size.height)
  const maxLength = anchor.vertical
    ? Math.min(anchor.maxLength * size.height, bounds.height)
    : Math.min(anchor.maxLength * size.width, bounds.width)

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
  const x = within(anchor.x * size.width - anchor.alignX * width, width, bounds.x, bounds.width)
  const y = within(anchor.y * size.height - anchor.alignY * height, height, bounds.y, bounds.height)
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

/** Moves a span starting at `at` back inside [start, start + room]; one too big for the room starts at its start. */
function within(at: number, length: number, start: number, room: number): number {
  return Math.max(start, Math.min(at, start + room - length))
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
