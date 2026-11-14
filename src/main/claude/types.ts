import type Anthropic from '@anthropic-ai/sdk'

export type Tier = 'fast' | 'strongest'

/** Which part of the suite made the call. `suite` is for shared screens such as Settings. */
export type ToolId = 'visualizer' | 'mix-master' | 'release' | 'suite'

export interface ClaudeRequest {
  tool: ToolId
  tier: Tier
  /** Either a single user message or a whole conversation. */
  prompt: string | Anthropic.MessageParam[]
  system?: string
  maxTokens?: number
  trackId?: number
  releaseId?: number
}

/** A JSON schema for structured output: an object with `additionalProperties: false` and `required`. */
export type JsonSchema = Record<string, unknown>

export interface ClaudeJsonRequest extends ClaudeRequest {
  schema: JsonSchema
}

/**
 * The one way the suite talks to Claude. Every call is logged to `api_usage`.
 * Failures throw a ClaudeError whose message can be shown in the UI as is.
 */
export interface ClaudeClient {
  text(request: ClaudeRequest): Promise<string>
  /** Returns the reply parsed as JSON, constrained by the API to match `schema`. */
  json<T>(request: ClaudeJsonRequest): Promise<T>
}

export type ClaudeErrorCode = 'no-key' | 'offline' | 'bad-key' | 'rate-limited' | 'refused' | 'bad-output' | 'api'

export class ClaudeError extends Error {
  readonly code: ClaudeErrorCode
  constructor(code: ClaudeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ClaudeError'
    this.code = code
  }
}
