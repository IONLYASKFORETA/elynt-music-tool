import Anthropic from '@anthropic-ai/sdk'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSuiteDatabase, type SuiteDatabase } from '../db/database'
import { createApiKeys } from '../keys/api-keys'
import { createMemoryVault } from '../keys/key-vault'
import { createTrackLibrary } from '../tracks'
import { createClaudeClient, MESSAGES, type Transport } from './client'
import { ClaudeError } from './types'
import { createUsageLog, type UsageLog } from './usage'

type Message = Anthropic.Beta.Messages.BetaMessage
type Params = Parameters<Transport>[1]

let dir: string
let db: SuiteDatabase
let usage: UsageLog

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elynt-'))
  db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
  usage = createUsageLog(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function reply(text: string, overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...overrides
  } as Message
}

/** A transport that records what was sent and answers with `answer`. */
function transportReturning(answer: Message | Error) {
  const sent: { apiKey: string; params: Params }[] = []
  const transport: Transport = async (apiKey, params) => {
    sent.push({ apiKey, params })
    if (answer instanceof Error) throw answer
    return answer
  }
  return { sent, transport }
}

function clientWith(answer: Message | Error, key: string | null = 'sk-ant-test') {
  const { sent, transport } = transportReturning(answer)
  const keys = createApiKeys(createMemoryVault(key ? { anthropic: key } : {}))
  const client = createClaudeClient({ keys, usage, transport, now: () => new Date('2026-11-13T12:00:00Z') })
  return { client, sent }
}

describe('Claude client', () => {
  it('sends the prompt with the saved key and the tier model, and returns the text', async () => {
    const { client, sent } = clientWith(reply('Three moods for SUPERFLY'))

    const text = await client.text({
      tool: 'visualizer',
      tier: 'strongest',
      prompt: 'Suggest moods',
      system: 'Be brief'
    })

    expect(text).toBe('Three moods for SUPERFLY')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.apiKey).toBe('sk-ant-test')
    expect(sent[0]!.params).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'Be brief',
      messages: [{ role: 'user', content: 'Suggest moods' }],
      output_config: { effort: 'high' }
    })
  })

  it('uses the cheaper model for the fast tier', async () => {
    const { client, sent } = clientWith(reply('ok', { model: 'claude-sonnet-5-5' }))

    await client.text({ tool: 'release', tier: 'fast', prompt: 'Make it shorter' })

    expect(sent[0]!.params.model).toBe('claude-sonnet-5-5')
    expect(sent[0]!.params.output_config).toEqual({ effort: 'low' })
  })

  it('logs every call with its tool, track, release, tier, tokens and cost', async () => {
    const track = createTrackLibrary(db).addFromMixdown('D:\\Bounces\\flip.wav')
    const { client } = clientWith(
      reply('ok', {
        usage: {
          input_tokens: 2_000,
          output_tokens: 1_000,
          cache_read_input_tokens: 10_000,
          cache_creation_input_tokens: 0
        } as Message['usage']
      })
    )

    await client.text({ tool: 'release', tier: 'strongest', prompt: 'Plan', trackId: track.id, releaseId: 7 })

    expect(usage.list()).toEqual([
      {
        calledAt: '2026-11-13T12:00:00.000Z',
        tool: 'release',
        trackId: track.id,
        releaseId: 7,
        tier: 'strongest',
        model: 'claude-opus-5-5',
        inputTokens: 2_000,
        outputTokens: 1_000,
        cacheReadTokens: 10_000,
        cacheWriteTokens: 0,
        // 2,000 x $4 + 1,000 x $20 + 10,000 x $0.20, per million tokens
        costUsd: expect.closeTo(0.03, 10)
      }
    ])
    expect(usage.totalCostUsd({ releaseId: 7 })).toBeCloseTo(0.03, 10)
    expect(usage.totalCostUsd({ releaseId: 8 })).toBe(0)
  })

  it('prices a call by the model that answered when a refusal fell back to another model', async () => {
    const { client } = clientWith(reply('ok', { model: 'claude-opus-4-8' }))

    await client.text({ tool: 'mix-master', tier: 'strongest', prompt: 'Stepping stones' })

    const [entry] = usage.list()
    expect(entry!.model).toBe('claude-opus-4-8')
    expect(entry!.costUsd).toBeCloseTo((1_000 * 5 + 500 * 25) / 1_000_000, 10)
  })

  it('returns structured output parsed from the JSON reply, and sends the schema', async () => {
    const schema = {
      type: 'object',
      properties: { visions: { type: 'array', items: { type: 'string' } } },
      required: ['visions'],
      additionalProperties: false
    }
    const { client, sent } = clientWith(reply('{"visions":["chrome","glitch","bleed"]}'))

    const result = await client.json<{ visions: string[] }>({
      tool: 'visualizer',
      tier: 'strongest',
      prompt: 'Three visions',
      schema
    })

    expect(result.visions).toEqual(['chrome', 'glitch', 'bleed'])
    expect(sent[0]!.params.output_config).toEqual({ effort: 'high', format: { type: 'json_schema', schema } })
  })

  it('fails clearly when structured output was cut off', async () => {
    const { client } = clientWith(reply('{"visions":["chr', { stop_reason: 'max_tokens' }))

    await expect(client.json({ tool: 'visualizer', tier: 'fast', prompt: 'x', schema: {} })).rejects.toMatchObject({
      code: 'bad-output',
      message: MESSAGES.badOutput
    })
  })

  it('fails with a message the UI can show when there is no key, without calling the API', async () => {
    const { client, sent } = clientWith(reply('never'), null)

    await expect(client.text({ tool: 'release', tier: 'fast', prompt: 'x' })).rejects.toMatchObject({
      code: 'no-key',
      message: 'Add your Anthropic API key in Settings to use this.'
    })
    expect(sent).toHaveLength(0)
    expect(usage.list()).toEqual([])
  })

  it('fails with a clear message when there is no internet', async () => {
    const { client } = clientWith(new Anthropic.APIConnectionError({ message: 'getaddrinfo ENOTFOUND' }))

    const error = await client.text({ tool: 'release', tier: 'fast', prompt: 'x' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ClaudeError)
    expect(error).toMatchObject({ code: 'offline', message: MESSAGES.offline })
    expect(usage.list()).toEqual([])
  })

  it('tells the owner to check the key when the API rejects it', async () => {
    const { client } = clientWith(new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()))

    await expect(client.text({ tool: 'suite', tier: 'fast', prompt: 'x' })).rejects.toMatchObject({ code: 'bad-key' })
  })

  it('maps rate limits and other API errors to their own messages', async () => {
    const limited = clientWith(new Anthropic.RateLimitError(429, undefined, 'slow down', new Headers())).client
    const broken = clientWith(new Anthropic.InternalServerError(500, undefined, 'oops', new Headers())).client

    await expect(limited.text({ tool: 'suite', tier: 'fast', prompt: 'x' })).rejects.toMatchObject({
      code: 'rate-limited'
    })
    await expect(broken.text({ tool: 'suite', tier: 'fast', prompt: 'x' })).rejects.toMatchObject({ code: 'api' })
  })

  it('still logs a refused call, because it is billed', async () => {
    const { client } = clientWith(reply('', { stop_reason: 'refusal', content: [] }))

    await expect(client.text({ tool: 'release', tier: 'fast', prompt: 'x' })).rejects.toMatchObject({ code: 'refused' })
    expect(usage.list()).toHaveLength(1)
  })
})
