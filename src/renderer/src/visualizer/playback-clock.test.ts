import { describe, expect, it } from 'vitest'
import { PlaybackClock } from './playback-clock'

function fakeAudioClock(latency = 0) {
  const audio = { now: 100, latency }
  const clock = new PlaybackClock(() => audio.now, () => audio.latency, 30)
  return { audio, clock }
}

describe('PlaybackClock', () => {
  it('stands still at 0 until played', () => {
    const { audio, clock } = fakeAudioClock()
    audio.now += 5
    expect(clock.time()).toBe(0)
    expect(clock.playing).toBe(false)
  })

  it('follows the audio clock while playing, from where it was', () => {
    const { audio, clock } = fakeAudioClock()
    clock.seek(10)
    clock.play()
    audio.now += 2.5
    expect(clock.time()).toBeCloseTo(12.5)
  })

  it('subtracts output latency so the picture matches what is heard', () => {
    const { audio, clock } = fakeAudioClock(0.04)
    clock.play()
    audio.now += 1
    expect(clock.time()).toBeCloseTo(0.96)
  })

  it('holds its place when paused', () => {
    const { audio, clock } = fakeAudioClock()
    clock.play()
    audio.now += 3
    clock.pause()
    audio.now += 10
    expect(clock.time()).toBeCloseTo(3)
  })

  it('keeps time inside the track', () => {
    const { audio, clock } = fakeAudioClock()
    clock.seek(-4)
    expect(clock.time()).toBe(0)
    clock.seek(29)
    clock.play()
    audio.now += 5
    expect(clock.time()).toBe(30)
    expect(clock.ended).toBe(true)
  })
})
