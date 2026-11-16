import { useState, type ReactNode } from 'react'
import type {
  LiveDevice,
  LiveParameter,
  LiveRouting,
  LiveSet,
  LiveTrack,
  NativeDevice,
  RackBranch
} from '../../shared/live-set'

/**
 * The Live Set reader (M1): pick an .als and see what the app read from it, as a plain tree.
 * Live tracks are nested under their groups; each shows routing, mixer, sends and its device chain.
 */
export function LiveSetTree() {
  const [liveSet, setLiveSet] = useState<LiveSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    setBusy(true)
    setError(null)
    try {
      const read = await window.elynt.liveSet.pickAndRead()
      if (read) setLiveSet(read)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const topLevel = liveSet?.tracks.filter((t) => t.groupId === null || t.groupId === 'unknown') ?? []

  return (
    <section className="live-set">
      <div className="live-set-head">
        <h2>Live Set</h2>
        <button type="button" className="secondary" disabled={busy} onClick={() => void pick()}>
          {busy ? 'Reading…' : liveSet ? 'Pick another .als' : 'Pick a Live Set (.als)'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {liveSet && (
        <>
          <p className="hint">
            {liveSet.path} · {liveSet.creator} (MinorVersion {liveSet.minorVersion})
          </p>
          <ul className="tree">
            {topLevel.map((t) => (
              <TrackNode key={String(t.id)} track={t} all={liveSet.tracks} />
            ))}
            {liveSet.returns.map((t) => (
              <TrackNode key={`r${String(t.id)}`} track={t} all={liveSet.tracks} />
            ))}
            {liveSet.main !== 'unknown' && <TrackNode track={liveSet.main} all={liveSet.tracks} />}
          </ul>
        </>
      )}
    </section>
  )
}

function TrackNode({ track, all }: { track: LiveTrack; all: LiveTrack[] }) {
  const children = track.kind === 'group' ? all.filter((t) => t.groupId === track.id) : []
  const m = track.mixer
  return (
    <li>
      <details open={track.kind === 'group'}>
        <summary>
          <strong>{track.name}</strong> <span className="muted">{track.kind}</span>
          {m.muted === true && <span className="tag">muted</span>}
          {m.soloed === true && <span className="tag">solo</span>}
        </summary>
        <ul className="tree">
          <li>
            Out: {routingText(track.output)} · Volume {dbText(m.volumeDb)} · Pan {panText(m.pan)}
          </li>
          {m.sends.length > 0 && (
            <li>Sends: {m.sends.map((s) => `${s.returnName} ${dbText(s.db)}`).join(', ')}</li>
          )}
          {track.devices.length > 0 && (
            <li>
              Devices
              <DeviceList devices={track.devices} />
            </li>
          )}
          {children.map((t) => (
            <TrackNode key={String(t.id)} track={t} all={all} />
          ))}
        </ul>
      </details>
    </li>
  )
}

function DeviceList({ devices }: { devices: LiveDevice[] }) {
  return (
    <ol className="tree">
      {devices.map((d, i) => (
        <DeviceNode key={i} device={d} />
      ))}
    </ol>
  )
}

function DeviceNode({ device }: { device: LiveDevice }) {
  const off = device.on === false ? <span className="tag">off</span> : null
  if (!isNative(device)) {
    return (
      <li>
        {device.name} <span className="muted">
          {device.plugin.format} plug-in · {device.plugin.id}
        </span>
        {off}
      </li>
    )
  }
  return <NativeDeviceNode device={device} off={off} />
}

function isNative(device: LiveDevice): device is NativeDevice {
  return device.kind === 'native' || device.kind === 'rack'
}

function NativeDeviceNode({ device, off }: { device: NativeDevice; off: ReactNode }) {
  const params = Object.entries(device.parameters)
  const branches: [string, RackBranch[]][] = [
    ['Chains', device.branches ?? []],
    ['Return chains', device.returnBranches ?? []]
  ]
  return (
    <li>
      <details>
        <summary>
          {device.name} <span className="muted">{device.type}</span>
          {off}
          {device.sidechain && device.sidechain.on === true && (
            <span className="tag">sidechain: {routingText(device.sidechain)}</span>
          )}
        </summary>
        {params.length > 0 && (
          <ul className="tree params">
            {params.map(([path, p]) => (
              <li key={path}>
                {path}: {valueText(p.value)} <span className="muted">({valueText(p.min)} to {valueText(p.max)})</span>
              </li>
            ))}
          </ul>
        )}
        {branches.map(([label, list]) =>
          list.length > 0 ? (
            <ul className="tree" key={label}>
              {list.map((b, i) => (
                <li key={i}>
                  {label === 'Chains' ? 'Chain' : 'Return chain'}: {b.name}
                  <DeviceList devices={b.devices} />
                </li>
              ))}
            </ul>
          ) : null
        )}
      </details>
    </li>
  )
}

function routingText(r: LiveRouting): string {
  if (r.trackName) return `${r.trackName} (${r.display || r.target})`
  return r.display || r.target
}

function dbText(db: number | string): string {
  return typeof db === 'number' ? `${db.toFixed(1)} dB` : db
}

function panText(p: LiveParameter): string {
  if (typeof p.value !== 'number') return String(p.value)
  if (p.value === 0) return 'C'
  return `${Math.round(Math.abs(p.value) * 50)}${p.value < 0 ? 'L' : 'R'}`
}

function valueText(v: number | boolean | string): string {
  return typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v)
}
