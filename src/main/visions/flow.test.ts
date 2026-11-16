import type Anthropic from '@anthropic-ai/sdk'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Section, TrackAnalysis } from '../../shared/analysis'
import { createClaudeClient, createUsageLog, type Transport, type UsageLog } from '../claude'
import { openSuiteDatabase, type SuiteDatabase } from '../db/database'
import { createApiKeys } from '../keys/api-keys'
import { createMemoryVault } from '../keys/key-vault'
import { createTrackLibrary, type TrackLibrary } from '../tracks'
import { createVisionFlow } from './flow'
import { createVisionStore } from './store'

const recorded = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, 'recorded', name), 'utf8'))

const section = (label: Section['label'], start: number, end: number): Section => ({
  label,
  start,
  end,
  startBar: 0,
  confidence: 1,
  source: 'owner'
})

/** Five sections, sure of its sections and energy but not whether the drop is dark or euphoric. */
const analysis: TrackAnalysis = {
  analyzerVersion: 1,
  durationSeconds: 150,
  bpm: 128,
  beatsPerBar: 4,
  beats: [],
  downbeats: [],
  beatSource: 'beat-this',
  constantTempo: true,
  sections: [section('intro', 0, 30), section('build', 30, 60), section('drop', 60, 90), section('breakdown', 90, 120), section('outro', 120, 150)],
  energy: { hz: 1, values: [] },
  mood: { label: 'moody', arousal: 0.9, valence: 0.1, key: null, keyConfidence: 0, source: 'heuristic' },
  notes: [],
  seconds: 1
}

let dir: string
let db: SuiteDatabase
let tracks: TrackLibrary
let usage: UsageLog
let trackId: number
let replies: unknown[]

/** $4 per M in, $20 per M out: 20k in and 6k out is $0.20 a call. */
const transport: Transport = async (_key, params) =>
  ({
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: params.model,
    content: [{ type: 'text', text: JSON.stringify(replies.shift()), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 20_000, output_tokens: 6_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  }) as unknown as Anthropic.Beta.Messages.BetaMessage

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  tracks = createTrackLibrary(db)
  usage = createUsageLog(db)
  const mixdown = join(dir, 'SUPERFLY.wav')
  writeFileSync(mixdown, '')
  trackId = tracks.addFromMixdown(mixdown).id
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function flow(state: TrackAnalysis | null = analysis) {
  const claude = createClaudeClient({ keys: createApiKeys(createMemoryVault({ anthropic: 'sk-ant-test' })), usage, transport })
  return createVisionFlow({
    claude,
    usage,
    store: createVisionStore(db),
    tracks,
    analysis: (id) => (id === trackId ? state : null),
    artistName: () => 'Elynt'
  })
}

describe('running the vision flow', () => {
  it('saves the three visions with the brief, the answers and what the run cost, retries included', async () => {
    replies = [recorded('off-library-layer.json'), recorded('three-visions.json')]
    const { set } = await flow().run({ trackId, brief: 'Mecha angels.', answers: { 'drop-mood': 'euphoric' } })

    expect(set).toMatchObject({ trackId, brief: 'Mecha angels.', answers: { 'drop-mood': 'euphoric' }, attempts: 2 })
    expect(set.costUsd).toBeCloseTo(0.4, 6)
    expect(set.visions).toHaveLength(3)
    expect(createVisionStore(db).latestSet(trackId)).toEqual(set)
  })

  it("logs each call against the track, and reports the track's whole Visualizer spend", async () => {
    replies = [recorded('three-visions.json'), recorded('three-visions.json')]
    await flow().run({ trackId, brief: '', answers: {} })
    const second = await flow().run({ trackId, brief: '', answers: {} })

    expect(usage.list({ tool: 'visualizer', trackId })).toHaveLength(2)
    expect(second.set.costUsd).toBeCloseTo(0.2, 6)
    expect(second.trackCostUsd).toBeCloseTo(0.4, 6)
  })

  it('asks the tap questions from the analysis itself and keeps only answers to those', async () => {
    replies = [recorded('three-visions.json')]
    const { set } = await flow().run({ trackId, brief: '', answers: { 'drop-mood': 'dark', 'made-up': 'x' } })

    expect(set.questions.map((q) => q.id)).toEqual(['drop-mood'])
    expect(set.answers).toEqual({ 'drop-mood': 'dark' })
  })

  it('refuses a track that has no analysis yet', async () => {
    await expect(flow(null).run({ trackId, brief: '', answers: {} })).rejects.toThrow(/analys/)
  })
})
