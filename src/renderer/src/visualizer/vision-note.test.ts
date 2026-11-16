import { describe, expect, it } from 'vitest'
import type { Section } from '../../../shared/analysis'
import { ClaudeError, createFakeClaudeClient, MESSAGES } from '../../../main/claude'
import { askVisionNote } from '../../../main/visualizer/vision-note'
import { applyChangeSet, controlValue } from './controls'
import calmerVideo from './note-replies/calmer-video.json'
import dropAngrier from './note-replies/drop-angrier.json'
import { defaultVision } from './vision'
import { noteRequest } from './vision-note'

const section = (label: Section['label'], start: number, end: number): Section => ({
  label,
  start,
  end,
  startBar: 0,
  confidence: 1,
  source: 'heuristic'
})
const vision = defaultVision([section('intro', 0, 16), section('build', 16, 32), section('drop', 32, 64), section('outro', 64, 80)], 80)
const DROP = { kind: 'section' as const, section: 2 }

/** The ops a request's schema lets Claude send. */
const ops = (schema: Record<string, unknown>): string[] => {
  const changes = (schema.properties as Record<string, { items: { anyOf: { properties: { op: { enum: string[] } } }[] } }>).changes!
  return changes.items.anyOf.flatMap((v) => v.properties.op.enum)
}

describe('noteRequest', () => {
  it('sends the note and the vision data at its scope only', () => {
    const request = noteRequest(vision, DROP, 'make the drop angrier', 7)
    expect(request.trackId).toBe(7)
    expect(request.prompt).toContain('make the drop angrier')
    expect(request.prompt).toContain('"label": "drop"')
    expect(request.prompt).not.toContain('"label": "intro"')
  })

  it('offers Claude only the changes its scope allows', () => {
    expect(ops(noteRequest(vision, { kind: 'video' }, 'x', 1).schema).sort()).toEqual(
      ['addLayer', 'palette', 'reactTo', 'removeLayer', 'set', 'transition'].sort()
    )
    expect(ops(noteRequest(vision, DROP, 'x', 1).schema).sort()).toEqual(['addLayer', 'reactTo', 'removeLayer', 'set', 'transition'].sort())
    expect(ops(noteRequest(vision, { kind: 'layer', section: 2, layer: 1 }, 'x', 1).schema).sort()).toEqual(['reactTo', 'set'])
  })

  it("leaves out the last section's transition, which hands over to nothing", () => {
    expect(ops(noteRequest(vision, { kind: 'section', section: 3 }, 'x', 1).schema)).not.toContain('transition')
  })
})

describe('a note, replayed at the seam', () => {
  it('turns "make the drop angrier" into changes to the drop only', async () => {
    const claude = createFakeClaudeClient(dropAngrier)
    const request = noteRequest(vision, DROP, 'make the drop angrier', 7)
    const result = await askVisionNote(claude, request)
    expect(claude.calls[0]).toMatchObject({ tool: 'visualizer', trackId: 7, schema: request.schema, prompt: request.prompt })
    if (!result.ok) throw new Error(result.message)
    expect(result.reply.summary).toMatch(/drop/)

    const applied = applyChangeSet(vision, DROP, result.reply.changes)
    const drop = applied.vision.sections[2]!
    expect(drop.intensity).toBe(1.6)
    expect(drop.scene.layers.map((l) => l.kind)).toEqual(['ground', 'classic', 'glitch', 'finish'])
    expect(controlValue(applied.vision, { section: 2, layer: 2 }, 'split')).toBe(9)
    expect(drop.scene.layers[1]!.reactivity.reactsTo).toBe('kickSnare')
    // The build's transition is outside the drop, so it is left out.
    expect(applied.rejected).toHaveLength(1)
    expect(applied.vision.sections[1]).toBe(vision.sections[1])
  })

  it('turns a video note into changes anywhere', async () => {
    const result = await askVisionNote(createFakeClaudeClient(calmerVideo), noteRequest(vision, { kind: 'video' }, 'calmer, colder', 7))
    if (!result.ok) throw new Error(result.message)
    const applied = applyChangeSet(vision, { kind: 'video' }, result.reply.changes)
    expect(applied.rejected).toEqual([])
    expect(applied.vision.intensity).toBe(0.6)
    expect(applied.vision.palette).toEqual(['#1b2a6b', '#3fb8ff', '#e0f7ff'])
    expect(applied.vision.sections[2]!.transition).toBe('bleedWash')
  })

  it("passes on Claude's failure as a message the owner can read", async () => {
    const result = await askVisionNote(createFakeClaudeClient(new ClaudeError('no-key', MESSAGES.noKey)), noteRequest(vision, DROP, 'x', 7))
    expect(result).toEqual({ ok: false, message: MESSAGES.noKey })
  })

  it('treats a reply without a change list as bad output', async () => {
    const result = await askVisionNote(createFakeClaudeClient({ summary: 'done' }), noteRequest(vision, DROP, 'x', 7))
    expect(result).toEqual({ ok: false, message: MESSAGES.badOutput })
  })
})
