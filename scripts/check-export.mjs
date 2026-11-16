// The export frame check without an NVIDIA card: builds the app, then runs the
// export benchmark on a generated one-second clip with software WebGPU and
// x264. It fails if the export and the preview differ by a single pixel, or
// if the file's frames, sync or colours are off. CI runs it under xvfb.
//
//   npm run check:export
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const dir = mkdtempSync(join(tmpdir(), 'elynt-check-export-'))

// Two seconds of a kick-like thump every half second over a quiet chord, so the spectrum moves.
const rate = 48_000
const seconds = 2
const samples = rate * seconds
const data = Buffer.alloc(samples * 4)
for (let i = 0; i < samples; i++) {
  const t = i / rate
  const beat = t % 0.5
  const kick = Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-beat * 30)) * beat) * Math.exp(-beat * 8)
  const chord = [220, 277.2, 329.6, 1760].reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) * 0.08
  const v = Math.round(Math.max(-1, Math.min(1, kick * 0.7 + chord)) * 30000)
  data.writeInt16LE(v, i * 4)
  data.writeInt16LE(v, i * 4 + 2)
}
const head = Buffer.alloc(44)
head.write('RIFF', 0)
head.writeUInt32LE(36 + data.length, 4)
head.write('WAVEfmt ', 8)
head.writeUInt32LE(16, 16)
head.writeUInt16LE(1, 20)
head.writeUInt16LE(2, 22)
head.writeUInt32LE(rate, 24)
head.writeUInt32LE(rate * 4, 28)
head.writeUInt16LE(4, 32)
head.writeUInt16LE(16, 34)
head.write('data', 36)
head.writeUInt32LE(data.length, 40)
const wav = join(dir, 'check.wav')
writeFileSync(wav, Buffer.concat([head, data]))

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
if (run('npx', ['electron-vite', 'build']).status !== 0) process.exit(1)

const report = join(dir, 'report.md')
const result = run(electron, [
  '.',
  '--no-sandbox',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  `--bench-export=${wav}`,
  `--bench-out=${report}`,
  '--bench-encoder=x264',
  '--bench-formats=youtube-1080p60',
  '--bench-seconds=1'
])
process.exit(result.status ?? 1)
