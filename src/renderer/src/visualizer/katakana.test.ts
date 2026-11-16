import { describe, expect, it } from 'vitest'
import { toKatakana } from './katakana'

describe('toKatakana', () => {
  it('writes romaji words as katakana', () => {
    expect(toKatakana('Sakura')).toBe('サクラ')
    expect(toKatakana('neon')).toBe('ネオン')
  })

  it('reads English titles the way loanwords are written, one word at a time', () => {
    expect(toKatakana('Midnight Drive')).toBe('ミッドナイト・ドライブ')
    expect(toKatakana('Back to the Dark')).toBe('バック・トゥ・ザ・ダーク')
    expect(toKatakana('Drop')).toBe('ドロップ')
    expect(toKatakana('Beat')).toBe('ビート')
    expect(toKatakana('Star')).toBe('スター')
    expect(toKatakana('Never')).toBe('ネバー')
  })

  it('drops punctuation between words', () => {
    expect(toKatakana('Neon, Drive!')).toBe('ネオン・ドライブ')
  })

  it('turns hiragana into katakana and keeps katakana and kanji as they are', () => {
    expect(toKatakana('さくら')).toBe('サクラ')
    expect(toKatakana('東京 ネオン')).toBe('東京・ネオン')
  })

  it('gives nothing for a title with no letters', () => {
    expect(toKatakana('  -- ')).toBe('')
  })
})
