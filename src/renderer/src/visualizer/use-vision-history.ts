import { useCallback, useEffect, useRef, useState } from 'react'
import type { HistoryState, VisionKey } from '../../../shared/vision-history'
import type { Vision } from './vision'

/** Edits closer together than this (a color dragged, a slider swept) are one step of undo. */
const SETTLE_MS = 400

export interface VisionHistory {
  vision: Vision
  /** Shows an edit straight away and records it for undo once edits settle. */
  setVision(vision: Vision): void
  canUndo: boolean
  canRedo: boolean
  undo(): void
  redo(): void
  /** Shows a state the history store already holds (a restored snapshot, say). */
  show(state: HistoryState): void
  /** Records anything still settling; call before reading the store. */
  flush(): Promise<void>
}

/**
 * The editor's vision, backed by the history store in the main process: the whole vision is
 * recorded on every edit, so anything a vision holds gets undo and survives a restart. A stored
 * vision that no longer fits the track (`fits` says no, e.g. after the sections changed) is
 * replaced by `fresh()`, recorded as an edit, so even that can be undone.
 */
export function useVisionHistory({
  key,
  ready,
  trackShape,
  fresh,
  fits
}: {
  key: VisionKey
  /** False until the track's analysis is in. */
  ready: boolean
  /** Changes when the track's sections or grid change, so the stored vision is checked again. */
  trackShape: string
  fresh: () => Vision
  fits: (v: Vision) => boolean
}): VisionHistory {
  const [vision, setLocal] = useState<Vision>(fresh)
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false })
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; vision: Vision } | null>(null)
  const api = window.elynt.visionHistory

  const apply = useCallback((state: HistoryState) => {
    if (state.vision) setLocal(state.vision as Vision)
    setFlags({ canUndo: state.canUndo, canRedo: state.canRedo })
  }, [])

  const flush = useCallback(async () => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    const state = await api.record(key, withoutCredits(p.vision))
    setFlags({ canUndo: state.canUndo, canRedo: state.canRedo })
  }, [api, key])

  // Load (or start) the stored vision once the track's analysis is in.
  const freshRef = useRef(fresh)
  freshRef.current = fresh
  const fitsRef = useRef(fits)
  fitsRef.current = fits
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    ;(async () => {
      await flush()
      const stored = await api.current(key)
      if (cancelled) return
      if (stored.vision && fitsRef.current(stored.vision as Vision)) apply(stored)
      else {
        const state = await api.record(key, withoutCredits(freshRef.current()))
        if (!cancelled) apply(state)
      }
    })().catch((e: unknown) => console.error('Could not load the vision history:', e))
    return () => {
      cancelled = true
    }
  }, [key, ready, trackShape])

  useEffect(() => () => void flush().catch(() => undefined), [flush])

  const setVision = useCallback(
    (next: Vision) => {
      setLocal(next)
      if (pending.current) clearTimeout(pending.current.timer)
      pending.current = {
        vision: next,
        timer: setTimeout(() => flush().catch((e: unknown) => console.error('Could not record the edit:', e)), SETTLE_MS)
      }
      setFlags({ canUndo: true, canRedo: false })
    },
    [flush]
  )

  const step = useCallback(
    (direction: 'undo' | 'redo') => {
      flush()
        .then(() => api[direction](key))
        .then(apply)
        .catch((e: unknown) => console.error(`Could not ${direction}:`, e))
    },
    [api, key, apply, flush]
  )

  return {
    vision,
    setVision,
    canUndo: flags.canUndo,
    canRedo: flags.canRedo,
    undo: () => step('undo'),
    redo: () => step('redo'),
    show: apply,
    flush
  }
}

/** Credits come from the track and the artist profile, not from edits, so history leaves them out. */
function withoutCredits(vision: Vision): Vision {
  const { credits: _credits, ...rest } = vision
  return rest
}
