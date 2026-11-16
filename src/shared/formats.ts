import defaults from './safe-zones.json'

/**
 * The shapes a vision is laid out in (V16). The owner edits once; the layout re-flows for each
 * format, with optional tweaks per format. A format is a shape, not an export: export formats
 * (shared/export.ts) each name the layout format they render.
 */
export type FormatId = 'wide' | 'vertical' | 'square'

export interface Format {
  id: FormatId
  label: string
  /** A reference size in pixels; only its shape matters to the layout. */
  width: number
  height: number
}

export const FORMATS: Record<FormatId, Format> = {
  wide: { id: 'wide', label: '16:9', width: 1920, height: 1080 },
  vertical: { id: 'vertical', label: '9:16', width: 1080, height: 1920 },
  square: { id: 'square', label: '1:1', width: 1080, height: 1080 }
}

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[]

export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && Object.hasOwn(FORMATS, value)
}

/** How far in from each edge, as a share of the frame's width (left, right) or height (top, bottom). */
export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface SafeZone {
  /** Where the platform's buttons, captions and bars can't cover what matters. */
  margins: Margins
  /** Optional tighter area for the focal point, so it survives feed and grid crops too. */
  focus?: Margins
}

/**
 * Safe zones per format, kept as data (safe-zones.json, or the owner's copy beside the database)
 * so they can be updated without a rebuild. A format with no zone uses the whole frame.
 */
export interface SafeZones {
  /** When the margins were last checked against the platforms' templates; null while still conservative guesses. */
  checked: string | null
  note: string
  formats: Partial<Record<FormatId, SafeZone>>
}

/** A part of the frame, as shares of its width and height. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const WHOLE_FRAME: Rect = { x: 0, y: 0, width: 1, height: 1 }

/** Reads safe zones from parsed JSON. Throws naming the first thing wrong. */
export function parseSafeZones(value: unknown): SafeZones {
  if (!isObject(value)) throw new Error('Safe zones must be an object.')
  const { checked, note, formats } = value
  if (checked !== null && typeof checked !== 'string') throw new Error('Safe zones: "checked" must be a date string or null.')
  if (!isObject(formats)) throw new Error('Safe zones: "formats" must be an object.')
  const out: SafeZones = { checked, note: typeof note === 'string' ? note : '', formats: {} }
  for (const [id, zone] of Object.entries(formats)) {
    if (!isFormatId(id)) throw new Error(`Safe zones: unknown format "${id}".`)
    if (!isObject(zone)) throw new Error(`Safe zones: ${id} must be an object.`)
    out.formats[id] = {
      margins: parseMargins(zone.margins, `${id} margins`),
      ...(zone.focus === undefined ? {} : { focus: parseMargins(zone.focus, `${id} focus`) })
    }
  }
  return out
}

function parseMargins(value: unknown, where: string): Margins {
  if (!isObject(value)) throw new Error(`Safe zones: ${where} must be an object.`)
  const out = {} as Margins
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const share = value[side]
    if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share >= 1) {
      throw new Error(`Safe zones: ${where} ${side} must be a share of the frame, from 0 up to 1.`)
    }
    out[side] = share
  }
  if (out.left + out.right >= 0.9 || out.top + out.bottom >= 0.9) throw new Error(`Safe zones: ${where} leave no room inside.`)
  return out
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const rectInside = (m: Margins): Rect => ({ x: m.left, y: m.top, width: 1 - m.left - m.right, height: 1 - m.top - m.bottom })

/** The part of a format's frame that platform overlays leave clear. */
export function safeRect(zones: SafeZones, format: FormatId): Rect {
  const zone = zones.formats[format]
  return zone ? rectInside(zone.margins) : WHOLE_FRAME
}

/** The focus area, where it has one. */
export function focusRect(zones: SafeZones, format: FormatId): Rect | null {
  const focus = zones.formats[format]?.focus
  return focus ? rectInside(focus) : null
}

/** What a frame is laid out for: its format and the part of it that is safe. */
export interface FormatLayout {
  format: FormatId
  safe: Rect
}

export function formatLayout(zones: SafeZones, format: FormatId): FormatLayout {
  return { format, safe: safeRect(zones, format) }
}

/** 16:9 on the whole frame: how a vision is drawn when nothing says otherwise. */
export const WIDE_LAYOUT: FormatLayout = { format: 'wide', safe: WHOLE_FRAME }

/** A layer's optional tweaks per format, each a patch over what the automatic layout gives it there. */
export type FormatTweaks<T> = Partial<Record<FormatId, T>>

/** What ships with the app: conservative until checked against the platforms' templates. */
export const DEFAULT_SAFE_ZONES: SafeZones = parseSafeZones(defaults)
