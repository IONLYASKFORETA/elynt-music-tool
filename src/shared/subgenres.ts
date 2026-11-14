/**
 * The suite-wide subgenre list (see GLOSSARY.md: Subgenre).
 *
 * One source for every tool: the artist profile, Mix & Master per-track setup
 * and release overrides all pick from here, so the tools agree on what the
 * music is. Ids are stored in the database, so never rename or remove one;
 * add new entries instead.
 */
export const SUBGENRES = [
  { id: 'house', name: 'House' },
  { id: 'tech-house', name: 'Tech house' },
  { id: 'deep-house', name: 'Deep house' },
  { id: 'progressive-house', name: 'Progressive house' },
  { id: 'future-house', name: 'Future house' },
  { id: 'bass-house', name: 'Bass house' },
  { id: 'techno', name: 'Techno' },
  { id: 'melodic-techno', name: 'Melodic techno' },
  { id: 'trance', name: 'Trance' },
  { id: 'dubstep', name: 'Dubstep' },
  { id: 'riddim', name: 'Riddim' },
  { id: 'melodic-dubstep', name: 'Melodic dubstep' },
  { id: 'future-bass', name: 'Future bass' },
  { id: 'drum-and-bass', name: 'Drum & bass' },
  { id: 'liquid-dnb', name: 'Liquid DnB' },
  { id: 'trap', name: 'Trap (EDM)' },
  { id: 'hardstyle', name: 'Hardstyle' },
  { id: 'uk-garage', name: 'UK garage' },
  { id: 'breakbeat', name: 'Breakbeat' },
  { id: 'electro', name: 'Electro' },
  { id: 'hyperpop', name: 'Hyperpop' },
  { id: 'phonk', name: 'Phonk' }
] as const

export type SubgenreId = (typeof SUBGENRES)[number]['id']

const ids: ReadonlySet<string> = new Set(SUBGENRES.map((s) => s.id))

export function isSubgenreId(value: unknown): value is SubgenreId {
  return typeof value === 'string' && ids.has(value)
}

export function subgenreName(id: SubgenreId): string {
  return SUBGENRES.find((s) => s.id === id)!.name
}

/** One main subgenre plus up to this many more. */
export const MAX_OTHER_SUBGENRES = 2

export interface SubgenreChoice {
  main: SubgenreId | null
  others: SubgenreId[]
}

/**
 * Applies one click on a subgenre chip.
 * - No main yet: the clicked subgenre becomes the main.
 * - Clicking the main clears it, and the first other (if any) moves up.
 * - Clicking an other removes it.
 * - Otherwise it is added as an other, unless two are already picked.
 */
export function toggleSubgenre(choice: SubgenreChoice, id: SubgenreId): SubgenreChoice {
  if (choice.main === id) {
    const [next = null, ...rest] = choice.others
    return { main: next, others: rest }
  }
  if (choice.others.includes(id)) {
    return { main: choice.main, others: choice.others.filter((o) => o !== id) }
  }
  if (choice.main === null) return { main: id, others: choice.others }
  if (choice.others.length >= MAX_OTHER_SUBGENRES) return choice
  return { main: choice.main, others: [...choice.others, id] }
}

/** Makes `id` the main subgenre; the old main becomes an other if there is room. */
export function makeMainSubgenre(choice: SubgenreChoice, id: SubgenreId): SubgenreChoice {
  if (choice.main === id) return choice
  const others = choice.others.filter((o) => o !== id)
  if (choice.main !== null) others.unshift(choice.main)
  return { main: id, others: others.slice(0, MAX_OTHER_SUBGENRES) }
}
