/**
 * Where in the track the preview is. While playing, time comes from the audio
 * clock (not from frame timing), minus the output latency, so the picture
 * matches what reaches the speakers.
 */
export class PlaybackClock {
  private startedAt = 0
  private offset = 0
  private isPlaying = false

  constructor(
    private readonly audioNow: () => number,
    private readonly outputLatency: () => number,
    readonly duration: number
  ) {}

  get playing(): boolean {
    return this.isPlaying
  }

  get ended(): boolean {
    return this.time() >= this.duration
  }

  /** Seconds into the track at this moment. */
  time(): number {
    const raw = this.isPlaying ? this.offset + this.audioNow() - this.startedAt - this.outputLatency() : this.offset
    return Math.min(this.duration, Math.max(0, raw))
  }

  play(): void {
    if (this.isPlaying) return
    this.startedAt = this.audioNow()
    this.isPlaying = true
  }

  pause(): void {
    if (!this.isPlaying) return
    this.offset = this.time()
    this.isPlaying = false
  }

  seek(t: number): void {
    this.offset = Math.min(this.duration, Math.max(0, t))
    this.startedAt = this.audioNow()
  }
}
