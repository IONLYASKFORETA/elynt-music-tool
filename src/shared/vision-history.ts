/**
 * Undo, snapshots and presets for the Visualizer (V15). The main process keeps a vision's
 * states as whole JSON values and never looks inside them, so every edit to a vision (scenes,
 * moments, Claude notes, whatever a vision grows to hold) gets undo without the store knowing.
 */

/**
 * Which vision a history belongs to. The editor uses `trackVisionKey(trackId)` for the vision
 * it is editing on a track; saved visions can key their own.
 */
export type VisionKey = string

export function trackVisionKey(trackId: number): VisionKey {
  return `track:${trackId}`
}

/** The state showing now, and whether there is anything to undo or redo. */
export interface HistoryState<V = unknown> {
  /** Null for a vision that was never recorded. */
  vision: V | null
  canUndo: boolean
  canRedo: boolean
}

/** A named point Aden saved and can go back to. */
export interface Snapshot<V = unknown> {
  id: number
  visionKey: VisionKey
  name: string
  vision: V
  savedAt: string
}

/** A preset saves one layer, one scene, or a whole vision, to use again on any track. */
export type PresetLevel = 'layer' | 'scene' | 'vision'
export const PRESET_LEVELS: readonly PresetLevel[] = ['layer', 'scene', 'vision']

export interface Preset<D = unknown> {
  id: number
  level: PresetLevel
  name: string
  data: D
  savedAt: string
}
