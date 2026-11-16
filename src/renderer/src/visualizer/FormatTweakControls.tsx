import { useState } from 'react'
import { FORMATS, WHOLE_FRAME, type FormatId } from '../../../shared/formats'
import { clearFormatTweaks, hasFormatTweak, setFormatTweak } from './formats'
import { POSTER_FRAME } from './layers/poster-frame'
import { FORMAT_ANCHORS, TYPE_BLOCKS, type TypeBlockId } from './type-layout'
import type { Vision } from './vision'

const BLOCK_NAMES: Record<TypeBlockId, string> = { title: 'Title', artist: 'Artist', katakana: 'Katakana', words: 'Words' }

/**
 * The optional per-format tweaks of one poster layer (V16), for the format the preview shows:
 * where the Subject sits and how big, Poster Frame's grid, and where each Poster Type block
 * hangs. Positions are shares of the format's safe zone. Other layers show nothing here.
 */
export function FormatTweakControls({
  vision,
  sectionIndex,
  layerIndex,
  format,
  onChange
}: {
  vision: Vision
  sectionIndex: number
  layerIndex: number
  format: FormatId
  onChange(vision: Vision): void
}) {
  const [block, setBlock] = useState<TypeBlockId>('title')
  const layer = vision.sections[sectionIndex]!.scene.layers[layerIndex]!
  const name = FORMATS[format].label
  const set = (patch: Parameters<typeof setFormatTweak>[4]) => onChange(setFormatTweak(vision, sectionIndex, layerIndex, format, patch))
  const reset = hasFormatTweak(vision, sectionIndex, layerIndex, format) && (
    <button className="link" onClick={() => onChange(clearFormatTweaks(vision, sectionIndex, layerIndex, format))} title={`Back to the automatic ${name} layout`}>
      Reset {name}
    </button>
  )

  if (layer.kind === 'subject') {
    const at = { x: layer.x, y: layer.y, scale: layer.scale, ...layer.formats?.[format] }
    return (
      <span className="format-tweaks" aria-label={`Placement in ${name}`}>
        <span className="format-tweaks-name">In {name}</span>
        <Slider label="X" value={at.x} onChange={(x) => set({ x })} />
        <Slider label="Y" value={at.y} onChange={(y) => set({ y })} />
        <Slider label="Size" value={at.scale} min={0.1} max={1.2} onChange={(scale) => set({ scale })} />
        {reset}
      </span>
    )
  }
  if (layer.kind === 'posterFrame') {
    const at = POSTER_FRAME.place!(layer, { format, safe: WHOLE_FRAME })
    return (
      <span className="format-tweaks" aria-label={`Grid in ${name}`}>
        <span className="format-tweaks-name">In {name}</span>
        <Count label="Columns" value={at.columns} onChange={(columns) => set({ columns })} />
        <Count label="Rows" value={at.rows} onChange={(rows) => set({ rows })} />
        {reset}
      </span>
    )
  }
  if (layer.kind === 'posterType') {
    const at = { ...FORMAT_ANCHORS[format][block], ...layer.formats?.[format]?.anchors?.[block] }
    return (
      <span className="format-tweaks" aria-label={`Type layout in ${name}`}>
        <span className="format-tweaks-name">In {name}</span>
        <select aria-label="Type block" value={block} onChange={(e) => setBlock(e.target.value as TypeBlockId)}>
          {TYPE_BLOCKS.map((id) => (
            <option key={id} value={id}>
              {BLOCK_NAMES[id]}
            </option>
          ))}
        </select>
        <Slider label="X" value={at.x} onChange={(x) => set({ anchors: { [block]: { x } } })} />
        <Slider label="Y" value={at.y} onChange={(y) => set({ anchors: { [block]: { y } } })} />
        <Slider label="Size" value={at.size} min={0.01} max={0.3} step={0.005} onChange={(size) => set({ anchors: { [block]: { size } } })} />
        {reset}
      </span>
    )
  }
  return null
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01
}: {
  label: string
  value: number
  onChange(value: number): void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label>
      {label}{' '}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function Count({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return (
    <label>
      {label}{' '}
      <input
        className="format-count"
        type="number"
        min={1}
        max={12}
        value={value}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value))
          if (n >= 1 && n <= 12) onChange(n)
        }}
      />
    </label>
  )
}
