import { describe, expect, it } from 'vitest'
import { coverArtUrl, mediaTypeOf, parseMediaUrl, shelfUrl } from './media'

describe('media addresses', () => {
  it('round-trips shelf items and cover art', () => {
    expect(shelfUrl(12)).toBe('elynt-media://shelf/12')
    expect(coverArtUrl(3)).toBe('elynt-media://cover/3')
    expect(parseMediaUrl(shelfUrl(12))).toEqual({ from: 'shelf', id: 12 })
    expect(parseMediaUrl(coverArtUrl(3))).toEqual({ from: 'cover', trackId: 3 })
  })

  it('turns down anything else, so the main process never serves a path the UI made up', () => {
    for (const url of ['elynt-media://shelf/../x', 'elynt-media://shelf/1.5', 'file:///C:/x.png', 'elynt-media://disk/1', 'elynt-media://shelf/']) {
      expect(parseMediaUrl(url)).toBeNull()
    }
  })

  it('tells images from clips by extension', () => {
    expect(mediaTypeOf('C:\\Art\\Logo.PNG')).toBe('image')
    expect(mediaTypeOf('/clips/smoke.mov')).toBe('clip')
    expect(mediaTypeOf('/clips/notes.txt')).toBeNull()
  })
})
