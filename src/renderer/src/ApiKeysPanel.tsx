import { useEffect, useState } from 'react'
import type { KeyName, KeyStatus } from '../../shared/keys'

const KEYS: { name: KeyName; label: string; hint: string; optional: boolean }[] = [
  {
    name: 'anthropic',
    label: 'Anthropic API key',
    hint: 'Used for visions, stepping stones and release drafts. Starts with sk-ant-.',
    optional: false
  },
  { name: 'gemini', label: 'Gemini API key', hint: 'Optional. Adds a mood listen to the Visualizer.', optional: true }
]

/** Strips Electron's "Error invoking remote method ..." wrapper so only our message shows. */
function messageOf(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )
}

export function ApiKeysPanel() {
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [drafts, setDrafts] = useState<Record<KeyName, string>>({ anthropic: '', gemini: '' })
  const [notes, setNotes] = useState<Partial<Record<KeyName, { text: string; bad?: boolean }>>>({})
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    window.elynt.keys
      .status()
      .then(setStatus, (e: unknown) => setNotes({ anthropic: { text: messageOf(e), bad: true } }))
  }, [])

  const note = (name: KeyName, text: string, bad = false) => setNotes((n) => ({ ...n, [name]: { text, bad } }))

  const save = async (name: KeyName) => {
    try {
      setStatus(await window.elynt.keys.save(name, drafts[name]))
      setDrafts((d) => ({ ...d, [name]: '' }))
      note(name, 'Saved to Windows Credential Manager.')
    } catch (e) {
      note(name, messageOf(e), true)
    }
  }

  const remove = async (name: KeyName) => {
    try {
      setStatus(await window.elynt.keys.remove(name))
      note(name, 'Removed.')
    } catch (e) {
      note(name, messageOf(e), true)
    }
  }

  const test = async () => {
    setTesting(true)
    const result = await window.elynt.keys
      .testAnthropic()
      .catch((e: unknown) => ({ ok: false as const, message: messageOf(e) }))
    setTesting(false)
    note('anthropic', result.ok ? 'The key works.' : result.message, !result.ok)
  }

  return (
    <section className="keys">
      <h2>API keys</h2>
      <p className="empty">
        Keys are kept in Windows Credential Manager, never in a file. Once saved they can't be shown again, only
        replaced.
      </p>
      {KEYS.map(({ name, label, hint }) => {
        const saved = status?.[name] ?? false
        return (
          <div className="key" key={name}>
            <label htmlFor={`key-${name}`}>
              {label} <span className={saved ? 'badge set' : 'badge'}>{saved ? 'Saved' : 'Not set'}</span>
            </label>
            <p className="hint">{hint}</p>
            <div className="key-row">
              <input
                id={`key-${name}`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={saved ? 'Paste a new key to replace it' : 'Paste your key'}
                value={drafts[name]}
                onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && void save(name)}
              />
              <button className="add" onClick={() => void save(name)} disabled={drafts[name].trim() === ''}>
                Save
              </button>
              {saved && name === 'anthropic' && (
                <button className="ghost" onClick={() => void test()} disabled={testing}>
                  {testing ? 'Testing…' : 'Test key'}
                </button>
              )}
              {saved && (
                <button className="ghost" onClick={() => void remove(name)}>
                  Remove
                </button>
              )}
            </div>
            {notes[name] && <p className={notes[name]!.bad ? 'error' : 'ok'}>{notes[name]!.text}</p>}
          </div>
        )
      })}
    </section>
  )
}
