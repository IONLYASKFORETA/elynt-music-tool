import type { LayerKind } from './scene'
import common from './shaders/common.wgsl?raw'
import ground from './shaders/ground.wgsl?raw'
import classic from './shaders/classic.wgsl?raw'
import finish from './shaders/finish.wgsl?raw'
import colorBleed from './shaders/color-bleed.wgsl?raw'
import chrome from './shaders/chrome.wgsl?raw'
import glitch from './shaders/glitch.wgsl?raw'
import lightPillar from './shaders/light-pillar.wgsl?raw'
import blit from './shaders/blit.wgsl?raw'

/** The WGSL every pass starts with: the Frame uniforms, the bindings, the vertex shader and helpers. */
export const COMMON_WGSL = common

/** Each layer kind's fragment shader, without the common code. */
export const LAYER_SHADERS: Record<LayerKind, string> = { ground, classic, finish, colorBleed, chrome, glitch, lightPillar }

export const BLIT_WGSL = blit

/** The whole shader module for one layer kind, as the GPU builds it. */
export function shaderSource(kind: LayerKind): string {
  return `${COMMON_WGSL}\n${LAYER_SHADERS[kind]}`
}
