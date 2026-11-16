import { posterKatakana } from './layers/poster-type'
import type { Credits, Layer } from './scene'
import { SubjectOptions } from './SubjectOptions'

/**
 * The settings only poster layers have, shown in a layer's row of the scene panel: Poster Type's
 * katakana (generated from the title, editable) and the owner's own words, and the Subject's image:
 * picked from the options the local image model generated (V9). The owner's own images and
 * clips come from the media shelf (V18, MediaControls), which keeps them for good.
 * Other layers show nothing here.
 */
export function PosterLayerControls({
  layer,
  credits,
  trackId,
  palette,
  onChange
}: {
  layer: Layer
  credits: Credits | undefined
  /** The track the scene is for: its generated subject images are offered. */
  trackId?: number
  palette: readonly string[]
  onChange(patch: Partial<Layer>): void
}) {
  if (layer.kind === 'posterType') {
    const title = credits?.title ?? ''
    return (
      <>
        <label>
          Katakana{' '}
          <input
            className="poster-katakana"
            value={posterKatakana(layer, title)}
            onChange={(e) => onChange({ katakana: e.target.value })}
          />
        </label>
        {layer.katakana !== null && (
          <button className="link" onClick={() => onChange({ katakana: null })} title="Generate it again from the title">
            From the title
          </button>
        )}
        <label>
          Your words{' '}
          <textarea
            className="poster-words"
            rows={2}
            value={layer.words}
            placeholder="Out now"
            onChange={(e) => onChange({ words: e.target.value })}
          />
        </label>
      </>
    )
  }
  // The owner's own images now come from the media shelf (V18, MediaControls), which keeps them for good.
  if (layer.kind === 'subject' && layer.image) {
    return (
      <>
        {trackId !== undefined && (
          <SubjectOptions trackId={trackId} image={layer.image} palette={palette} onPick={(image) => onChange({ image })} />
        )}
        {layer.image && (
          <button className="link" onClick={() => onChange({ image: null })}>
            Clear image
          </button>
        )}
      </>
    )
  }
  return null
}
