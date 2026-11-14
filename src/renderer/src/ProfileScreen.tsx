import { useEffect, useState } from 'react'
import {
  DEFAULT_GOAL,
  DISTRIBUTORS,
  GOALS,
  MAX_REFERENCE_ARTISTS,
  PLATFORMS,
  type ArtistProfile,
  type GoalId,
  type PlatformId
} from '../../shared/profile'
import {
  makeMainSubgenre,
  MAX_OTHER_SUBGENRES,
  SUBGENRES,
  subgenreName,
  toggleSubgenre
} from '../../shared/subgenres'

/** The one artist profile every tool reads. Every field is optional. */
export function ProfileScreen() {
  const [profile, setProfile] = useState<ArtistProfile | null>(null)
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.elynt.profile
      .get()
      .then(setProfile)
      .catch((e: unknown) => setStatus({ kind: 'error', text: String(e) }))
  }, [])

  if (!profile) return status ? <p className="error">{status.text}</p> : null

  const change = (next: ArtistProfile) => {
    setProfile(next)
    setStatus(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await window.elynt.profile.save(profile)
      setProfile(saved)
      setStatus({ kind: 'saved', text: 'Saved. Every tool now uses this profile.' })
    } catch (e) {
      setStatus({ kind: 'error', text: errorText(e) })
    } finally {
      setSaving(false)
    }
  }

  const { subgenres } = profile
  const refs = [...profile.referenceArtists]
  while (refs.length < MAX_REFERENCE_ARTISTS) refs.push('')

  return (
    <form
      className="profile"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <p className="hint">Fill in what you know. Every field is optional, and you can come back any time.</p>

      <section>
        <h2>Artist</h2>
        <label className="field">
          <span>Artist name</span>
          <input
            value={profile.artistName ?? ''}
            placeholder="Shown on screen by the Visualizer"
            onChange={(e) => change({ ...profile, artistName: e.target.value })}
          />
        </label>
        <div className="grid">
          {PLATFORMS.map((p) => (
            <label className="field" key={p.id}>
              <span>{p.name} link</span>
              <input
                type="url"
                value={profile.links[p.id] ?? ''}
                placeholder="https://"
                onChange={(e) => change({ ...profile, links: { ...profile.links, [p.id]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>Subgenres</h2>
        <p className="hint">
          One main subgenre plus up to {MAX_OTHER_SUBGENRES} more. The Mix &amp; Master Assistant uses the same list.
        </p>
        <div className="chips" role="group" aria-label="Subgenres">
          {SUBGENRES.map((s) => {
            const isMain = subgenres.main === s.id
            const isOther = subgenres.others.includes(s.id)
            const full = subgenres.main !== null && subgenres.others.length >= MAX_OTHER_SUBGENRES
            return (
              <button
                type="button"
                key={s.id}
                className={isMain ? 'chip main' : isOther ? 'chip on' : 'chip'}
                aria-pressed={isMain || isOther}
                disabled={!isMain && !isOther && full}
                onClick={() => change({ ...profile, subgenres: toggleSubgenre(subgenres, s.id) })}
              >
                {s.name}
                {isMain && <small>MAIN</small>}
              </button>
            )
          })}
        </div>
        {subgenres.others.length > 0 && (
          <p className="hint">
            Also:{' '}
            {subgenres.others.map((id) => (
              <button
                type="button"
                className="link"
                key={id}
                onClick={() => change({ ...profile, subgenres: makeMainSubgenre(subgenres, id) })}
              >
                make {subgenreName(id)} main
              </button>
            ))}
          </p>
        )}
      </section>

      <section>
        <h2>Audience snapshot</h2>
        <p className="hint">Check-ins will keep these up to date after each release.</p>
        <div className="grid">
          <NumberField
            label="Spotify monthly listeners"
            value={profile.audience.spotifyMonthlyListeners}
            onChange={(v) => change({ ...profile, audience: { ...profile.audience, spotifyMonthlyListeners: v } })}
          />
          {PLATFORMS.map((p) => (
            <NumberField
              key={p.id}
              label={`${p.name} followers`}
              value={profile.audience.followers[p.id] ?? null}
              onChange={(v) =>
                change({
                  ...profile,
                  audience: { ...profile.audience, followers: withCount(profile.audience.followers, p.id, v) }
                })
              }
            />
          ))}
        </div>
      </section>

      <section>
        <h2>Setup</h2>
        <div className="grid">
          <NumberField
            label="Budget per release (USD)"
            step="0.01"
            value={profile.budgetPerRelease}
            onChange={(v) => change({ ...profile, budgetPerRelease: v })}
          />
          <label className="field">
            <span>Distributor</span>
            <input
              list="distributors"
              value={profile.distributor ?? ''}
              onChange={(e) => change({ ...profile, distributor: e.target.value })}
            />
            <datalist id="distributors">
              {DISTRIBUTORS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Default goal for a release</span>
            <select
              value={profile.defaultGoal ?? ''}
              onChange={(e) => change({ ...profile, defaultGoal: (e.target.value || null) as GoalId | null })}
            >
              <option value="">{GOALS.find((g) => g.id === DEFAULT_GOAL)!.name} (default)</option>
              {GOALS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="label">Platforms that matter most</span>
        <div className="chips" role="group" aria-label="Platforms">
          {PLATFORMS.map((p) => {
            const on = profile.platforms.includes(p.id)
            return (
              <button
                type="button"
                key={p.id}
                className={on ? 'chip on' : 'chip'}
                aria-pressed={on}
                onClick={() =>
                  change({
                    ...profile,
                    platforms: on ? profile.platforms.filter((x) => x !== p.id) : [...profile.platforms, p.id]
                  })
                }
              >
                {p.name}
              </button>
            )
          })}
        </div>
      </section>

      <section>
        <h2>Reference artists</h2>
        <p className="hint">2 or 3 artists whose release and marketing style you want to learn from.</p>
        <div className="grid">
          {refs.map((name, i) => (
            <label className="field" key={i}>
              <span>Reference artist {i + 1}</span>
              <input
                value={name}
                onChange={(e) => {
                  const next = [...refs]
                  next[i] = e.target.value
                  change({ ...profile, referenceArtists: next })
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <footer className="profile-foot">
        <button className="add" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {status && <span className={status.kind === 'error' ? 'error' : 'saved'}>{status.text}</span>}
      </footer>
    </form>
  )
}

function NumberField(props: { label: string; value: number | null; step?: string; onChange(v: number | null): void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="number"
        min="0"
        step={props.step ?? '1'}
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </label>
  )
}

function withCount(
  counts: Partial<Record<PlatformId, number>>,
  id: PlatformId,
  value: number | null
): Partial<Record<PlatformId, number>> {
  const next = { ...counts }
  if (value === null) delete next[id]
  else next[id] = value
  return next
}

/** Electron wraps errors from the main process; show only our own message. */
function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
