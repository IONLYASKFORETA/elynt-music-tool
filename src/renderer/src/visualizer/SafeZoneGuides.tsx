import { focusRect, safeRect, type FormatId, type Rect, type SafeZones } from '../../../shared/formats'

const inset = (r: Rect): React.CSSProperties => ({
  left: `${r.x * 100}%`,
  top: `${r.y * 100}%`,
  width: `${r.width * 100}%`,
  height: `${r.height * 100}%`
})

/**
 * Guides over the preview for the format's safe zone (V16): the area the platforms' buttons and
 * captions leave clear, and the focus area that survives feed and grid crops. Drawn in the page,
 * never into the picture, so exports don't carry them. A format with no zone (16:9) shows none.
 */
export function SafeZoneGuides({ zones, format }: { zones: SafeZones; format: FormatId }) {
  if (!zones.formats[format]) return null
  const focus = focusRect(zones, format)
  return (
    <div className="safe-zones" aria-hidden>
      <div className="safe-zone" style={inset(safeRect(zones, format))}>
        <span className="safe-zone-label">{zones.checked ? `Safe zone (checked ${zones.checked})` : 'Safe zone (conservative)'}</span>
      </div>
      {focus && <div className="safe-zone-focus" style={inset(focus)} />}
    </div>
  )
}
