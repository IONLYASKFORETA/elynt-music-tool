import type { TrackAnalysis } from '../../shared/analysis'
import { tapQuestions, type TapAnswers } from '../../shared/tap-questions'
import type { VisionFlowRequest, VisionFlowResult } from '../../shared/visions'
import type { ClaudeClient, UsageLog } from '../claude'
import type { TrackLibrary } from '../tracks'
import { proposeVisions } from './propose'
import type { VisionStore } from './store'

export interface VisionFlowDeps {
  claude: ClaudeClient
  usage: UsageLog
  store: VisionStore
  tracks: Pick<TrackLibrary, 'get'>
  /** The track's analysis after the "What I heard" check, or null if there is none yet. */
  analysis: (trackId: number) => TrackAnalysis | null
  artistName: () => string | Promise<string>
  onReply?: (reply: unknown) => void
}

/**
 * The vision flow's main-process side (V10): from the brief and tap answers to three saved
 * visions. Costs come from api_usage, where the Claude client logs every call against the track.
 */
export function createVisionFlow(deps: VisionFlowDeps) {
  const spent = (trackId: number) => deps.usage.totalCostUsd({ tool: 'visualizer', trackId })
  return {
    async run({ trackId, brief, answers }: VisionFlowRequest): Promise<VisionFlowResult> {
      const track = deps.tracks.get(trackId)
      if (!track) throw new Error(`No track with id ${trackId}.`)
      const analysis = deps.analysis(trackId)
      if (!analysis) throw new Error('This track needs its analysis before Claude can write visions.')

      const questions = tapQuestions(analysis)
      const asked: TapAnswers = Object.fromEntries(
        questions.flatMap((q) => (q.options.some((o) => o.id === answers[q.id]) ? [[q.id, answers[q.id]!]] : []))
      )
      const before = spent(trackId)
      const { visions, attempts } = await proposeVisions(
        { claude: deps.claude, onReply: deps.onReply },
        { trackId, title: track.title, artist: await deps.artistName(), analysis, brief: brief.trim(), questions, answers: asked }
      )
      const trackCostUsd = spent(trackId)
      const set = deps.store.saveSet({ trackId, brief: brief.trim(), questions, answers: asked, visions, attempts, costUsd: trackCostUsd - before })
      return { set, trackCostUsd }
    }
  }
}
