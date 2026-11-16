/**
 * What the Live Set reader (M1) read from an Ableton Live .als file.
 * Produced by the helper's `liveset.read` (helper/src/elynt_helper/live_set.py). Keep the two in step.
 *
 * The .als format has no published spec, so anything the reader could not find is the string 'unknown'.
 */

export type Unknown = 'unknown'

/** An automatable value as stored in the Set, with its range. Switches range false to true. */
export interface LiveParameter {
  value: number | boolean | Unknown
  min: number | boolean | Unknown
  max: number | boolean | Unknown
}

export type RoutingKind = 'main' | 'group' | 'track' | 'external' | 'none' | Unknown

export interface LiveRouting {
  /** Live's raw target, e.g. "AudioOut/Main", "AudioOut/GroupTrack", "AudioIn/Track.8/PostFxOut". */
  target: string
  /** What Live shows in the chooser, e.g. "1-Kick Post FX". */
  display: string
  kind: RoutingKind
  /** For 'group' and 'track': the Live track it points at. */
  trackId?: number
  trackName?: string
}

export interface LiveSend {
  value: LiveParameter
  /** -inf at Live's floor. */
  db: number | '-inf' | Unknown
  active: boolean | Unknown
  returnId: number | Unknown
  returnName: string
}

export interface LiveMixer {
  /** Linear gain: 1 is 0 dB. */
  volume: LiveParameter
  volumeDb: number | '-inf' | Unknown
  /** -1 (left) to 1 (right). */
  pan: LiveParameter
  muted: boolean | Unknown
  soloed: boolean | Unknown
  /** One per return track, in return order. */
  sends: LiveSend[]
}

export interface RackBranch {
  name: string
  devices: LiveDevice[]
}

export interface NativeDevice {
  /** The XML tag, e.g. Eq8, Compressor2, AudioEffectGroupDevice. */
  type: string
  kind: 'native' | 'rack'
  /** The name the owner gave it, else Live's name for the device. */
  name: string
  on: boolean | Unknown
  /** Every stored setting, keyed by its path inside the device ("Bands.0/ParameterA/Freq"). */
  parameters: Record<string, LiveParameter>
  sidechain?: LiveRouting & { on: boolean | Unknown }
  /** Racks only, in order. */
  branches?: RackBranch[]
  /** Drum Racks only: their own return chains. */
  returnBranches?: RackBranch[]
}

/** A third-party plug-in or a Max for Live device: name and ID only. */
export interface OpaqueDevice {
  type: string
  kind: 'plugin' | 'max'
  name: string
  on: boolean | Unknown
  plugin: { format: 'vst2' | 'vst3' | 'au' | 'max' | Unknown; name: string; id: string }
}

export type LiveDevice = NativeDevice | OpaqueDevice

export interface LiveTrack {
  id: number | Unknown
  kind: 'audio' | 'midi' | 'group' | 'return' | 'main'
  name: string
  /** The GroupTrack this Live track sits in, or null at the top level. */
  groupId: number | null | Unknown
  output: LiveRouting
  mixer: LiveMixer
  /** In signal order. */
  devices: LiveDevice[]
}

export interface LiveSet {
  path: string
  /** e.g. "Ableton Live 12.1.5". */
  creator: string
  /** e.g. "12.0_12117". */
  minorVersion: string
  /** 10, 11 or 12. */
  liveVersion: number | Unknown
  /** Audio, MIDI and group tracks in Live's order. */
  tracks: LiveTrack[]
  returns: LiveTrack[]
  /** MasterTrack (Live 11 and earlier) or MainTrack (Live 12). */
  main: LiveTrack | Unknown
}
