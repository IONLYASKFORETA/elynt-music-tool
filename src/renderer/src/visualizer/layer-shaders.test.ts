import { describe, expect, it } from 'vitest'
import { COMMON_WGSL, PASS_SHADERS, shaderSource } from './layer-shaders'
import { LAYER_NAMES, type DrawnKind } from './scene'

/**
 * No GPU here, so these catch what would stop a shader module from building on Aden's PC
 * before it gets there: a kind with no shader, a name declared twice, a uniform that isn't there.
 */
/** Every layer kind, plus the passes moments and transitions draw. */
const KINDS: DrawnKind[] = [...(Object.keys(LAYER_NAMES) as DrawnKind[]), 'flash', 'transition']

/** Names declared at module scope (unindented), where a second declaration is an error. */
function declared(source: string): string[] {
  return [...source.matchAll(/^(?:fn|const|var(?:<[^>]*>)?|struct)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]!)
}

/** WGSL's reserved words that read like ordinary names (the spec lists more). */
const WGSL_RESERVED = new Set(
  (
    'active as attribute auto cast catch class common demote do enum export extends extern filter final from get ' +
    'goto highp import inline layout lowp macro match mediump meta mod module move mut new nil null of operator ' +
    'package pass patch precise precision priv ref register resource self set shared smooth static super target ' +
    'template this throw trait try type typedef union unless unsafe use using varying where with yield'
  ).split(' ')
)

function balanced(source: string): boolean {
  const code = source.replace(/\/\/.*$/gm, '')
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const stack: string[] = []
  for (const c of code) {
    if ('([{'.includes(c)) stack.push(c)
    else if (c in pairs && stack.pop() !== pairs[c]) return false
  }
  return stack.length === 0
}

describe('layer shaders', () => {
  const frameFields = [.../struct Frame \{([^}]*)\}/.exec(COMMON_WGSL)![1]!.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1])

  it.each(KINDS)('%s has a fragment shader', (kind) => {
    expect(PASS_SHADERS[kind]).toMatch(/@fragment\s+fn fs\(/)
  })

  it.each(KINDS)('%s declares nothing the common code already declares, nor anything twice', (kind) => {
    const names = declared(shaderSource(kind))
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
  })

  it.each(KINDS)('%s reads only uniforms the frame has', (kind) => {
    const used = [...PASS_SHADERS[kind].matchAll(/\bframe\.(\w+)/g)].map((m) => m[1])
    for (const field of used) expect(frameFields).toContain(field)
  })

  it.each(KINDS)('%s names nothing with a word WGSL reserves', (kind) => {
    const names = [...shaderSource(kind).matchAll(/\b(?:let|var|const|fn)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]!)
    expect(names.filter((n) => WGSL_RESERVED.has(n))).toEqual([])
  })

  it.each(KINDS)('%s has balanced brackets', (kind) => {
    expect(balanced(shaderSource(kind))).toBe(true)
  })
})
