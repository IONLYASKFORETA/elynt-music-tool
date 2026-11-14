import { useEffect, useState } from 'react'
import {
  CAPS,
  DEFAULT_GOAL,
  DISTRIBUTORS,
  EMOJI_USE,
  emptyPastRelease,
  GOALS,
  MAX_REFERENCE_ARTISTS,
  PAST_RELEASE_NUMBERS,
  parseNeverSay,
  PLATFORMS,
  setupStatus,
  SOUNDCLOUD_PLANS,
  SUGGESTED_VOICE_EXAMPLES,
  TONES,
  type ArtistProfile,
  type GoalId,
  type PastRelease,
  type PlatformId,
  type SetupCheck,
  type SetupItemId,
  type Voice
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
  // Kept as typed, so a trailing comma survives while typing; parsed into the profile on change.
  const [neverSayText, setNeverSayText] = useState('')

  useEffect(() => {
    window.elynt.profile
      .get()
      .then((p) => {
        setProfile(p)
        setNeverSayText(p.voice.neverSay.join(', '))
      })
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
      setNeverSayText(saved.voice.neverSay.join(', '))
      setStatus({ kind: 'saved', text: 'Saved. Every tool now uses this profile.' })
    } catch (e) {
      setStatus({ kind: 'error', text: errorText(e) })
    } finally {
      setSaving(false)
    }
  }

  const { subgenres, voice } = profile
  const setVoice = (changes: Partial<Voice>) => change({ ...profile, voice: { ...voice, ...changes } })
  const examples = [...voice.examples]
  while (examples.length < SUGGESTED_VOICE_EXAMPLES.max) examples.push('')
  const setSetup = (changes: Partial<SetupCheck>) =>
    change({ ...profile, setupCheck: { ...profile.setupCheck, ...changes } })
  const setPast = (i: number, changes: Partial<PastRelease>) =>
    change({
      ...profile,
      pastReleases: profile.pastReleases.map((r, j) => (j === i ? { ...r, ...changes } : r))
    })
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

      <section>
        <h2>Voice</h2>
        <p className="hint">
          Paste {SUGGESTED_VOICE_EXAMPLES.min} to {SUGGESTED_VOICE_EXAMPLES.max} captions you wrote yourself, so the
          Release Assistant's drafts sound like you.
        </p>
        <div className="examples">
          {examples.map((text, i) => (
            <label className="field" key={i}>
              <span>Caption {i + 1}</span>
              <textarea
                rows={2}
                value={text}
                onChange={(e) => {
                  const next = [...examples]
                  next[i] = e.target.value
                  setVoice({ examples: next })
                }}
              />
            </label>
          ))}
        </div>
        <div className="grid">
          <Switch label="Tone" options={TONES} value={voice.tone} onChange={(tone) => setVoice({ tone })} />
          <Switch label="Emoji" options={EMOJI_USE} value={voice.emoji} onChange={(emoji) => setVoice({ emoji })} />
          <Switch label="Caps" options={CAPS} value={voice.caps} onChange={(caps) => setVoice({ caps })} />
        </div>
        <label className="field">
          <span>Never say</span>
          <input
            value={neverSayText}
            placeholder="Words or phrases drafts must never use, separated by commas"
            onChange={(e) => {
              setNeverSayText(e.target.value)
              setVoice({ neverSay: parseNeverSay(e.target.value) })
            }}
          />
        </label>
      </section>

      <section>
        <h2>Setup check</h2>
        <p className="hint">
          Answer once, so blockers show up before your first release plan. Nothing here stops you starting a release.
        </p>
        <ul className="setup-check">
          {setupStatus(profile).map((item) => (
            <li key={item.id} className={`setup-${item.state}`}>
              <div className="setup-row">
                <span>{item.question}</span>
                <SetupAnswer
                  id={item.id}
                  check={profile.setupCheck}
                  onChange={setSetup}
                />
              </div>
              {item.blocks && <p className="blocks">{item.blocks}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Past singles</h2>
        <p className="hint">
          Optional. Numbers from each single's first 28 days, so your first plan has something to compare against. Leave
          any number blank.
        </p>
        {profile.pastReleases.map((r, i) => (
          <div className="past-release" key={i}>
            <div className="grid">
              <label className="field">
                <span>Title</span>
                <input value={r.title} onChange={(e) => setPast(i, { title: e.target.value })} />
              </label>
              <label className="field">
                <span>Release date</span>
                <input type="date" value={r.releasedOn} onChange={(e) => setPast(i, { releasedOn: e.target.value })} />
              </label>
              {PAST_RELEASE_NUMBERS.map(({ key, name }) => (
                <NumberField key={key} label={name} value={r[key]} onChange={(v) => setPast(i, { [key]: v })} />
              ))}
            </div>
            <button
              type="button"
              className="link"
              onClick={() => change({ ...profile, pastReleases: profile.pastReleases.filter((_, j) => j !== i) })}
            >
              Remove {r.title.trim() || 'this single'}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="chip"
          onClick={() => change({ ...profile, pastReleases: [...profile.pastReleases, emptyPastRelease()] })}
        >
          + Add a past single
        </button>
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

function Switch<T extends string>(props: {
  label: string
  options: ReadonlyArray<{ id: T; name: string }>
  value: T | null
  onChange(v: T | null): void
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value ?? ''} onChange={(e) => props.onChange((e.target.value || null) as T | null)}>
        <option value="">Learn it from my captions</option>
        {props.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function SetupAnswer(props: { id: SetupItemId; check: SetupCheck; onChange(c: Partial<SetupCheck>): void }) {
  if (props.id === 'soundcloudPlan') {
    return (
      <select
        value={props.check.soundcloudPlan ?? ''}
        onChange={(e) =>
          props.onChange({ soundcloudPlan: (e.target.value || null) as SetupCheck['soundcloudPlan'] })
        }
      >
        <option value="">Not checked yet</option>
        {SOUNDCLOUD_PLANS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    )
  }
  const id = props.id
  const value = props.check[id]
  return (
    <div className="chips" role="group">
      {([true, false] as const).map((answer) => (
        <button
          type="button"
          key={String(answer)}
          className={value === answer ? 'chip on' : 'chip'}
          aria-pressed={value === answer}
          onClick={() => props.onChange({ [id]: value === answer ? null : answer })}
        >
          {answer ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
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
