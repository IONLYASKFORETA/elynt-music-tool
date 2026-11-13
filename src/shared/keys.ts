/** The API keys the owner can enter in Settings. */
export const KEY_NAMES = ['anthropic', 'gemini'] as const
export type KeyName = (typeof KEY_NAMES)[number]

export function isKeyName(value: unknown): value is KeyName {
  return typeof value === 'string' && (KEY_NAMES as readonly string[]).includes(value)
}

/** Which keys are saved. The UI never gets the keys themselves. */
export type KeyStatus = Record<KeyName, boolean>

/** The result of the Settings "Test key" button. */
export type KeyTestResult = { ok: true } | { ok: false; message: string }
