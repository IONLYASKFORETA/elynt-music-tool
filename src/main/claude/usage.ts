import type { SuiteDatabase } from '../db/database'
import type { TokenCounts } from './pricing'
import type { Tier, ToolId } from './types'

export interface UsageEntry extends TokenCounts {
  calledAt: string
  tool: ToolId
  trackId: number | null
  releaseId: number | null
  tier: Tier
  model: string
  costUsd: number
}

export interface UsageFilter {
  tool?: ToolId
  trackId?: number
  releaseId?: number
}

/** The `api_usage` table: one row per Claude call. */
export interface UsageLog {
  record(entry: UsageEntry): void
  list(filter?: UsageFilter): UsageEntry[]
  totalCostUsd(filter?: UsageFilter): number
}

interface Row {
  called_at: string
  tool: ToolId
  track_id: number | null
  release_id: number | null
  tier: Tier
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number
}

export function createUsageLog(db: SuiteDatabase): UsageLog {
  const insert = db.prepare(`
    INSERT INTO api_usage (called_at, tool, track_id, release_id, tier, model,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const where = (filter: UsageFilter) => {
    const columns = { tool: filter.tool, track_id: filter.trackId, release_id: filter.releaseId }
    const set = Object.entries(columns).filter(([, value]) => value !== undefined) as [string, string | number][]
    return {
      sql: set.length ? `WHERE ${set.map(([column]) => `${column} = ?`).join(' AND ')}` : '',
      params: set.map(([, value]) => value)
    }
  }

  return {
    record(e) {
      insert.run(
        e.calledAt,
        e.tool,
        e.trackId,
        e.releaseId,
        e.tier,
        e.model,
        e.inputTokens,
        e.outputTokens,
        e.cacheReadTokens,
        e.cacheWriteTokens,
        e.costUsd
      )
    },
    list(filter = {}) {
      const w = where(filter)
      const rows = db.prepare(`SELECT * FROM api_usage ${w.sql} ORDER BY id`).all(...w.params) as unknown as Row[]
      return rows.map((r) => ({
        calledAt: r.called_at,
        tool: r.tool,
        trackId: r.track_id,
        releaseId: r.release_id,
        tier: r.tier,
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
        costUsd: r.cost_usd
      }))
    },
    totalCostUsd(filter = {}) {
      const w = where(filter)
      const row = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM api_usage ${w.sql}`).get(...w.params) as {
        total: number
      }
      return row.total
    }
  }
}
