import { BAND_COUNT } from './audio-features'
import type { FramePlan, LayerKind } from './scene'
import { UNIFORM_FLOATS } from './scene'
import common from './shaders/common.wgsl?raw'
import ground from './shaders/ground.wgsl?raw'
import classic from './shaders/classic.wgsl?raw'
import finish from './shaders/finish.wgsl?raw'
import blit from './shaders/blit.wgsl?raw'

const LAYER_SHADERS: Record<LayerKind, string> = { ground, classic, finish }
const WORK_FORMAT: GPUTextureFormat = 'rgba16float'

/**
 * Our own WebGPU renderer (ADR 0001). It draws one frame from a plan, so it
 * never cares whether t came from the audio clock (preview) or from a frame
 * counter (export). Each layer is a full-screen WGSL pass that reads the
 * picture below it from one texture and writes into the other.
 */
export class SceneRenderer {
  private readonly layout: GPUBindGroupLayout
  private readonly pipelines: Record<LayerKind, GPURenderPipeline>
  private readonly blitPipeline: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly spectrum: GPUBuffer
  private readonly uniforms: GPUBuffer[] = []
  private targets: [GPUTexture, GPUTexture] | null = null
  private blank: GPUTexture | null = null
  private width = 0
  private height = 0
  private configured = false

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly canvasFormat: GPUTextureFormat
  ) {
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }
      ]
    })
    const make = (source: string, format: GPUTextureFormat): GPURenderPipeline => {
      const module = device.createShaderModule({ code: `${common}\n${source}` })
      return device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
      })
    }
    this.pipelines = {
      ground: make(ground, WORK_FORMAT),
      classic: make(classic, WORK_FORMAT),
      finish: make(finish, WORK_FORMAT)
    }
    this.blitPipeline = make(blit, canvasFormat)
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.spectrum = device.createBuffer({
      size: BAND_COUNT * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    })
  }

  static async create(canvas: HTMLCanvasElement): Promise<SceneRenderer> {
    if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this window.')
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) throw new Error('No WebGPU adapter was found.')
    const device = await adapter.requestDevice()
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('The preview canvas has no WebGPU context.')
    const format = navigator.gpu.getPreferredCanvasFormat()
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
    const texture = (): GPUTexture =>
      this.device.createTexture({
        size: [width, height],
        format: WORK_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
      })
    this.targets = [texture(), texture()]
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

  /** Draws one frame: every pass in order, then the result onto the canvas. */
  draw(plan: FramePlan): void {
    if (!this.targets || !this.blank) throw new Error('Call setRenderSize before draw.')
    const { device } = this
    // Configured on first draw, so a renderer that is thrown away before drawing never claims the canvas.
    if (!this.configured) {
      this.context.configure({ device, format: this.canvasFormat, alphaMode: 'opaque' })
      this.configured = true
    }
    device.queue.writeBuffer(this.spectrum, 0, plan.spectrum)
    const encoder = device.createCommandEncoder()

    let below = this.blank
    plan.passes.forEach((pass, i) => {
      const out = this.targets![i % 2]!
      this.runPass(encoder, this.pipelines[pass.kind], this.uniformBuffer(i), pass.uniforms, below, out.createView())
      below = out
    })

    const blitUniforms = new Float32Array(UNIFORM_FLOATS)
    blitUniforms.set([0, 0, this.width, this.height])
    const canvasView = this.context.getCurrentTexture().createView()
    this.runPass(encoder, this.blitPipeline, this.uniformBuffer(plan.passes.length), blitUniforms, below, canvasView)
    device.queue.submit([encoder.finish()])
  }

  destroy(): void {
    this.targets?.forEach((t) => t.destroy())
    this.blank?.destroy()
    this.device.destroy()
  }

  private runPass(
    encoder: GPUCommandEncoder,
    pipeline: GPURenderPipeline,
    uniformBuffer: GPUBuffer,
    uniforms: Float32Array,
    below: GPUTexture,
    out: GPUTextureView
  ): void {
    this.device.queue.writeBuffer(uniformBuffer, 0, uniforms)
    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: below.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.spectrum } }
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
