import { join } from 'node:path'

/** How to start the helper, and how to hand it file paths. */
export interface HelperCommand {
  mode: 'wsl' | 'native'
  command: string
  args: string[]
  /** Turns a path the app knows into one the helper can open. */
  toHelperPath(path: string): string
}

export interface ResolveOptions {
  platform: NodeJS.Platform
  /** The repo root in dev (app.getAppPath()); the helper lives in `<root>/helper`. */
  appRoot: string
  env: Record<string, string | undefined>
}

/** The venv that helper/setup-wsl.sh creates, inside WSL's own disk. */
const WSL_VENV_PYTHON = '$HOME/.elynt/helper-venv/bin/python'

/**
 * Picks how to launch the helper.
 *
 * - On Windows the default is WSL2, because Essentia and NATTEN publish no Windows
 *   wheels (ADR 0003). `ELYNT_HELPER_MODE=native` uses `helper\.venv` instead.
 * - Elsewhere (dev on Linux or macOS) it runs natively from `helper/.venv`.
 * - `ELYNT_HELPER_PYTHON` points at any Python with the helper installed (native only).
 */
export function resolveHelperCommand({ platform, appRoot, env }: ResolveOptions): HelperCommand {
  const wanted = env['ELYNT_HELPER_MODE']
  const mode = wanted === 'native' || wanted === 'wsl' ? wanted : platform === 'win32' ? 'wsl' : 'native'

  if (mode === 'wsl') {
    const python = env['ELYNT_HELPER_WSL_PYTHON'] ?? WSL_VENV_PYTHON
    const distro = env['ELYNT_HELPER_WSL_DISTRO']
    return {
      mode,
      command: 'wsl.exe',
      // A login shell so $HOME expands; exec so killing wsl.exe ends Python too.
      args: [...(distro ? ['-d', distro] : []), '-e', 'bash', '-lc', `exec "${python}" -m elynt_helper`],
      toHelperPath: windowsToWslPath
    }
  }

  const venvPython =
    platform === 'win32' ? join(appRoot, 'helper', '.venv', 'Scripts', 'python.exe') : join(appRoot, 'helper', '.venv', 'bin', 'python')
  return {
    mode,
    command: env['ELYNT_HELPER_PYTHON'] ?? venvPython,
    args: ['-m', 'elynt_helper'],
    toHelperPath: (path) => path
  }
}

/** `D:\Music Projects\a.wav` becomes `/mnt/d/Music Projects/a.wav`. */
export function windowsToWslPath(path: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(path)
  if (!match) {
    if (path.startsWith('/')) return path
    throw new Error(`The helper runs in WSL2 and can only open files on a drive letter, not ${path}`)
  }
  const [, drive, rest] = match
  return `/mnt/${drive!.toLowerCase()}/${rest!.replaceAll('\\', '/')}`
}
