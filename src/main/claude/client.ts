import Anthropic from '@anthropic-ai/sdk'
import type { ApiKeys } from '../keys/api-keys'
import { costUsd, TIER_MODELS } from './pricing'
import { ClaudeError, type ClaudeClient, type ClaudeRequest, type JsonSchema, type Tier } from './types'
import type { UsageLog } from './usage'

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming
type Message = Anthropic.Beta.Messages.BetaMessage

/** Sends one request to the API. Swappable so the real client can be tested without the network. */
export type Transport = (apiKey: string, params: CreateParams) => Promise<Message>

const EFFORT: Record<Tier, 'low' | 'high'> = { fast: 'low', strongest: 'high' }
const DEFAULT_MAX_TOKENS = 16_000

export const MESSAGES = {
  noKey: 'Add your Anthropic API key in Settings to use this.',
  offline: "Couldn't reach Claude. Check your internet connection and try again.",
  badKey: 'Claude rejected your Anthropic API key. Check it in Settings.',
  rateLimited: 'Claude is busy or your API limit was reached. Wait a minute and try again.',
  refused: 'Claude declined this request. Try rewording it.',
  badOutput: 'Claude sent back something unexpected. Try again.',
  api: 'Claude had a problem answering. Try again in a moment.'
} as const

export function createAnthropicTransport(): Transport {
  let cached: { apiKey: string; sdk: Anthropic } | null = null
  return (apiKey, params) => {
    if (cached?.apiKey !== apiKey) cached = { apiKey, sdk: new Anthropic({ apiKey }) }
    return cached.sdk.beta.messages.create(params)
  }
}

export interface ClaudeClientDeps {
  keys: Pick<ApiKeys, 'get'>
  usage: UsageLog
  transport?: Transport
  now?: () => Date
}

export function createClaudeClient({
  keys,
  usage,
  transport = createAnthropicTransport(),
  now = () => new Date()
}: ClaudeClientDeps): ClaudeClient {
  async function call(request: ClaudeRequest, schema?: JsonSchema): Promise<Message> {
    const apiKey = await keys.get('anthropic')
    if (!apiKey) throw new ClaudeError('no-key', MESSAGES.noKey)

    const params: CreateParams = {
      model: TIER_MODELS[request.tier],
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: typeof request.prompt === 'string' ? [{ role: 'user', content: request.prompt }] : request.prompt,
      ...(request.system !== undefined && { system: request.system }),
      output_config: {
        effort: EFFORT[request.tier],
        ...(schema && { format: { type: 'json_schema', schema } })
      },
      // If a safety check declines a request, the API retries it on a suitable older model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    }

    let message: Message
    try {
      message = await transport(apiKey, params)
    } catch (error) {
      throw toClaudeError(error)
    }

    logUsage(request, message)
    if (message.stop_reason === 'refusal') throw new ClaudeError('refused', MESSAGES.refused)
    return message
  }

  function logUsage(request: ClaudeRequest, message: Message): void {
    const tokens = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0
    }
    usage.record({
      calledAt: now().toISOString(),
      tool: request.tool,
      trackId: request.trackId ?? null,
      releaseId: request.releaseId ?? null,
      tier: request.tier,
      // The model that answered, which differs from the tier's model after a fallback.
      model: message.model,
      ...tokens,
      costUsd: costUsd(message.model, tokens)
    })
  }

  return {
    async text(request) {
      return textOf(await call(request))
    },
    async json<T>(request: ClaudeRequest & { schema: JsonSchema }) {
      const message = await call(request, request.schema)
      if (message.stop_reason === 'max_tokens') throw new ClaudeError('bad-output', MESSAGES.badOutput)
      try {
        return JSON.parse(textOf(message)) as T
      } catch (error) {
        throw new ClaudeError('bad-output', MESSAGES.badOutput, { cause: error })
      }
    }
  }
}

function textOf(message: Message): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
}

function toClaudeError(error: unknown): ClaudeError {
  const wrap = (code: ConstructorParameters<typeof ClaudeError>[0], message: string) =>
    new ClaudeError(code, message, { cause: error })
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
    return wrap('bad-key', MESSAGES.badKey)
  if (error instanceof Anthropic.RateLimitError) return wrap('rate-limited', MESSAGES.rateLimited)
  if (error instanceof Anthropic.APIConnectionError) return wrap('offline', MESSAGES.offline)
  return wrap('api', MESSAGES.api)
}
