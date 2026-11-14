import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyPastRelease, emptyProfile, type ArtistProfile } from '../shared/profile'
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

  describe('voice (R7)', () => {
    it('saves examples, switches and never-say words and keeps them after reopening', () => {
      const voice = {
        examples: ['new one friday 🔊', 'this drop is unwell', 'link in bio, go'],
        tone: 'hype' as const,
        emoji: 'some' as const,
        caps: 'lowercase' as const,
        neverSay: ['banger', 'fire']
      }
      createProfileStore(db, fixedNow).save(profile({ voice }))
      db.close()
      db = openSuiteDatabase(join(dir, 'elynt.sqlite'))

      expect(createProfileStore(db).get().voice).toEqual(voice)
    })

    it('drops blank examples, keeps line breaks inside one, and dedupes never-say words ignoring case', () => {
      const saved = createProfileStore(db).save(
        profile({
          voice: {
            examples: ['  ', ' line one\nline two ', ''],
            tone: null,
            emoji: null,
            caps: null,
            neverSay: [' Banger ', 'banger', '', 'fire']
          }
        })
      )

      expect(saved.voice.examples).toEqual(['line one\nline two'])
      expect(saved.voice.neverSay).toEqual(['Banger', 'fire'])
    })

    it('refuses unknown switches and over-long examples', () => {
      const store = createProfileStore(db)
      const voice = emptyProfile().voice

      expect(() => store.save(profile({ voice: { ...voice, tone: 'angry' as never } }))).toThrow(/tone/)
      expect(() => store.save(profile({ voice: { ...voice, examples: ['x'.repeat(2201)] } }))).toThrow(/2200/)
    })
  })

  describe('setup check (R7)', () => {
    it('saves its answers', () => {
      const setupCheck = {
        customReleaseDates: true,
        spotifyForArtistsClaimed: false,
        tiktokArtistAccount: null,
        soundcloudPlan: 'free' as const
      }
      createProfileStore(db).save(profile({ setupCheck }))

      expect(createProfileStore(db).get().setupCheck).toEqual(setupCheck)
    })

    it('refuses a SoundCloud plan it does not know', () => {
      const bad = profile({ setupCheck: { ...emptyProfile().setupCheck, soundcloudPlan: 'next-pro' as never } })

      expect(() => createProfileStore(db).save(bad)).toThrow(/SoundCloud plan/)
    })
  })

  describe('past releases (R7)', () => {
    it('saves singles with a date and optional numbers, newest first', () => {
      const saved = createProfileStore(db).save(
        profile({
          pastReleases: [
            { ...emptyPastRelease(), title: ' Older ', releasedOn: '2025-03-07', spotifyStreams: 1200 },
            {
              title: 'Newer',
              releasedOn: '2026-06-12',
              spotifyStreams: 3400,
              spotifySaves: 210,
              soundcloudPlays: null,
              followersGained: 45
            }
          ]
        })
      )

      expect(saved.pastReleases.map((r) => [r.title, r.releasedOn])).toEqual([
        ['Newer', '2026-06-12'],
        ['Older', '2025-03-07']
      ])
      expect(createProfileStore(db).get().pastReleases[1]).toEqual({
        ...emptyPastRelease(),
        title: 'Older',
        releasedOn: '2025-03-07',
        spotifyStreams: 1200
      })
    })

    it('drops rows left completely blank', () => {
      const saved = createProfileStore(db).save(profile({ pastReleases: [emptyPastRelease()] }))

      expect(saved.pastReleases).toEqual([])
    })

    it('needs a title and a real date on any row that has something in it', () => {
      const store = createProfileStore(db)

      expect(() =>
        store.save(profile({ pastReleases: [{ ...emptyPastRelease(), releasedOn: '2026-01-02' }] }))
      ).toThrow(/title/)
      expect(() =>
        store.save(profile({ pastReleases: [{ ...emptyPastRelease(), title: 'X', releasedOn: '2026-02-30' }] }))
      ).toThrow(/date/)
      expect(() =>
        store.save(
          profile({ pastReleases: [{ ...emptyPastRelease(), title: 'X', releasedOn: '2026-02-03', spotifySaves: -1 }] })
        )
      ).toThrow(/Spotify saves/)
    })
  })

  it('reads the R7 fields as empty from a profile saved before they existed', () => {
    db.prepare("INSERT INTO artist_profile (id, artist_name, updated_at) VALUES (1, 'Old', '2026-11-13T00:00:00.000Z')").run()

    expect(createProfileStore(db).get()).toMatchObject({
      artistName: 'Old',
      voice: emptyProfile().voice,
      setupCheck: emptyProfile().setupCheck,
      pastReleases: []
    })
  })
})
