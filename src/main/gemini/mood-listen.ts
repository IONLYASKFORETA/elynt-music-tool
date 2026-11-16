import { extname } from 'node:path'
import { type MoodDetail, type MoodLabel, type TrackAnalysis } from '../../shared/analysis'
import type { ApiKeys } from '../keys/api-keys'
import type { UsageLog } from '../claude/usage'

/**
 * The optional Gemini mood listen (V12). Claude can't hear audio, so when the owner has
 * set a Gemini key, the analysis step also sends the mixdown to Gemini for mood detail.
 * The spec allows it on the paid tier only, at under 1 cent a track.
 */

/** Flash-Lite hears audio and is the cheapest stable model. Checked against ai.google.dev 2026-11-16. */
export const GEMINI_MOOD_MODEL = 'gemini-3.1-flash-lite'

/**
 * US dollars per million tokens, paid tier. Input is priced at the audio rate (text input is
 * no dearer), output includes thinking. A model missing here is priced as the dearest, so
 * cost is never under-reported.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  'gemini-3.1-flash-lite': { input: 0.5, output: 1.5 },
  'gemini-3.5-flash': { input: 1.5, output: 9 }
}
const FALLBACK_PRICE = { input: 1.5, output: 9 }

const MIME_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mp3',
  '.flac': 'audio/flac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff'
}

/** The parts of a generateContent reply this module reads. */
export interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    cachedContentTokenCount?: number
    totalTokenCount?: number
    promptTokensDetails?: { modality: string; tokenCount: number }[]
  }
}

export interface UploadedFile {
  /** For example "files/abc123", used to delete it. */
  name: string
  uri: string
  mimeType: string
}

/** Gemini's REST API, swappable so the listen can be tested without the network. */
export interface GeminiTransport {
  uploadFile(apiKey: string, file: { path: string; mimeType: string; displayName: string }): Promise<UploadedFile>
  generateContent(apiKey: string, model: string, body: Record<string, unknown>): Promise<GenerateContentResponse>
  deleteFile(apiKey: string, name: string): Promise<void>
}

export interface MoodListenInput {
  trackId: number
  mixdownPath: string
  /** The local analysis, so Gemini can describe each section the app found. */
  analysis: TrackAnalysis
}

/** Resolves to the mood detail, or null when there is no key or the listen didn't work out. Never throws. */
export type MoodListen = (input: MoodListenInput) => Promise<MoodDetail | null>

export interface MoodListenerDeps {
  keys: Pick<ApiKeys, 'get'>
  usage: UsageLog
  transport: GeminiTransport
  now?: () => Date
  /** Where a failed listen is reported. It is optional, so nothing reaches the owner. */
  onError?: (error: unknown) => void
}

const MOOD_LABELS: readonly MoodLabel[] = ['euphoric', 'dark', 'dreamy', 'melancholic', 'uplifting', 'moody']

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    label: { type: 'STRING', enum: [...MOOD_LABELS] },
    arousal: { type: 'NUMBER', description: '-1 calm to 1 energetic' },
    valence: { type: 'NUMBER', description: '-1 dark to 1 bright' },
    words: { type: 'ARRAY', items: { type: 'STRING' }, description: '3 to 6 words for the emotion and vibe' },
    summary: { type: 'STRING', description: 'One or two sentences on how the track feels' },
    sections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          feeling: { type: 'STRING', description: 'A few words on how this section feels' },
          intensity: { type: 'NUMBER', description: '0 to 1, how intense it feels' }
        },
        required: ['index', 'feeling', 'intensity'],
        propertyOrdering: ['index', 'feeling', 'intensity']
      }
    }
  },
  required: ['label', 'arousal', 'valence', 'words', 'summary', 'sections'],
  propertyOrdering: ['label', 'arousal', 'valence', 'words', 'summary', 'sections']
}

export function createMoodListener({ keys, usage, transport, now = () => new Date(), onError = () => {} }: MoodListenerDeps): MoodListen {
  return async ({ trackId, mixdownPath, analysis }) => {
    const apiKey = await keys.get('gemini').catch(() => null)
    if (!apiKey) return null

    let uploaded: UploadedFile | null = null
    try {
      const mimeType = MIME_TYPES[extname(mixdownPath).toLowerCase()] ?? 'audio/wav'
      uploaded = await transport.uploadFile(apiKey, { path: mixdownPath, mimeType, displayName: `elynt-track-${trackId}` })
      const reply = await transport.generateContent(apiKey, GEMINI_MOOD_MODEL, {
        contents: [
          {
            role: 'user',
            parts: [{ fileData: { mimeType: uploaded.mimeType, fileUri: uploaded.uri } }, { text: promptFor(analysis) }]
          }
        ],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }
      })
      logUsage(trackId, reply)
      return parseDetail(reply, analysis)
    } catch (error) {
      onError(error)
      return null
    } finally {
      // Google keeps uploads 48 hours; there's no reason to leave the track there that long.
      if (uploaded) await transport.deleteFile(apiKey, uploaded.name).catch(onError)
    }
  }

  function logUsage(trackId: number, reply: GenerateContentResponse): void {
    const meta = reply.usageMetadata
    if (!meta) return
    const inputTokens = meta.promptTokenCount ?? 0
    const outputTokens = (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0)
    const price = PRICES[GEMINI_MOOD_MODEL] ?? FALLBACK_PRICE
    usage.record({
      calledAt: now().toISOString(),
      tool: 'visualizer',
      trackId,
      releaseId: null,
      tier: 'fast',
      model: GEMINI_MOOD_MODEL,
      inputTokens,
      outputTokens,
      cacheReadTokens: meta.cachedContentTokenCount ?? 0,
      cacheWriteTokens: 0,
      costUsd: (inputTokens * price.input + outputTokens * price.output) / 1_000_000
    })
  }
}

function promptFor(analysis: TrackAnalysis): string {
  const sections = analysis.sections
    .map((s, i) => `${i}. ${s.label}, ${s.start.toFixed(1)}s to ${s.end.toFixed(1)}s`)
    .join('\n')
  return [
    'You are listening to an electronic dance music track so a music visualizer can match its emotion.',
    `It runs ${analysis.durationSeconds.toFixed(0)} seconds at about ${analysis.bpm.toFixed(0)} BPM.`,
    `A quick local read called its mood "${analysis.mood.label}"${analysis.mood.key ? ` in ${analysis.mood.key}` : ''}. Correct it if you hear otherwise.`,
    'The app split it into these sections:',
    sections,
    'Describe how the track feels: pick the closest mood label, rate arousal and valence from -1 to 1,',
    'give 3 to 6 words for its emotion and vibe, a one- or two-sentence summary, and for each section',
    'by its number, a few words on how it feels and how intense it feels from 0 to 1.'
  ].join('\n')
}

const clamp = (n: unknown, lo: number, hi: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null)

/** Reads Gemini's JSON answer. Anything that doesn't fit the shape counts as no answer. */
function parseDetail(reply: GenerateContentResponse, analysis: TrackAnalysis): MoodDetail | null {
  const text = reply.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error(`Gemini sent no mood answer (${reply.promptFeedback?.blockReason ?? reply.candidates?.[0]?.finishReason ?? 'empty'})`)
  const raw = JSON.parse(text) as Record<string, unknown>

  const label = MOOD_LABELS.find((l) => l === raw['label'])
  const arousal = clamp(raw['arousal'], -1, 1)
  const valence = clamp(raw['valence'], -1, 1)
  const summary = typeof raw['summary'] === 'string' ? raw['summary'].trim() : ''
  if (!label || arousal === null || valence === null || !summary) throw new Error('Gemini sent a mood answer in the wrong shape')

  const words = (Array.isArray(raw['words']) ? raw['words'] : [])
    .filter((w): w is string => typeof w === 'string' && w.trim() !== '')
    .map((w) => w.trim())
    .slice(0, 6)
  const sections = (Array.isArray(raw['sections']) ? (raw['sections'] as Record<string, unknown>[]) : [])
    .flatMap((s) => {
      const index = s?.['index']
      const intensity = clamp(s?.['intensity'], 0, 1)
      const feeling = typeof s?.['feeling'] === 'string' ? s['feeling'].trim() : ''
      const valid = Number.isInteger(index) && (index as number) >= 0 && (index as number) < analysis.sections.length
      return valid && feeling && intensity !== null ? [{ index: index as number, feeling, intensity }] : []
    })
    .filter((s, i, all) => all.findIndex((o) => o.index === s.index) === i)
    .sort((a, b) => a.index - b.index)

  return { source: 'gemini', model: GEMINI_MOOD_MODEL, label, arousal, valence, words, summary, sections }
}

