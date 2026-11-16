import { useCallback, useEffect, useState } from 'react'
import type { Preset, PresetLevel, Snapshot, VisionKey } from '../../../shared/vision-history'
import { applyLayerPreset, applyScenePreset, applyVisionPreset, visionPreset, type LayerPreset, type ScenePreset, type VisionPreset } from './presets'
import { LAYER_NAMES } from './scene'
import type { VisionHistory } from './use-vision-history'

const LEVEL_NAMES: Record<PresetLevel, string> = { layer: 'Layer', scene: 'Scene', vision: 'Vision' }

/**
 * Undo and redo (also Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y), named snapshots of this vision, and
 * presets: save the picked section's scene, one of its layers, or the whole vision, and apply
 * any saved one here. Everything applied is an edit, so it can be undone.
 */
export function HistoryPanel({ visionKey, history, section }: { visionKey: VisionKey; history: VisionHistory; section: number }) {
  const { vision } = history
  const index = Math.min(section, vision.sections.length - 1)
  const scene = vision.sections[index]!.scene
  const [error, setError] = useState<string | null>(null)
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) history.undo()
      else if ((key === 'z' && e.shiftKey) || key === 'y') history.redo()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history.undo, history.redo])

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [snapshotName, setSnapshotName] = useState('')
  const loadSnapshots = useCallback(() => {
    window.elynt.visionHistory.listSnapshots(visionKey).then(setSnapshots).catch(fail)
  }, [visionKey])
  useEffect(loadSnapshots, [loadSnapshots])

  const saveSnapshot = async () => {
    setError(null)
    try {
      await history.flush()
      await window.elynt.visionHistory.saveSnapshot(visionKey, snapshotName)
      setSnapshotName('')
      loadSnapshots()
    } catch (e) {
      fail(e)
    }
  }
  const restore = async (id: number) => {
    setError(null)
    try {
      await history.flush()
      history.show(await window.elynt.visionHistory.restoreSnapshot(id))
    } catch (e) {
      fail(e)
    }
  }
  const removeSnapshot = (id: number) => window.elynt.visionHistory.deleteSnapshot(id).then(loadSnapshots).catch(fail)

  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState('')
  const [presetLevel, setPresetLevel] = useState<PresetLevel>('scene')
  const [presetLayer, setPresetLayer] = useState(0)
  const loadPresets = useCallback(() => {
    window.elynt.presets.list().then(setPresets).catch(fail)
  }, [])
  useEffect(loadPresets, [loadPresets])

  const savePreset = async () => {
    setError(null)
    const data =
      presetLevel === 'vision' ? visionPreset(vision) : presetLevel === 'scene' ? scene : scene.layers[Math.min(presetLayer, scene.layers.length - 1)]
    try {
      await window.elynt.presets.save(presetLevel, presetName, data)
      setPresetName('')
      loadPresets()
    } catch (e) {
      fail(e)
    }
  }
  const applyPreset = (preset: Preset) => {
    setError(null)
    try {
      if (preset.level === 'vision') history.setVision(applyVisionPreset(vision, preset.data as VisionPreset))
      else if (preset.level === 'scene') history.setVision(applyScenePreset(vision, index, preset.data as ScenePreset))
      else history.setVision(applyLayerPreset(vision, index, preset.data as LayerPreset))
    } catch (e) {
      fail(e)
    }
  }
  const removePreset = (id: number) => window.elynt.presets.delete(id).then(loadPresets).catch(fail)

  const sectionName = `section ${index + 1} (${vision.sections[index]!.label})`
  return (
    <section className="history-panel" aria-label="History and presets">
      <div className="history-row">
        <button onClick={history.undo} disabled={!history.canUndo}>
          Undo
        </button>
        <button onClick={history.redo} disabled={!history.canRedo}>
          Redo
        </button>
      </div>

      <div className="history-row" aria-label="Snapshots">
        <input placeholder="Snapshot name" value={snapshotName} onChange={(e) => setSnapshotName(e.target.value)} />
        <button onClick={saveSnapshot} disabled={!snapshotName.trim()}>
          Save snapshot
        </button>
      </div>
      {snapshots.length > 0 && (
        <ul className="history-list">
          {snapshots.map((s) => (
            <li key={s.id}>
              <span>{s.name}</span>
              <button className="link" onClick={() => restore(s.id)}>
                Go back to this
              </button>
              <button className="link" onClick={() => removeSnapshot(s.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="history-row" aria-label="Save a preset">
        <select value={presetLevel} onChange={(e) => setPresetLevel(e.target.value as PresetLevel)} aria-label="Preset level">
          <option value="layer">A layer of {sectionName}</option>
          <option value="scene">The scene of {sectionName}</option>
          <option value="vision">The whole vision</option>
        </select>
        {presetLevel === 'layer' && (
          <select value={presetLayer} onChange={(e) => setPresetLayer(Number(e.target.value))} aria-label="Layer">
            {scene.layers.map((l, i) => (
              <option key={i} value={i}>
                {LAYER_NAMES[l.kind]}
              </option>
            ))}
          </select>
        )}
        <input placeholder="Preset name" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
        <button onClick={savePreset} disabled={!presetName.trim()}>
          Save preset
        </button>
      </div>
      {presets.length > 0 && (
        <ul className="history-list">
          {presets.map((p) => (
            <li key={p.id}>
              <span>
                {LEVEL_NAMES[p.level]}: {p.name}
              </span>
              <button className="link" onClick={() => applyPreset(p)}>
                {p.level === 'vision' ? 'Apply to this track' : `Apply to ${sectionName}`}
              </button>
              <button className="link" onClick={() => removePreset(p.id)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}
