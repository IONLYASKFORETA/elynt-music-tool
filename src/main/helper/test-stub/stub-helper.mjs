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
  send({ event: 'ready', protocol: mode === 'old-protocol' ? 0 : 3, version: 'stub' })
}

const methods = {
  'helper.info': () => ({
    version: 'stub',
    protocol: 3,
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

// Reports progress every 40 ms for 200 ms, then answers: longer than a 100 ms timeout, but never quiet that long.
async function split(id, { path, outDir }) {
  for (let i = 0; i < 5; i++) {
    send({ id, progress: { stage: 'Splitting', fraction: i / 5 } })
    await new Promise((r) => setTimeout(r, 40))
  }
  send({ id, result: { stems: [{ name: 'drums', path: `${outDir}/drums.wav` }, { name: 'bass', path: `${outDir}/bass.wav` }], model: 'stub.ckpt', seconds: 0.2, seenPath: path } })
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line)
  if (mode === 'silent') return
  if (method === 'stems.split') return void split(id, params)
  const handler = methods[method]
  if (!handler) return send({ id, error: { code: 'unknown_method', message: method } })
  try {
    send({ id, result: handler(params) })
  } catch (error) {
    send({ id, error })
  }
})
