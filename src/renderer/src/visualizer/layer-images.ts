import { layoutPosterType, TYPE_BLOCKS, type Measure, type TypeLayout } from './type-layout'
import type { PassImage } from './scene'

/** How far a playing preview clip may drift from where the vision says it should be before it is re-seeked, in seconds. */
const PREVIEW_CLIP_DRIFT = 0.15

type ClipImage = Extract<PassImage, { kind: 'clip' }>

/** One video per clip and timing, and the texture its current frame is copied into. */
interface ClipEntry {
  video: HTMLVideoElement
  ready: Promise<void>
  texture: GPUTexture | null
  /** The clip frame the texture holds (export), or -1. */
  frame: number
  /** The clip time the last preview frame asked for, to tell playing from paused. */
  lastTime: number | null
}

/** Type textures kept at once: a few sections' worth, at a couple of sizes. */
const MAX_TYPE_TEXTURES = 8

/**
 * The pictures layer passes draw from (ADR 0001 renderer glue): Poster Type's rasterized type
 * and the Subject's image, as GPU textures. Type is rasterized on the spot and cached by its
 * text, anchors and size. A picture loads in the background; until it has, its pass draws from a
 * clear 1x1 texture, so it shows nothing. The export loads every picture before its first frame.
 *
 * Clips (V18) play from a video element per clip and timing. The preview lets the video play and
 * re-seeks it when it drifts; the export (`live` false) seeks each clip to the exact frame the
 * plan names in `prepare` and copies that frame before the frame is drawn.
 */
export class LayerImages {
  /** Clear and 1x1: what a pass with no picture (or one still loading) reads. */
  readonly blank: GPUTexture
  private readonly types = new Map<string, GPUTexture>()
  private readonly pictures = new Map<string, { texture: GPUTexture | null; loading: Promise<void> }>()
  private readonly clips = new Map<string, ClipEntry>()
  private readonly measure = canvasMeasure()

  constructor(
    private readonly device: GPUDevice,
    private readonly live: boolean
  ) {
    this.blank = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    })
    device.queue.writeTexture({ texture: this.blank }, new Uint8Array(4), { bytesPerRow: 4 }, [1, 1])
  }

  textureFor(image: PassImage | undefined, width: number, height: number): GPUTexture {
    if (!image) return this.blank
    if (image.kind === 'picture') {
      const entry = this.pictures.get(image.url)
      if (!entry) void this.load([image.url])
      return entry?.texture ?? this.blank
    }
    if (image.kind === 'clip') return this.clipTexture(image)
    const key = `${image.key}@${width}x${height}`
    let texture = this.types.get(key)
    if (texture) {
      // Most recently used goes last, so the oldest is the first to go.
      this.types.delete(key)
    } else {
      texture = this.typeTexture(layoutPosterType(image.text, image.anchors, { width, height }, this.measure, image.bounds))
      while (this.types.size >= MAX_TYPE_TEXTURES) {
        const [oldest, old] = this.types.entries().next().value!
        old.destroy()
        this.types.delete(oldest)
      }
    }
    this.types.set(key, texture)
    return texture
  }

  /** Loads pictures, resolving once all of them are ready (or have failed and show nothing). */
  load(urls: readonly string[]): Promise<void> {
    return Promise.all(
      urls.map((url) => {
        const known = this.pictures.get(url)
        if (known) return known.loading
        const entry: { texture: GPUTexture | null; loading: Promise<void> } = { texture: null, loading: Promise.resolve() }
        entry.loading = this.loadPicture(url)
          .then((texture) => void (entry.texture = texture))
          .catch((e: unknown) => console.error(`Could not load the image ${url}:`, e))
        this.pictures.set(url, entry)
        return entry.loading
      })
    ).then(() => undefined)
  }

  /**
   * Gets every clip a frame shows onto exactly the frame it names: seeks, waits for the seek, and
   * copies the frame. The export calls this before drawing each frame, one frame at a time.
   */
  async prepare(images: readonly (PassImage | undefined)[]): Promise<void> {
    for (const image of images) {
      if (image?.kind !== 'clip') continue
      const entry = this.clip(image)
      await entry.ready
      if (entry.frame === image.frame && entry.texture) continue
      const { video } = entry
      if (!video.paused) video.pause()
      if (Math.abs(video.currentTime - image.time) > 1e-4) {
        const seeked = new Promise<void>((resolve) => video.addEventListener('seeked', () => resolve(), { once: true }))
        video.currentTime = image.time
        await seeked
      }
      this.copyFrame(entry)
      entry.frame = image.frame
    }
  }

  destroy(): void {
    this.blank.destroy()
    this.types.forEach((t) => t.destroy())
    this.pictures.forEach((p) => p.texture?.destroy())
    this.clips.forEach((c) => {
      c.texture?.destroy()
      c.video.pause()
      c.video.removeAttribute('src')
      c.video.load()
    })
  }

  private clip(image: ClipImage): ClipEntry {
    let entry = this.clips.get(image.key)
    if (entry) return entry
    const video = document.createElement('video')
    // The media server answers with CORS headers; without them WebGPU refuses to copy the frames.
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    const ready = new Promise<void>((resolve) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true })
      video.addEventListener(
        'error',
        () => {
          console.error(`Could not load the clip ${image.url}:`, video.error?.message)
          resolve()
        },
        { once: true }
      )
    })
    video.src = image.url
    entry = { video, ready, texture: null, frame: -1, lastTime: null }
    this.clips.set(image.key, entry)
    return entry
  }

  /** The preview's clip: kept playing near where the vision says, its current frame copied each draw. */
  private clipTexture(image: ClipImage): GPUTexture {
    const entry = this.clip(image)
    if (!this.live) return entry.texture ?? this.blank
    const { video } = entry
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return entry.texture ?? this.blank
    const moving = entry.lastTime !== null && Math.abs(image.time - entry.lastTime) > 1e-6
    entry.lastTime = image.time
    video.playbackRate = Math.min(16, Math.max(0.0625, image.speed))
    if (moving && video.paused) void video.play().catch(() => {})
    if (!moving && !video.paused) video.pause()
    if (!video.seeking && Math.abs(video.currentTime - image.time) > (moving ? PREVIEW_CLIP_DRIFT : 1 / 120)) {
      video.currentTime = image.time
    }
    this.copyFrame(entry)
    return entry.texture ?? this.blank
  }

  private copyFrame(entry: ClipEntry): void {
    const { video } = entry
    if (video.videoWidth === 0 || video.videoHeight === 0) return
    if (!entry.texture || entry.texture.width !== video.videoWidth || entry.texture.height !== video.videoHeight) {
      entry.texture?.destroy()
      entry.texture = this.device.createTexture({
        size: [video.videoWidth, video.videoHeight],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
      })
    }
    try {
      this.device.queue.copyExternalImageToTexture({ source: video }, { texture: entry.texture }, [video.videoWidth, video.videoHeight])
    } catch (error) {
      console.error('Could not copy a clip frame:', error)
    }
  }

  private async loadPicture(url: string): Promise<GPUTexture> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' })
    const texture = this.device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    })
    this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height])
    bitmap.close()
    return texture
  }

  private typeTexture(layout: TypeLayout): GPUTexture {
    const { width, height } = layout
    const texture = this.device.createTexture({
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    })
    this.device.queue.writeTexture({ texture }, rasterizeType(layout), { bytesPerRow: width * 4 }, [width, height])
    return texture
  }
}

/** A Measure backed by a 2D canvas: what the type will really be drawn with. */
function canvasMeasure(): Measure {
  const context = new OffscreenCanvas(1, 1).getContext('2d')!
  return (text, font) => {
    context.font = font
    return context.measureText(text).width
  }
}

/**
 * Draws a type layout as a mask with one block in each channel (title in red, artist in green,
 * katakana in blue, words in alpha), so the shader can reveal each block on its own.
 */
function rasterizeType(layout: TypeLayout): Uint8Array<ArrayBuffer> {
  const { width, height } = layout
  const out = new Uint8Array(width * height * 4)
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
  for (const block of layout.blocks) {
    // Only the block's own box (with room for overhangs) is read back.
    const pad = Math.ceil(block.fontPx * 0.3)
    const x0 = Math.max(0, Math.floor(block.box.x) - pad)
    const y0 = Math.max(0, Math.floor(block.box.y) - pad)
    const x1 = Math.min(width, Math.ceil(block.box.x + block.box.width) + pad)
    const y1 = Math.min(height, Math.ceil(block.box.y + block.box.height) + pad)
    if (x1 <= x0 || y1 <= y0) continue
    context.clearRect(0, 0, width, height)
    context.font = block.font
    context.textAlign = block.align
    context.textBaseline = 'top'
    context.fillStyle = '#fff'
    for (const line of block.lines) context.fillText(line.text, line.x, line.y)
    const pixels = context.getImageData(x0, y0, x1 - x0, y1 - y0).data
    const channel = TYPE_BLOCKS.indexOf(block.id)
    const rowWidth = x1 - x0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const alpha = pixels[((y - y0) * rowWidth + (x - x0)) * 4 + 3]!
        const at = (y * width + x) * 4 + channel
        out[at] = Math.max(out[at]!, alpha)
      }
    }
  }
  return out
}
