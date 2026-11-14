import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { HelperMethod, HelperMethods, HelperProgress } from '../../shared/helper'

/** A call that the helper answered with an error, or that never got an answer. */
export class HelperCallError extends Error {
  constructor(
    /** The helper's error code (`file_not_found`, `unreadable_audio`, ...), or `timeout` / `helper_exited`. */
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'HelperCallError'
  }
}

export interface CallOptions {
  /**
   * How long to wait with no word from the helper. A progress line restarts the clock,
   * so a split that keeps reporting can run as long as it needs.
   */
  timeoutMs?: number
  onProgress?: (progress: HelperProgress) => void
}

export interface HelperClient {
  /** Resolves with the helper's ready line once it has started. */
  readonly ready: Promise<{ protocol: number; version: string }>
  call<M extends HelperMethod>(method: M, params: HelperMethods[M]['params'], options?: CallOptions): Promise<HelperMethods[M]['result']>
  /** Rejects every call still waiting. The supervisor calls this when the process exits. */
  close(reason: string): void
}

interface Pending {
  resolve(result: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
  /** Restarts the timeout clock. */
  touch(): void
  onProgress?: (progress: HelperProgress) => void
}

const DEFAULT_TIMEOUT_MS = 30_000

/** Speaks the helper's line-delimited JSON protocol (see helper/src/elynt_helper/server.py). */
export function createHelperClient(io: { stdin: Writable; stdout: Readable }): HelperClient {
  let nextId = 1
  let closed: string | null = null
  const pending = new Map<number, Pending>()

  let markReady!: (v: { protocol: number; version: string }) => void
  let failReady!: (e: Error) => void
  const ready = new Promise<{ protocol: number; version: string }>((resolve, reject) => {
    markReady = resolve
    failReady = reject
  })
  // A helper that dies before ready is reported through the supervisor, not as an unhandled rejection.
  ready.catch(() => {})

  createInterface({ input: io.stdout }).on('line', (line) => {
    let message: {
      id?: number
      event?: string
      result?: unknown
      error?: { code: string; message: string }
      progress?: HelperProgress
      protocol?: number
      version?: string
    }
    try {
      message = JSON.parse(line)
    } catch {
      return // Not ours. The helper keeps stdout for protocol lines, but be forgiving.
    }
    if (message.event === 'ready') {
      markReady({ protocol: message.protocol ?? 0, version: message.version ?? 'unknown' })
      return
    }
    if (typeof message.id !== 'number') return
    const call = pending.get(message.id)
    if (!call) return
    if (message.progress) {
      call.touch()
      call.onProgress?.(message.progress)
      return
    }
    pending.delete(message.id)
    clearTimeout(call.timer)
    if (message.error) call.reject(new HelperCallError(message.error.code, message.error.message))
    else call.resolve(message.result)
  })

  return {
    ready,
    call(method, params, options) {
      if (closed) return Promise.reject(new HelperCallError('helper_exited', closed))
      const id = nextId++
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
      return new Promise((resolve, reject) => {
        const expire = () => {
          pending.delete(id)
          reject(new HelperCallError('timeout', `${method} went ${timeoutMs} ms without an answer`))
        }
        const entry: Pending = {
          resolve: resolve as (r: unknown) => void,
          reject,
          timer: setTimeout(expire, timeoutMs),
          touch() {
            clearTimeout(entry.timer)
            entry.timer = setTimeout(expire, timeoutMs)
          },
          onProgress: options?.onProgress
        }
        pending.set(id, entry)
        io.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      })
    },
    close(reason) {
      if (closed) return
      closed = reason
      failReady(new HelperCallError('helper_exited', reason))
      for (const call of pending.values()) {
        clearTimeout(call.timer)
        call.reject(new HelperCallError('helper_exited', reason))
      }
      pending.clear()
    }
  }
}
