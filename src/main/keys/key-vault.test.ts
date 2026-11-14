import { afterAll, describe, expect, it } from 'vitest'
import { createCredentialVault } from './key-vault'

// Runs on the Windows CI runner against the real Windows Credential Manager,
// under a test-only service name so it never touches the app's own keys.
describe.runIf(process.platform === 'win32')('Windows credential vault', () => {
  const vault = createCredentialVault('Elynt Music Tool (test)')

  afterAll(async () => {
    await vault.remove('anthropic')
  })

  it('saves, reads and removes a key', async () => {
    await vault.set('anthropic', 'sk-ant-vault-test')
    expect(await vault.get('anthropic')).toBe('sk-ant-vault-test')

    await vault.remove('anthropic')
    expect(await vault.get('anthropic')).toBeNull()
  })
})
