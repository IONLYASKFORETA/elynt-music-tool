import { useEffect, useState } from 'react'
import type { BackupStatus } from '../../shared/backup'

/** Settings: the daily backup folder and "Export everything" (ADR 0002). */
export function BackupSettings() {
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.elynt.backup.status().then(setStatus, (e: unknown) => setError(String(e)))
  }, [])

  const run = async (action: () => Promise<void>) => {
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (e) {
      setError(String(e))
    }
  }

  const chooseFolder = () =>
    run(async () => {
      const next = await window.elynt.backup.chooseFolder()
      if (next) {
        setStatus(next)
        setMessage('Backed up. A fresh copy goes to this folder once a day.')
      }
    })

  const exportEverything = () =>
    run(async () => {
      const path = await window.elynt.backup.exportEverything()
      if (path) setMessage(`Exported everything to ${path}`)
    })

  return (
    <section className="settings-block">
      <h2>Backup</h2>
      <p className="settings-help">
        Once a day the app copies all of its data to a folder you choose, such as one in OneDrive or Dropbox. It
        keeps the last two weeks. Nothing syncs between machines.
      </p>
      <div className="settings-row">
        <div>
          <div className="settings-label">Backup folder</div>
          <div className="path">{status?.folder ?? 'Not chosen yet'}</div>
          {status?.folder && (
            <div className="path">Last backup: {status.lastBackupDay ?? 'none yet'}</div>
          )}
        </div>
        <button className="secondary" onClick={chooseFolder}>
          {status?.folder ? 'Change folder' : 'Choose folder'}
        </button>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-label">Export everything</div>
          <div className="path">Writes all of the suite's data into one file you can keep anywhere.</div>
        </div>
        <button className="secondary" onClick={exportEverything}>
          Export everything
        </button>
      </div>
      {message && <p className="settings-help">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
