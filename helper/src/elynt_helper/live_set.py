"""The Live Set reader (M1): what an Ableton Live .als file says about a mix.

An .als is gzipped XML with no published spec, so every element is looked up by path and anything missing or
unexpected comes back as UNKNOWN. Reading a Set never throws on its contents; only a file that is not a Live Set at
all (not gzip, not XML, no <Ableton><LiveSet>) is an error.
"""

from __future__ import annotations

import gzip
import math
import re
import sys
import xml.etree.ElementTree as ET
import zlib
from typing import Any

UNKNOWN = "unknown"

TRACK_KINDS = {"AudioTrack": "audio", "MidiTrack": "midi", "GroupTrack": "group", "ReturnTrack": "return"}

# Live's mixer and send floor: 0.0003162 linear gain is -70 dB, which Live shows as -inf.
GAIN_FLOOR = 0.000317


class NotALiveSet(Exception):
    """The file can't be read as a Live Set at all."""


def read_live_set(path: str) -> dict[str, Any]:
    root = _load(path)
    live_set = root.find("LiveSet")
    if root.tag != "Ableton" or live_set is None:
        raise NotALiveSet(f"{path} is XML but not an Ableton Live Set")

    creator = root.get("Creator") or UNKNOWN
    minor_version = root.get("MinorVersion") or UNKNOWN
    print(f"liveset.read: Creator={creator!r} MinorVersion={minor_version!r} path={path!r}", file=sys.stderr)

    tracks: list[dict[str, Any]] = []
    returns: list[dict[str, Any]] = []
    for element in _children(live_set, "Tracks"):
        kind = TRACK_KINDS.get(element.tag)
        if kind is None:
            continue
        (returns if kind == "return" else tracks).append(_track(element, kind))

    # Live 11 and earlier call it MasterTrack; Live 12 renamed it MainTrack.
    main_element = live_set.find("MainTrack")
    if main_element is None:
        main_element = live_set.find("MasterTrack")
    main = _track(main_element, "main") if main_element is not None else UNKNOWN

    every = [*tracks, *returns, *([main] if isinstance(main, dict) else [])]
    _resolve_sends(every, returns)
    _name_routed_tracks(every)

    return {
        "path": path,
        "creator": creator,
        "minorVersion": minor_version,
        "liveVersion": _live_version(creator, minor_version),
        "tracks": tracks,
        "returns": returns,
        "main": main,
    }


# --- reading the file -------------------------------------------------------------------------------------------


def _load(path: str) -> ET.Element:
    try:
        with gzip.open(path, "rb") as f:
            data = f.read()
    except (OSError, EOFError, zlib.error) as e:  # gzip raises BadGzipFile (an OSError) on a non-gzip file
        raise NotALiveSet(f"{path} is not a gzipped Live Set: {e}") from e
    try:
        return ET.fromstring(data)
    except ET.ParseError as e:
        raise NotALiveSet(f"{path} is not valid XML: {e}") from e


def _children(element: ET.Element | None, path: str) -> list[ET.Element]:
    found = element.find(path) if element is not None else None
    return list(found) if found is not None else []


def _find(element: ET.Element | None, path: str) -> ET.Element | None:
    return element.find(path) if element is not None else None


def _value(element: ET.Element | None, path: str) -> str | None:
    """The Value attribute at `path` under `element`, or None if anything on the way is missing."""
    found = _find(element, path)
    return found.get("Value") if found is not None else None


def _int(text: str | None) -> int | str:
    try:
        return int(text) if text is not None else UNKNOWN
    except ValueError:
        return UNKNOWN


def _number(text: str | None) -> float | str:
    try:
        number = float(text) if text is not None else None
    except ValueError:
        return UNKNOWN
    return number if number is not None and math.isfinite(number) else UNKNOWN


def _bool(text: str | None) -> bool | str:
    if text == "true":
        return True
    if text == "false":
        return False
    return UNKNOWN


def _live_version(creator: str, minor_version: str) -> int | str:
    """The Live major version (10, 11, 12), from Creator ("Ableton Live 12.1.5") or MinorVersion ("12.0_12117")."""
    for text, pattern in ((creator, r"Live (\d+)"), (minor_version, r"^(\d+)\.")):
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    return UNKNOWN


# --- values -----------------------------------------------------------------------------------------------------


def _gain_db(value: Any) -> float | str:
    """Live stores fader and send levels as linear gain (1.0 is 0 dB)."""
    if isinstance(value, bool) or not isinstance(value, float):
        return UNKNOWN
    if value <= GAIN_FLOOR:
        return "-inf"
    return round(20 * math.log10(value), 2)


def _parameter(element: ET.Element | None) -> dict[str, Any]:
    """An automatable value as {"value", "min", "max"}, each UNKNOWN when it isn't stored.

    On/off switches have no stored range, so theirs is false to true. Choosers (a filter type, a model) store
    neither a range nor their option names, so those stay UNKNOWN.
    """
    raw = _value(element, "Manual")
    flag = _bool(raw)
    if isinstance(flag, bool):
        return {"value": flag, "min": False, "max": True}
    return {
        "value": _number(raw),
        "min": _number(_value(element, "MidiControllerRange/Min")),
        "max": _number(_value(element, "MidiControllerRange/Max")),
    }


def _routing(element: ET.Element | None, group_id: int | None = None) -> dict[str, Any]:
    """Where a routing chooser points: the raw Target, Live's label for it, and what kind of place that is.

    Targets seen in real Sets: AudioOut/Master (Live 11), AudioOut/Main (Live 12), AudioOut/GroupTrack,
    AudioOut/Track.13/TrackIn, AudioIn/Track.8/PostFxOut (a sidechain), AudioOut/External/S0, AudioOut/None.
    """
    target = _value(element, "Target")
    if target is None:
        return {"target": UNKNOWN, "display": UNKNOWN, "kind": UNKNOWN}
    display = " ".join(part for part in (_value(element, "UpperDisplayString"), _value(element, "LowerDisplayString")) if part)
    routing: dict[str, Any] = {"target": target, "display": display, "kind": UNKNOWN}
    rest = target.partition("/")[2]
    if rest in ("Master", "Main"):
        routing["kind"] = "main"
    elif rest == "GroupTrack":
        routing["kind"] = "group"
        if group_id is not None:
            routing["trackId"] = group_id
    elif rest == "None":
        routing["kind"] = "none"
    elif rest.startswith("External"):
        routing["kind"] = "external"
    else:
        match = re.match(r"Track\.(\d+)(?:/|$)", rest)
        if match:
            routing["kind"] = "track"
            routing["trackId"] = int(match.group(1))
    return routing


# --- Live tracks ------------------------------------------------------------------------------------------------


def _track(element: ET.Element, kind: str) -> dict[str, Any]:
    name = _value(element, "Name/EffectiveName") or _value(element, "Name/UserName")
    group = _int(_value(element, "TrackGroupId"))
    group_id = group if isinstance(group, int) and group >= 0 else None
    chain = element.find("DeviceChain")
    return {
        "id": _int(element.get("Id")) if kind != "main" else UNKNOWN,
        "kind": kind,
        "name": name if name else ("Main" if kind == "main" else UNKNOWN),
        # The Id of the GroupTrack this Live track sits in, None at the top level.
        "groupId": group_id if group != UNKNOWN or kind == "main" else UNKNOWN,
        "output": _routing(_find(chain, "AudioOutputRouting"), group_id),
        "mixer": _mixer(_find(chain, "Mixer")),
        # A track's own devices sit one DeviceChain deeper than its mixer and routing.
        "devices": _devices(_find(chain, "DeviceChain/Devices")),
    }


def _mixer(element: ET.Element | None) -> dict[str, Any]:
    volume = _parameter(_find(element, "Volume"))
    speaker = _bool(_value(element, "Speaker/Manual"))
    sends = []
    for holder in _children(element, "Sends"):
        send = _parameter(holder.find("Send"))
        sends.append({"value": send, "db": _gain_db(send["value"]), "active": _bool(_value(holder, "Active"))})
    return {
        "volume": volume,
        "volumeDb": _gain_db(volume["value"]),
        "pan": _parameter(_find(element, "Pan")),
        # Speaker is the track activator button: off means muted.
        "muted": (not speaker) if isinstance(speaker, bool) else UNKNOWN,
        "soloed": _bool(_value(element, "SoloSink")),
        "sends": sends,
    }


# --- devices ----------------------------------------------------------------------------------------------------

# The names Live shows for its own devices, by XML tag. A tag not listed here is still read; it is named by its tag.
NATIVE_NAMES = {
    "Eq8": "EQ Eight",
    "FilterEQ3": "EQ Three",
    "ChannelEq": "Channel EQ",
    "Compressor2": "Compressor",
    "GlueCompressor": "Glue Compressor",
    "MultibandDynamics": "Multiband Dynamics",
    "Limiter": "Limiter",
    "Gate": "Gate",
    "StereoGain": "Utility",
    "Saturator": "Saturator",
    "DrumBuss": "Drum Buss",
    "Roar": "Roar",
    "Overdrive": "Overdrive",
    "Pedal": "Pedal",
    "Redux2": "Redux",
    "Erosion": "Erosion",
    "Vinyl": "Vinyl Distortion",
    "Amp": "Amp",
    "Cabinet": "Cabinet",
    "Reverb": "Reverb",
    "Hybrid": "Hybrid Reverb",
    "Delay": "Delay",
    "Echo": "Echo",
    "FilterDelay": "Filter Delay",
    "PingPongDelay": "Ping Pong Delay",
    "CrossDelay": "Simple Delay",
    "GrainDelay": "Grain Delay",
    "AutoFilter": "Auto Filter",
    "AutoPan": "Auto Pan",
    "Chorus2": "Chorus-Ensemble",
    "PhaserNew": "Phaser-Flanger",
    "Phaser": "Phaser",
    "Flanger": "Flanger",
    "FrequencyShifter": "Frequency Shifter",
    "Shifter": "Shifter",
    "BeatRepeat": "Beat Repeat",
    "Looper": "Looper",
    "Corpus": "Corpus",
    "Resonator": "Resonators",
    "Vocoder": "Vocoder",
    "SpectrumAnalyzer": "Spectrum",
    "Tuner": "Tuner",
    "OriginalSimpler": "Simpler",
    "MultiSampler": "Sampler",
    "InstrumentVector": "Wavetable",
    "Operator": "Operator",
    "UltraAnalog": "Analog",
    "Drift": "Drift",
    "Collision": "Collision",
    "LoungeLizard": "Electric",
    "StringStudio": "Tension",
    "InstrumentImpulse": "Impulse",
    "AudioEffectGroupDevice": "Audio Effect Rack",
    "InstrumentGroupDevice": "Instrument Rack",
    "DrumGroupDevice": "Drum Rack",
    "MidiEffectGroupDevice": "MIDI Effect Rack",
    "MidiArpeggiator": "Arpeggiator",
    "MidiChord": "Chord",
    "MidiNoteLength": "Note Length",
    "MidiPitcher": "Pitch",
    "MidiRandom": "Random",
    "MidiScale": "Scale",
    "MidiVelocity": "Velocity",
}

RACKS = {"AudioEffectGroupDevice", "InstrumentGroupDevice", "DrumGroupDevice", "MidiEffectGroupDevice"}

# Parts of a device that hold no settings of its own (or, for racks, hold the devices inside).
NOT_PARAMETERS = {
    "Branches",
    "ReturnBranches",
    "DeviceChain",
    "Pointee",
    "LastPresetRef",
    "SourceContext",
    "SignalModulations",
    "ParametersListWrapper",
    "BranchesListWrapper",
    "ReturnBranchesListWrapper",
    "MacroVariations",
    "MacroAnnotations",
    "AutomationTarget",
    "ModulationTarget",
    "LockedScripts",
}


def _devices(element: ET.Element | None) -> list[dict[str, Any]]:
    """A chain's devices, in signal order (the XML keeps them in the order they sit in Live)."""
    return [_device(d) for d in element] if element is not None else []


PLUGIN_HOSTS = {"PluginDevice", "AuPluginDevice"}
MAX_DEVICES = {"MxDeviceAudioEffect", "MxDeviceMidiEffect", "MxDeviceInstrument"}


def _device(element: ET.Element) -> dict[str, Any]:
    tag = element.tag
    user_name = _value(element, "UserName")
    if tag in PLUGIN_HOSTS or tag in MAX_DEVICES:
        return _opaque_device(element, user_name)
    device: dict[str, Any] = {
        "type": tag,
        "kind": "rack" if tag in RACKS else "native",
        "name": user_name or NATIVE_NAMES.get(tag, tag),
        "on": _bool(_value(element, "On/Manual")),
        "parameters": _parameters(element),
    }
    side_chain = element.find("SideChain")
    if side_chain is not None:
        device["sidechain"] = _sidechain(side_chain)
    if tag in RACKS:
        device["branches"] = [_branch(b) for b in _children(element, "Branches")]
        # A Drum Rack can have its own return chains, fed by sends on its pads.
        if element.find("ReturnBranches") is not None:
            device["returnBranches"] = [_branch(b) for b in _children(element, "ReturnBranches")]
    return device


def _opaque_device(element: ET.Element, user_name: str | None) -> dict[str, Any]:
    """A third-party plug-in or a Max for Live device: who it is, not how it's set.

    A plug-in's real state is a binary chunk only the plug-in can read, so no parameters are listed.
    """
    if element.tag in MAX_DEVICES:
        patch = _value(element, "PatchSlot/Value/MxDPatchRef/FileRef/RelativePath") or _value(
            element, "PatchSlot/Value/MxDPatchRef/FileRef/Path"
        )
        patch_name = re.sub(r"\.amxd$", "", patch.replace("\\", "/").rsplit("/", 1)[-1]) if patch else None
        plugin = {"format": "max", "name": patch_name or UNKNOWN, "id": patch or UNKNOWN}
    else:
        plugin = _plugin_identity(element.find("PluginDesc"))
    name = user_name or plugin["name"]
    return {
        "type": element.tag,
        "kind": "max" if element.tag in MAX_DEVICES else "plugin",
        "name": name,
        "on": _bool(_value(element, "On/Manual")),
        "plugin": plugin,
    }


def _plugin_identity(desc: ET.Element | None) -> dict[str, Any]:
    """Name and ID from a PluginDesc: VST3 (Name, Uid as four int32 fields), VST2 (PlugName, UniqueId) or AU."""
    vst3 = _find(desc, "Vst3PluginInfo")
    if vst3 is not None:
        fields = [_int(_value(vst3, f"Uid/Fields.{i}")) for i in range(4)]
        uid = "-".join(f"{f & 0xFFFFFFFF:08X}" for f in fields) if all(isinstance(f, int) for f in fields) else UNKNOWN
        return {"format": "vst3", "name": _value(vst3, "Name") or UNKNOWN, "id": uid}
    vst2 = _find(desc, "VstPluginInfo")
    if vst2 is not None:
        return {
            "format": "vst2",
            "name": _value(vst2, "PlugName") or UNKNOWN,
            "id": _value(vst2, "UniqueId") or UNKNOWN,
        }
    au = _find(desc, "AuPluginInfo")
    if au is not None:
        parts = [_value(au, k) for k in ("ComponentType", "ComponentSubType", "ComponentManufacturer")]
        return {
            "format": "au",
            "name": _value(au, "Name") or UNKNOWN,
            "id": "-".join(parts) if all(parts) else UNKNOWN,  # type: ignore[arg-type]
        }
    return {"format": UNKNOWN, "name": UNKNOWN, "id": UNKNOWN}


def _parameters(device: ET.Element) -> dict[str, dict[str, Any]]:
    """Every stored setting of a native device, keyed by its path inside the device ("Bands.0/ParameterA/Freq")."""
    found: dict[str, dict[str, Any]] = {}

    def walk(element: ET.Element, prefix: str) -> None:
        for child in element:
            if child.tag in NOT_PARAMETERS:
                continue
            path = f"{prefix}{child.tag}"
            if child.find("Manual") is not None:
                found[path] = _parameter(child)
            elif len(child):
                walk(child, path + "/")

    walk(device, "")
    return found


def _sidechain(element: ET.Element) -> dict[str, Any]:
    """A device's sidechain input: whether it's on and which Live track feeds it."""
    routable = element.find("RoutedInput/Routable")
    if routable is None:  # unexpected shape: take the first routing chooser inside
        routable = next((e for e in element.iter() if e.find("Target") is not None), None)
    return {"on": _bool(_value(element, "OnOff/Manual")), **_routing(routable)}


def _branch(element: ET.Element) -> dict[str, Any]:
    """One chain of a rack. Its devices sit in DeviceChain/<AudioToAudio|MidiToAudio|MidiToMidi>DeviceChain/Devices."""
    name = _value(element, "Name/EffectiveName") or _value(element, "Name/UserName") or _value(element, "Name")
    devices = None
    for inner in _children(element, "DeviceChain"):
        devices = inner.find("Devices")
        if devices is not None:
            break
    return {"name": name or UNKNOWN, "devices": _devices(devices)}


def _name_routed_tracks(tracks: list[dict[str, Any]]) -> None:
    """Adds trackName next to every trackId in output and sidechain routing, wherever the device sits."""
    names = {t["id"]: t["name"] for t in tracks if isinstance(t["id"], int)}

    def name(routing: dict[str, Any]) -> None:
        if "trackId" in routing:
            routing["trackName"] = names.get(routing["trackId"], UNKNOWN)

    def walk(devices: list[dict[str, Any]]) -> None:
        for d in devices:
            if "sidechain" in d:
                name(d["sidechain"])
            for branch in [*d.get("branches", []), *d.get("returnBranches", [])]:
                walk(branch["devices"])

    for t in tracks:
        name(t["output"])
        walk(t["devices"])


def _resolve_sends(tracks: list[dict[str, Any]], returns: list[dict[str, Any]]) -> None:
    """Sends are stored in return-track order; name each one after its return."""
    for t in tracks:
        for index, send in enumerate(t["mixer"]["sends"]):
            target = returns[index] if index < len(returns) else None
            send["returnId"] = target["id"] if target else UNKNOWN
            send["returnName"] = target["name"] if target else UNKNOWN
