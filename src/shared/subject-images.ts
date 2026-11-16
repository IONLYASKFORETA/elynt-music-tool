/**
 * Subject images (V9): pictures of the track's motif made ahead of time by the helper's local
 * image model (FLUX.2 klein 4B), for the Subject layer to show. Nothing generative runs per frame.
 * The images stay on disk; the database and the vision hold their paths.
 */

/** What a subject sits on. The house style allows only black or off-white grounds. */
export type SubjectGround = 'black' | 'off-white'

/** Starting points for a motif (the house style's mecha and occult imagery). Any words work. */
export const SUBJECT_MOTIF_IDEAS = [
  'a towering chrome mecha',
  'a glowing occult sigil',
  'a hooded figure, arms open',
  'a winged machine heart',
  'a ring of floating blades'
] as const

export interface SubjectImageRequest {
  /** What to draw, in a few words: one of the track's motifs. */
  motif: string
  ground: SubjectGround
  /** The vision's palette (#rrggbb), so the subject comes out in the track's colors. */
  palette?: readonly string[]
}

/** One generated option for a track's Subject layers. */
export interface SubjectImage {
  id: number
  trackId: number
  motif: string
  ground: SubjectGround
  /** The full prompt the model got. */
  prompt: string
  /** Where the PNG is, as the app sees it. */
  path: string
  seed: number
  model: string
  width: number
  height: number
  /** How long the model took for this image on this machine, in seconds. */
  seconds: number
  createdAt: string
}

/** Where a track's image generation has got to. A track with none has finished or never generated. */
export type SubjectJob =
  | { trackId: number; state: 'running'; stage: string; fraction?: number; /** Which image, from 1. */ image: number; of: number }
  | { trackId: number; state: 'failed'; message: string }

const GROUND_WORDS: Record<SubjectGround, string> = {
  black: 'pure black',
  'off-white': 'flat off-white'
}

/** The prompt for one subject image: the motif, drawn in the house style on a plain ground. */
export function subjectPrompt(request: SubjectImageRequest): string {
  const motif = request.motif.trim()
  if (!motif) throw new Error('Say what the subject is: a motif from the track.')
  const colors = request.palette && request.palette.length > 0 ? `, colored in ${request.palette.join(', ')}` : ''
  return (
    `${motif}, one subject, graphic poster art, mecha and occult imagery, iridescent holographic chrome, ` +
    `spectral rainbow color bleed off its edges, subtle glitch detail, sharp, high contrast${colors}, ` +
    `centered with empty space around it, isolated on a plain ${GROUND_WORDS[request.ground]} background, ` +
    'no text, no lettering, no frame'
  )
}

/**
 * The app's own scheme for media on disk. Only paths the main process knows about (a track's
 * subject images) are served; anything else is refused.
 */
export const MEDIA_SCHEME = 'elynt-media'
const MEDIA_PREFIX = `${MEDIA_SCHEME}://file/`

/** A URL the renderer can load (an <img>, or the Subject layer's picture) for a file on disk. */
export function mediaUrl(path: string): string {
  return MEDIA_PREFIX + encodeURIComponent(path)
}

/** The file path a media URL points at, or null for any other URL. */
export function mediaPath(url: string): string | null {
  if (!url.startsWith(MEDIA_PREFIX)) return null
  const rest = url.slice(MEDIA_PREFIX.length)
  if (!rest || rest.includes('/')) return null
  try {
    return decodeURIComponent(rest)
  } catch {
    return null
  }
}
