import { ClaudeError, type ClaudeClient, type ClaudeJsonRequest, type ClaudeRequest } from './types'

/** What the fake answers: a fixed reply (string for text, any value for json) or an error to throw. */
export type FakeReply = string | object | ClaudeError | ((request: ClaudeRequest | ClaudeJsonRequest) => unknown)

export interface FakeClaudeClient extends ClaudeClient {
  /** Every request made, in order. */
  readonly calls: (ClaudeRequest | ClaudeJsonRequest)[]
}

/**
 * A Claude client for tests. Replies are used in order; the last one repeats.
 * It never touches the network or the usage log.
 */
export function createFakeClaudeClient(...replies: FakeReply[]): FakeClaudeClient {
  const calls: (ClaudeRequest | ClaudeJsonRequest)[] = []
  const next = (request: ClaudeRequest | ClaudeJsonRequest): unknown => {
    calls.push(request)
    const reply = replies.length > 1 ? replies.shift() : replies[0]
    if (reply === undefined) throw new Error('The fake Claude client has no reply set')
    if (reply instanceof ClaudeError) throw reply
    return typeof reply === 'function' ? reply(request) : reply
  }
  return {
    calls,
    async text(request) {
      const reply = next(request)
      return typeof reply === 'string' ? reply : JSON.stringify(reply)
    },
    async json<T>(request: ClaudeJsonRequest) {
      const reply = next(request)
      return (typeof reply === 'string' ? JSON.parse(reply) : reply) as T
    }
  }
}
