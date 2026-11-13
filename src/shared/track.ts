/** One song by the owner: the unit every tool works on (see GLOSSARY.md). */
export interface Track {
  id: number
  title: string
  /** Where the mixdown sits on disk. The database never holds the audio itself. */
  mixdownPath: string
  /** ISO 8601 time the track was added. */
  addedAt: string
}
