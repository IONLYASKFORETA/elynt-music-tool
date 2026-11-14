import type { KeyName } from '../../shared/keys'

/**
 * Where the owner's API keys live (ADR 0001). The real vault is the Windows
 * Credential Manager, so no key is ever written to the database or a config file.
 */
export interface KeyVault {
  get(name: KeyName): Promise<string | null>
  set(name: KeyName, value: string): Promise<void>
  remove(name: KeyName): Promise<void>
}

/** Credentials show up in Windows Credential Manager under this service name. */
export const VAULT_SERVICE = 'Elynt Music Tool'

/**
 * The OS credential vault: Windows Credential Manager on Windows (and the
 * keychain or Secret Service elsewhere, which only matters for development).
 */
export function createCredentialVault(service = VAULT_SERVICE): KeyVault {
  // Loaded lazily so tests and tools that never touch the vault don't load the native module.
  const entry = async (name: KeyName) => {
    const { AsyncEntry } = await import('@napi-rs/keyring')
    return new AsyncEntry(service, name)
  }
  return {
    get: async (name) => (await entry(name)).getPassword(),
    set: async (name, value) => (await entry(name)).setPassword(value),
    remove: async (name) => {
      await (await entry(name)).deleteCredential()
    }
  }
}

/** An in-memory vault for tests. */
export function createMemoryVault(initial: Partial<Record<KeyName, string>> = {}): KeyVault {
  const keys = new Map(Object.entries(initial) as [KeyName, string][])
  return {
    get: async (name) => keys.get(name) ?? null,
    set: async (name, value) => void keys.set(name, value),
    remove: async (name) => void keys.delete(name)
  }
}
