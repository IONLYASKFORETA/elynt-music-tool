import { BAND_COUNT } from './audio-features'
import type { DrawnKind, FramePlan } from './scene'
import { UNIFORM_FLOATS } from './scene'
import { BLIT_WGSL, COMMON_WGSL, PASS_SHADERS } from './layer-shaders'
import { LayerImages } from './layer-images'
const WORK_FORMAT: GPUTextureFormat = 'rgba16float'
/** What an offscreen (export) frame is read back as: 8-bit RGBA, top row first, the layout FFmpeg takes. */
const PIXEL_FORMAT: GPUTextureFormat = 'rgba8unorm'

/**
 * Our own WebGPU renderer (ADR 0001). It draws one frame from a plan, so it
 * never cares whether t came from the audio clock (preview) or from a frame
 * counter (export). Each layer is a full-screen WGSL pass that reads the
 * picture below it from one texture and writes into the other.
 */
export class SceneRenderer {
  private readonly layout: GPUBindGroupLayout
  private readonly pipelines: Record<DrawnKind, GPURenderPipeline>
  private readonly blitPipeline: GPURenderPipeline
  private readonly pixelBlitPipeline: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly spectrum: GPUBuffer
  private readonly uniforms: GPUBuffer[] = []
  private readonly images: LayerImages
  /** Three, so a transition can hold one scene's picture while the next is drawn in the other two. */
  private targets: GPUTexture[] | null = null
  private blank: GPUTexture | null = null
  private pixels: GPUTexture | null = null
  /** The target the last encodeLayers left the finished picture in. */
  private finished: GPUTexture | null = null
  private readonly readbacks: GPUBuffer[] = []
  /** The export's frames, each with its clips seeked, drawn one after the other. */
  private exactQueue: Promise<void> = Promise.resolve()
  private width = 0
  private height = 0
  private configured = false

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext | null,
    private readonly canvasFormat: GPUTextureFormat
  ) {
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
      ]
    })
    const make = (source: string, format: GPUTextureFormat): GPURenderPipeline => {
      const module = device.createShaderModule({ code: `${COMMON_WGSL}\n${source}` })
      // A shader that fails to build shows up here, named, rather than as a blank pass.
      module.getCompilationInfo().then((info) => {
        for (const m of info.messages) if (m.type === 'error') console.error(`WGSL error at ${m.lineNum}:${m.linePos}: ${m.message}`)
      })
      return device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
      })
    }
    this.pipelines = Object.fromEntries(
      (Object.keys(PASS_SHADERS) as DrawnKind[]).map((kind) => [kind, make(PASS_SHADERS[kind], WORK_FORMAT)])
    ) as Record<DrawnKind, GPURenderPipeline>
    this.images = new LayerImages(device, context !== null)
    this.blitPipeline = make(BLIT_WGSL, canvasFormat)
    this.pixelBlitPipeline = canvasFormat === PIXEL_FORMAT ? this.blitPipeline : make(BLIT_WGSL, PIXEL_FORMAT)
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.spectrum = device.createBuffer({
      size: BAND_COUNT * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    })
  }

  /** With a canvas, for the preview. Without one, for the export, which only reads frames back. */
  static async create(canvas?: HTMLCanvasElement): Promise<SceneRenderer> {
    if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this window.')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter was found.')
    const device = await adapter.requestDevice()
    const context = canvas ? canvas.getContext('webgpu') : null
    if (canvas && !context) throw new Error('The preview canvas has no WebGPU context.')
    const format = context ? navigator.gpu.getPreferredCanvasFormat() : PIXEL_FORMAT
    device.lost.then((info) => console.error('WebGPU device lost:', info.message))
    return new SceneRenderer(device, context, format)
  }

  /** The size layers render at. The canvas upscales it, which is how the preview runs at reduced resolution. */
  get renderSize(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  setRenderSize(width: number, height: number): void {
    width = Math.max(1, Math.round(width))
    height = Math.max(1, Math.round(height))
    if (width === this.width && height === this.height && this.targets) return
    this.width = width
    this.height = height
    this.targets?.forEach((t) => t.destroy())
    this.blank?.destroy()
    this.pixels?.destroy()
    this.pixels = null
    this.readbacks.splice(0).forEach((b) => b.destroy())
    const texture = (): GPUTexture =>
      this.device.createTexture({
        size: [width, height],
        format: WORK_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      })
    this.targets = [texture(), texture(), texture()]
    this.blank = texture()
    const clear = this.device.createCommandEncoder()
    clear
      .beginRenderPass({
        colorAttachments: [
          { view: this.blank.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }
        ]
      })
      .end()
    this.device.queue.submit([clear.finish()])
  }

  /**
   * Loads pictures layers will draw (a Subject's image). The preview loads them as they are first
   * drawn and shows nothing until then; the export waits for them before its first frame.
   */
  loadImages(urls: readonly string[]): Promise<void> {
    return this.images.load(urls)
  }

  /** Draws one frame: every pass in order, then the result onto the canvas. */
  draw(plan: FramePlan): void {
    this.submitToCanvas(plan, false)
  }

  /**
   * Draws onto the canvas like `draw`, and also reads back what the canvas
   * shows, as RGBA. Only the export check uses it: it proves the export
   * matches the preview pixel for pixel.
   */
  drawAndCapture(plan: FramePlan): Promise<Uint8Array> {
    return this.submitToCanvas(plan, true)!
  }

  /**
   * Renders one frame offscreen and reads it back as 8-bit RGBA, top row
   * first. Several can be in flight at once: the GPU draws the next frame
   * while the last one is still being copied out.
   */
  renderPixels(plan: FramePlan): Promise<Uint8Array> {
    const { device } = this
    if (!this.pixels) {
      this.pixels = device.createTexture({
        size: [this.width, this.height],
        format: PIXEL_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
      })
    }
    const encoder = this.encodeLayers(plan)
    this.blitTo(encoder, this.pixelBlitPipeline, plan, this.pixels.createView())
    return this.readBack(encoder, this.pixels, false)
  }

  /**
   * Like `renderPixels`, but first seeks every clip the frame shows to the exact frame its plan
   * names (V18). Frames are drawn in the order asked, so a clip's texture always holds the frame
   * that frame needs; their readbacks still overlap.
   */
  renderExactPixels(plan: FramePlan): Promise<Uint8Array> {
    const drawn = this.exactQueue
      .then(() => this.images.prepare(plan.passes.map((p) => p.image)))
      .then(() => ({ pixels: this.renderPixels(plan) }))
    this.exactQueue = drawn.then(
      () => undefined,
      () => undefined
    )
    return drawn.then((d) => d.pixels)
  }

  private submitToCanvas(plan: FramePlan, capture: boolean): Promise<Uint8Array> | undefined {
    const { device, context } = this
    if (!context) throw new Error('This renderer has no canvas.')
    // Configured on first draw, so a renderer that is thrown away before drawing never claims the canvas.
    if (!this.configured) {
      context.configure({
        device,
        format: this.canvasFormat,
        alphaMode: 'opaque',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
      })
      this.configured = true
    }
    const encoder = this.encodeLayers(plan)
    const current = context.getCurrentTexture()
    this.blitTo(encoder, this.blitPipeline, plan, current.createView())
    if (capture) return this.readBack(encoder, current, this.canvasFormat === 'bgra8unorm')
    device.queue.submit([encoder.finish()])
    return undefined
  }

  /** Every layer pass, bottom to top. The finished picture is left in the last target written. */
  private encodeLayers(plan: FramePlan): GPUCommandEncoder {
    if (!this.targets || !this.blank) throw new Error('Call setRenderSize before drawing.')
    this.device.queue.writeBuffer(this.spectrum, 0, plan.spectrum)
    const encoder = this.device.createCommandEncoder()
    let below = this.blank
    // The picture a "hold" step set aside; the next transition pass reads it in place of an image.
    let held: GPUTexture | null = null
    plan.passes.forEach((pass, i) => {
      if (pass.kind === 'hold') {
        held = below
        below = this.blank!
        return
      }
      const out = this.targets!.find((target) => target !== below && target !== held)!
      const image =
        pass.kind === 'transition' ? (held ?? this.images.blank) : this.images.textureFor(pass.image, this.width, this.height)
      this.runPass(encoder, this.pipelines[pass.kind], this.uniformBuffer(i), pass.uniforms, below, out.createView(), image)
      below = out
      if (pass.kind === 'transition') held = null
    })
    this.finished = below
    return encoder
  }

  private blitTo(encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, plan: FramePlan, view: GPUTextureView): void {
    const blitUniforms = new Float32Array(UNIFORM_FLOATS)
    blitUniforms.set([0, 0, this.width, this.height])
    this.runPass(encoder, pipeline, this.uniformBuffer(plan.passes.length), blitUniforms, this.finished!, view, this.images.blank)
  }

  /** Copies a texture into a mappable buffer, submits, and resolves with tightly packed RGBA rows. */
  private async readBack(encoder: GPUCommandEncoder, texture: GPUTexture, bgra: boolean): Promise<Uint8Array> {
    const { width, height } = texture
    const rowBytes = width * 4
    const paddedRow = Math.ceil(rowBytes / 256) * 256
    const size = paddedRow * height
    const buffer =
      this.readbacks.pop() ?? this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: paddedRow }, [width, height])
    this.device.queue.submit([encoder.finish()])
    await buffer.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(buffer.getMappedRange())
    const out = new Uint8Array(rowBytes * height)
    if (paddedRow === rowBytes) out.set(mapped)
    else for (let y = 0; y < height; y++) out.set(mapped.subarray(y * paddedRow, y * paddedRow + rowBytes), y * rowBytes)
    buffer.unmap()
    // A buffer from before a resize is the wrong size; let it go.
    if (buffer.size === Math.ceil((this.width * 4) / 256) * 256 * this.height) this.readbacks.push(buffer)
    else buffer.destroy()
    if (bgra) for (let i = 0; i < out.length; i += 4) [out[i], out[i + 2]] = [out[i + 2]!, out[i]!]
    return out
  }

  destroy(): void {
    this.targets?.forEach((t) => t.destroy())
    this.blank?.destroy()
    this.pixels?.destroy()
    this.readbacks.forEach((b) => b.destroy())
    this.images.destroy()
    this.device.destroy()
  }

  private runPass(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    uniformBuffer: GPUBuffer,
    uniforms: Float32Array,
    below: GPUTexture,
    out: GPUTextureView,
    image: GPUTexture
  ): void {
    this.device.queue.writeBuffer(uniformBuffer, 0, uniforms)
    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: below.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.spectrum } },
        { binding: 4, resource: image.createView() }
      ]
    })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: out, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }]
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
  }

  private uniformBuffer(index: number): GPUBuffer {
    while (this.uniforms.length <= index) {
      this.uniforms.push(
        this.device.createBuffer({ size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      )
    }
    return this.uniforms[index]!
  }
}
