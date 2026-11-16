import { fileExtension } from './paths'

/**
 * The media shelf (V18; GLOSSARY: Media shelf): the owner's reusable images, clips and logo,
 * kept as file paths (ADR 0002: media stays on disk) and usable on any track.
 */
export interface MediaItem {
  id: number
  type: MediaType
  path: string
  /** The file's name, as the shelf shows it. */
  name: string
  /** The one shelf image used as the logo mark, if any. */
  isLogo: boolean
  /** A clip's length and frame rate, read when it was added; null for images. */
  durationSeconds: number | null
  fps: number | null
  addedAt: string
}

export type MediaType = 'image' | 'clip'

/** A track's cover art: offered to the vision as a Subject, never required. */
export interface CoverArt {
  trackId: number
  path: string
  name: string
  url: string
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
export const CLIP_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'm4v']

export function mediaTypeOf(path: string): MediaType | null {
  const ext = fileExtension(path)
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (CLIP_EXTENSIONS.includes(ext)) return 'clip'
  return null
}

/** The scheme the main process serves media on. It only ever serves paths the database holds. */
export const MEDIA_SCHEME = 'elynt-media'

export function shelfUrl(id: number): string {
  return `${MEDIA_SCHEME}://shelf/${id}`
}

export function coverArtUrl(trackId: number): string {
  return `${MEDIA_SCHEME}://cover/${trackId}`
}

export type MediaAddress = { from: 'shelf'; id: number } | { from: 'cover'; trackId: number }

export function parseMediaUrl(url: string): MediaAddress | null {
  const match = new RegExp(`^${MEDIA_SCHEME}://(shelf|cover)/(\\d+)/?$`).exec(url)
  if (!match) return null
  const n = Number(match[2])
  return match[1] === 'shelf' ? { from: 'shelf', id: n } : { from: 'cover', trackId: n }
}
