import type { PlatformId, SoundCloudPlanId } from './profile'

/**
 * The playbook: the fixed steps and timings the Release Assistant ships with (see GLOSSARY.md).
 * Every dated thing in a release plan comes from here; Claude never invents dates or steps.
 * Each shipped version is a data file in ./playbooks, kept forever so running plans never change.
 */
export interface Playbook {
  /** Goes up by one with every change that ships. A release records the version that built it. */
  version: number
  steps: PlaybookStep[]
}

/** The stages of a release plan, in order. Offsets are days from release day (R). */
export const PHASES = [
  { id: 'prep', name: 'Prep', from: -42, to: -29 },
  { id: 'setup', name: 'Setup', from: -28, to: -15 },
  { id: 'pre-release', name: 'Pre-release', from: -14, to: -1 },
  { id: 'release-day', name: 'Release day', from: 0, to: 0 },
  { id: 'post-release', name: 'Post-release', from: 1, to: 28 }
] as const

export type PhaseId = (typeof PHASES)[number]['id']

/** The platforms and kinds of work a step belongs to; the Board view's rows. */
export const LANES = [
  { id: 'distribution', name: 'Distribution' },
  { id: 'spotify', name: 'Spotify' },
  { id: 'social', name: 'Social' },
  { id: 'outreach', name: 'Outreach' },
  { id: 'soundcloud', name: 'SoundCloud' },
  { id: 'check-ins', name: 'Check-ins' }
] as const

export type LaneId = (typeof LANES)[number]['id']

/** Where a step comes from: a platform's own rule, or a sensible default (folklore). */
export const TAGS = [
  { id: 'rule', name: 'Platform rule' },
  { id: 'thumb', name: 'Rule of thumb' }
] as const

export type TagId = (typeof TAGS)[number]['id']

/** The kinds of text the draft writer makes. A step lists the ones it uses. */
export const DRAFT_KINDS = [
  'track-description',
  'spotify-pitch',
  'caption',
  'video-hook',
  'curator-email',
  'blog-email',
  'dj-promo-email',
  'labelradar-note',
  'bio-short',
  'bio-long'
] as const

export type DraftKind = (typeof DRAFT_KINDS)[number]

/**
 * Rules that start a step, beyond a fixed offset. The plan uses the rule's suggested offset
 * as the step's date, and the step says what to watch for.
 */
export const STEP_RULES = [
  { id: 'in-upcoming', name: 'As soon as the song shows under Upcoming in Spotify for Artists' }
] as const

export type StepRuleId = (typeof STEP_RULES)[number]['id']

/** When a step falls: a fixed day from R, or a rule with the day it is suggested for. */
export type StepWhen = { offset: number } | { rule: StepRuleId; offset: number }

/**
 * What the artist profile must show for a step to apply. Every condition is optional; an empty
 * object means everyone qualifies. Read by the plan engine's eligibility filter.
 */
export interface Eligibility {
  /** At least this many Spotify monthly listeners. */
  minSpotifyMonthlyListeners?: number
  /** At least this many streams in the last 28 days (Marquee, Showcase). */
  minStreamsLast28Days?: number
  /** Only when the owner uses one of these platforms. */
  platforms?: PlatformId[]
  /** Only on one of these SoundCloud plans. */
  soundcloudPlans?: SoundCloudPlanId[]
  /** Only with at least this many dollars to spend on the release. */
  minBudget?: number
  /** Only for EPs and albums; v1 releases are always singles, so these steps never apply. */
  notForSingles?: boolean
}

export interface PlaybookStep {
  /** Stable across playbook versions while the step means the same thing. */
  id: string
  phase: PhaseId
  lane: LaneId
  when: StepWhen
  /** Shown in red: missing it costs real reach. */
  hardDeadline: boolean
  tag: TagId
  /** A short name for lists. */
  title: string
  what: string
  why: string
  how: string
  eligibility: Eligibility
  draftKinds: DraftKind[]
  /** Steps that must happen first; if one is lost, this one no longer makes sense. */
  dependsOn: string[]
}

/** The phase a day from R falls in, or null outside the plan (before R−42 or after R+28). */
export function phaseOfOffset(offset: number): PhaseId | null {
  return PHASES.find((p) => offset >= p.from && offset <= p.to)?.id ?? null
}

/** "R−21", "R", "R+14". */
export function formatOffset(offset: number): string {
  return offset === 0 ? 'R' : offset < 0 ? `R−${-offset}` : `R+${offset}`
}

/**
 * Reads a playbook data file and checks it holds together, so a bad edit fails in the tests and
 * at startup rather than in a running plan. Throws with the step and field that are wrong.
 */
export function parsePlaybook(raw: unknown): Playbook {
  const file = raw as { version?: unknown; steps?: unknown }
  if (!Number.isInteger(file?.version) || (file.version as number) < 1) {
    throw new Error('A playbook needs a version that is a whole number of 1 or more')
  }
  if (!Array.isArray(file.steps)) throw new Error('A playbook needs a list of steps')

  const steps = file.steps.map(parseStep)
  const ids = new Set<string>()
  for (const s of steps) {
    if (ids.has(s.id)) throw new Error(`Two steps share the id "${s.id}"`)
    ids.add(s.id)
  }
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      if (!ids.has(dep)) throw new Error(`Step "${s.id}" depends on "${dep}", which is not in the playbook`)
    }
  }
  return { version: file.version as number, steps }
}

function parseStep(raw: unknown): PlaybookStep {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = typeof r.id === 'string' && r.id ? r.id : null
  if (!id) throw new Error('Every playbook step needs an id')
  const fail = (field: string, detail = ''): never => {
    throw new Error(`Step "${id}" has a bad ${field}${detail ? `: ${detail}` : ''}`)
  }
  const oneOf = <T extends string>(value: unknown, options: ReadonlyArray<{ id: string }>, field: string): T =>
    options.some((o) => o.id === value) ? (value as T) : fail(field, String(value))
  const text = (field: 'title' | 'what' | 'why' | 'how'): string =>
    typeof r[field] === 'string' && (r[field] as string).trim() ? (r[field] as string) : fail(field, 'missing')

  const phase = oneOf<PhaseId>(r.phase, PHASES, 'phase')
  const when = (r.when ?? {}) as { offset?: unknown; rule?: unknown }
  if (!Number.isInteger(when.offset)) fail('offset', 'missing')
  const offset = when.offset as number
  if (phaseOfOffset(offset) !== phase) {
    fail('phase', `${formatOffset(offset)} is in ${phaseOfOffset(offset) ?? 'no phase'}, not ${phase}`)
  }
  const parsedWhen: StepWhen =
    when.rule === undefined ? { offset } : { rule: oneOf<StepRuleId>(when.rule, STEP_RULES, 'rule'), offset }

  const draftKinds = Array.isArray(r.draftKinds) ? r.draftKinds : fail('draft kind list')
  for (const k of draftKinds) if (!DRAFT_KINDS.includes(k as DraftKind)) fail('draft kind', String(k))
  const dependsOn = Array.isArray(r.dependsOn) ? r.dependsOn : fail('dependsOn list')

  return {
    id,
    phase,
    lane: oneOf<LaneId>(r.lane, LANES, 'lane'),
    when: parsedWhen,
    hardDeadline: r.hardDeadline === true,
    tag: oneOf<TagId>(r.tag, TAGS, 'tag'),
    title: text('title'),
    what: text('what'),
    why: text('why'),
    how: text('how'),
    eligibility: (r.eligibility ?? {}) as Eligibility,
    draftKinds: draftKinds as DraftKind[],
    dependsOn: dependsOn.map(String)
  }
}
