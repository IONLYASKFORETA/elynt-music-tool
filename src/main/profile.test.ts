import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyProfile, type ArtistProfile } from '../shared/profile'
import { openSuiteDatabase, type SuiteDatabase } from './db/database'
import { createProfileStore } from './profile'

let dir: string
let db: SuiteDatabase
const fixedNow = () => new Date('2026-11-13T12:00:00.000Z')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-profile-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function profile(changes: Partial<ArtistProfile>): ArtistProfile {
  return { ...emptyProfile(), ...changes }
}

describe('artist profile', () => {
  it('reads as empty before it is ever saved', () => {
    expect(createProfileStore(db).get()).toEqual(emptyProfile())
  })

  it('saves and reads back a half-filled profile', () => {
    const store = createProfileStore(db, fixedNow)

    store.save(
      profile({
        artistName: 'ELYNT',
        subgenres: { main: 'bass-house', others: [] },
        audience: { followers: { tiktok: 1200 }, spotifyMonthlyListeners: null }
      })
    )

    expect(store.get()).toEqual(
      profile({
        artistName: 'ELYNT',
        subgenres: { main: 'bass-house', others: [] },
        audience: { followers: { tiktok: 1200 }, spotifyMonthlyListeners: null },
        updatedAt: '2026-11-13T12:00:00.000Z'
      })
    )
  })

  it('saves a profile with nothing filled in', () => {
    const store = createProfileStore(db, fixedNow)

    store.save(emptyProfile())

    expect(store.get()).toEqual({ ...emptyProfile(), updatedAt: '2026-11-13T12:00:00.000Z' })
  })

  it('keeps one suite-wide row however often it is saved', () => {
    const store = createProfileStore(db)

    store.save(profile({ artistName: 'First' }))
    store.save(profile({ artistName: 'Second', budgetPerRelease: 100 }))

    expect(db.prepare('SELECT COUNT(*) AS n FROM artist_profile').get()).toEqual({ n: 1 })
    expect(store.get()).toMatchObject({ artistName: 'Second', budgetPerRelease: 100 })
  })

  it('keeps every field after the database is closed and reopened', () => {
    const full = profile({
      artistName: 'ELYNT',
      links: { spotify: 'https://open.spotify.com/artist/x', soundcloud: 'https://soundcloud.com/x' },
      subgenres: { main: 'dubstep', others: ['melodic-dubstep', 'future-bass'] },
      audience: { followers: { instagram: 800, soundcloud: 300 }, spotifyMonthlyListeners: 2500 },
      budgetPerRelease: 75.5,
      distributor: 'DistroKid',
      platforms: ['spotify', 'soundcloud', 'tiktok', 'instagram'],
      referenceArtists: ['Artist A', 'Artist B'],
      defaultGoal: 'dj-support'
    })
    createProfileStore(db, fixedNow).save(full)
    db.close()

    db = openSuiteDatabase(join(dir, 'elynt.sqlite'))

    expect(createProfileStore(db).get()).toEqual({ ...full, updatedAt: '2026-11-13T12:00:00.000Z' })
  })

  it('turns blank text into "not filled in" and trims the rest', () => {
    const store = createProfileStore(db)

    const saved = store.save(
      profile({
        artistName: '   ',
        distributor: ' DistroKid ',
        links: { spotify: '', tiktok: ' https://tiktok.com/@x ' },
        referenceArtists: [' Artist A ', '', 'Artist A']
      })
    )

    expect(saved).toMatchObject({
      artistName: null,
      distributor: 'DistroKid',
      links: { tiktok: 'https://tiktok.com/@x' },
      referenceArtists: ['Artist A']
    })
  })

  it('allows one main subgenre plus at most two more', () => {
    const store = createProfileStore(db)

    expect(() =>
      store.save(profile({ subgenres: { main: 'house', others: ['techno', 'trance', 'dubstep'] } }))
    ).toThrow(/at most 2 more/)
    expect(() => store.save(profile({ subgenres: { main: null, others: ['techno'] } }))).toThrow(/main subgenre/)
  })

  it('drops the main subgenre from the others list', () => {
    const saved = createProfileStore(db).save(profile({ subgenres: { main: 'house', others: ['house', 'techno'] } }))

    expect(saved.subgenres).toEqual({ main: 'house', others: ['techno'] })
  })

  it('refuses subgenres that are not on the suite-wide list', () => {
    const bad = profile({ subgenres: { main: 'polka' as never, others: [] } })

    expect(() => createProfileStore(db).save(bad)).toThrow(/Unknown subgenre: polka/)
  })

  it('refuses negative or fractional follower counts and a negative budget', () => {
    const store = createProfileStore(db)

    expect(() =>
      store.save(profile({ audience: { followers: { spotify: -1 }, spotifyMonthlyListeners: null } }))
    ).toThrow(/spotify followers/)
    expect(() =>
      store.save(profile({ audience: { followers: {}, spotifyMonthlyListeners: 1.5 } }))
    ).toThrow(/monthly listeners/)
    expect(() => store.save(profile({ budgetPerRelease: -5 }))).toThrow(/Budget/)
  })

  it('allows a budget of $0', () => {
    expect(createProfileStore(db).save(profile({ budgetPerRelease: 0 })).budgetPerRelease).toBe(0)
  })

  it('lists at most three reference artists', () => {
    expect(() =>
      createProfileStore(db).save(profile({ referenceArtists: ['A', 'B', 'C', 'D'] }))
    ).toThrow(/at most 3/)
  })
})
