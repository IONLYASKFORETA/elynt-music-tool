import { describe, expect, it } from 'vitest'
import type { LiveTrack } from './live-set'
import { BOUNCE_SETTINGS, sortBounces } from './mix-project'

function liveTrack(name: string, kind: LiveTrack['kind'] = 'audio'): LiveTrack {
  return {
    id: 1,
    kind,
    name,
    groupId: null,
    output: { target: 'AudioOut/Main', display: 'Main', kind: 'main' },
    mixer: {
      volume: { value: 1, min: 0, max: 2 },
      volumeDb: 0,
      pan: { value: 0, min: -1, max: 1 },
      muted: false,
      soloed: false,
      sends: []
    },
    devices: []
  }
}

const set = {
  name: 'SUPERFLY',
  tracks: [liveTrack('1-Kick'), liveTrack('Bass'), liveTrack('Sub Bass'), liveTrack('Drums', 'group'), liveTrack('Lead Vox', 'midi')],
  returns: [liveTrack('A-Reverb', 'return')]
}

describe('sorting bounces', () => {
  it("matches Live's All Individual Tracks names (set name, then Live track name) to Live tracks", () => {
    const sorted = sortBounces(
      ['SUPERFLY 1-Kick.wav', 'SUPERFLY Sub Bass.wav', 'SUPERFLY Bass.wav', 'SUPERFLY A-Reverb.wav', 'SUPERFLY Drums.wav'],
      set
    )
    expect(sorted.stems).toEqual([
      { file: 'SUPERFLY 1-Kick.wav', liveTrack: '1-Kick' },
      { file: 'SUPERFLY Sub Bass.wav', liveTrack: 'Sub Bass' },
      { file: 'SUPERFLY Bass.wav', liveTrack: 'Bass' },
      { file: 'SUPERFLY A-Reverb.wav', liveTrack: 'A-Reverb' },
      { file: 'SUPERFLY Drums.wav', liveTrack: 'Drums' }
    ])
  })

  it('matches a plain Live track name, ignoring case, spaces and punctuation', () => {
    expect(sortBounces(['lead_vox.WAV', 'kick.wav'], set).stems).toEqual([
      { file: 'lead_vox.WAV', liveTrack: 'Lead Vox' },
      { file: 'kick.wav', liveTrack: null }
    ])
  })

  it('splits off the mixdown: the Main or Master track, the Set name on its own, or a file called mixdown', () => {
    const sorted = sortBounces(
      ['SUPERFLY Main.wav', 'SUPERFLY Master.wav', 'SUPERFLY.wav', 'superfly mixdown v2.wav', 'SUPERFLY Bass.wav'],
      set
    )
    expect(sorted.mixdowns).toEqual(['SUPERFLY Main.wav', 'SUPERFLY Master.wav', 'SUPERFLY.wav', 'superfly mixdown v2.wav'])
    expect(sorted.stems.map((s) => s.file)).toEqual(['SUPERFLY Bass.wav'])
  })

  it('treats a Live track that is really called Main as a stem', () => {
    const own = { name: 'X', tracks: [liveTrack('Main')], returns: [] }
    expect(sortBounces(['X Main.wav'], own)).toMatchObject({ mixdowns: [], stems: [{ file: 'X Main.wav', liveTrack: 'Main' }] })
  })

  it('lists unmatched stems and the Live tracks no stem was found for', () => {
    const sorted = sortBounces(['SUPERFLY 1-Kick.wav', 'SUPERFLY Old Pad.wav'], set)
    expect(sorted.unmatchedStems).toEqual(['SUPERFLY Old Pad.wav'])
    expect(sorted.unmatchedLiveTracks).toEqual(['Bass', 'Sub Bass', 'Drums', 'Lead Vox', 'A-Reverb'])
  })

  it('gives each Live track at most one stem when two Live tracks share a name', () => {
    const dup = { name: 'X', tracks: [liveTrack('Synth'), liveTrack('Synth')], returns: [] }
    const sorted = sortBounces(['X Synth.wav'], dup)
    expect(sorted.stems).toEqual([{ file: 'X Synth.wav', liveTrack: 'Synth' }])
    expect(sorted.unmatchedLiveTracks).toEqual(['Synth'])
  })

  it('without a Live Set, still splits mixdown from stems but matches nothing', () => {
    const sorted = sortBounces(['SUPERFLY Main.wav', 'SUPERFLY Bass.wav'], null)
    expect(sorted.mixdowns).toEqual(['SUPERFLY Main.wav'])
    expect(sorted.stems).toEqual([{ file: 'SUPERFLY Bass.wav', liveTrack: null }])
    expect(sorted.unmatchedLiveTracks).toEqual([])
  })
})

describe('bounce settings help', () => {
  it('asks for 32-bit float WAV, Normalize off, all individual tracks', () => {
    const text = BOUNCE_SETTINGS.map((s) => `${s.setting}: ${s.value}`).join('\n')
    expect(text).toMatch(/32.bit float/i)
    expect(text).toMatch(/WAV/)
    expect(text).toMatch(/Normalize: Off/i)
    expect(text).toMatch(/All Individual Tracks/i)
  })
})
