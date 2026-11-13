# What can be read from an Ableton Live 12 project file?

Ticket: #26 · Map: #24 (Mix & Master Assistant v1 spec) · Researched 2026-11-13

## Question

What can be read from an Ableton Live 12 project file (`.als`), and how reliably can it be parsed on Windows? This covers the format and how stable it is, tracks and routing, device chains (native devices and VST/VST3 plug-ins), mixer state, automation, names and colours, frozen tracks, sample references, existing parsers, and what a parsed project can and can't tell us about the sound.

## Short answer

An `.als` file is a gzip-compressed XML file with no published spec. Python's standard library (`gzip` plus `xml.etree`) reads it on any OS, Windows included. For **native Live devices**, the file holds almost everything we need: every parameter's stored value, its allowed range and its on/off state, along with track names, colours, grouping, routing, volume, pan, sends, mute (the "Speaker" switch), solo and automation breakpoints. For **third-party VST/VST3 plug-ins**, it holds the plug-in's name, its ID and any parameters that were configured or automated in Live. The plug-in's full state is an opaque binary blob that only the plug-in can interpret. The file contains no audio and no rendered result. It describes the *settings* but not the *sound*. Loudness, spectrum, peaks and masking have to come from the bounced audio. No existing library covers the mixer and device scope we need, so we should write a small parser of our own.

## Findings

### 1. File format: gzip-wrapped XML, undocumented, versioned per release

- An `.als` file is gzip-compressed XML. Several independent tools state this and read it with the standard `gzip` module ([daw-schemas README / `daw_format_base.py`](https://pypi.org/project/daw-schemas/), [pyableton `Ableton.py`](https://pypi.org/project/pyableton), [alsmuse](https://pypi.org/project/alsmuse/), [Sample-Offline/ableton-under-the-hood](https://github.com/Sample-Offline/ableton-under-the-hood)). I checked this directly: `file` reports pyableton's test sets as "gzip compressed data, from NTFS filesystem (NT)". Both were saved on Windows.
- The root element carries the version, for example `<Ableton MajorVersion="5" MinorVersion="11.0_11300" SchemaChangeCount="3" Creator="Ableton Live 11.3.3" Revision="...">` (from pyableton's test file `evasiva.als`). The Live 12 schema lists `Creator`, `MajorVersion`, `MinorVersion` and `Revision` as required root attributes ([daw-schemas `ableton_live/12/schema.json`](https://pypi.org/project/daw-schemas/), built from sets made in Live 12.1.5 through 12.3.2). A parser should read `Creator` and `MinorVersion` and log them with every result.
- I found **no official specification** from Ableton. bravoh-daw calls the formats "proprietary and partially reverse-engineered" ([bravoh-daw](https://docs.rs/crate/bravoh-daw/0.1.0)).
- **Version stability:** Ableton's help centre says "Sets created or saved in later versions of Live cannot be opened in earlier versions", and Live 11 point releases (11.1, 11.2, 11.3) each broke backward opening ([Backward Compatibility](https://help.ableton.com/hc/en-us/articles/360000841004-Backward-Compatibility)). The Live 12 release notes add that "When saving a Set in Live 12.3 that was created in an earlier version, you will be prompted to save it under a new name". In 12.4, older devices load as legacy variants, such as "Erosion Legacy" and a legacy Auto Pan ([Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/)). In practice, Ableton adds elements and device variants on point releases, so the format changes in small ways several times a year.
- **A concrete Live 11 to Live 12 break:** the master track element is `<MasterTrack>` in a Live 11.3 set (verified in `evasiva.als`) but `<MainTrack>` in Live 12. The Live 12 schema has `MainTrack` and no `MasterTrack` ([daw-schemas schema](https://pypi.org/project/daw-schemas/)), and alsmuse reads tempo from `MainTrack/DeviceChain/Mixer/Tempo/Manual` ([alsmuse `parser.py`](https://pypi.org/project/alsmuse/)). pyableton hard-codes `MasterTrack` (`LiveSet.py`), so it would not find the master track in Live 12 files.
- **Implication:** parse defensively. Look elements up by path, treat any missing element as "unknown" and never as a crash, and keep a small corpus of Aden's own Live 12 sets as test fixtures.

### 2. Tracks, groups, returns, routing

- `LiveSet/Tracks` contains `AudioTrack`, `MidiTrack`, `GroupTrack` and `ReturnTrack`. The main and cue tracks are separate siblings: `MainTrack` and `PreHearTrack` ([daw-schemas schema](https://pypi.org/project/daw-schemas/)).
- **Grouping:** each track has `TrackGroupId Value=` that points at the `Id` of its parent `GroupTrack`, with `-1` meaning top level (verified in `evasiva.als`; alsmuse uses the same field). Nested groups can be rebuilt from this.
- **Output routing:** each track has `DeviceChain/AudioOutputRouting/Target Value=`, for example `"AudioOut/Master"`, plus `UpperDisplayString`, the label shown in Live, for example `"Master"` (verified). `AudioInputRouting` and `MidiInputRouting` have the same shape.
- **Sidechain routing:** sidechain-capable devices (`Compressor2`, `GlueCompressor`, `PluginDevice`) have `SideChain/RoutedInput/Routable` plus `OnOff` and `DryWet` ([schema](https://pypi.org/project/daw-schemas/)). So "kick ducks bass" can be detected from the file.

### 3. Device chains: native devices are fully readable

- A track's devices live in `DeviceChain/DeviceChain/Devices`. The Live 12 schema lists native device tags including `Eq8`, `Compressor2` (Compressor), `GlueCompressor`, `Limiter`, `StereoGain` (Utility), `Saturator`, `DrumBuss`, `Roar`, `Reverb`, `Delay`, `Echo`, `AutoFilter`, `Gate` and `FilterEQ3`. It also lists the rack containers `AudioEffectGroupDevice`, `InstrumentGroupDevice` and `DrumGroupDevice`, the Max for Live devices `MxDeviceAudioEffect` and `MxDeviceMidiEffect`, and the plug-in hosts `PluginDevice` and `AuPluginDevice` ([schema](https://pypi.org/project/daw-schemas/)). Device order in the XML is the signal order.
- **Racks nest:** a rack has `Branches/AudioEffectBranch` (or `InstrumentBranch`/`DrumBranch`), and each branch has its own `DeviceChain` and `MixerDevice` with volume, pan and sends ([schema](https://pypi.org/project/daw-schemas/)). In `evasiva.als`, every track's only top-level device is an `InstrumentGroupDevice`, and the EQ and compressors sit inside it. A parser that doesn't recurse into racks misses most devices.
- Every automatable parameter has the same shape: `<Param><Manual Value="..."/><MidiControllerRange><Min/><Max/></MidiControllerRange><AutomationTarget Id="..."/>...</Param>`. Each device also has an `On` parameter for bypass. Examples of the stored fields per device, from the schema:
  - **EQ Eight (`Eq8`):** `Bands.0` to `Bands.7`, each with `ParameterA`/`ParameterB` (the A/B states) holding `IsOn`, `Mode` (filter type), `Freq`, `Gain` and `Q`. The device also has `GlobalGain`, `Scale`, `AdaptiveQ` and `Mode` (stereo/L-R/M-S).
  - **Compressor (`Compressor2`):** `Threshold`, `Ratio`, `Attack`, `Release`, `Knee`, `Gain`, `DryWet`, `Model` (peak/RMS/expand), `LookAhead` and the `SideChainEq_*` fields.
  - **Glue Compressor:** `Threshold`, `Ratio`, `Attack`, `Release`, `Makeup`, `Range`, `DryWet`, `PeakClipIn` (soft clip) and `Oversample`.
  - **Limiter:** `Gain`, `Ceiling`, `Release`, `AutoRelease`, `Lookahead`, `Mode`, `LinkAmount` and the Live 12 `Maximize*` fields.
  - **Utility (`StereoGain`):** `Gain`, `StereoWidth`, `Mono`, `BassMono`, `BassMonoFrequency`, `Balance`, `Mute`, `PhaseInvertL/R` and `DcFilter`.
  - **Saturator:** `PreDrive`, `PostDrive`, `Type`, `DryWet`, `ColorOn` and `PostClip`, plus the waveshaper `Ws*` fields.
- **Units are not uniform, and they are stored raw.** In `evasiva.als`, Compressor `Threshold` is a linear amplitude of 0.2249 (about −13.0 dB, range 0.000316 to 1.995) while `Gain` is stored in dB (−3.92, range −36 to 36). `Attack` and `Release` are in ms, and EQ `Freq` is in Hz (range 10 to 22000). We will need a small per-parameter conversion table, built by checking each device against the value Live shows in its GUI.

### 4. VST/VST3 plug-ins: identity yes, settings mostly no

- A plug-in is a `PluginDevice` whose `PluginDesc` holds `Vst3PluginInfo` (fields `Name`, `Uid`, `DeviceType`, `NumAudioInputs/Outputs`, `IsPlaceholderDevice`) or `AuPluginInfo` on macOS ([schema](https://pypi.org/project/daw-schemas/)). Live also supports VST2 ([Using Plug-Ins](https://www.ableton.com/en/live-manual/12/using-plug-ins/)). The Live 12 schema sample contained no VST2 instances, so the exact VST2 element names (expected to be `VstPluginInfo`) **must be confirmed on one of Aden's Windows sets**.
- **Full plug-in state is opaque:** `Vst3Preset` contains `ProcessorState` and `ControllerState` with no child elements ([schema](https://pypi.org/project/daw-schemas/)). These are the plug-in's own serialised chunk, and only that plug-in can decode them. An FL or Serum setting cannot be read from there.
- **Readable plug-in parameters:** `PluginDevice/ParameterList/PluginFloatParameter` gives `ParameterName`, `ParameterId` and `ParameterValue` (with `Manual` and `AutomationTarget`) ([schema](https://pypi.org/project/daw-schemas/)). According to Ableton, plug-ins with up to 64 parameters get them all on Live's panel. Plug-ins with more than 64 open with an empty panel that the user configures, and "certain plug-ins do not 'publish' all of their parameters to Live". The configured set "is saved with the Set" ([Using Plug-Ins](https://www.ableton.com/en/live-manual/12/using-plug-ins/), [Automating plug-in parameters that can't be configured](https://help.ableton.com/hc/en-us/articles/209067009-Automating-plug-in-parameters-that-can-t-be-configured)). So for big plug-ins such as Pro-Q or Ozone, we typically see only automated or configured parameters. Values are normalised plug-in values with no units (inferred, because VST parameters are exchanged as 0 to 1; verify on a real set).
- **Missing plug-ins:** `IsPlaceholderDevice` marks a plug-in that Live couldn't load ([schema](https://pypi.org/project/daw-schemas/)). The tool can report it as "unknown plug-in X".
- **Max for Live devices** (`MxDeviceAudioEffect`) expose a `ParameterList` and a `PatchSlot`/`MxPatchRef` that points at the `.amxd` file ([schema](https://pypi.org/project/daw-schemas/)).

### 5. Mixer state

- `DeviceChain/Mixer` holds `Volume`, `Pan`, `PanMode` with `SplitStereoPanL/R` (split-stereo pan), `Speaker` (track on/off, the mute button), `SoloSink`, `Sends/TrackSendHolder/Send` (one per return, plus `EnabledByUser`), `CrossFadeState`, and on the main track `Tempo` and `TimeSignature` ([schema](https://pypi.org/project/daw-schemas/)).
- **Values (verified in `evasiva.als`):** Volume `Manual` 1.0 is 0 dB on a linear gain scale from 0.000316 (−70 dB, shown as −inf) to 1.995 (+6 dB). Pan ranges from −1 to 1. Sends use the same linear scale, and 0.000316 means "off". alsmuse treats `Speaker/Manual` as track enabled.
- **Track width:** Live's mixer has no stereo-width control. Width is set with Utility (`StereoGain/StereoWidth`) or split-stereo panning. In the schema, `ViewStateSessionTrackWidth` is the UI column width and not audio. The 12.x release notes about "track width" refer to the mixer layout ([Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/)).

### 6. Automation

- Per track: `AutomationEnvelopes/Envelopes/AutomationEnvelope`, each with `EnvelopeTarget/PointeeId` and `Automation/Events`, which hold `FloatEvent` (`Time`, `Value`, plus Bezier `CurveControl1X/Y`, `CurveControl2X/Y`), `BoolEvent` or `EnumEvent` ([schema](https://pypi.org/project/daw-schemas/); verified shape in `evasiva.als`). `PointeeId` matches the `AutomationTarget Id` of the parameter it controls, so we resolve an envelope by scanning for that Id. Clips have their own `ClipEnvelope`s.
- `Time` is in beats, and the first event sits at a sentinel time far before zero (`Time="-63072000"` seen). Converting to seconds needs the tempo map. dawtool's author notes that his tempo handling supports linear automation only: "Nonlinear automation may cause inaccuracies" ([dawtool](https://www.github.com/offlinemark/dawtool)).
- **Important for the advice:** when a parameter is automated, `Manual` is not what plays. The envelope is.

### 7. Names, colours, clips, locators

- Track `Name` has `EffectiveName` (what Live shows) and `UserName` (blank when the name is auto-generated) ([schema](https://pypi.org/project/daw-schemas/); alsmuse reads both).
- `Color Value=` is an **index into Live's palette** (for example 6, 17, 20 in `evasiva.als`), not RGB. Showing the real colour needs a palette table.
- Clips: `AudioClip`/`MidiClip` with `Name`, `Color`, `Time`, `CurrentStart/End`, `Disabled`, `WarpMode` and `SampleVolume` ([schema](https://pypi.org/project/daw-schemas/)). Arrangement `Locators/Locator` have `Name` and `Time` and are useful for naming sections ("drop", "break"). dawtool's main feature is extracting these markers in real time ([dawtool](https://www.github.com/offlinemark/dawtool)).

### 8. Frozen tracks

- Tracks have `Freeze Value="true|false"`, `FreezeSequencer` and `NeedArrangerRefreeze` ([schema](https://pypi.org/project/daw-schemas/); `Freeze` verified in `evasiva.als`).
- Ableton: freeze creates "a sample file for every Session and Arrangement clip" on the track, stored "in the Current Project folder under /Samples/Processed/Freeze". Device and clip settings are locked, but "mixer controls such as volume, pan, and the sends are still available" ([Live 12 manual: Computer Audio Resources and Strategies](https://www.ableton.com/en/manual/computer-audio-resources-and-strategies/)). For us, a frozen track's device settings are still in the XML, and its freeze WAVs are real per-track audio on disk.

### 9. Sample references

- `SampleRef/FileRef` gives `Path` (absolute, for example `C:/ProgramData/Ableton/...`), `RelativePath`, `RelativePathType`, `OriginalFileSize`, `OriginalCrc`, `LastModDate`, `LivePackName`, plus `DefaultDuration` and `DefaultSampleRate` ([Sample-Offline/ableton-under-the-hood](https://github.com/Sample-Offline/ableton-under-the-hood); [schema](https://pypi.org/project/daw-schemas/); verified in `evasiva.als`). Paths use forward slashes even on Windows. We can resolve them with `pathlib`, try `RelativePath` against the project folder first, and flag files that are missing.

### 10. Existing parsers and their licences

| Library | Lang | Licence | Reads | Gaps for us |
|---|---|---|---|---|
| [dawtool](https://www.github.com/offlinemark/dawtool) | Python | BSD-3-Clause (one FL Studio file is GPL-3) ([LICENSE](https://raw.githubusercontent.com/offlinemark/dawtool/master/LICENSE)) | Locators/markers with tempo automation; Live 8 to 12 | Only markers are supported, "API and CLI should be considered unstable"; no mixer or devices |
| [pyableton](https://pypi.org/project/pyableton) 0.0.15 (Feb 2024) | Python | MIT | Track, clip and mixer objects mapped from XML; MIDI export | Hard-codes `MasterTrack`, so Live 12 is likely broken; crashes on missing elements (`list(node.attrib.values())[0]` on `find()`); no device parameters; unmaintained |
| [alsmuse](https://pypi.org/project/alsmuse/) 0.1.0 (Jan 2026) | Python | Apache-2.0 | Live 12 tempo, time signature, tracks, groups, enabled state, clips | Built for structure and lyrics; no devices, sends or automation |
| [daw-schemas](https://pypi.org/project/daw-schemas/) 0.1.0 (Jan 2026) | Python | MIT | A JSON *schema* of all elements seen in Live 12.1 to 12.3 sets, plus a diff tool | Not a parser; alpha; schema built on macOS (AU) so VST2 is unseen. Very useful as a map of element names |
| [bravoh-daw](https://docs.rs/crate/bravoh-daw/0.1.0) 0.1.0 (Jul 2026) | Rust | MIT | BPM, version, track names and types, plug-in names and counts, samples, markers, mixer summary, automated parameter list | Summary level only; "If a field can't be parsed dependably, it is omitted" |
| [AbletonParsing](https://pypi.org/project/abletonparsing/) | Python | MIT | `.asd` clip-warp files, **not** `.als` | Not relevant ("Live 12's binary format is not yet supported" for `.asd`) |

None of them reads native device parameters with units, plug-in parameters, sends or automation the way the Mix & Master Assistant needs. The parsing itself is about 300 lines of `xml.etree`, so writing our own is cheap. daw-schemas' Live 12 schema plus a few of Aden's sets can serve as the reference.

### 11. Alternative for live values: the Live Object Model

If we ever need display strings that the file doesn't hold, for example "−12.9 dB" for a plug-in parameter, the Live API (Max for Live or a Remote Script) exposes each `DeviceParameter`'s `value`, `min`, `max`, `display_value` ("The value as visible in the GUI"), `str_for_value` and `automation_state` ([LOM DeviceParameter](https://docs.cycling74.com/apiref/lom/deviceparameter/)). This only works with Live running and the set open. It is out of scope for a file-only v1, but it is the fallback for unit conversion and for plug-ins.

## What a parsed project can and can't tell us about the sound

**Can:** the signal-flow graph (track to group to main, sends to returns, sidechains); which processors sit where and whether they are on; exact settings of native EQ, compressor, limiter, Utility and Saturator (for example "Glue on the drum bus at 4:1, −18 dB threshold", "Limiter ceiling −0.3 dB", "Utility Bass Mono at 120 Hz on main"); fader, pan and send positions; what is automated and how; names, colours, sections; frozen state; which samples are used.

**Can't:** actual levels, loudness (LUFS), true peak, gain reduction actually applied, spectral balance, masking, stereo correlation or clipping. These depend on the audio running through the chain, and the file holds no audio or meters. Third-party plug-in settings are mostly invisible (opaque state). Instrument output level is unknown, so "fader at 0 dB" says nothing about how loud the track is. All of this must come from analysing the bounced mixdown and stems. The project file adds the context ("why") and the knobs to point at ("where to make the move").

## Verified directly

- pyableton 0.0.15's bundled test sets (`test/evasiva.als`, Live 11.3.3; `test/test.als`, Live 11.1.5) were decompressed and parsed with Python `gzip` and `xml.etree`. Tracks, groups, routing, mixer values and ranges, Compressor/EQ/Utility values, `Freeze`, automation envelope shape, `FileRef` paths and colour indices were all read successfully.
- The daw-schemas 0.1.0 `ableton_live/12/schema.json` was queried for every Live 12 element named above.

## Open questions

- VST2 element names on Windows (`VstPluginInfo`?) and whether `PluginFloatParameter` lists all parameters or only configured ones in Live 12. Check on one of Aden's sets.
- A per-device unit conversion table (linear vs dB vs normalised), to be checked against Live's GUI.
- Whether Live 12.4 sets add elements that break assumptions made from the 12.1 to 12.3 schema.
