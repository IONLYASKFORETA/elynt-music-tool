import { useCallback, useEffect, useState } from 'react'
import type { Track } from '../../shared/track'

const SECTIONS = [
  { id: 'visualizer', name: 'Visualizer', blurb: 'Turn a track into reactive visuals and render the video.' },
  { id: 'mix-master', name: 'Mix & Master', blurb: 'Read the open Live Set and get stepping stones for the mix and master.' },
  { id: 'release', name: 'Release', blurb: 'Plan the release of a finished track, step by step.' }
] as const

type SectionId = (typeof SECTIONS)[number]['id']

export function App() {
  const [active, setActive] = useState<SectionId>('visualizer')
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
      const added = await window.elynt.tracks.pickMixdown()
      if (added) await refresh()
    } catch (e) {
      setError(String(e))
    }
  }

  const section = SECTIONS.find((s) => s.id === active)!

  return (
    <div className="shell">
      <nav className="nav" aria-label="Tools">
        <div className="brand">
          ELYNT<span>MUSIC TOOL</span>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={s.id === active ? 'nav-item active' : 'nav-item'}
            aria-current={s.id === active ? 'page' : undefined}
            onClick={() => setActive(s.id)}
          >
            {s.name}
          </button>
        ))}
      </nav>

      <main className="section">
        <header className="section-head">
          <div>
            <h1>{section.name}</h1>
            <p>{section.blurb}</p>
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
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
