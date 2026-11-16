import type { VisionNoteReply, VisionNoteRequest, VisionNoteResult } from '../../shared/vision-note'
import { ClaudeError, MESSAGES, type ClaudeClient } from '../claude'

/**
 * Sends a note from the editor's note box (V14) to Claude and returns its change set, unchecked:
 * the window checks it against the layer library as it applies it. Never throws; a failure
 * comes back as a message the owner can read.
 */
export async function askVisionNote(claude: ClaudeClient, request: VisionNoteRequest): Promise<VisionNoteResult> {
  try {
    const reply = await claude.json<VisionNoteReply>({
      tool: 'visualizer',
      // A note is a small, interactive edit: the fast tier keeps the preview waiting briefly.
      tier: 'fast',
      trackId: request.trackId,
      system: request.system,
      prompt: request.prompt,
      schema: request.schema,
      maxTokens: 4_000
    })
    if (typeof reply?.summary !== 'string' || !Array.isArray(reply.changes)) return { ok: false, message: MESSAGES.badOutput }
    return { ok: true, reply: { summary: reply.summary, changes: reply.changes } }
  } catch (error) {
    return { ok: false, message: error instanceof ClaudeError ? error.message : String(error) }
  }
}
