import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HelperStatus } from '../../shared/helper'
import { resolveHelperCommand, windowsToWslPath, type HelperCommand } from './command'
import { createHelperClient, HelperCallError } from './client'
import { createHelperSupervisor, type HelperSupervisor } from './supervisor'

const STUB = join(import.meta.dirname, 'test-stub', 'stub-helper.mjs')

// Pretends to be the WSL setup, so paths get translated the same way.
function stubCommand(): HelperCommand {
  return { mode: 'wsl', command: process.execPath, args: [STUB], toHelperPath: windowsToWslPath }
}

const running: HelperSupervisor[] = []
afterEach(() => {
  for (const s of running.splice(0)) s.stop()
})

function supervise(mode = 'normal', extra: Partial<Parameters<typeof createHelperSupervisor>[0]> = {}) {
  const supervisor = createHelperSupervisor({
    command: stubCommand(),
    // The stub reads its behaviour from STUB_MODE.
    spawn: (command, args, options) => spawn(command, args, { ...options, env: { ...process.env, STUB_MODE: mode } }),
    backoffMs: [20],
    log: () => {},
    ...extra
  })
  running.push(supervisor)
  return supervisor
}

function waitFor(supervisor: HelperSupervisor, test: (s: HelperStatus) => boolean, timeoutMs = 5000): Promise<HelperStatus> {
  return new Promise((resolve, reject) => {
    if (test(supervisor.status())) return resolve(supervisor.status())
    const timer = setTimeout(() => reject(new Error(`timed out; last status ${JSON.stringify(supervisor.status())}`)), timeoutMs)
    const off = supervisor.onStatus((s) => {
      if (!test(s)) return
      clearTimeout(timer)
      off()
      resolve(s)
    })
  })
}

describe('helper supervisor', () => {
  it('starts the helper, reports it running, and fills in its info', async () => {
    const helper = supervise()
    helper.start()
    expect(helper.status().state).toBe('starting')
    const status = await waitFor(helper, (s) => s.info !== undefined)
    expect(status.state).toBe('running')
    expect(status.info?.gpu.name).toBe('NVIDIA GeForce RTX 5080')
  })

  it('round-trips a typed call with the path translated for WSL', async () => {
    const helper = supervise()
    helper.start()
    const probe = await helper.call('audio.probe', { path: helper.toHelperPath('D:\\Music Projects\\SUPERFLY.wav') })
    expect(probe).toMatchObject({ durationSeconds: 180.5, sampleRate: 48000, channels: 2 })
    expect((probe as unknown as { seenPath: string }).seenPath).toBe('/mnt/d/Music Projects/SUPERFLY.wav')
  })

  it('passes the helper error code through', async () => {
    const helper = supervise()
    helper.start()
    await expect(helper.call('audio.probe', { path: '/x/cover.png' })).rejects.toMatchObject({ code: 'unreadable_audio' })
  })

  it('restarts the helper when it dies, failing only the call in flight', async () => {
    const helper = supervise()
    helper.start()
    await waitFor(helper, (s) => s.state === 'running')
    await expect(helper.call('audio.probe', { path: '/x/crash.wav' })).rejects.toMatchObject({ code: 'helper_exited' })
    const back = await waitFor(helper, (s) => s.state === 'running' && s.restarts === 1)
    expect(back.lastError).toMatch(/code 3/)
    await expect(helper.call('audio.probe', { path: '/x/ok.wav' })).resolves.toMatchObject({ sampleRate: 48000 })
  })

  it('reports not-installed when the venv python is missing inside WSL', async () => {
    const helper = supervise('exit-127')
    helper.start()
    const status = await waitFor(helper, (s) => s.state === 'not-installed')
    expect(status.lastError).toMatch(/No such file/)
    expect(status.restarts).toBe(0)
  })

  it('reports not-installed when the command does not exist', async () => {
    const helper = createHelperSupervisor({
      command: { ...stubCommand(), command: join(import.meta.dirname, 'no-such-python') },
      log: () => {}
    })
    running.push(helper)
    helper.start()
    await waitFor(helper, (s) => s.state === 'not-installed')
    await expect(helper.call('helper.info', {})).rejects.toMatchObject({ code: 'not_running' })
  })

  it('refuses a helper on an older protocol', async () => {
    const helper = supervise('old-protocol')
    helper.start()
    const status = await waitFor(helper, (s) => s.state === 'not-installed')
    expect(status.lastError).toMatch(/protocol 0/)
  })

  it('restarts a helper that never says ready', async () => {
    const helper = supervise('never-ready', { readyTimeoutMs: 100 })
    helper.start()
    await waitFor(helper, (s) => s.restarts >= 1)
  })

  it('stops for good on stop()', async () => {
    const helper = supervise()
    helper.start()
    await waitFor(helper, (s) => s.state === 'running')
    helper.stop()
    await waitFor(helper, (s) => s.state === 'stopped')
  })
})

describe('helper client', () => {
  it('times out a call the helper never answers', async () => {
    const proc = spawn(process.execPath, [STUB], { env: { ...process.env, STUB_MODE: 'silent' } })
    try {
      const client = createHelperClient({ stdin: proc.stdin, stdout: proc.stdout })
      await client.ready
      const error = await client.call('helper.info', {}, { timeoutMs: 50 }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(HelperCallError)
      expect((error as HelperCallError).code).toBe('timeout')
    } finally {
      proc.kill()
    }
  })
})

describe('resolveHelperCommand', () => {
  it('uses WSL2 by default on Windows', () => {
    const cmd = resolveHelperCommand({ platform: 'win32', appRoot: 'C:\\elynt', env: {} })
    expect(cmd.mode).toBe('wsl')
    expect(cmd.command).toBe('wsl.exe')
    expect(cmd.args.at(-1)).toContain('-m elynt_helper')
  })

  it('can pick a WSL distro', () => {
    const cmd = resolveHelperCommand({ platform: 'win32', appRoot: 'C:\\elynt', env: { ELYNT_HELPER_WSL_DISTRO: 'Ubuntu-24.04' } })
    expect(cmd.args.slice(0, 2)).toEqual(['-d', 'Ubuntu-24.04'])
  })

  it('runs natively from helper/.venv on Windows when asked, and elsewhere by default', () => {
    const win = resolveHelperCommand({ platform: 'win32', appRoot: 'C:\\elynt', env: { ELYNT_HELPER_MODE: 'native' } })
    expect(win.command).toMatch(/helper.\.venv.Scripts.python\.exe$/)
    expect(win.toHelperPath('D:\\a.wav')).toBe('D:\\a.wav')
    const linux = resolveHelperCommand({ platform: 'linux', appRoot: '/repo', env: {} })
    expect(linux).toMatchObject({ mode: 'native', command: '/repo/helper/.venv/bin/python', args: ['-m', 'elynt_helper'] })
  })

  it('honours ELYNT_HELPER_PYTHON', () => {
    const cmd = resolveHelperCommand({ platform: 'linux', appRoot: '/repo', env: { ELYNT_HELPER_PYTHON: '/opt/py/bin/python' } })
    expect(cmd.command).toBe('/opt/py/bin/python')
  })
})

describe('windowsToWslPath', () => {
  it('maps drive paths to /mnt', () => {
    expect(windowsToWslPath('D:\\Music Projects\\flip\\flip.wav')).toBe('/mnt/d/Music Projects/flip/flip.wav')
    expect(windowsToWslPath('c:/Users/aden/a.wav')).toBe('/mnt/c/Users/aden/a.wav')
    expect(windowsToWslPath('/mnt/d/a.wav')).toBe('/mnt/d/a.wav')
  })

  it('refuses network paths', () => {
    expect(() => windowsToWslPath('\\\\nas\\music\\a.wav')).toThrow(/drive letter/)
  })
})
