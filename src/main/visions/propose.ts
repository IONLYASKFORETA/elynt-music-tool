import type Anthropic from '@anthropic-ai/sdk'
import type { TrackAnalysis } from '../../shared/analysis'
import { clock, describeAnswers, type TapAnswers, type TapQuestion } from '../../shared/tap-questions'
import {
  checkVisionsReply,
  LAYER_CATALOG,
  LAYER_KINDS,
  PLAN_MAX_ACTIVE_LAYERS,
  REACTS_TO,
  VISION_COUNT,
  visionsSchema,
  type VisionPlan
} from '../../shared/vision-plan'
import { ClaudeError, MESSAGES, type ClaudeClient } from '../claude'

/** Everything Claude writes the visions from (Vision flow steps 2 to 6). Claude can't hear the track. */
export interface VisionAsk {
  trackId: number
  title: string
  artist: string
  /** The analysis after the "What I heard" check. */
  analysis: TrackAnalysis
  /** The owner's brief; blank when skipped. */
  brief: string
  /** The tap questions that were asked, and the owner's answers (skipped ones left out). */
  questions: TapQuestion[]
  answers: TapAnswers
}

export interface ProposeDeps {
  claude: ClaudeClient
  /** Sees every raw reply, valid or not, so real replies can be saved and replayed in tests. */
  onReply?: (reply: unknown) => void
}

/** How many times Claude is asked before giving up on a bad reply. */
export const VISION_ATTEMPTS = 3

/**
 * Asks Claude for three visions, checks the reply against the layer library, and asks again
 * (saying what was wrong) when it doesn't pass. Every call is costed against the track in
 * api_usage by the Claude client, retries included.
 */
export async function proposeVisions({ claude, onReply }: ProposeDeps, ask: VisionAsk): Promise<{ visions: VisionPlan[]; attempts: number }> {
  const sectionCount = ask.analysis.sections.length
  const first = visionPrompt(ask)
  let prompt: string | Anthropic.MessageParam[] = first
  for (let attempt = 1; attempt <= VISION_ATTEMPTS; attempt++) {
    let reply: unknown
    try {
      reply = await claude.json<unknown>({
        tool: 'visualizer',
        tier: 'strongest',
        trackId: ask.trackId,
        system: SYSTEM,
        prompt,
        schema: visionsSchema()
      })
    } catch (error) {
      if (error instanceof ClaudeError && error.code === 'bad-output') {
        prompt = first
        continue
      }
      throw error
    }
    onReply?.(reply)
    const checked = checkVisionsReply(reply, sectionCount)
    if (checked.ok) return { visions: checked.visions, attempts: attempt }
    prompt = [
      { role: 'user', content: first },
      { role: 'assistant', content: JSON.stringify(reply) },
      {
        role: 'user',
        content: `That reply can't be used:\n${checked.problems.map((p) => `- ${p}`).join('\n')}\nSend all ${VISION_COUNT} visions again with these fixed.`
      }
    ]
  }
  throw new ClaudeError('bad-output', MESSAGES.badOutput)
}

const catalog = LAYER_KINDS.map((kind) => {
  const spec = LAYER_CATALOG[kind]
  const params = Object.entries(spec.params)
    .map(([name, p]) => `${name} (${p.min} to ${p.max}${p.integer ? ', whole number' : ''}): ${p.about}`)
    .join('; ')
  return `- ${kind} = ${spec.name}. ${spec.about} Settings: ${params}.`
}).join('\n')

const SYSTEM = `You are the art director of a music visualizer for an EDM producer's own tracks. You write visions: the art direction for one track. You cannot hear the track; you work from its analysis, the producer's brief and their answers.

Every vision lives inside one house style: graphic, glitchy, spectral and poster-like. Spectral color bleed off shapes and type; iridescent holographic chrome; glitch and datamosh on hits; big poster type with katakana subtitles on grids; light pillars on the biggest moments; mecha and occult subject imagery; black or off-white grounds only. Tracks differ inside the house style, never outside it: in their palette (3 to 5 colors), their motifs and the shape of their drop.

Craft: a concept first, then form. Give each section an intensity budget along the arc of the track: breakdowns spend little, drops spend most. Save hard hits for drops and downbeats; kick and snare get medium pulses; energy and builds drive slow change. Ignore hi-hats. Restraint before the drop makes the drop land.

Build every section only from the layer library below, with at most ${PLAN_MAX_ACTIVE_LAYERS} active layers per section (ground and finish are always there and don't count; list them only to change their settings). Each layer reacts to one of: ${REACTS_TO.join(', ')}, with a strength from 0 to 1. Set only the settings listed, inside their ranges.

Layer library:
${catalog}

Write ${VISION_COUNT} visions that are clearly different from each other, each with a short name, a one-line concept, a palette of #rrggbb colors, motifs, a plan for every section by its index, how the drop lands (with an intensity from 0 to 1), and the type treatment (the owner's words to set on screen, if any, and katakana on or off).`

function visionPrompt(ask: VisionAsk): string {
  const { analysis: a } = ask
  const bar = (60 / a.bpm) * a.beatsPerBar
  const energy = (start: number, end: number) => {
    const { hz, values } = a.energy
    const slice = values.slice(Math.floor(start * hz), Math.max(Math.floor(start * hz) + 1, Math.floor(end * hz)))
    return slice.length ? slice.reduce((x, y) => x + y, 0) / slice.length : 0
  }
  const sections = a.sections
    .map((s, i) => {
      const feeling = a.moodDetail?.sections.find((f) => f.index === i)?.feeling
      return `${i}: ${s.label}, ${clock(s.start)} to ${clock(s.end)} (${Math.round((s.end - s.start) / bar)} bars, energy ${energy(s.start, s.end).toFixed(2)})${feeling ? `, feels ${feeling}` : ''}`
    })
    .join('\n')
  const mood = `${a.mood.label} (arousal ${a.mood.arousal.toFixed(2)}, valence ${a.mood.valence.toFixed(2)}${a.mood.key ? `, key ${a.mood.key}` : ''})`
  const detail = a.moodDetail ? `\nHow it feels to a model that listened: ${a.moodDetail.summary} Words: ${a.moodDetail.words.join(', ')}.` : ''
  const brief = ask.brief.trim() ? `The producer's brief: ${ask.brief.trim()}` : 'No brief: the producer skipped it.'
  const answers = describeAnswers(ask.questions, ask.answers)
  return `Track: "${ask.title}"${ask.artist ? ` by ${ask.artist}` : ''}. ${Math.round(a.bpm)} BPM, ${clock(a.durationSeconds)} long.

Sections (index: label, from to, length, mean energy 0 to 1):
${sections}

Mood read from the audio: ${mood}.${detail}

${brief}

${answers.length ? `The producer's answers:\n${answers.map((x) => `- ${x}`).join('\n')}` : 'No answers to tap questions.'}

Write the ${VISION_COUNT} visions.`
}
