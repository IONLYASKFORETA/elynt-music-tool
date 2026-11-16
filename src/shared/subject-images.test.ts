import { describe, expect, it } from 'vitest'
import { mediaPath, mediaUrl, subjectPrompt } from './subject-images'

describe('subject prompt', () => {
  it("describes the track's motif in the house style, on the ground asked for, in the vision's colors", () => {
    const prompt = subjectPrompt({ motif: 'a kneeling mecha with a halo', ground: 'black', palette: ['#ff2bd6', '#00e5ff', '#f2ff00'] })

    expect(prompt).toMatch(/^a kneeling mecha with a halo, /)
    expect(prompt).toContain('iridescent holographic chrome')
    expect(prompt).toContain('plain pure black background')
    expect(prompt).toContain('#ff2bd6, #00e5ff, #f2ff00')
    // The Poster Type layer sets the words; generated text would fight it.
    expect(prompt).toContain('no text')
  })

  it('can sit on off-white instead, and leaves colors out when there is no palette', () => {
    const prompt = subjectPrompt({ motif: 'a sigil', ground: 'off-white' })

    expect(prompt).toContain('plain flat off-white background')
    expect(prompt).not.toContain('#')
  })

  it('needs a motif', () => {
    expect(() => subjectPrompt({ motif: '   ', ground: 'black' })).toThrow(/motif/)
  })
})

describe('media URLs', () => {
  it('carry a file path the renderer can load and the main process can read back', () => {
    const path = 'C:\\Users\\Aden\\AppData\\Roaming\\elynt\\subjects\\3\\subject 1.png'

    const url = mediaUrl(path)

    expect(url.startsWith('elynt-media://file/')).toBe(true)
    expect(new URL(url).pathname.split('/').length).toBe(2)
    expect(mediaPath(url)).toBe(path)
  })

  it('give no path for any other URL', () => {
    expect(mediaPath('blob:file:///1234')).toBeNull()
    expect(mediaPath('elynt-media://other/x')).toBeNull()
  })
})
