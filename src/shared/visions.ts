/**
 * Saved visions (V10). A vision set is one run of the vision flow for a track: the brief, the
 * tap answers, and the three visions Claude wrote, with what they cost. The working vision is
 * the one the scene editor shows and saves edits to; V11 makes a pick of the three its source.
 */
import type { TapAnswers, TapQuestion } from './tap-questions'
import type { VisionPlan } from './vision-plan'

export interface VisionSet {
  id: number
  trackId: number
  brief: string
  questions: TapQuestion[]
  answers: TapAnswers
  /** Always three, each already checked against the layer library. */
  visions: VisionPlan[]
  /** How many times Claude was asked before a reply passed. */
  attempts: number
  /** What this run cost in Claude calls, retries included. */
  costUsd: number
  createdAt: string
}

/**
 * The track's working vision as the renderer's `Vision` data, stored as given. `from` says which
 * vision of which set it was built from, or null for the default starting vision.
 */
export interface WorkingVision {
  trackId: number
  vision: unknown
  from: { setId: number; index: number } | null
  updatedAt: string
}

/** What the window sends to ask for visions. The questions are worked out again from the analysis. */
export interface VisionFlowRequest {
  trackId: number
  brief: string
  answers: TapAnswers
}

export interface VisionFlowResult {
  set: VisionSet
  /** Everything the Visualizer has spent on this track so far, all calls included. */
  trackCostUsd: number
}
