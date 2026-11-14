import { describe, expect, it } from 'vitest'
import { emptyProfile, parseNeverSay, setupStatus, type ArtistProfile } from './profile'

function withSetup(setupCheck: Partial<ArtistProfile['setupCheck']>, distributor: string | null = 'DistroKid') {
  return { distributor, setupCheck: { ...emptyProfile().setupCheck, ...setupCheck } }
}

describe('setup check status', () => {
  it('lists all four items as unanswered on a new profile, blocking nothing', () => {
    const status = setupStatus(emptyProfile())

    expect(status.map((s) => [s.id, s.state, s.blocks])).toEqual([
      ['customReleaseDates', 'unanswered', null],
      ['spotifyForArtistsClaimed', 'unanswered', null],
      ['tiktokArtistAccount', 'unanswered', null],
      ['soundcloudPlan', 'unanswered', null]
    ])
  })

  it.each([
    ['customReleaseDates', { customReleaseDates: false }, /R−7 Spotify pitch/],
    ['spotifyForArtistsClaimed', { spotifyForArtistsClaimed: false }, /editorial pitch/],
    ['tiktokArtistAccount', { tiktokArtistAccount: false }, /artist tools/],
    ['soundcloudPlan', { soundcloudPlan: 'free' as const }, /00:01/]
  ])('says what an unmet %s blocks', (id, answers, blocks) => {
    const item = setupStatus(withSetup(answers)).find((s) => s.id === id)!

    expect(item.state).toBe('unmet')
    expect(item.blocks).toMatch(blocks)
  })

  it('counts yes answers and a paid SoundCloud plan as met', () => {
    const status = setupStatus(
      withSetup({
        customReleaseDates: true,
        spotifyForArtistsClaimed: true,
        tiktokArtistAccount: true,
        soundcloudPlan: 'artist'
      })
    )

    expect(status.every((s) => s.state === 'met' && s.blocks === null)).toBe(true)
  })

  it('names the distributor from the profile in the release date question', () => {
    expect(setupStatus(withSetup({}, 'TuneCore'))[0]!.question).toContain('TuneCore')
    expect(setupStatus(withSetup({}, null))[0]!.question).toBe('Does your distributor’s plan let you choose the release date?')
  })
})

describe('never-say words', () => {
  it('splits on commas and new lines, trims, and drops repeats ignoring case', () => {
    expect(parseNeverSay('banger, Fire\n fire ,, vibes ')).toEqual(['banger', 'Fire', 'vibes'])
  })
})
