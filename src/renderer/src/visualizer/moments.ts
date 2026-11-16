import type { AudioFeatures } from './audio-features'
import { COLOR_BLEED } from './layers/color-bleed'
import { GLITCH } from './layers/glitch'
import { LIGHT_PILLAR } from './layers/light-pillar'
import type { Palette } from './palette'
import { layerParams, passUniforms, type Layer, type LayerPass } from './scene'

/**
 * Moments (GLOSSARY: Moment): visual events pinned to an exact bar or beat, drawn on top of
 * whatever the section's scene is doing. Plain data inside the vision.
 */
export type MomentKind = 'flash' | 'glitch' | 'bleed' | 'pillar'

export interface Moment {
  /** Stable within one vision, so the timeline can move or delete this one. */
  id: number
  kind: MomentKind
  /** Seconds, on a beat or bar line of the track's grid. */
  at: number
}

/** How fast each kind dies away: beats for the hit to fall to about a third. */
const DECAY_BEATS: Record<MomentKind, number> = { flash: 0.5, glitch: 0.75, bleed: 1, pillar: 0.75 }
/** Below this a moment draws nothing, so its pass is left out (under 4 decays: inside the bar). */
const SILENT = 0.02

/** How hard a moment hits at t, 0 to 1: 1 on its beat, dying away after, 0 before. */
export function momentAmount(moment: Moment, t: number, secondsPerBeat: number): number {
  const since = t - moment.at
  if (since < 0) return 0
  const amount = Math.exp(-since / (DECAY_BEATS[moment.kind] * secondsPerBeat))
  return amount < SILENT ? 0 : amount
}

/** The layer a moment draws through, at rest: a hard hit of `amount` is put on top by its kind's response. */
const MOMENT_LAYERS = {
  glitch: () => ({ ...GLITCH.create(QUIET), amount: 0, drag: 0, mosh: 0 }),
  bleed: () => ({ ...COLOR_BLEED.create(QUIET), band: 0 }),
  pillar: () => LIGHT_PILLAR.create(QUIET)
}
const QUIET = { reactsTo: 'none', strength: 0 } as const

/** The passes every moment sounding at t draws, oldest first. They go over the scene. */
export function momentPasses(
  moments: readonly Moment[],
  t: number,
  secondsPerBeat: number,
  frame: { features: AudioFeatures; size: { width: number; height: number }; build: number; palette: Palette }
): LayerPass[] {
  const { features, size, build, palette } = frame
  const passes: LayerPass[] = []
  for (const moment of moments) {
    const a = momentAmount(moment, t, secondsPerBeat)
    if (a <= 0) continue
    const layer: Layer | null =
      moment.kind === 'glitch'
        ? GLITCH.respond.hard(MOMENT_LAYERS.glitch(), a)
        : moment.kind === 'bleed'
          ? COLOR_BLEED.respond.hard(MOMENT_LAYERS.bleed(), a)
          : moment.kind === 'pillar'
            ? LIGHT_PILLAR.respond.hard(MOMENT_LAYERS.pillar(), a)
            : null
    passes.push(
      layer
        ? { kind: layer.kind, uniforms: passUniforms(t, features, size, layerParams(layer), build, palette) }
        : { kind: 'flash', uniforms: passUniforms(t, features, size, [a], build, palette) }
    )
  }
  return passes
}

export const MOMENT_KINDS:readonly MomentKind[] = ['flash', 'glitch', 'bleed', 'pillar']

export const MOMENT_NAMES: Record<MomentKind, string> = {
  flash: 'White flash',
  glitch: 'Glitch hit',
  bleed: 'Bleed burst',
  pillar: 'Pillar slam'
}
