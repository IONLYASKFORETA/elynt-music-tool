import type { Tier } from './types'

/**
 * Which model each tier uses. Fast is for quick writing (captions, tweaks);
 * strongest is for coaching, proposals, retrospectives and visions.
 */
export const TIER_MODELS: Record<Tier, string> = {
  fast: 'claude-sonnet-5-5',
  strongest: 'claude-opus-5-5'
}

/** US dollars per million tokens. Anthropic list prices, checked 2026-11-13. */
interface Price {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const price = (input: number, output: number, cacheRead: number): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25 // 5-minute cache writes cost 1.25x input
})

/** Includes the older models a refused request can fall back to. */
const PRICES: Record<string, Price> = {
  'claude-opus-5-5': price(4, 20, 0.2),
  'claude-sonnet-5-5': price(2, 10, 0.1),
  'claude-opus-5': price(5, 25, 0.5),
  'claude-opus-4-8': price(5, 25, 0.5),
  'claude-sonnet-5': price(2, 10, 0.2)
}

export interface TokenCounts {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Cost of one call. A model missing from the table is priced as the strongest tier, so cost is never under-reported. */
export function costUsd(model: string, tokens: TokenCounts): number {
  const p = PRICES[model] ?? PRICES[TIER_MODELS.strongest]!
  const dollars =
    tokens.inputTokens * p.input +
    tokens.outputTokens * p.output +
    tokens.cacheReadTokens * p.cacheRead +
    tokens.cacheWriteTokens * p.cacheWrite
  return dollars / 1_000_000
}
