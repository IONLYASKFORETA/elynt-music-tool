/**
 * Tap questions (Vision flow step 5): up to three short multiple-choice questions, asked only
 * where the track analysis is least sure. Claude reads the answers when it writes the visions.
 */
import type { Section, TrackAnalysis } from './analysis'

export interface TapOption {
  id: string
  label: string
  /** What the answer means, in the words Claude reads. */
  means: string
}

export interface TapQuestion {
  id: string
  prompt: string
  options: TapOption[]
  /** 0 to 1: how unsure the analysis is about what this asks. */
  unsure: number
}

/** Question id to option id. A question with no answer was skipped. */
export type TapAnswers = Record<string, string>

export const MAX_TAP_QUESTIONS = 3
/** Below this the analysis is sure enough not to ask. */
const ASK_ABOVE = 0.5

const DROP_MOOD: TapOption[] = [
  { id: 'dark', label: 'Dark', means: 'menacing, heavy, low-lit.' },
  { id: 'euphoric', label: 'Euphoric', means: 'bright, lifting, wide open.' },
  { id: 'both', label: 'Dark into euphoric', means: 'dark through the build, breaking open bright on the drop.' }
]

const DROP_ENERGY: TapOption[] = [
  { id: 'restrained', label: 'Restrained', means: 'hold back; let a few hits carry it.' },
  { id: 'big', label: 'Big', means: 'a clear step up from everything before it.' },
  { id: 'all-out', label: 'All out', means: 'everything fires; the loudest moment of the video.' }
]

/** The questions to ask, least sure first, at most three. None when the analysis is sure. */
export function tapQuestions(analysis: TrackAnalysis): TapQuestion[] {
  // Gemini heard the track, so its read wins over the coarse local one.
  const valence = analysis.moodDetail?.valence ?? analysis.mood.valence
  const arousal = analysis.moodDetail?.arousal ?? analysis.mood.arousal
  const candidates: TapQuestion[] = [
    { id: 'drop-mood', prompt: 'Dark or euphoric drop?', options: DROP_MOOD, unsure: 1 - Math.abs(valence) },
    { id: 'drop-energy', prompt: 'How hard should the drop hit?', options: DROP_ENERGY, unsure: 1 - Math.abs(arousal) },
    ...analysis.sections.flatMap((s, i) => (s.source === 'heuristic' ? [sectionQuestion(s, i)] : []))
  ]
  return candidates
    .filter((q) => q.unsure > ASK_ABOVE)
    .sort((a, b) => b.unsure - a.unsure)
    .slice(0, MAX_TAP_QUESTIONS)
}

function sectionQuestion(section: Section, index: number): TapQuestion {
  const at = clock(section.start)
  const { label } = section
  const prompt =
    label === 'drop'
      ? `Is ${at} the drop, or still building?`
      : label === 'build'
        ? `Is ${at} a build, or already the drop?`
        : `Is ${at} really the ${label}?`
  const other = label === 'drop' ? 'build' : label === 'build' ? 'drop' : null
  const options: TapOption[] = [
    { id: 'yes', label: `Yes, ${article(label)}${label}`, means: `treat the section at ${at} as ${article(label)}${label}.` },
    other
      ? { id: other, label: `It's ${article(other)}${other}`, means: `treat the section at ${at} as ${article(other)}${other}.` }
      : { id: 'unsure', label: 'Not sure', means: `the section at ${at} is hard to call; keep it understated.` }
  ]
  return { id: `section-${index}`, prompt, options, unsure: 1 - section.confidence }
}

const article = (label: string) => (/^[aeiou]/.test(label) ? 'an ' : 'a ')

/** Each answered question as one line for Claude: the question, the pick, and what it means. */
export function describeAnswers(questions: TapQuestion[], answers: TapAnswers): string[] {
  return questions.flatMap((q) => {
    const option = q.options.find((o) => o.id === answers[q.id])
    return option ? [`${q.prompt} ${option.label}: ${option.means}`] : []
  })
}

export function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
