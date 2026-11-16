import { useState } from 'react'
import { MediaControls } from './MediaControls'
import type { OwnMedia } from './MediaShelf'
import { PosterLayerControls } from './PosterLayerControls'
import { MAX_COLORS, MIN_COLORS } from './palette'
import { PICKABLE_SIGNALS, signalLabel, type Reactivity } from './reactivity'
import {
  activeLayerCount,
  canAddLayer,
  countsTowardLimit,
  EXEMPT_KINDS,
  LAYER_NAMES,
  MAX_ACTIVE_LAYERS,
  newLayer,
  type LayerKind
} from './scene'
import { SIGNALS } from './signals'
import {
  acceptCoverArt,
  addSectionLayer,
  removeSectionLayer,
  setVisionPalette,
  updateSectionLayer,
  visionImages,
  type Vision
} from './vision'

/** Layer kinds the owner can add between Ground and Finish: every kind in the layer library but those two. */
const ADDABLE_KINDS = (Object.keys(LAYER_NAMES) as LayerKind[]).filter((k) => !EXEMPT_KINDS.includes(k))

/**
 * A basic scene panel: pick a section, then for each of its layers what it reacts to and how
 * strongly. Active layers can be added (up to the limit) and removed.
 */
const NO_MEDIA: OwnMedia = { shelf: [], coverArt: null }

export function ScenePanel({
  vision,
  media = NO_MEDIA,
  onChange
}: {
  vision: Vision
  /** The media shelf and the track's cover art, which Subject, Ground, Chrome and Poster Frame can use. */
  media?: OwnMedia
  onChange(vision: Vision): void
}) {
  const [picked, setPicked] = useState(0)
  const index = Math.min(picked, vision.sections.length - 1)
  const section = vision.sections[index]!
  const { scene } = section
  const active = activeLayerCount(scene)

  const setReactivity = (layerIndex: number, reactivity: Reactivity) =>
    onChange(updateSectionLayer(vision, index, layerIndex, { reactivity }))

  const palette = vision.palette
  const setPalette = (colors: string[]) => onChange(setVisionPalette(vision, colors))

  // The vision never asks for media; with cover art on the track, it offers it as a Subject.
  const cover = media.coverArt
  const offerCover = cover && !visionImages(vision).includes(cover.url) && canAddLayer(scene, 'subject')

  return (
    <section className="scene-panel" aria-label="Scenes">
      <div className="scene-palette" aria-label="Palette">
        <span className="scene-layer-name">Palette</span>
        {palette.map((color, i) => (
          <span key={i} className="scene-swatch">
            <input
              type="color"
              aria-label={`Color ${i + 1}`}
              value={color}
              onChange={(e) => setPalette(palette.map((c, j) => (j === i ? e.target.value : c)))}
            />
            {palette.length > MIN_COLORS && (
              <button className="link" aria-label={`Remove color ${i + 1}`} onClick={() => setPalette(palette.filter((_, j) => j !== i))}>
                ×
              </button>
            )}
          </span>
        ))}
        {palette.length < MAX_COLORS && (
          <button className="link" onClick={() => setPalette([...palette, palette[0]!])}>
            Add color
          </button>
        )}
      </div>

      <div className="scene-sections" role="tablist">
        {vision.sections.map((s, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === index}
            className={i === index ? 'scene-section picked' : 'scene-section'}
            onClick={() => setPicked(i)}
          >
            {s.label[0]!.toUpperCase() + s.label.slice(1)} <span className="scene-section-time">{clock(s.start)}</span>
          </button>
        ))}
      </div>

      {offerCover && (
        <div className="scene-cover-offer">
          This track has cover art.{' '}
          <button className="link" onClick={() => onChange(acceptCoverArt(vision, index, cover))}>
            Use it as the Subject here
          </button>
        </div>
      )}

      <ol className="scene-layers">
        {scene.layers.map((layer, i) => (
          <li key={i} className="scene-layer">
            <span className="scene-layer-name">{LAYER_NAMES[layer.kind]}</span>
            <label>
              Reacts to{' '}
              <select
                value={layer.reactivity.reactsTo}
                onChange={(e) =>
                  setReactivity(i, { ...layer.reactivity, reactsTo: e.target.value as Reactivity['reactsTo'] })
                }
              >
                {PICKABLE_SIGNALS.map((name) => (
                  <option key={name} value={name}>
                    {signalLabel(name)}
                    {name !== 'none' && ` (${SIGNALS[name].tier})`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Strength{' '}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layer.reactivity.strength}
                disabled={layer.reactivity.reactsTo === 'none'}
                onChange={(e) => setReactivity(i, { ...layer.reactivity, strength: Number(e.target.value) })}
              />
            </label>
            <PosterLayerControls
              layer={layer}
              credits={vision.credits}
              onChange={(patch) => onChange(updateSectionLayer(vision, index, i, patch))}
            />
            <MediaControls layer={layer} media={media} onChange={(patch) => onChange(updateSectionLayer(vision, index, i, patch))} />
            {countsTowardLimit(layer.kind) && (
              <button className="link" onClick={() => onChange(removeSectionLayer(vision, index, i))}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ol>

      <div className="scene-add">
        {ADDABLE_KINDS.map((kind) => (
          <button
            key={kind}
            className="add"
            disabled={!canAddLayer(scene, kind)}
            onClick={() => onChange(addSectionLayer(vision, index, newLayer(kind)))}
          >
            Add {LAYER_NAMES[kind]}
          </button>
        ))}
        <span className="scene-count">
          {active} of {MAX_ACTIVE_LAYERS} active layers (Ground and Finish don't count)
        </span>
      </div>
    </section>
  )
}

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
