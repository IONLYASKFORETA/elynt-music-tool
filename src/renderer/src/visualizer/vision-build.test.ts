import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { checkVisionsReply, LAYER_CATALOG, LAYER_KINDS, REACTS_TO, type VisionPlan } from '../../../shared/vision-plan'
import { PICKABLE_SIGNALS } from './reactivity'
import { activeLayerCount, LAYER_NAMES, MAX_ACTIVE_LAYERS, newLayer, type LayerKind } from './scene'
import { buildVision } from './vision-build'

const sections: Section[] = [
  { label: 'intro', start: 0, end: 16, startBar: 0, confidence: 1, source: 'heuristic' },
  { label: 'build', start: 16, end: 32, startBar: 8, confidence: 1, source: 'heuristic' },
  { label: 'drop', start: 32, end: 64, startBar: 16, confidence: 1, source: 'heuristic' }
]

function plan(): VisionPlan {
  return {
    name: 'Chrome angel',
    concept: 'A chrome angel cracking open over a black city.',
    palette: ['#0b0f2a', '#ff3ea5', '#22e0ff'],
    motifs: ['chrome wings'],
    sections: [
      { section: 0, look: 'still', layers: [{ kind: 'posterType', reactsTo: 'downbeat', strength: 0.4, params: { chrome: 0.9 } }] },
      {
        section: 1,
        look: 'rising',
        layers: [
          { kind: 'ground', reactsTo: 'build', strength: 0.5, params: { lift: 0.2 } },
          { kind: 'chrome', reactsTo: 'snare', strength: 0.6, params: { spikes: 0.3 } }
        ]
      },
      {
        section: 2,
        look: 'slam',
        layers: [
          { kind: 'lightPillar', reactsTo: 'dropDownbeat', strength: 0.8, params: { count: 5 } },
          { kind: 'glitch', reactsTo: 'drop', strength: 0.6, params: {} }
        ]
      }
    ],
    drop: { lands: 'Pillars slam down.', intensity: 0.5 },
    type: { treatment: 'Big title.', words: 'no gravity', katakana: false }
  }
}

describe('building a vision into scenes', () => {
  it('gives every section a scene of Ground, its planned layers in order, then Finish', () => {
    const vision = buildVision(plan(), sections, 64)

    expect(vision.sections.map((s) => [s.label, s.start, s.end, s.scene.layers.map((l) => l.kind)])).toEqual([
      ['intro', 0, 16, ['ground', 'posterType', 'finish']],
      ['build', 16, 32, ['ground', 'chrome', 'finish']],
      ['drop', 32, 64, ['ground', 'lightPillar', 'glitch', 'finish']]
    ])
    expect(vision.palette).toEqual(['#0b0f2a', '#ff3ea5', '#22e0ff'])
  })

  it('starts on the track’s beat grid with cuts between sections and no moments yet', () => {
    const grid = { beats: [0, 0.5, 1], downbeats: [0] }
    const vision = buildVision(plan(), sections, 64, grid)

    expect(vision.grid).toEqual(grid)
    expect(vision.moments).toEqual([])
    expect(vision.sections.map((s) => s.transition)).toEqual(['cut', 'cut', 'cut'])
  })

  it("sets the planned settings and reactivity over the layer's own defaults", () => {
    const chrome = buildVision(plan(), sections, 64).sections[1]!.scene.layers[1]!

    expect(chrome).toEqual({ ...newLayer('chrome'), spikes: 0.3, reactivity: { reactsTo: 'snare', strength: 0.6 } })
  })

  it('uses a planned Ground or Finish in place of the default one', () => {
    const ground = buildVision(plan(), sections, 64).sections[1]!.scene.layers[0]!
    expect(ground).toEqual({ ...newLayer('ground'), lift: 0.2, reactivity: { reactsTo: 'build', strength: 0.5 } })
  })

  it('sets the type treatment on the Poster Type: the words, and katakana off', () => {
    const type = buildVision(plan(), sections, 64).sections[0]!.scene.layers[1]!
    expect(type).toMatchObject({ kind: 'posterType', words: 'no gravity', katakana: '', chrome: 0.9 })
  })

  it('leaves katakana to be generated from the title when the treatment wants it', () => {
    const p = plan()
    p.type.katakana = true
    const type = buildVision(p, sections, 64).sections[0]!.scene.layers[1]!
    expect(type).toMatchObject({ katakana: null })
  })

  it('lets the drop intensity scale how hard drop sections react, and nothing else', () => {
    const soft = plan()
    soft.drop.intensity = 0
    const hard = plan()
    hard.drop.intensity = 1

    const strengths = (p: VisionPlan, i: number) => buildVision(p, sections, 64).sections[i]!.scene.layers.map((l) => l.reactivity.strength)
    // Middle intensity keeps the planned strengths; 0 halves them; 1 adds half again, up to 1.
    expect(strengths(plan(), 2).slice(1, 3)).toEqual([0.8, 0.6])
    expect(strengths(soft, 2).slice(1, 3)).toEqual([0.4, 0.3])
    expect(strengths(hard, 2).slice(1, 3)).toEqual([1, 0.9])
    expect(strengths(soft, 1)).toEqual(strengths(hard, 1))
  })
})

describe('the layer catalog Claude is given', () => {
  it('names exactly the layer kinds of the layer library', () => {
    expect([...LAYER_KINDS].sort()).toEqual((Object.keys(LAYER_NAMES) as LayerKind[]).sort())
    for (const kind of LAYER_KINDS) expect(LAYER_CATALOG[kind].name).toBe(LAYER_NAMES[kind])
  })

  it("names only settings each layer really has, with its default inside the catalog's range", () => {
    for (const kind of LAYER_KINDS) {
      const layer = newLayer(kind) as unknown as Record<string, unknown>
      for (const [name, spec] of Object.entries(LAYER_CATALOG[kind].params)) {
        const value = layer[name]
        expect(typeof value, `${kind}.${name}`).toBe('number')
        expect(value as number, `${kind}.${name}`).toBeGreaterThanOrEqual(spec.min)
        expect(value as number, `${kind}.${name}`).toBeLessThanOrEqual(spec.max)
      }
    }
  })

  it('offers the same "reacts to" signals as the picker', () => {
    expect([...REACTS_TO].sort()).toEqual([...PICKABLE_SIGNALS].sort())
  })
})

describe('a recorded reply from Claude', () => {
  it('builds each of its three visions into a valid scene per section, with no editing', () => {
    const reply = JSON.parse(readFileSync(join(import.meta.dirname, '../../../main/visions/recorded/three-visions.json'), 'utf8'))
    const five: Section[] = (['intro', 'build', 'drop', 'breakdown', 'outro'] as const).map((label, i) => ({
      label,
      start: i * 30,
      end: (i + 1) * 30,
      startBar: i * 16,
      confidence: 1,
      source: 'heuristic'
    }))

    const checked = checkVisionsReply(reply, five.length)
    expect(checked.ok).toBe(true)
    for (const plan of checked.ok ? checked.visions : []) {
      const vision = buildVision(plan, five, 150)
      expect(vision.sections.map((s) => s.label)).toEqual(['intro', 'build', 'drop', 'breakdown', 'outro'])
      for (const { scene } of vision.sections) {
        expect(scene.layers[0]!.kind).toBe('ground')
        expect(scene.layers.at(-1)!.kind).toBe('finish')
        expect(activeLayerCount(scene)).toBeLessThanOrEqual(MAX_ACTIVE_LAYERS)
      }
    }
  })
})
