import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../../../shared/media'
import { clipFrameAt, layerMediaFrom, newClipMedia, type ClipMedia } from './media'

/** A 10 s clip at 30 fps: frames 0 to 299. */
const clip = (patch: Partial<ClipMedia> = {}): ClipMedia => ({
  ...newClipMedia({ url: 'elynt-media://shelf/1', name: 'smoke.mp4', durationSeconds: 10, fps: 30 }),
  ...patch
})

describe('media from the shelf', () => {
  const item = (patch: Partial<MediaItem>): MediaItem => ({
    id: 4,
    type: 'image',
    path: 'C:\\Art\\Portrait.jpg',
    name: 'Portrait.jpg',
    isLogo: false,
    durationSeconds: null,
    fps: null,
    addedAt: '2026-11-16T09:00:00.000Z',
    ...patch
  })

  it('places a shelf image treated by default, addressed by its shelf id rather than a path', () => {
    expect(layerMediaFrom(item({}))).toEqual({ type: 'image', url: 'elynt-media://shelf/4', name: 'Portrait.jpg', untreated: false })
  })

  it('places a shelf clip playing once, whole, at its own speed', () => {
    expect(layerMediaFrom(item({ type: 'clip', name: 'smoke.mp4', durationSeconds: 8, fps: 24 }))).toMatchObject({
      type: 'clip',
      url: 'elynt-media://shelf/4',
      durationSeconds: 8,
      fps: 24,
      trimStart: 0,
      trimEnd: null,
      loop: false,
      speed: 1
    })
  })
})

describe('clip timing', () => {
  it('plays the whole clip once from the start of its section by default, then holds the last frame', () => {
    expect(clipFrameAt(clip(), 0).frame).toBe(0)
    expect(clipFrameAt(clip(), 1).frame).toBe(30)
    expect(clipFrameAt(clip(), 9.99).frame).toBe(299)
    expect(clipFrameAt(clip(), 25).frame).toBe(299)
  })

  it('seeks to the middle of the frame, so a seek lands on exactly that frame', () => {
    expect(clipFrameAt(clip(), 1).time).toBeCloseTo(30.5 / 30, 9)
  })

  it('plays only the trimmed part, starting at the trim start', () => {
    const trimmed = clip({ trimStart: 2, trimEnd: 4 })
    expect(clipFrameAt(trimmed, 0).frame).toBe(60)
    expect(clipFrameAt(trimmed, 1.5).frame).toBe(105)
    // Past the trim end it holds the trim's last frame, not the clip's.
    expect(clipFrameAt(trimmed, 3).frame).toBe(119)
  })

  it('loops the trimmed part', () => {
    const looped = clip({ trimStart: 2, trimEnd: 4, loop: true })
    expect(clipFrameAt(looped, 2).frame).toBe(60)
    expect(clipFrameAt(looped, 2.5).frame).toBe(75)
    expect(clipFrameAt(looped, 7.1).frame).toBe(93)
  })

  it('speeds up and slows down', () => {
    expect(clipFrameAt(clip({ speed: 2 }), 1).frame).toBe(60)
    expect(clipFrameAt(clip({ speed: 0.5 }), 1).frame).toBe(15)
    expect(clipFrameAt(clip({ speed: 2, loop: true, trimEnd: 4 }), 3).frame).toBe(60)
  })

  it('gives the same clip frame to the two export frames a 60 fps export draws per 30 fps clip frame', () => {
    expect(clipFrameAt(clip(), 10 / 60).frame).toBe(5)
    expect(clipFrameAt(clip(), 11 / 60).frame).toBe(5)
    expect(clipFrameAt(clip(), 12 / 60).frame).toBe(6)
  })

  it('stays inside the clip for odd trims and times', () => {
    expect(clipFrameAt(clip({ trimStart: 12, trimEnd: 20 }), 3).frame).toBe(299)
    expect(clipFrameAt(clip({ trimStart: 5, trimEnd: 3 }), 3).frame).toBe(150)
    expect(clipFrameAt(clip(), -2).frame).toBe(0)
  })
})
