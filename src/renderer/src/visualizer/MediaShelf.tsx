import { useCallback, useEffect, useState } from 'react'
import type { CoverArt, MediaItem } from '../../../shared/media'

/** What the Visualizer knows of the owner's media: the shelf (any track) and this track's cover art. */
export interface OwnMedia {
  shelf: MediaItem[]
  coverArt: CoverArt | null
}

export interface OwnMediaActions {
  addPicked(): Promise<MediaItem[]>
  remove(id: number): void
  setLogo(id: number | null): void
  attachCoverArt(): void
  removeCoverArt(): void
}

/** Reads the media shelf and the track's cover art, and changes them through the main process. */
export function useOwnMedia(trackId: number): [OwnMedia, OwnMediaActions] {
  const [shelf, setShelf] = useState<MediaItem[]>([])
  const [coverArt, setCoverArt] = useState<CoverArt | null>(null)
  const report = (what: string) => (e: unknown) => console.error(`Could not ${what}:`, e)

  useEffect(() => {
    let cancelled = false
    window.elynt.media.list().then((items) => !cancelled && setShelf(items), report('read the media shelf'))
    window.elynt.media.coverArt(trackId).then((cover) => !cancelled && setCoverArt(cover), report('read the cover art'))
    return () => {
      cancelled = true
    }
  }, [trackId])

  const addPicked = useCallback(async () => {
    const added = await window.elynt.media.addPicked()
    setShelf(await window.elynt.media.list())
    return added
  }, [])

  return [
    { shelf, coverArt },
    {
      addPicked,
      remove: (id) => void window.elynt.media.remove(id).then(setShelf, report('take it off the shelf')),
      setLogo: (id) => void window.elynt.media.setLogo(id).then(setShelf, report('set the logo')),
      attachCoverArt: () => void window.elynt.media.attachPickedCoverArt(trackId).then(setCoverArt, report('attach the cover art')),
      removeCoverArt: () =>
        void window.elynt.media.removeCoverArt(trackId).then(() => setCoverArt(null), report('remove the cover art'))
    }
  ]
}

/**
 * The media shelf: the owner's images, clips and logo, kept by path and usable on any track, and
 * this track's cover art. Nothing here is needed for a video.
 */
export function MediaShelfPanel({ media, actions }: { media: OwnMedia; actions: OwnMediaActions }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <section className="media-shelf" aria-label="Media shelf">
      <span className="scene-layer-name">Media shelf</span>
      {media.shelf.length === 0 && <span className="media-empty">Your images, clips and logo, for any track.</span>}
      <ul className="media-items">
        {media.shelf.map((item) => (
          <li key={item.id} className="media-item">
            <span title={item.path}>
              {item.name} <span className="media-type">{item.type === 'clip' ? 'clip' : 'image'}</span>
            </span>
            {item.type === 'image' && (
              <label>
                <input type="checkbox" checked={item.isLogo} onChange={(e) => actions.setLogo(e.target.checked ? item.id : null)} /> Logo
              </label>
            )}
            <button className="link" onClick={() => actions.remove(item.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        className="add"
        onClick={() => {
          setError(null)
          actions.addPicked().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        }}
      >
        Add images or clips
      </button>
      <span className="media-cover">
        {media.coverArt ? (
          <>
            Cover art: <span title={media.coverArt.path}>{media.coverArt.name}</span>{' '}
            <button className="link" onClick={actions.attachCoverArt}>
              Change
            </button>{' '}
            <button className="link" onClick={actions.removeCoverArt}>
              Remove
            </button>
          </>
        ) : (
          <button className="link" onClick={actions.attachCoverArt}>
            Attach cover art
          </button>
        )}
      </span>
      {error && <span className="media-error">{error}</span>}
    </section>
  )
}
