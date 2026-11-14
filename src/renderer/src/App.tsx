import { useCallback, useEffect, useState } from 'react'
import type { AudioProbe, HelperStatus } from '../../shared/helper'
import type { Track } from '../../shared/track'

const TOOLS = [
  { id: 'visualizer', name: 'Visualizer', nav: 'Visualizer', blurb: 'Turn a track into reactive visuals and render the video.' },
  { id: 'mix-master', name: 'Mix & Master Assistant', nav: 'Mix & Master', blurb: 'Read the open Live Set and get stepping stones for the mix and master.' },
  { id: 'release', name: 'Release Assistant', nav: 'Release', blurb: 'Plan the release of a finished track, step by step.' }
] as const

type ToolId = (typeof TOOLS)[number]['id']

export function App() {
  const [active, setActive] = useState<ToolId>('visualizer')
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setTracks(await window.elynt.tracks.list())
  }, [])

  useEffect(() => {
    refresh().catch((e: unknown) => setError(String(e)))
  }, [refresh])

  const addTrack = async () => {
    setError(null)
    try {
      const added = await window.elynt.tracks.addFromPickedMixdown()
      if (added) await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  const tool = TOOLS.find((s) => s.id === active)!

  return (
    <div className="shell">
      <nav className="nav" aria-label="Tools">
        <div className="brand">
          ELYNT<span>MUSIC TOOL</span>
        </div>
        {TOOLS.map((s) => (
          <button
            key={s.id}
            className={s.id === active ? 'nav-item active' : 'nav-item'}
            aria-current={s.id === active ? 'page' : undefined}
            onClick={() => setActive(s.id)}
          >
            {s.nav}
          </button>
        ))}
        <HelperBadge />
      </nav>

      <main className="tool">
        <header className="tool-head">
          <div>
            <h1>{tool.name}</h1>
            <p>{tool.blurb}</p>
          </div>
          <button className="add" onClick={addTrack}>
            + Add track
          </button>
        </header>

        {error && <p className="error">{error}</p>}

        <h2>Tracks</h2>
        {tracks.length === 0 ? (
          <p className="empty">No tracks yet. Add one by picking its mixdown.</p>
        ) : (
          <ul className="tracks">
            {tracks.map((t) => (
              <li key={t.id}>
                <span className="title">{t.title}</span>
                <span className="path">{t.mixdownPath}</span>
                <MixdownFacts trackId={t.id} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

const HELPER_LABELS: Record<HelperStatus['state'], string> = {
  starting: 'Helper starting',
  running: 'Helper running',
  restarting: 'Helper restarting',
  'not-installed': 'Helper not set up',
  stopped: 'Helper stopped'
}

/** Shows whether the Python helper is up, and what GPU it sees. */
function HelperBadge() {
  const [status, setStatus] = useState<HelperStatus | null>(null)

  useEffect(() => {
    const off = window.elynt.helper.onStatus(setStatus)
    window.elynt.helper.status().then(setStatus).catch(() => {})
    return off
  }, [])

  if (!status) return null
  const gpu = status.info?.gpu
  const details = [
    status.mode === 'wsl' ? 'WSL2' : 'native',
    status.info && `Python ${status.info.python}`,
    gpu && (gpu.available ? gpu.name : `no CUDA: ${gpu.reason ?? 'unknown'}`),
    status.restarts > 0 && `${status.restarts} restart${status.restarts === 1 ? '' : 's'}`
  ].filter(Boolean)

  return (
    <div className={`helper helper-${status.state}`} role="status" title={status.lastError ?? details.join(' · ')}>
      <span className="dot" aria-hidden="true" />
      <div>
        <div className="helper-state">{HELPER_LABELS[status.state]}</div>
        <div className="helper-detail">{details.join(' · ')}</div>
        {status.state === 'not-installed' && <div className="helper-detail">See helper/README.md</div>}
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Asks the helper for the mixdown's duration and sample rate: the round trip proving the link works. */
function MixdownFacts({ trackId }: { trackId: number }) {
  const [probe, setProbe] = useState<AudioProbe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const read = async () => {
    setBusy(true)
    setError(null)
    try {
      setProbe(await window.elynt.helper.probeTrack(trackId))
    } catch (e) {
      setError(String(e).replace(/^Error: Error invoking remote method '[^']+': /, ''))
    } finally {
      setBusy(false)
    }
  }

  if (probe) {
    return (
      <span className="facts">
        {formatDuration(probe.durationSeconds)} · {(probe.sampleRate / 1000).toFixed(1)} kHz · {probe.channels === 2 ? 'stereo' : `${probe.channels} ch`}
      </span>
    )
  }
  return (
    <span className="facts">
      <button className="link" onClick={read} disabled={busy}>
        {busy ? 'Reading…' : 'Read mixdown'}
      </button>
      {error && <span className="error"> {error}</span>}
    </span>
  )
}
