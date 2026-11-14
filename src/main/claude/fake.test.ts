import { describe, expect, it } from 'vitest'
import { createFakeClaudeClient } from './fake'
import { ClaudeError } from './types'

describe('fake Claude client', () => {
  it('answers text and JSON calls in order and records them', async () => {
    const claude = createFakeClaudeClient('first caption', { visions: ['a'] })

    expect(await claude.text({ tool: 'release', tier: 'fast', prompt: 'caption' })).toBe('first caption')
    expect(await claude.json({ tool: 'visualizer', tier: 'strongest', prompt: 'visions', schema: {} })).toEqual({
      visions: ['a']
    })
    expect(claude.calls.map((c) => c.prompt)).toEqual(['caption', 'visions'])
  })

  it('repeats the last reply, can compute replies, and can fail like the real client', async () => {
    const echo = createFakeClaudeClient((request) => `echo: ${String(request.prompt)}`)
    expect(await echo.text({ tool: 'suite', tier: 'fast', prompt: 'one' })).toBe('echo: one')
    expect(await echo.text({ tool: 'suite', tier: 'fast', prompt: 'two' })).toBe('echo: two')

    const offline = createFakeClaudeClient(new ClaudeError('offline', 'No internet'))
    await expect(offline.text({ tool: 'suite', tier: 'fast', prompt: 'x' })).rejects.toMatchObject({ code: 'offline' })
  })
})
