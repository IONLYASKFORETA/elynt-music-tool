import type { GoalId } from './profile'
import type { ReleasePlan } from './release-plan'
import type { LostDeadline } from './release-plan-actions'
import type { SubgenreId } from './subgenres'

/** One track put out to the public on a release day (see GLOSSARY.md). Always a single in v1. */
export interface Release {
  id: number
  trackId: number
  trackTitle: string
  /** YYYY-MM-DD. */
  releaseDay: string
  /** The playbook version that built the plan. Kept for the life of the release. */
  playbookVersion: number
  /** Per-release choices that win over the artist profile. Null uses the profile. */
  overrides: ReleaseOverrides
  status: 'active' | 'closed'
  /** ISO 8601 time the release was started. */
  startedAt: string
}

export interface ReleaseOverrides {
  subgenre: SubgenreId | null
  budget: number | null
  goal: GoalId | null
}

export interface ReleaseWithPlan {
  release: Release
  plan: ReleasePlan
}

/** A release as of the owner's today, after any steps that passed were marked missed. */
export interface ReleaseToday extends ReleaseWithPlan {
  /** The owner's local calendar day, YYYY-MM-DD. */
  today: string
  /** Hard deadlines newly missed when the plan was brought up to today; empty most of the time. */
  lost: LostDeadline[]
}

/** What the owner picks to start a release. */
export interface StartRelease {
  trackId: number
  /** YYYY-MM-DD. */
  releaseDay: string
}
