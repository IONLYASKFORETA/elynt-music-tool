import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createMediaShelf, type ClipProbe } from './media-shelf'
import { createTrackLibrary, type TrackLibrary } from './tracks'

let dir: string
let db: SuiteDatabase
let tracks: TrackLibrary
const now = () => new Date('2026-11-16T09:00:00.000Z')
const probeClip: ClipProbe = async (path) => ({ durationSeconds: path.includes('long') ? 30 : 8, fps: 24 })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-media-shelf-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  tracks = createTrackLibrary(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const shelf = () => createMediaShelf({ db, tracks, probeClip, now })

describe('the media shelf', () => {
  it('stores images and clips by path, with what a clip needs to play frame-accurately', async () => {
    const added = await shelf().add(['C:\\Art\\Portrait.jpg', 'C:\\Clips\\smoke.mp4'])
    expect(added).toEqual([
      {
        id: 1,
        type: 'image',
        path: 'C:\\Art\\Portrait.jpg',
        name: 'Portrait.jpg',
        isLogo: false,
        durationSeconds: null,
        fps: null,
        addedAt: '2026-11-16T09:00:00.000Z'
      },
      expect.objectContaining({ id: 2, type: 'clip', path: 'C:\\Clips\\smoke.mp4', durationSeconds: 8, fps: 24 })
    ])
    // Another visit (or another track) sees the same shelf.
    expect(createMediaShelf({ db, tracks, probeClip, now }).list()).toEqual(added)
  })

  it('keeps one item per file, in any letter case', async () => {
    const [first] = await shelf().add(['C:\\Art\\Portrait.jpg'])
    const again = await shelf().add(['c:\\art\\PORTRAIT.JPG'])
    expect(again).toEqual([first])
    expect(shelf().list()).toHaveLength(1)
  })

  it('turns down files that are neither images nor clips', async () => {
    await expect(shelf().add(['C:\\Docs\\notes.txt'])).rejects.toThrow(/notes\.txt/)
    expect(shelf().list()).toEqual([])
  })

  it('has at most one logo, and only an image can be it', async () => {
    const [a, b, clip] = await shelf().add(['C:\\Art\\logo-old.png', 'C:\\Art\\logo.png', 'C:\\Clips\\long.mp4'])
    shelf().setLogo(a!.id)
    shelf().setLogo(b!.id)
    expect(shelf().list().filter((i) => i.isLogo).map((i) => i.id)).toEqual([b!.id])
    expect(shelf().logo()?.id).toBe(b!.id)
    expect(() => shelf().setLogo(clip!.id)).toThrow(/image/)
    shelf().setLogo(null)
    expect(shelf().logo()).toBeNull()
  })

  it('removes an item, leaving its file where it is', async () => {
    const [a] = await shelf().add(['C:\\Art\\Portrait.jpg'])
    shelf().remove(a!.id)
    expect(shelf().list()).toEqual([])
    expect(shelf().pathFor('elynt-media://shelf/1')).toBeNull()
  })
})

describe("a track's cover art", () => {
  it('is none until attached, then offered by its own address', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    expect(shelf().coverArt(track.id)).toBeNull()
    shelf().setCoverArt(track.id, 'C:\\Art\\SUPERFLY cover.png')
    expect(shelf().coverArt(track.id)).toEqual({
      trackId: track.id,
      path: 'C:\\Art\\SUPERFLY cover.png',
      name: 'SUPERFLY cover.png',
      url: `elynt-media://cover/${track.id}`
    })
    shelf().setCoverArt(track.id, null)
    expect(shelf().coverArt(track.id)).toBeNull()
  })

  it('must be an image, on a track that exists', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    expect(() => shelf().setCoverArt(track.id, 'C:\\Clips\\smoke.mp4')).toThrow(/image/)
    expect(() => shelf().setCoverArt(999, 'C:\\Art\\x.png')).toThrow(/999/)
  })
})

describe('serving media', () => {
  it('resolves only addresses the database holds', async () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const [item] = await shelf().add(['C:\\Art\\Portrait.jpg'])
    shelf().setCoverArt(track.id, 'C:\\Art\\cover.png')
    expect(shelf().pathFor(`elynt-media://shelf/${item!.id}`)).toBe('C:\\Art\\Portrait.jpg')
    expect(shelf().pathFor(`elynt-media://cover/${track.id}`)).toBe('C:\\Art\\cover.png')
    expect(shelf().pathFor('elynt-media://shelf/42')).toBeNull()
    expect(shelf().pathFor('file:///C:/Windows/win.ini')).toBeNull()
  })
})
