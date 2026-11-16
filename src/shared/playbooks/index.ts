import { parsePlaybook, type Playbook } from '../playbook'
import v1 from './playbook-v1.json'

/**
 * Every playbook version the app has ever shipped, oldest first. Append-only, like the database
 * migrations: a running release reads the steps of the version that built it, so an old version
 * must never be edited or removed. To change the playbook, copy the newest file to the next
 * version and add it here.
 */
export const PLAYBOOKS: readonly Playbook[] = [parsePlaybook(v1)]

/** The playbook new releases are built from: the newest one shipped. */
export function currentPlaybook(): Playbook {
  return PLAYBOOKS.reduce((a, b) => (b.version > a.version ? b : a))
}

export function playbookByVersion(version: number): Playbook | null {
  return PLAYBOOKS.find((p) => p.version === version) ?? null
}
