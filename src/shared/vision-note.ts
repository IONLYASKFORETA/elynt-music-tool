/**
 * A note from the editor's note box (V14): the owner types something like "make the drop
 * angrier" at a scope and Claude answers with a change set for that scope. The window builds
 * the request from the vision and the layer library; the main process makes the call.
 */
export interface VisionNoteRequest {
  /** The track the note is about, for the cost log. */
  trackId?: number
  system: string
  /** The note and the vision data at its scope. */
  prompt: string
  /** The change set's JSON schema, which only offers the changes the scope allows. */
  schema: Record<string, unknown>
}

/** What Claude sends back. The changes are unchecked until the window applies them. */
export interface VisionNoteReply {
  /** One line for the owner on what Claude changed. */
  summary: string
  changes: unknown[]
}

export type VisionNoteResult = { ok: true; reply: VisionNoteReply } | { ok: false; message: string }
