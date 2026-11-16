import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Section, TrackAnalysis } from '../../shared/analysis'
import { tapQuestions } from '../../shared/tap-questions'
import { ClaudeError, createFakeClaudeClient, type ClaudeJsonRequest } from '../claude'
import { proposeVisions, VISION_ATTEMPTS, type VisionAsk } from './propose'

/** Claude replies recorded for a five-section track: intro, build, drop, breakdown, outro. */
const recorded = (name: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, 'recorded', name), 'utf8'))

const section = (label: Section['label'], start: number, end: number, confidence = 1): Section => ({
  label,
  start,
  end,
  startBar: Math.round(start / 2),
  confidence,
  source: 'heuristic'
})

function analysis(): TrackAnalysis {
  return {
    analyzerVersion: 1,
    durationSeconds: 150,
    bpm: 128,
    beatsPerBar: 4,
    beats: [],
    downbeats: [],
    beatSource: 'beat-this',
    constantTempo: true,
    sections: [section('intro', 0, 30), section('build', 30, 60), section('drop', 60, 90, 0.3), section('breakdown', 90, 120), section('outro', 120, 150)],
    energy: { hz: 1, values: Array.from({ length: 150 }, (_, i) => (i >= 60 && i < 90 ? 0.9 : 0.3)) },
    mood: { label: 'dark', arousal: 0.8, valence: -0.1, key: 'F minor', keyConfidence: 0.7, source: 'heuristic' },
    notes: [],
    seconds: 1
  }
}

function ask(overrides: Partial<VisionAsk> = {}): VisionAsk {
  const a = analysis()
  return { trackId: 7, title: 'SUPERFLY', artist: 'Elynt', analysis: a, brief: '', questions: tapQuestions(a), answers: {}, ...overrides }
}

const userText = (request: ClaudeJsonRequest, turn = 0): string => {
  const prompt = request.prompt
  if (typeof prompt === 'string') return prompt
  const content = prompt[turn]!.content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

describe('proposing three visions', () => {
  it('replays a recorded reply into three checked visions, one plan per section each', async () => {
    const claude = createFakeClaudeClient(recorded('three-visions.json') as object)
    const { visions, attempts } = await proposeVisions({ claude }, ask())

    expect(attempts).toBe(1)
    expect(visions.map((v) => v.name)).toEqual(['Chrome Seraph', 'Datamosh Rave', 'Neon Shrine'])
    for (const v of visions) expect(v.sections.map((s) => s.section)).toEqual([0, 1, 2, 3, 4])
  })

  it('asks the strongest tier for the Visualizer, on this track, against the visions schema', async () => {
    const claude = createFakeClaudeClient(recorded('three-visions.json') as object)
    await proposeVisions({ claude }, ask())

    const [request] = claude.calls as ClaudeJsonRequest[]
    expect(request).toMatchObject({ tool: 'visualizer', tier: 'strongest', trackId: 7 })
    expect(JSON.stringify(request!.schema)).toContain('"lightPillar"')
  })

  it('rejects a reply with a layer outside the library and asks again, saying what was wrong', async () => {
    const claude = createFakeClaudeClient(recorded('off-library-layer.json') as object, recorded('three-visions.json') as object)
    const { visions, attempts } = await proposeVisions({ claude }, ask())

    expect(attempts).toBe(2)
    expect(visions).toHaveLength(3)
    const retry = claude.calls[1] as ClaudeJsonRequest
    expect(Array.isArray(retry.prompt) && retry.prompt.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(userText(retry, 2)).toContain('Vision 2, section 3: "fluid_sim" is not a layer in the layer library.')
  })

  it('asks again when Claude sends back something unparseable', async () => {
    const claude = createFakeClaudeClient(new ClaudeError('bad-output', 'nope'), recorded('three-visions.json') as object)
    const { attempts } = await proposeVisions({ claude }, ask())
    expect(attempts).toBe(2)
  })

  it(`gives up after ${VISION_ATTEMPTS} bad replies with an error the UI can show`, async () => {
    const claude = createFakeClaudeClient(recorded('off-library-layer.json') as object)
    await expect(proposeVisions({ claude }, ask())).rejects.toMatchObject({ code: 'bad-output' })
    expect(claude.calls).toHaveLength(VISION_ATTEMPTS)
  })

  it('does not retry a missing key or an offline network', async () => {
    const claude = createFakeClaudeClient(new ClaudeError('no-key', 'Add your key'))
    await expect(proposeVisions({ claude }, ask())).rejects.toMatchObject({ code: 'no-key' })
    expect(claude.calls).toHaveLength(1)
  })

  it('passes each recorded reply to the recorder, so real replies can be saved for replay', async () => {
    const seen: unknown[] = []
    const claude = createFakeClaudeClient(recorded('off-library-layer.json') as object, recorded('three-visions.json') as object)
    await proposeVisions({ claude, onReply: (r) => seen.push(r) }, ask())
    expect(seen).toEqual([recorded('off-library-layer.json'), recorded('three-visions.json')])
  })
})

describe('what Claude is told', () => {
  it('gives the sections by index with their times, the tempo, the mood and the title', async () => {
    const claude = createFakeClaudeClient(recorded('three-visions.json') as object)
    await proposeVisions({ claude }, ask())
    const text = userText(claude.calls[0] as ClaudeJsonRequest)

    expect(text).toContain('SUPERFLY')
    expect(text).toContain('128 BPM')
    expect(text).toContain('2: drop, 1:00 to 1:30')
    expect(text).toContain('dark')
  })

  it("includes the owner's brief, or says there is none when it was skipped", async () => {
    const withBrief = createFakeClaudeClient(recorded('three-visions.json') as object)
    await proposeVisions({ claude: withBrief }, ask({ brief: 'Mecha angels over Tokyo at night.' }))
    expect(userText(withBrief.calls[0] as ClaudeJsonRequest)).toContain('Mecha angels over Tokyo at night.')

    const skipped = createFakeClaudeClient(recorded('three-visions.json') as object)
    await proposeVisions({ claude: skipped }, ask({ brief: '  ' }))
    expect(userText(skipped.calls[0] as ClaudeJsonRequest)).toContain('No brief')
  })

  it('includes the tap answers in words', async () => {
    const claude = createFakeClaudeClient(recorded('three-visions.json') as object)
    await proposeVisions({ claude }, ask({ answers: { 'drop-mood': 'euphoric' } }))
    expect(userText(claude.calls[0] as ClaudeJsonRequest)).toContain('Dark or euphoric drop? Euphoric: bright, lifting, wide open.')
  })

  it('describes the house style and every layer kind with its settings', async () => {
    const claude = createFakeClaudeClient(recorded('three-visions.json') as object)
    await proposeVisions({ claude }, ask())
    const system = (claude.calls[0] as ClaudeJsonRequest).system!

    expect(system).toContain('house style')
    expect(system).toContain('Light Pillar')
    expect(system).toContain('count (1 to 7')
  })
})
