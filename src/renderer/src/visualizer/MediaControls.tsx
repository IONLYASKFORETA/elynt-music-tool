import { shelfUrl } from '../../../shared/media'
import { CLIP_SPEEDS, layerMediaFrom, newImageMedia, type ClipMedia, type ImageMedia, type LayerMedia } from './media'
import type { OwnMedia } from './MediaShelf'
import type { Layer } from './scene'

/**
 * Own media on a layer (V18), in its row of the scene panel: which shelf item or the cover art a
 * Subject, Ground or Chrome shows, untreated or not, and for a clip its trim, loop and speed; and
 * whether a Poster Frame's mark is the shelf logo. Other layers show nothing here.
 */
export function MediaControls({
  layer,
  media,
  onChange
}: {
  layer: Layer
  media: OwnMedia
  onChange(patch: Partial<Layer>): void
}) {
  if (layer.kind === 'posterFrame') {
    const logo = media.shelf.find((i) => i.isLogo)
    if (!logo && !layer.logoMedia) return null
    return (
      <>
        <label>
          <input
            type="checkbox"
            checked={layer.logoMedia !== null}
            onChange={(e) =>
              onChange({ logoMedia: e.target.checked && logo ? newImageMedia({ url: shelfUrl(logo.id), name: logo.name }) : null })
            }
          />{' '}
          My logo as the mark
        </label>
        {layer.logoMedia && (
          <Untreated media={layer.logoMedia} onChange={(logoMedia) => onChange({ logoMedia: logoMedia as ImageMedia })} />
        )}
      </>
    )
  }
  if (layer.kind !== 'subject' && layer.kind !== 'ground' && layer.kind !== 'chrome') return null

  const current = layer.media
  const pick = (url: string) => {
    if (!url) return onChange({ media: null })
    if (media.coverArt && url === media.coverArt.url) return onChange({ media: newImageMedia(media.coverArt) })
    const item = media.shelf.find((i) => layerMediaFrom(i).url === url)
    if (item) onChange({ media: layerMediaFrom(item) })
  }
  const known = new Set([...media.shelf.map((i) => layerMediaFrom(i).url), media.coverArt?.url])

  return (
    <>
      <label>
        {layer.kind === 'chrome' ? 'Reflects' : 'Media'}{' '}
        <select value={current?.url ?? ''} onChange={(e) => pick(e.target.value)}>
          <option value="">{layer.kind === 'subject' && layer.image ? 'The generated image' : 'None'}</option>
          {media.coverArt && <option value={media.coverArt.url}>Cover art</option>}
          {media.shelf.map((item) => (
            <option key={item.id} value={layerMediaFrom(item).url}>
              {item.name}
            </option>
          ))}
          {current && !known.has(current.url) && <option value={current.url}>{current.name} (not on the shelf any more)</option>}
        </select>
      </label>
      {current && <Untreated media={current} onChange={(m) => onChange({ media: m })} />}
      {current?.type === 'clip' && <ClipTimingControls clip={current} onChange={(m) => onChange({ media: m })} />}
    </>
  )
}

function Untreated({ media, onChange }: { media: LayerMedia; onChange(media: LayerMedia): void }) {
  return (
    <label title="Show it as it is, without the house-style duotone, posterize and halftone">
      <input type="checkbox" checked={media.untreated} onChange={(e) => onChange({ ...media, untreated: e.target.checked })} />{' '}
      Untreated
    </label>
  )
}

function ClipTimingControls({ clip, onChange }: { clip: ClipMedia; onChange(clip: ClipMedia): void }) {
  const seconds = (value: string) => Math.min(clip.durationSeconds, Math.max(0, Number(value) || 0))
  return (
    <>
      <label>
        From{' '}
        <input
          type="number"
          className="media-trim"
          min={0}
          max={clip.durationSeconds}
          step={0.05}
          value={clip.trimStart}
          onChange={(e) => onChange({ ...clip, trimStart: seconds(e.target.value) })}
        />
      </label>
      <label>
        to{' '}
        <input
          type="number"
          className="media-trim"
          min={0}
          max={clip.durationSeconds}
          step={0.05}
          value={clip.trimEnd ?? clip.durationSeconds}
          onChange={(e) => {
            const end = seconds(e.target.value)
            onChange({ ...clip, trimEnd: end >= clip.durationSeconds ? null : end })
          }}
        />{' '}
        s
      </label>
      <label>
        <input type="checkbox" checked={clip.loop} onChange={(e) => onChange({ ...clip, loop: e.target.checked })} /> Loop
      </label>
      <label>
        Speed{' '}
        <select value={clip.speed} onChange={(e) => onChange({ ...clip, speed: Number(e.target.value) })}>
          {CLIP_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
