import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupStatus } from '../shared/backup'
import type { SuiteDatabase } from './db/database'

/** Daily backups older than this many are deleted from the backup folder. */
export const KEEP_DAILY_BACKUPS = 14

const BACKUP_FILE = /^elynt-backup-(\d{4}-\d{2}-\d{2})\.sqlite$/

export interface Backups {
  status(): BackupStatus
  /** Remembers the folder and backs up into it straight away. */
  setFolder(folder: string): string
  /**
   * Writes today's backup if the folder has none yet, then rotates old ones.
   * Returns the file written, or null when nothing was due. Throws if the folder can't be written.
   */
  runIfDue(): string | null
  /** Writes the whole suite database to one file, replacing that file if it exists. */
  exportEverything(target: string): void
}

interface Options {
  db: SuiteDatabase
  /**
   * Where the chosen folder is remembered. Kept outside the database on purpose, so a
   * restored backup never points the app at a different folder.
   */
  settingsFile: string
  now?: () => Date
}

export function createBackups({ db, settingsFile, now = () => new Date() }: Options): Backups {
  const readFolder = (): string | null => {
    if (!existsSync(settingsFile)) return null
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf8')) as { folder?: unknown }
    return typeof parsed.folder === 'string' ? parsed.folder : null
  }

  const backupDays = (folder: string): string[] => {
    if (!existsSync(folder)) return []
    return readdirSync(folder)
      .map((name) => BACKUP_FILE.exec(name)?.[1])
      .filter((day): day is string => day !== undefined)
      .sort()
  }

  const backupsIn = (folder: string) => {
    const days = backupDays(folder)
    const today = localDay(now())
    if (days.includes(today)) return null

    if (!existsSync(folder) || !statSync(folder).isDirectory()) {
      throw new Error(`The backup folder ${folder} can't be found. Is the drive connected?`)
    }
    const target = join(folder, `elynt-backup-${today}.sqlite`)
    copyDatabase(db, target)

    for (const old of [...days, today].slice(0, -KEEP_DAILY_BACKUPS)) {
      rmSync(join(folder, `elynt-backup-${old}.sqlite`), { force: true })
    }
    return target
  }

  return {
    status() {
      const folder = readFolder()
      return { folder, lastBackupDay: folder ? (backupDays(folder).at(-1) ?? null) : null }
    },
    setFolder(folder) {
      writeFileSync(settingsFile, JSON.stringify({ folder }, null, 2))
      backupsIn(folder)
      return folder
    },
    runIfDue() {
      const folder = readFolder()
      return folder ? backupsIn(folder) : null
    },
    exportEverything(target) {
      copyDatabase(db, target)
    }
  }
}

/**
 * VACUUM INTO writes a consistent snapshot even while the app is using the database (WAL mode).
 * It writes to a temporary name first, so a half-written file never looks like a finished backup.
 */
function copyDatabase(db: SuiteDatabase, target: string): void {
  const partial = `${target}.partial`
  rmSync(partial, { force: true })
  try {
    db.prepare('VACUUM INTO ?').run(partial)
    rmSync(target, { force: true })
    renameSync(partial, target)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }
}

/** The owner's calendar day, so "once a day" follows Aden's clock rather than UTC. */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
