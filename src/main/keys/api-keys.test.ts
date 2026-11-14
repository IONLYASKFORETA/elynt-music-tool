import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClaudeClient, type Transport } from '../claude/client'
import { createUsageLog } from '../claude/usage'
import { openSuiteDatabase } from '../db/database'
import { createApiKeys } from './api-keys'
import { createMemoryVault } from './key-vault'

describe('API keys', () => {
  it('reports which keys are saved, trimming pasted whitespace', async () => {
    const vault = createMemoryVault()
    const keys = createApiKeys(vault)
    expect(await keys.status()).toEqual({ anthropic: false, gemini: false })

    await keys.save('anthropic', '  sk-ant-abc123\n')

    expect(await keys.status()).toEqual({ anthropic: true, gemini: false })
    expect(await vault.get('anthropic')).toBe('sk-ant-abc123')
  })

  it('removes a key', async () => {
    const keys = createApiKeys(createMemoryVault({ gemini: 'AIza-xyz' }))
    await keys.remove('gemini')
    expect(await keys.status()).toEqual({ anthropic: false, gemini: false })
  })

  it('refuses an empty key or one with spaces inside', async () => {
    const keys = createApiKeys(createMemoryVault())
    await expect(keys.save('anthropic', '   ')).rejects.toThrow('Paste a key')
    await expect(keys.save('anthropic', 'sk-ant one')).rejects.toThrow('spaces')
  })

  it('never writes a key into the database files, even after a logged call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elynt-'))
    try {
      const db = openSuiteDatabase(join(dir, 'elynt.sqlite'))
      const keys = createApiKeys(createMemoryVault())
      await keys.save('anthropic', 'sk-ant-SECRET-canary')
      const transport: Transport = async (_key, params) =>
        ({
          id: 'msg',
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: [],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 }
        }) as unknown as Awaited<ReturnType<Transport>>
      await createClaudeClient({ keys, usage: createUsageLog(db), transport }).text({
        tool: 'suite',
        tier: 'fast',
        prompt: 'hi'
      })
      db.close()

      for (const file of readdirSync(dir)) {
        expect(readFileSync(join(dir, file)).includes('sk-ant-SECRET-canary')).toBe(false)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
