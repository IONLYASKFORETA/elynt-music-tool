import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { HELPER_PROTOCOL_VERSION, type HelperMethod, type HelperMethods, type HelperStatus } from '../../shared/helper'
import { createHelperClient, HelperCallError, type HelperClient } from './client'
import type { HelperCommand } from './command'

export interface HelperSupervisor {
  /** Spawns the helper. Safe to call once; later starts happen by themselves after a crash. */
  start(): void
  /** Stops the helper for good (app quit). */
  stop(): void
  status(): HelperStatus
  onStatus(listener: (status: HelperStatus) => void): () => void
  /** Calls the helper, waiting for it to finish starting if it is mid-start. */
  call<M extends HelperMethod>(method: M, params: HelperMethods[M]['params'], options?: { timeoutMs?: number }): Promise<HelperMethods[M]['result']>
  /** Maps an app path to the helper's view of it (Windows path to WSL path under WSL2). */
  toHelperPath(path: string): string
}

export interface SupervisorOptions {
  command: HelperCommand
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  /** Waits before each restart, by attempt. The last value repeats. */
  backoffMs?: number[]
  /** A helper that stays up this long resets the backoff. */
  stableAfterMs?: number
  /** How long to wait for the ready line before giving up on a start. */
  readyTimeoutMs?: number
  log?: (line: string) => void
}

const STDERR_KEEP = 20

export function createHelperSupervisor(options: SupervisorOptions): HelperSupervisor {
  const { command } = options
  const spawn = options.spawn ?? nodeSpawn
  const backoff = options.backoffMs ?? [500, 1000, 2000, 5000, 10_000, 30_000]
  const stableAfterMs = options.stableAfterMs ?? 60_000
  const readyTimeoutMs = options.readyTimeoutMs ?? 60_000
  const log = options.log ?? ((line) => console.log(`[helper] ${line}`))

  let status: HelperStatus = { state: 'stopped', mode: command.mode, restarts: 0 }
  const listeners = new Set<(s: HelperStatus) => void>()
  let child: ChildProcess | null = null
  let client: HelperClient | null = null
  let attempt = 0
  let restartTimer: NodeJS.Timeout | null = null
  let stableTimer: NodeJS.Timeout | null = null
  let stopping = false

  const set = (patch: Partial<HelperStatus>) => {
    status = { ...status, ...patch }
    for (const listener of listeners) listener(status)
  }

  const launch = () => {
    restartTimer = null
    const stderr: string[] = []
    let gaveUp = false
    set({ state: 'starting', info: undefined })

    const proc = spawn(command.command, command.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const thisClient = createHelperClient({ stdin: proc.stdin!, stdout: proc.stdout! })
    child = proc
    client = thisClient

    proc.stdin!.on('error', () => {}) // EPIPE after a crash; the exit handler reports it.
    proc.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue
        log(line)
        stderr.push(line)
        if (stderr.length > STDERR_KEEP) stderr.shift()
      }
    })

    const readyTimer = setTimeout(() => {
      gaveUp = true
      thisClient.close('the helper did not say it was ready in time')
      proc.kill()
    }, readyTimeoutMs)

    thisClient.ready.then(
      async (ready) => {
        clearTimeout(readyTimer)
        if (ready.protocol !== HELPER_PROTOCOL_VERSION) {
          gaveUp = true
          set({ state: 'not-installed', lastError: `The helper speaks protocol ${ready.protocol}, the app needs ${HELPER_PROTOCOL_VERSION}. Re-run the helper setup.` })
          proc.kill()
          return
        }
        set({ state: 'running' })
        stableTimer = setTimeout(() => (attempt = 0), stableAfterMs)
        try {
          const info = await thisClient.call('helper.info', {}, { timeoutMs: 30_000 })
          if (client === thisClient) set({ info })
        } catch (e) {
          log(`helper.info failed: ${String(e)}`)
        }
      },
      () => clearTimeout(readyTimer)
    )

    let notFound = false
    proc.on('error', (error: NodeJS.ErrnoException) => {
      // Spawn failures (ENOENT) arrive here, and 'exit' may never follow.
      notFound = error.code === 'ENOENT'
      onGone(`could not start ${command.command}: ${error.message}`, null)
    })
    proc.on('exit', (code, signal) => onGone(`exited with ${signal ?? `code ${code}`}`, code))

    let gone = false
    function onGone(reason: string, code: number | null) {
      if (gone) return
      gone = true
      clearTimeout(readyTimer)
      if (stableTimer) clearTimeout(stableTimer)
      thisClient.close(`The helper ${reason}`)
      if (child === proc) {
        child = null
        client = null
      }
      if (stopping) return set({ state: 'stopped' })

      const detail = stderr.at(-1)
      const lastError = `The helper ${reason}${detail ? `: ${detail}` : ''}`
      // ENOENT: no python / wsl.exe. 127: the shell in WSL found no venv python.
      if (notFound || code === 127) {
        return set({ state: 'not-installed', lastError })
      }
      if (gaveUp && status.state === 'not-installed') return

      const wait = backoff[Math.min(attempt, backoff.length - 1)]!
      attempt++
      log(`${lastError}; restarting in ${wait} ms`)
      set({ state: 'restarting', lastError, restarts: status.restarts + 1 })
      restartTimer = setTimeout(launch, wait)
    }
  }

  return {
    start() {
      if (child || restartTimer) return
      stopping = false
      launch()
    },
    stop() {
      stopping = true
      if (restartTimer) clearTimeout(restartTimer)
      if (stableTimer) clearTimeout(stableTimer)
      restartTimer = null
      if (child) child.kill()
      else set({ state: 'stopped' })
    },
    status: () => status,
    onStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async call(method, params, callOptions) {
      if (!client || (status.state !== 'running' && status.state !== 'starting')) {
        throw new HelperCallError('not_running', status.lastError ?? `The helper is ${status.state}`)
      }
      const current = client
      await current.ready
      return current.call(method, params, callOptions)
    },
    toHelperPath: (path) => command.toHelperPath(path)
  }
}
