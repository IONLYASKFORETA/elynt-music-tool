import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MixProjectChange } from '../shared/mix-project'
import { watchMixProject, type MixProjectWatcher } from './mix-project-watcher'

let folder: string
let watcher: MixProjectWatcher | null = null
let events: MixProjectChange[][]

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'elynt-watch-'))
  write('SUPERFLY.als', '2026-11-10T19:00:00.000Z')
  write('Elynt Bounces/SUPERFLY Main.wav', '2026-11-10T20:00:00.000Z')
  events = []
})

afterEach(() => {
  watcher?.close()
  watcher = null
  rmSync(folder, { recursive: true, force: true })
})

function write(relative: string, savedAt?: string, content = 'x') {
  const path = join(folder, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  if (savedAt) utimesSync(path, new Date(savedAt), new Date(savedAt))
}

function start() {
  watcher = watchMixProject(folder, (changes) => events.push(changes), { debounceMs: 40 })
}

/** Waits for the watcher's next event, or fails after a second. */
async function nextEvent(): Promise<MixProjectChange[]> {
  const seen = events.length
  for (let waited = 0; waited < 1000; waited += 10) {
    if (events.length > seen) return events[seen]!
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('The watcher emitted nothing')
}

async function quietFor(ms: number) {
  const seen = events.length
  await new Promise((resolve) => setTimeout(resolve, ms))
  expect(events.slice(seen)).toEqual([])
}

describe('project watcher', () => {
  it('emits when a newer .als is saved', async () => {
    start()
    write('SUPERFLY v2.als', '2026-11-12T10:00:00.000Z')
    expect(await nextEvent()).toEqual([
      { kind: 'live-set', path: join(folder, 'SUPERFLY v2.als'), savedAt: '2026-11-12T10:00:00.000Z' }
    ])
  })

  it('emits when the same .als is saved again', async () => {
    start()
    write('SUPERFLY.als', '2026-11-12T10:00:00.000Z', 'saved again')
    expect(await nextEvent()).toEqual([
      { kind: 'live-set', path: join(folder, 'SUPERFLY.als'), savedAt: '2026-11-12T10:00:00.000Z' }
    ])
  })

  it('emits when new bounces land, and when one is bounced again', async () => {
    start()
    write('Elynt Bounces/SUPERFLY Kick.wav')
    write('Elynt Bounces/SUPERFLY Bass.wav')
    expect(await nextEvent()).toEqual([
      { kind: 'bounces', added: ['SUPERFLY Bass.wav', 'SUPERFLY Kick.wav'], updated: [] }
    ])

    write('Elynt Bounces/SUPERFLY Main.wav', undefined, 'a louder mix')
    expect(await nextEvent()).toEqual([{ kind: 'bounces', added: [], updated: ['SUPERFLY Main.wav'] }])
  })

  it('notices bounces in an Elynt Bounces folder made after watching started', async () => {
    rmSync(join(folder, 'Elynt Bounces'), { recursive: true })
    start()
    write('Elynt Bounces/SUPERFLY Main.wav')
    expect(await nextEvent()).toEqual([{ kind: 'bounces', added: ['SUPERFLY Main.wav'], updated: [] }])
  })

  it("stays quiet for Live's backups, analysis files and other files", async () => {
    start()
    write('Backup/SUPERFLY [2026-11-12 100000].als', '2026-11-12T10:00:00.000Z')
    write('Elynt Bounces/SUPERFLY Main.wav.asd')
    write('Samples/Recorded/take 1.wav')
    write('SUPERFLY older.als', '2026-01-01T00:00:00.000Z')
    await quietFor(200)
  })

  it('stops when closed', async () => {
    start()
    watcher!.close()
    write('Elynt Bounces/SUPERFLY Kick.wav')
    await quietFor(200)
  })
})
