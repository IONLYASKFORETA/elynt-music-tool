import { frameTime } from '../../../shared/export'

export interface FramePump {
  frames: number
  fps: number
  /** Starts drawing frame n at time t. Resolves with its pixels once they are read back. */
  render(t: number, n: number): Promise<Uint8Array>
  /** Hands frame n to the encoder. Resolves when the encoder has taken it. */
  write(frame: Uint8Array, n: number): Promise<void>
  /** Frames drawn ahead of the encoder, so the GPU never waits for a readback. */
  inFlight?: number
  onProgress?(framesWritten: number): void
  signal?: AbortSignal
}

/**
 * Drives an export: every frame at its exact time, written in order. Up to
 * `inFlight` frames are rendering while the oldest is being written.
 */
export async function pumpFrames({ frames, fps, render, write, inFlight = 3, onProgress, signal }: FramePump): Promise<void> {
  const pending: Promise<Uint8Array>[] = []
  let next = 0
  const fill = () => {
    while (next < frames && pending.length < inFlight) {
      const p = render(frameTime(next, fps), next)
      // Rejections are taken in order below; this only stops them counting as unhandled meanwhile.
      p.catch(() => {})
      pending.push(p)
      next++
    }
  }
  for (let n = 0; n < frames; n++) {
    signal?.throwIfAborted()
    fill()
    const frame = await pending.shift()!
    signal?.throwIfAborted()
    await write(frame, n)
    onProgress?.(n + 1)
  }
}
