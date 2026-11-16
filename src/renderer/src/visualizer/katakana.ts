/**
 * Katakana for Poster Type, made from a track title. Latin words are read the way loanwords are
 * written in katakana (English spelling first turned into rough romaji, then into kana), kana and
 * kanji are kept, and words are joined with a middle dot. It is a starting point the owner can
 * edit, not a dictionary: unusual words come out close rather than right.
 */
export function toKatakana(title: string): string {
  const words = title.match(/[a-z']+|[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]+|[0-9]+/gi) ?? []
  return words
    .map((word) => (/^[a-z']+$/i.test(word) ? latinWord(word) : toKatakanaScript(word)))
    .filter((word) => word.length > 0)
    .join('・')
}

/** Hiragana to katakana; anything else is kept. */
function toKatakanaScript(text: string): string {
  return text.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

/** Short words whose loanword spelling the rules below would get wrong. */
const WORDS: Record<string, string> = {
  a: 'ア',
  and: 'アンド',
  be: 'ビー',
  i: 'アイ',
  love: 'ラブ',
  me: 'ミー',
  my: 'マイ',
  of: 'オブ',
  the: 'ザ',
  to: 'トゥ',
  we: 'ウィー',
  you: 'ユー'
}

function latinWord(word: string): string {
  const lower = word.toLowerCase().replace(/'/g, '')
  return WORDS[lower] ?? romajiToKana(englishToRomaji(lower))
}

const VOWEL = /[aeiou]/
const isVowel = (c: string | undefined) => c !== undefined && VOWEL.test(c)

/** English spelling to rough romaji, with ":" marking a long vowel. */
function englishToRomaji(word: string): string {
  let w = word
    .replace(/tion/g, 'shon')
    .replace(/igh/g, 'ai')
    .replace(/gh/g, '')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'kw')
    .replace(/wh/g, 'w')
    .replace(/th/g, 's')
    .replace(/x/g, 'ks')
    .replace(/q/g, 'k')
    .replace(/c(?!h)(?=[eiy])/g, 's')
    .replace(/c(?!h)/g, 'k')
  // A silent final e lengthens the vowel before its consonant: drive, fade, home, tune.
  const LONG: Record<string, string> = { a: 'ei', i: 'ai', o: 'o:', u: 'yu:' }
  w = w.replace(/(^|[^aeiou])([aiou])([^aeiouwy])e$/, (_, before: string, v: string, c: string) => before + LONG[v] + c)
  if (w.length > 3) w = w.replace(/([^aeiou])e$/, '$1')
  w = w.replace(/ee|ea/g, 'i:').replace(/oo/g, 'u:').replace(/oa/g, 'o:').replace(/ay/g, 'ei')
  // A vowel before an r that ends a syllable is long: dark, star, never.
  w = w.replace(/([aeiou])r(?=[^aeiouy]|$)/g, (_, v: string, offset: number) => {
    const long = v === 'o' ? 'o:' : 'a:'
    return isVowel(w[offset - 1]) ? v + long : long
  })
  w = w
    .replace(/([^aeiou])y$/, '$1i:')
    .replace(/y(?![aeiou])/g, 'i')
    .replace(/l/g, 'r')
    .replace(/v/g, 'b')
    .replace(/([mnrhwfbzjy])\1/g, '$1')
  return w
}

type Row = readonly [a: string, i: string, u: string, e: string, o: string]

const ROWS: Record<string, Row> = {
  '': ['ア', 'イ', 'ウ', 'エ', 'オ'],
  k: ['カ', 'キ', 'ク', 'ケ', 'コ'],
  g: ['ガ', 'ギ', 'グ', 'ゲ', 'ゴ'],
  s: ['サ', 'シ', 'ス', 'セ', 'ソ'],
  z: ['ザ', 'ジ', 'ズ', 'ゼ', 'ゾ'],
  t: ['タ', 'ティ', 'トゥ', 'テ', 'ト'],
  d: ['ダ', 'ディ', 'ドゥ', 'デ', 'ド'],
  n: ['ナ', 'ニ', 'ヌ', 'ネ', 'ノ'],
  h: ['ハ', 'ヒ', 'フ', 'ヘ', 'ホ'],
  b: ['バ', 'ビ', 'ブ', 'ベ', 'ボ'],
  p: ['パ', 'ピ', 'プ', 'ペ', 'ポ'],
  m: ['マ', 'ミ', 'ム', 'メ', 'モ'],
  y: ['ヤ', 'イ', 'ユ', 'イェ', 'ヨ'],
  r: ['ラ', 'リ', 'ル', 'レ', 'ロ'],
  w: ['ワ', 'ウィ', 'ウ', 'ウェ', 'ウォ'],
  f: ['ファ', 'フィ', 'フ', 'フェ', 'フォ'],
  j: ['ジャ', 'ジ', 'ジュ', 'ジェ', 'ジョ'],
  sh: ['シャ', 'シ', 'シュ', 'シェ', 'ショ'],
  ch: ['チャ', 'チ', 'チュ', 'チェ', 'チョ'],
  ts: ['ツァ', 'ツィ', 'ツ', 'ツェ', 'ツォ'],
  ky: ['キャ', 'キ', 'キュ', 'キェ', 'キョ'],
  gy: ['ギャ', 'ギ', 'ギュ', 'ギェ', 'ギョ'],
  ny: ['ニャ', 'ニ', 'ニュ', 'ニェ', 'ニョ'],
  hy: ['ヒャ', 'ヒ', 'ヒュ', 'ヒェ', 'ヒョ'],
  my: ['ミャ', 'ミ', 'ミュ', 'ミェ', 'ミョ'],
  ry: ['リャ', 'リ', 'リュ', 'リェ', 'リョ'],
  by: ['ビャ', 'ビ', 'ビュ', 'ビェ', 'ビョ'],
  py: ['ピャ', 'ピ', 'ピュ', 'ピェ', 'ピョ']
}

/** A consonant with no vowel after it gets the vowel loanwords give it. */
const CODA: Record<string, string> = {
  k: 'ク', g: 'グ', s: 'ス', z: 'ズ', t: 'ト', d: 'ド', n: 'ン', h: '', b: 'ブ', p: 'プ', m: 'ム',
  r: 'ル', w: 'ウ', f: 'フ', j: 'ジ', y: 'イ', sh: 'シュ', ch: 'チ', ts: 'ツ'
}

/** After a short vowel, these consonants close the syllable with a small tsu: back, drop, midnight. */
const STOPS = new Set(['k', 't', 'p', 'd', 'g', 'ch', 'sh'])
const VOWEL_INDEX: Record<string, number> = { a: 0, i: 1, u: 2, e: 3, o: 4 }

function romajiToKana(romaji: string): string {
  let out = ''
  let i = 0
  while (i < romaji.length) {
    const c = romaji[i]!
    if (c === ':') {
      out += 'ー'
      i++
      continue
    }
    if (isVowel(c)) {
      out += ROWS['']![VOWEL_INDEX[c]!]
      i++
      continue
    }
    const two = romaji.slice(i, i + 2)
    const onset = two in ROWS ? two : c
    if (!(onset in ROWS)) {
      i++
      continue
    }
    // A doubled consonant is a small tsu and then the consonant.
    if (onset.length === 1 && romaji[i + 1] === c) {
      out += 'ッ'
      i++
      continue
    }
    const next = romaji[i + onset.length]
    if (isVowel(next)) {
      out += ROWS[onset]![VOWEL_INDEX[next!]!]
      i += onset.length + 1
      continue
    }
    const shortVowelBefore = isVowel(romaji[i - 1]) && !isVowel(romaji[i - 2])
    if (STOPS.has(onset) && shortVowelBefore) out += 'ッ'
    out += CODA[onset] ?? ''
    i += onset.length
  }
  return out
}
