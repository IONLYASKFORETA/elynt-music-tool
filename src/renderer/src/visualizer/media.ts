import { shelfUrl, type MediaItem } from '../../../shared/media'
import type { PassImage } from './scene'

/**
 * The owner's own media on a layer (V18; GLOSSARY: Media shelf): an image or a clip from the
 * media shelf, or the track's cover art, placed in a Subject, Ground or Chrome layer or as the
 * Poster Frame's logo mark. Plain data: the URL is an elynt-media:// address the main process
 * resolves to the file's path, so a saved vision keeps its media for good.
 */
export type LayerMedia = ImageMedia | ClipMedia

interface MediaBase {
  /** elynt-media://shelf/<id> or elynt-media://cover/<trackId> (see src/shared/media.ts). */
  url: string
  /** The file's name, for the scene panel. */
  name: string
  /** True shows the media raw; false (the default) gives it the house-style treatment. */
  untreated: boolean
}

export interface ImageMedia extends MediaBase {
  type: 'image'
}

export interface ClipMedia extends MediaBase {
  type: 'clip'
  /** The clip's own length and frame rate, read when it went on the shelf. */
  durationSeconds: number
  fps: number
  /** The part that plays, in seconds of the clip. A null end plays to the clip's end. */
  trimStart: number
  trimEnd: number | null
  /** Plays the trimmed part over and over; otherwise it plays once and holds its last frame. */
  loop: boolean
  /** 1 is the clip's own speed; 2 twice as fast, 0.5 half. */
  speed: number
}

export const CLIP_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4] as const

export function newImageMedia(source: { url: string; name: string }): ImageMedia {
  return { type: 'image', url: source.url, name: source.name, untreated: false }
}

export function newClipMedia(source: { url: string; name: string; durationSeconds: number; fps: number }): ClipMedia {
  return {
    type: 'clip',
    url: source.url,
    name: source.name,
    untreated: false,
    durationSeconds: source.durationSeconds,
    fps: source.fps,
    trimStart: 0,
    trimEnd: null,
    loop: false,
    speed: 1
  }
}

/** A shelf item as a layer's media, treated, and for a clip playing once, whole, at its own speed. */
export function layerMediaFrom(item: MediaItem): LayerMedia {
  const source = { url: shelfUrl(item.id), name: item.name }
  if (item.type === 'image') return newImageMedia(source)
  return newClipMedia({ ...source, durationSeconds: item.durationSeconds ?? 0, fps: item.fps ?? FALLBACK_FPS })
}

/** A clip's frame rate when the shelf couldn't read one. */
const FALLBACK_FPS = 30

/**
 * Which frame of a clip shows `elapsed` seconds after its section starts, and the time to seek
 * to for it: the middle of that frame, so a seek always lands on exactly that frame. The export
 * draws every frame from this, which is what makes clips frame-accurate there.
 */
export function clipFrameAt(clip: ClipMedia, elapsed: number): { frame: number; time: number } {
  const fps = clip.fps > 0 ? clip.fps : FALLBACK_FPS
  const duration = Math.max(0, clip.durationSeconds)
  const start = Math.min(Math.max(0, clip.trimStart), duration)
  const end = Math.min(Math.max(clip.trimEnd ?? duration, start), duration)
  const length = end - start
  const played = Math.max(0, elapsed) * Math.max(0, clip.speed)
  const position = length <= 0 ? 0 : clip.loop ? played % length : Math.min(played, length)
  const first = Math.floor(start * fps + 1e-6)
  const last = Math.max(first, Math.ceil(end * fps - 1e-6) - 1, 0)
  const lastInClip = Math.max(0, Math.ceil(duration * fps - 1e-6) - 1)
  const frame = Math.min(Math.max(Math.floor((start + position) * fps + 1e-6), first), last, lastInClip)
  return { frame, time: (frame + 0.5) / fps }
}

/** One video per clip and timing, so two layers playing the same clip differently each get their own. */
export function clipKey(clip: ClipMedia): string {
  return [clip.url, clip.trimStart, clip.trimEnd ?? 'end', clip.loop ? 'loop' : 'once', clip.speed].join('|')
}

/** What a layer's pass reads for its media at t, `sectionStart` being when the clip starts playing. */
export function mediaImage(media: LayerMedia, t: number, sectionStart: number): PassImage {
  if (media.type === 'image') return { kind: 'picture', url: media.url }
  const { frame, time } = clipFrameAt(media, t - sectionStart)
  return { kind: 'clip', url: media.url, key: clipKey(media), frame, time, speed: media.speed }
}

/** The shader's media switch: 0 no media, 1 treated, 2 untreated. */
export function mediaFlag(media: LayerMedia | null): number {
  return media ? (media.untreated ? 2 : 1) : 0
}
