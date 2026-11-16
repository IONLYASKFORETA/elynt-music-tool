import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TrackAnalysis } from '../../shared/analysis'
import { createUsageLog, type UsageLog } from '../claude/usage'
import { openSuiteDatabase, type SuiteDatabase } from '../db/database'
import { createTrackLibrary } from '../tracks'
import { createMoodListener, type GeminiTransport, type GenerateContentResponse } from './mood-listen'

let dir: string
let db: SuiteDatabase
let usage: UsageLog
let trackId: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  usage = createUsageLog(db)
  trackId = createTrackLibrary(db).addFromMixdown('D:\\Bounces\\flip.wav').id
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const coarse: TrackAnalysis = {
  analyzerVersion: 1,
  durationSeconds: 72,
  bpm: 134,
  beatsPerBar: 4,
  beats: [0.5, 0.95],
  downbeats: [0.5],
  beatSource: 'dsp',
  constantTempo: true,
  sections: [
    { label: 'intro', start: 0, end: 14.3, startBar: 0, confidence: 0.9, source: 'heuristic' },
    { label: 'build', start: 14.3, end: 42.95, startBar: 8, confidence: 0.9, source: 'heuristic' },
    { label: 'drop', start: 42.95, end: 72, startBar: 24, confidence: 1, source: 'heuristic' }
  ],
  energy: { hz: 10, values: [0, 0.5, 1] },
  mood: { label: 'euphoric', arousal: 0.3, valence: 0.5, key: 'C major', keyConfidence: 0.9, source: 'heuristic' },
  notes: [],
  seconds: 0.2
}

/** What Gemini sends back for a 72-second track: 2,304 audio tokens, a short JSON answer. */
const geminiReply = (text: string): GenerateContentResponse => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
  usageMetadata: {
    promptTokenCount: 2504,
    candidatesTokenCount: 300,
    thoughtsTokenCount: 100,
    totalTokenCount: 2904,
    promptTokensDetails: [
      { modality: 'AUDIO', tokenCount: 2304 },
      { modality: 'TEXT', tokenCount: 200 }
    ]
  }
})

const listenAnswer = {
  label: 'dark',
  arousal: 0.8,
  valence: -0.4,
  words: ['menacing', 'driving', 'cold'],
  summary: 'A cold, driving track that turns menacing at the drop.',
  sections: [
    { index: 0, feeling: 'uneasy and sparse', intensity: 0.2 },
    { index: 1, feeling: 'tension winding up', intensity: 0.6 },
    { index: 2, feeling: 'menacing and relentless', intensity: 1 }
  ]
}

function stubTransport(reply: () => Promise<GenerateContentResponse>) {
  const log: string[] = []
  const transport: GeminiTransport = {
    async uploadFile(apiKey, file) {
      log.push(`upload ${apiKey} ${file.path} ${file.mimeType}`)
      return { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: file.mimeType }
    },
    async generateContent(apiKey, model) {
      log.push(`generate ${apiKey} ${model}`)
      return reply()
    },
    async deleteFile(apiKey, name) {
      log.push(`delete ${apiKey} ${name}`)
    }
  }
  return { transport, log }
}

const keysWith = (gemini: string | null) => ({ get: async () => gemini })

describe('Gemini mood listen', () => {
  it('sends the mixdown to Gemini and returns its mood detail, logging the cost', async () => {
    const { transport, log } = stubTransport(async () => geminiReply(JSON.stringify(listenAnswer)))
    const listen = createMoodListener({
      keys: keysWith('AIza-test'),
      usage,
      transport,
      now: () => new Date('2026-11-16T10:00:00Z')
    })

    const detail = await listen({ trackId, mixdownPath: 'D:\\Bounces\\flip.wav', analysis: coarse })

    expect(detail).toMatchObject({ source: 'gemini', label: 'dark', arousal: 0.8, valence: -0.4, words: ['menacing', 'driving', 'cold'] })
    expect(detail?.sections.map((s) => s.feeling)).toEqual(['uneasy and sparse', 'tension winding up', 'menacing and relentless'])
    expect(log[0]).toBe('upload AIza-test D:\\Bounces\\flip.wav audio/wav')
    expect(log.at(-1)).toBe('delete AIza-test files/abc') // nothing left on Google's side

    const [row] = usage.list({ trackId })
    expect(row).toMatchObject({ tool: 'visualizer', trackId, calledAt: '2026-11-16T10:00:00.000Z', inputTokens: 2504, outputTokens: 400 })
    expect(row?.model).toBe(detail?.model)
    // gemini-3.1-flash-lite list price: 2,504 input tokens at $0.50/M (audio rate) + 400 output at $1.50/M.
    expect(row!.costUsd).toBeCloseTo(0.001852, 6)
  })

  it('without a Gemini key, does nothing and costs nothing', async () => {
    const { transport, log } = stubTransport(async () => geminiReply(JSON.stringify(listenAnswer)))
    const listen = createMoodListener({ keys: keysWith(null), usage, transport })

    expect(await listen({ trackId, mixdownPath: 'D:\\Bounces\\flip.wav', analysis: coarse })).toBeNull()
    expect(log).toEqual([])
    expect(usage.list()).toEqual([])
  })

  it('offline, gives up quietly and leaves no file behind', async () => {
    const { transport, log } = stubTransport(async () => {
      throw new TypeError('fetch failed')
    })
    const errors: unknown[] = []
    const listen = createMoodListener({ keys: keysWith('AIza-test'), usage, transport, onError: (e) => errors.push(e) })

    expect(await listen({ trackId, mixdownPath: 'D:\\Bounces\\flip.wav', analysis: coarse })).toBeNull()
    expect(log.at(-1)).toBe('delete AIza-test files/abc')
    expect(usage.list()).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('logs the cost even when the answer is unusable, since Google still bills it', async () => {
    const { transport } = stubTransport(async () => geminiReply(JSON.stringify({ ...listenAnswer, label: 'happy' })))
    const listen = createMoodListener({ keys: keysWith('AIza-test'), usage, transport })

    expect(await listen({ trackId, mixdownPath: 'D:\\Bounces\\flip.wav', analysis: coarse })).toBeNull()
    expect(usage.list({ trackId })).toHaveLength(1)
  })

  it('keeps only answers for sections the track has, within range', async () => {
    const answer = {
      ...listenAnswer,
      arousal: 1.7,
      sections: [
        { index: 2, feeling: 'menacing', intensity: 1.4 },
        { index: 7, feeling: 'made up', intensity: 0.5 },
        { index: 0, feeling: 'uneasy', intensity: 0.2 }
      ]
    }
    const { transport } = stubTransport(async () => geminiReply(JSON.stringify(answer)))
    const listen = createMoodListener({ keys: keysWith('AIza-test'), usage, transport })

    const detail = await listen({ trackId, mixdownPath: '/m/flip.flac', analysis: coarse })

    expect(detail?.arousal).toBe(1)
    expect(detail?.sections).toEqual([
      { index: 0, feeling: 'uneasy', intensity: 0.2 },
      { index: 2, feeling: 'menacing', intensity: 1 }
    ])
  })
})
