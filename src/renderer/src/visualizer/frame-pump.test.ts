import { describe, expect, it } from 'vitest'
import { pumpFrames } from './frame-pump'

const frame = (n: number) => new Uint8Array([n])

describe('pumpFrames', () => {
  it('renders every frame at its exact time and writes them in order', async () => {
    const times: number[] = []
    const written: number[] = []
    await pumpFrames({
      frames: 5,
      fps: 60,
      render: async (t, n) => {
        times.push(t)
        return frame(n)
      },
      write: async (f) => void written.push(f[0]!)
    })
    expect(times).toEqual([0, 1 / 60, 2 / 60, 3 / 60, 4 / 60])
    expect(written).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps writes in order even when later frames finish reading back first', async () => {
    const written: number[] = []
    await pumpFrames({
      frames: 6,
      fps: 30,
      inFlight: 3,
      render: (_t, n) => new Promise((r) => setTimeout(() => r(frame(n)), (6 - n) * 3)),
      write: async (f) => void written.push(f[0]!)
    })
    expect(written).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('draws ahead of the encoder, but never more than inFlight frames', async () => {
    let started = 0
    let maxAhead = 0
    let done = 0
    await pumpFrames({
      frames: 10,
      fps: 60,
      inFlight: 3,
      render: async (_t, n) => {
        started++
        maxAhead = Math.max(maxAhead, started - done)
        return frame(n)
      },
      write: async () => {
        done++
      }
    })
    expect(started).toBe(10)
    expect(maxAhead).toBe(3)
  })

  it('reports progress after each written frame', async () => {
    const progress: number[] = []
    await pumpFrames({ frames: 3, fps: 60, render: async (_t, n) => frame(n), write: async () => {}, onProgress: (d) => progress.push(d) })
    expect(progress).toEqual([1, 2, 3])
  })

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    const written: number[] = []
    const run = pumpFrames({
      frames: 100,
      fps: 60,
      signal: controller.signal,
      render: async (_t, n) => frame(n),
      write: async (f) => {
        written.push(f[0]!)
        if (written.length === 4) controller.abort()
      }
    })
    await expect(run).rejects.toThrow()
    expect(written).toHaveLength(4)
  })

  it('fails on the first frame that fails to render', async () => {
    const written: number[] = []
    const run = pumpFrames({
      frames: 5,
      fps: 60,
      render: async (_t, n) => {
        if (n === 2) throw new Error('device lost')
        return frame(n)
      },
      write: async (f) => void written.push(f[0]!)
    })
    await expect(run).rejects.toThrow('device lost')
    expect(written).toEqual([0, 1])
  })
})
