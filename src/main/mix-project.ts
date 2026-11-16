import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LiveSet } from '../shared/live-set'
import {
  BOUNCE_EXTENSIONS,
  BOUNCES_FOLDER,
  sortBounces,
  type Bounce,
  type MixProject,
  type ProjectLiveSet
} from '../shared/mix-project'
import { fileExtension, titleFromFileName } from '../shared/paths'
import type { SuiteDatabase } from './db/database'
import type { TrackLibrary } from './tracks'

/** Reads an .als (the helper's liveset.read in the app). */
export type LiveSetReader = (path: string) => Promise<LiveSet>

export interface MixProjects {
  /** The project folder picked for a track, or null before one is picked. */
  folderOf(trackId: number): string | null
  /** Saves the project folder against the shared track, replacing any earlier one. */
  setFolder(trackId: number, folder: string): void
  /** Looks at the folder as it is now: reads the newest Live Set and sorts the bounces. Null with no folder. */
  open(trackId: number): Promise<MixProject | null>
}

export interface MixProjectsOptions {
  db: SuiteDatabase
  tracks: TrackLibrary
  readLiveSet: LiveSetReader
  now?: () => Date
}

export function createMixProjects({ db, tracks, readLiveSet, now = () => new Date() }: MixProjectsOptions): MixProjects {
  const read = db.prepare('SELECT folder FROM mix_projects WHERE track_id = ?')
  const upsert = db.prepare(`
    INSERT INTO mix_projects (track_id, folder, picked_at) VALUES (?, ?, ?)
    ON CONFLICT (track_id) DO UPDATE SET folder = excluded.folder, picked_at = excluded.picked_at
  `)

  const folderOf = (trackId: number): string | null => {
    const row = read.get(trackId) as { folder: string } | undefined
    return row?.folder ?? null
  }

  return {
    folderOf,
    setFolder(trackId, folder) {
      if (!tracks.get(trackId)) throw new Error(`No track with id ${String(trackId)}`)
      if (!isDirectory(folder)) throw new Error(`Can't find the folder ${folder}`)
      upsert.run(trackId, folder, now().toISOString())
    },
    async open(trackId) {
      const folder = folderOf(trackId)
      if (folder === null) return null
      return openProject(trackId, folder, readLiveSet)
    }
  }
}

/** What is in a project folder right now. The watcher compares two of these. */
export interface ProjectSnapshot {
  folderFound: boolean
  /** The newest .als at the top of the folder (Live's Backup folder and older versions are ignored). */
  liveSet: { path: string; mtimeMs: number } | null
  bouncesFolder: string
  bouncesFolderFound: boolean
  /** Audio files in `Elynt Bounces`, by file name. */
  bounces: { file: string; path: string; mtimeMs: number; size: number }[]
}

export function scanProjectFolder(folder: string): ProjectSnapshot {
  const root = list(folder)
  const missing: ProjectSnapshot = {
    folderFound: false,
    liveSet: null,
    bouncesFolder: join(folder, BOUNCES_FOLDER),
    bouncesFolderFound: false,
    bounces: []
  }
  if (!root) return missing

  let liveSet: ProjectSnapshot['liveSet'] = null
  for (const name of root) {
    if (fileExtension(name) !== 'als' || name.startsWith('.')) continue
    const stat = statOf(join(folder, name))
    if (stat?.isFile() && (!liveSet || stat.mtimeMs > liveSet.mtimeMs)) liveSet = { path: join(folder, name), mtimeMs: stat.mtimeMs }
  }

  // Windows ignores case, so "elynt bounces" is the same folder.
  const bouncesName = root.find((name) => name.toLowerCase() === BOUNCES_FOLDER.toLowerCase())
  const bouncesFolder = join(folder, bouncesName ?? BOUNCES_FOLDER)
  const bouncesFolderFound = bouncesName !== undefined && statOf(bouncesFolder)?.isDirectory() === true
  const bounces: ProjectSnapshot['bounces'] = []
  for (const file of (bouncesFolderFound ? list(bouncesFolder) : null) ?? []) {
    if (!BOUNCE_EXTENSIONS.includes(fileExtension(file)) || file.startsWith('.')) continue
    const path = join(bouncesFolder, file)
    const stat = statOf(path)
    if (stat?.isFile()) bounces.push({ file, path, mtimeMs: stat.mtimeMs, size: stat.size })
  }
  bounces.sort((a, b) => a.file.localeCompare(b.file))

  return { folderFound: true, liveSet, bouncesFolder, bouncesFolderFound, bounces }
}

async function openProject(trackId: number, folder: string, readLiveSet: LiveSetReader): Promise<MixProject> {
  const scan = scanProjectFolder(folder)

  let liveSet: ProjectLiveSet | null = null
  if (scan.liveSet) {
    const savedAt = new Date(scan.liveSet.mtimeMs).toISOString()
    try {
      const read = await readLiveSet(scan.liveSet.path)
      liveSet = { path: scan.liveSet.path, savedAt, read, readError: null }
    } catch (error) {
      liveSet = { path: scan.liveSet.path, savedAt, read: null, readError: error instanceof Error ? error.message : String(error) }
    }
  }

  const sorted = sortBounces(
    scan.bounces.map((b) => b.file),
    liveSet?.read ? { name: titleFromFileName(liveSet.path), tracks: liveSet.read.tracks, returns: liveSet.read.returns } : null
  )
  const byFile = new Map(
    scan.bounces.map((b): [string, Bounce] => [b.file, { path: b.path, file: b.file, savedAt: new Date(b.mtimeMs).toISOString() }])
  )
  const bounce = (file: string): Bounce => byFile.get(file)!

  // Stale: the Live Set was saved after these were bounced, so they may not be the mix it holds now.
  const staleFiles = scan.liveSet ? scan.bounces.filter((b) => b.mtimeMs < scan.liveSet!.mtimeMs).map((b) => b.file) : []

  return {
    trackId,
    folder,
    folderFound: scan.folderFound,
    liveSet,
    bouncesFolderFound: scan.bouncesFolderFound,
    bouncesFolder: scan.bouncesFolder,
    mixdowns: sorted.mixdowns.map(bounce),
    stems: sorted.stems.map((s) => ({ ...bounce(s.file), liveTrack: s.liveTrack })),
    unmatchedStems: sorted.unmatchedStems,
    unmatchedLiveTracks: sorted.unmatchedLiveTracks,
    staleBounces: liveSet && staleFiles.length > 0 ? { liveSetSavedAt: liveSet.savedAt, files: staleFiles } : null,
    readyToAnalyze: liveSet?.read != null && scan.bounces.length > 0
  }
}

function list(folder: string): string[] | null {
  try {
    return readdirSync(folder)
  } catch {
    return null
  }
}

function statOf(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function isDirectory(path: string): boolean {
  return statOf(path)?.isDirectory() === true
}
