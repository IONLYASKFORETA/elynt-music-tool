import { describe, expect, it } from 'vitest'
import { checkVisionsReply, LAYER_CATALOG, visionsSchema, type VisionPlan } from './vision-plan'

/** A plan for a three-section track that the checker should accept as is. */
function plan(name: string): VisionPlan {
  return {
    name,
    concept: 'A chrome angel cracking open over a black city.',
    palette: ['#0b0f2a', '#ff3ea5', '#22e0ff'],
    motifs: ['chrome wings', 'sigils'],
    sections: [0, 1, 2].map((section) => ({
      section,
      look: 'quiet chrome',
      layers: [{ kind: 'chrome', reactsTo: 'snare', strength: 0.8, params: { size: 0.4, spikes: 0.1, film: 0.5, flow: 3 } }]
    })),
    drop: { lands: 'Pillars slam down on the first downbeat.', intensity: 0.9 },
    type: { treatment: 'Big title, katakana under it.', words: 'fly', katakana: true }
  }
}

const reply = (...visions: unknown[]) => ({ visions })

describe('checking a visions reply', () => {
  it('accepts three valid visions as they are', () => {
    const result = checkVisionsReply(reply(plan('A'), plan('B'), plan('C')), 3)
    expect(result).toEqual({ ok: true, visions: [plan('A'), plan('B'), plan('C')] })
  })

  it('rejects a layer kind outside the layer library, naming it', () => {
    const bad = plan('B')
    bad.sections[1]!.layers.push({ kind: 'fluid_sim' as never, reactsTo: 'kick', strength: 1, params: {} })
    const result = checkVisionsReply(reply(plan('A'), bad, plan('C')), 3)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.problems).toContain('Vision 2, section 2: "fluid_sim" is not a layer in the layer library.')
  })

  it('rejects a parameter the layer kind does not have', () => {
    const bad = plan('A')
    bad.sections[0]!.layers[0]!.params = { size: 0.4, spikes: 0.1, film: 0.5, flow: 3, viscosity: 0.3 }
    const result = checkVisionsReply(reply(bad, plan('B'), plan('C')), 3)

    expect(!result.ok && result.problems).toEqual(['Vision 1, section 1: Chrome has no parameter "viscosity".'])
  })

  it('rejects anything other than exactly three visions', () => {
    const result = checkVisionsReply(reply(plan('A'), plan('B')), 3)
    expect(!result.ok && result.problems).toEqual(['Send exactly 3 visions, not 2.'])
  })

  it('rejects a palette of the wrong size or with a color that is not #rrggbb', () => {
    const few = { ...plan('A'), palette: ['#000000', '#ffffff'] }
    const odd = { ...plan('B'), palette: ['#000000', '#ffffff', 'hot pink'] }
    const result = checkVisionsReply(reply(few, odd, plan('C')), 3)

    expect(!result.ok && result.problems).toEqual([
      'Vision 1: a palette has 3 to 5 colors, not 2.',
      'Vision 2: "hot pink" is not a color like #ff2e88.'
    ])
  })

  it('rejects a vision that skips a section or plans one twice', () => {
    const skips = plan('A')
    skips.sections = skips.sections.slice(0, 2)
    const twice = plan('B')
    twice.sections[2]!.section = 1
    const result = checkVisionsReply(reply(skips, twice, plan('C')), 3)

    expect(!result.ok && result.problems).toEqual([
      'Vision 1: plan each of the 3 sections once, by index 0 to 2.',
      'Vision 2: plan each of the 3 sections once, by index 0 to 2.'
    ])
  })

  it('rejects more than five active layers in a section, not counting Ground and Finish', () => {
    const crowded = plan('A')
    const extra = (['colorBleed', 'glitch', 'lightPillar', 'posterFrame', 'posterType'] as const).map((kind) => ({
      kind,
      reactsTo: 'drop' as const,
      strength: 0.5,
      params: {}
    }))
    crowded.sections[0]!.layers.push(...extra, { kind: 'ground', reactsTo: 'energy', strength: 0.5, params: {} })
    const result = checkVisionsReply(reply(crowded, plan('B'), plan('C')), 3)

    expect(!result.ok && result.problems).toEqual(['Vision 1, section 1: 6 active layers; a section has at most 5.'])
  })

  it('rejects an unknown "reacts to" signal', () => {
    const bad = plan('A')
    bad.sections[0]!.layers[0]!.reactsTo = 'vocals' as never
    const result = checkVisionsReply(reply(bad, plan('B'), plan('C')), 3)
    expect(!result.ok && result.problems).toEqual(['Vision 1, section 1: Chrome can\'t react to "vocals".'])
  })

  it('pulls numbers back into range rather than rejecting them, and rounds counts', () => {
    const loud = plan('A')
    loud.sections[0]!.layers = [
      { kind: 'lightPillar', reactsTo: 'drop', strength: 3, params: { fire: 2, count: 9.4, width: -1, bloom: 0.5 } }
    ]
    loud.drop.intensity = -2
    const result = checkVisionsReply(reply(loud, plan('B'), plan('C')), 3)

    expect(result.ok).toBe(true)
    const v = result.ok ? result.visions[0]! : null
    expect(v!.sections[0]!.layers[0]).toEqual({
      kind: 'lightPillar',
      reactsTo: 'drop',
      strength: 1,
      params: { fire: 1, count: 7, width: LAYER_CATALOG.lightPillar.params.width!.min, bloom: 0.5 }
    })
    expect(v!.drop.intensity).toBe(0)
  })

  it('rejects a reply that is not an object of visions at all', () => {
    expect(checkVisionsReply('three visions', 3)).toEqual({ ok: false, problems: ['The reply must be an object with a "visions" list.'] })
  })
})

describe('the visions schema', () => {
  it('only lets layer kinds from the layer library through, each with its own parameters', () => {
    const schema = visionsSchema() as any
    const layerVariants = schema.properties.visions.items.properties.sections.items.properties.layers.items.anyOf
    const kinds = layerVariants.map((v: any) => v.properties.kind.enum).flat()

    expect(kinds.sort()).toEqual(Object.keys(LAYER_CATALOG).sort())
    const chrome = layerVariants.find((v: any) => v.properties.kind.enum[0] === 'chrome')
    expect(Object.keys(chrome.properties.params.properties).sort()).toEqual(['film', 'flow', 'size', 'spikes'])
    expect(chrome.properties.params.additionalProperties).toBe(false)
  })

  it('closes every object, as structured outputs require', () => {
    const open: string[] = []
    const walk = (node: any, path: string) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'object') {
        if (node.additionalProperties !== false) open.push(path)
        if (JSON.stringify(Object.keys(node.properties ?? {}).sort()) !== JSON.stringify([...(node.required ?? [])].sort())) open.push(`${path} (required)`)
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`)
    }
    walk(visionsSchema(), '$')
    expect(open).toEqual([])
  })
})
