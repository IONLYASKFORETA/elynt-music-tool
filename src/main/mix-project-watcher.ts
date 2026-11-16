import { watch, type FSWatcher } from 'node:fs'
import type { MixProjectChange } from '../shared/mix-project'
import { scanProjectFolder, type ProjectSnapshot } from './mix-project'

export interface MixProjectWatcher {
  close(): void
}

export interface WatchOptions {
  /**
   * Quiet time after the last file event before the folder is looked at again. Live writes a bounce
   * in many small steps, so waiting for it to go quiet means a half-written file isn't reported.
   */
  debounceMs?: number
}

/**
 * The project watcher (M2): watches a project folder for a newer .als and new or re-bounced files
 * in `Elynt Bounces`, and calls onChange with what changed. Later tickets re-run on these.
 */
export function watchMixProject(
  folder: string,
  onChange: (changes: MixProjectChange[]) => void,
  { debounceMs = 1500 }: WatchOptions = {}
): MixProjectWatcher {
  let last = scanProjectFolder(folder)
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const look = () => {
    timer = null
    if (closed) return
    const next = scanProjectFolder(folder)
    const changes = projectChanges(last, next)
    last = next
    if (changes.length > 0) onChange(changes)
  }

  let fsWatcher: FSWatcher | null = null
  try {
    // Recursive, so an `Elynt Bounces` folder made later is watched too (Windows and Linux both support it).
    fsWatcher = watch(folder, { recursive: true }, () => {
      if (closed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(look, debounceMs)
    })
    // A folder that goes away (a drive unplugged) shouldn't take the app down.
    fsWatcher.on('error', (error) => console.warn(`Stopped watching ${folder}:`, error.message))
  } catch (error) {
    console.warn(`Can't watch ${folder}:`, error instanceof Error ? error.message : error)
  }

  return {
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      fsWatcher?.close()
    }
  }
}

/** What is new between two looks at a project folder. Removed files are not changes worth a re-run. */
export function projectChanges(before: ProjectSnapshot, after: ProjectSnapshot): MixProjectChange[] {
  const changes: MixProjectChange[] = []

  const live = after.liveSet
  if (live && (!before.liveSet || live.path !== before.liveSet.path || live.mtimeMs > before.liveSet.mtimeMs)) {
    changes.push({ kind: 'live-set', path: live.path, savedAt: new Date(live.mtimeMs).toISOString() })
  }

  const earlier = new Map(before.bounces.map((b) => [b.file.toLowerCase(), b]))
  const added: string[] = []
  const updated: string[] = []
  for (const bounce of after.bounces) {
    const was = earlier.get(bounce.file.toLowerCase())
    if (!was) added.push(bounce.file)
    else if (was.mtimeMs !== bounce.mtimeMs || was.size !== bounce.size) updated.push(bounce.file)
  }
  if (added.length > 0 || updated.length > 0) changes.push({ kind: 'bounces', added, updated })

  return changes
}
