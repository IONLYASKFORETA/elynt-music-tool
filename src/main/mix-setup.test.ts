import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultMixSetup, mixTargets, type MixSetup } from '../shared/mix-setup'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createMixSetupStore } from './mix-setup'
import { createTrackLibrary, type TrackLibrary } from './tracks'

let dir: string
let db: SuiteDatabase
let tracks: TrackLibrary
const fixedNow = () => new Date('2026-11-14T12:00:00.000Z')
const existing = new Set(['C:\\Refs\\Skrillex - Ref.wav', 'C:\\Refs\\Two.flac', 'C:\\Refs\\Three.mp3', 'C:\\Refs\\Four.wav'])
const fileExists = (path: string) => existing.has(path)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-mix-setup-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  tracks = createTrackLibrary(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function store() {
  return createMixSetupStore(db, tracks, { now: fixedNow, fileExists })
}

function refs(...paths: string[]) {
  return paths.map((path) => ({ path, title: '' }))
}

describe('mix setup', () => {
  it('is null until the track is set up for the first time', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    expect(store().get(track.id)).toBeNull()
  })

  it('saves subgenre, loudness target and references against the shared track', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const setup: MixSetup = {
      ...defaultMixSetup(track.id),
      subgenre: 'riddim',
      loudnessTarget: 'streaming',
      referenceTracks: refs('C:\\Refs\\Skrillex - Ref.wav', 'C:\\Refs\\Two.flac')
    }

    store().save(setup)

    expect(store().get(track.id)).toEqual({
      trackId: track.id,
      subgenre: 'riddim',
      loudnessTarget: 'streaming',
      referenceTracks: [
        { path: 'C:\\Refs\\Skrillex - Ref.wav', title: 'Skrillex - Ref' },
        { path: 'C:\\Refs\\Two.flac', title: 'Two' }
      ],
      updatedAt: '2026-11-14T12:00:00.000Z'
    })
  })

  it('removes a reference when it is saved without it', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\flip.wav')
    const s = store()
    s.save({ ...defaultMixSetup(track.id), referenceTracks: refs('C:\\Refs\\Two.flac', 'C:\\Refs\\Three.mp3') })
    s.save({ ...defaultMixSetup(track.id), referenceTracks: refs('C:\\Refs\\Three.mp3') })
    expect(s.get(track.id)!.referenceTracks.map((r) => r.title)).toEqual(['Three'])
  })

  it('keeps each track its own setup', () => {
    const a = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const b = tracks.addFromMixdown('C:\\Bounces\\flip.wav')
    const s = store()
    s.save({ ...defaultMixSetup(a.id), subgenre: 'dubstep' })
    s.save({ ...defaultMixSetup(b.id), subgenre: 'house' })
    expect(s.get(a.id)!.subgenre).toBe('dubstep')
    expect(s.get(b.id)!.subgenre).toBe('house')
  })

  it('allows at most 3 reference tracks', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const four = refs('C:\\Refs\\Skrillex - Ref.wav', 'C:\\Refs\\Two.flac', 'C:\\Refs\\Three.mp3', 'C:\\Refs\\Four.wav')
    expect(() => store().save({ ...defaultMixSetup(track.id), referenceTracks: four })).toThrow('at most 3')
  })

  it('drops a reference added twice, in any letter case', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const saved = store().save({
      ...defaultMixSetup(track.id),
      referenceTracks: refs('C:\\Refs\\Two.flac', 'c:\\refs\\two.FLAC')
    })
    expect(saved.referenceTracks).toHaveLength(1)
  })

  it('rejects a reference that is missing, not audio, or the track itself', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    existing.add('C:\\Bounces\\SUPERFLY.wav')
    const save = (path: string) => () =>
      store().save({ ...defaultMixSetup(track.id), referenceTracks: refs(path) })
    expect(save('C:\\Refs\\Gone.wav')).toThrow("Can't find")
    expect(save('C:\\Refs\\notes.txt')).toThrow("isn't an audio file")
    expect(save('c:\\bounces\\superfly.wav')).toThrow('own mixdown')
  })

  it('rejects an unknown subgenre, loudness target or track', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const s = store()
    expect(() => s.save({ ...defaultMixSetup(track.id), subgenre: 'polka' as never })).toThrow('Unknown subgenre')
    expect(() => s.save({ ...defaultMixSetup(track.id), loudnessTarget: 'radio' as never })).toThrow(
      'Unknown loudness target'
    )
    expect(() => s.save(defaultMixSetup(999))).toThrow('No track')
  })

  it('gives later checks the rough electronic curve, flagged as rough, when there are no references', () => {
    const track = tracks.addFromMixdown('C:\\Bounces\\SUPERFLY.wav')
    const saved = store().save(defaultMixSetup(track.id))
    const tone = mixTargets(saved).tone
    expect(tone.rough).toBe(true)
    expect(tone.kind).toBe('rough-contour')
  })
})
