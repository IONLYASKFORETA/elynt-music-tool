import { KEY_NAMES, type KeyName, type KeyStatus } from '../../shared/keys'
import type { KeyVault } from './key-vault'

/** What the Settings screen does with keys: save, remove, and see which are set. */
export interface ApiKeys {
  status(): Promise<KeyStatus>
  save(name: KeyName, value: string): Promise<void>
  remove(name: KeyName): Promise<void>
  get(name: KeyName): Promise<string | null>
}

export function createApiKeys(vault: KeyVault): ApiKeys {
  return {
    async status() {
      const entries = await Promise.all(
        KEY_NAMES.map(async (name) => [name, (await vault.get(name)) !== null] as const)
      )
      return Object.fromEntries(entries) as KeyStatus
    },
    async save(name, value) {
      // Keys are often pasted with stray spaces or line breaks.
      const key = value.trim()
      if (key === '') throw new Error('Paste a key before saving.')
      if (/\s/.test(key)) throw new Error('That key has spaces in it. Copy it again from the provider.')
      await vault.set(name, key)
    },
    remove: (name) => vault.remove(name),
    get: (name) => vault.get(name)
  }
}
