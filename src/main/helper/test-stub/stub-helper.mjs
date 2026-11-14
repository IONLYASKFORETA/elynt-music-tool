// A stand-in for the Python helper in tests. Speaks the same stdio protocol.
// STUB_MODE picks the behaviour: normal | never-ready | old-protocol | exit-127 | silent.
import { createInterface } from 'node:readline'

const mode = process.env.STUB_MODE ?? 'normal'
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n')

if (mode === 'exit-127') {
  process.stderr.write('bash: /home/aden/.elynt/helper-venv/bin/python: No such file or directory\n')
  process.exit(127)
}
if (mode !== 'never-ready') {
  process.stdout.write('some library printed this on import\n')
  send({ event: 'ready', protocol: mode === 'old-protocol' ? 0 : 1, version: 'stub' })
}

const methods = {
  'helper.info': () => ({
    version: 'stub',
    protocol: 1,
    python: '3.12.9',
    platform: 'linux',
    wsl: true,
    gpu: { available: true, via: 'torch', name: 'NVIDIA GeForce RTX 5080' }
  }),
  'audio.probe': ({ path }) => {
    if (path.endsWith('/crash.wav')) process.exit(3)
    if (!path.endsWith('.wav')) throw { code: 'unreadable_audio', message: `can't read ${path}` }
    return { durationSeconds: 180.5, sampleRate: 48000, channels: 2, frames: 8664000, format: 'WAV', seenPath: path }
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line)
  if (mode === 'silent') return
  const handler = methods[method]
  if (!handler) return send({ id, error: { code: 'unknown_method', message: method } })
  try {
    send({ id, result: handler(params) })
  } catch (error) {
    send({ id, error })
  }
})
