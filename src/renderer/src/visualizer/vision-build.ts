import type { Section } from '../../../shared/analysis'
import { PLAN_EXEMPT_KINDS, type PlannedLayer, type VisionPlan } from '../../../shared/vision-plan'
import { NO_GRID, type BeatGrid } from './beat-grid'
import { newLayer, type Layer, type Scene } from './scene'
import type { Vision } from './vision'

/**
 * Builds a checked vision plan from Claude into real scenes, one per section, with no manual
 * editing: on the track's beat grid, with cuts between sections and no moments yet. Ground at the bottom, the planned layers in order, Finish on top. A section left out
 * of the plan (a plan always covers every section once it is checked) gets Ground and Finish.
 */
export function buildVision(plan: VisionPlan, sections: Section[], durationSeconds: number, grid: BeatGrid = NO_GRID): Vision {
  const spans = sections.length > 0 ? sections : [{ label: 'intro' as const, start: 0, end: durationSeconds }]
  return {
    palette: [...plan.palette],
    moments: [],
    grid: { beats: [...grid.beats], downbeats: [...grid.downbeats] },
    sections: spans.map(({ label, start, end }, index) => {
      const planned = plan.sections.find((s) => s.section === index)?.layers ?? []
      // How the drop lands: intensity 0.5 keeps the planned strengths, 0 halves them, 1 adds half again.
      const push = label === 'drop' ? 0.5 + plan.drop.intensity : 1
      return { label, start, end, scene: sceneOf(planned, plan, push), transition: 'cut' as const }
    })
  }
}

function sceneOf(planned: PlannedLayer[], plan: VisionPlan, push: number): Scene {
  const build = (p: PlannedLayer) => layerOf(p, plan, push)
  const ground = planned.find((l) => l.kind === 'ground')
  const finish = planned.find((l) => l.kind === 'finish')
  return {
    layers: [
      ground ? build(ground) : newLayer('ground'),
      ...planned.filter((l) => !PLAN_EXEMPT_KINDS.includes(l.kind)).map(build),
      finish ? build(finish) : newLayer('finish')
    ]
  }
}

function layerOf(planned: PlannedLayer, plan: VisionPlan, push: number): Layer {
  const base = newLayer(planned.kind)
  const strength = Math.round(Math.min(1, planned.strength * push) * 1000) / 1000
  const layer = { ...base, ...planned.params, kind: base.kind, reactivity: { reactsTo: planned.reactsTo, strength } } as Layer
  if (layer.kind === 'posterType') {
    // Katakana on means generate it from the title (null); off means none ('').
    return { ...layer, words: plan.type.words, katakana: plan.type.katakana ? null : '' }
  }
  return layer
}
