# What can a live link to Ableton Live 12 on Windows read and do?

Ticket: #27 (map #24, Mix & Master Assistant v1 spec). Researched 2026-11-13 against Live 12.4.x docs.

## Short answer

A live link reads the same mixer and device state that the saved `.als` already holds. It adds four things: live peak meters, the playhead position, values for the session as it is right now (including changes not yet saved), and the ability to *set* parameters. Of the three routes, only Max for Live can touch audio, and only through a device that sits on the track it listens to. **No route can start Export Audio/Video**, so stems and the mixdown still have to be bounced by hand. For an advise-only v1 that works from bounced audio plus the `.als`, a live link adds friction and a fragile dependency without unlocking a needed capability. **Recommendation: leave it out of v1.** Keep it as a v2 option, most likely as a small Max for Live device that sends OSC.

## The three routes

### 1. Live Object Model (LOM) through a Max for Live device

- **What it is.** The LOM is Live's object tree (Song → Tracks → Devices → DeviceParameters, plus mixer, clips and cue points). It is documented for Live 12.4.5 ([LOM index](https://docs.cycling74.com/apiref/lom/): "This document refers to Ableton Live version 12.4.5"). A Max patch reaches it through `live.path`, `live.object`, `live.observer` and `live.remote~`, or through the JavaScript `LiveAPI` ([Live API overview](https://docs.cycling74.com/max8/vignettes/live_api_overview)).
- **What it reads.**
  - Tracks, return tracks and the master track ([Song](https://docs.cycling74.com/apiref/lom/song/)).
  - The playing position: `current_song_time`, "The playing position in the Live Set, in beats", and `is_playing` (both get, set and observe) ([Song](https://docs.cycling74.com/apiref/lom/song/)).
  - Device parameters: `value`, `display_value` ("The value as visible in the GUI"), `min`, `max`, `str_for_value` and `automation_state` ([DeviceParameter](https://docs.cycling74.com/apiref/lom/deviceparameter/)).
  - Freeze state: `is_frozen` and `can_be_frozen` ([Track](https://docs.cycling74.com/apiref/lom/track/)).
- **Meters.** `output_meter_left` and `output_meter_right` are a "Smoothed momentary peak value ... 0.0 to 1.0". `output_meter_level` is a hold peak with a 1-second hold. There are matching `input_meter_*` properties. The docs warn that these meters add significant load to Live's GUI ([Track](https://docs.cycling74.com/apiref/lom/track/)). They are normalised peak values only: no RMS, no LUFS, and no spectrum.
- **Third-party plug-ins.** A `PluginDevice` adds only `is_editor_open`, `presets` and `selected_preset_index` ([PluginDevice](https://docs.cycling74.com/apiref/lom/plugindevice/)). Its parameters are whatever Live's panel exposes. Live shows every parameter only "For plug-ins with up to 64 modifiable parameters". Larger plug-ins "open with an empty panel" until they are configured, and "certain plug-ins do not 'publish' all of their parameters to Live" ([Live 12 manual, Using Plug-Ins](https://www.ableton.com/en/live-manual/12/using-plug-ins/)). The `.als` is limited in the same way, so the live link gains nothing here.
- **Automation.** The LOM docs list `automation_state` and `re_enable_automation`. The Song and DeviceParameter pages document no envelope data ([DeviceParameter](https://docs.cycling74.com/apiref/lom/deviceparameter/)).
- **Audio and spectrum.** Max for Live is the only route that can tap audio. "By convention, a Max for Live device gets all its audio from the Live application using the plugin~ object". Audio input and output are limited to two channels, and passing audio between Max for Live devices with `send~`/`receive~` is not supported ([Creating Audio Effect Devices](https://docs.cycling74.com/userguide/m4l/live_audiodevices/)). An analyser device, such as one built on FFT, therefore hears only the track it is inserted on, in real time, while Live plays. Analysing every stem means putting a device on every track. Those devices are then saved into the Set.
- **Export.** None. The Song functions (34 of them) cover playback, tracks, scenes, cue points and undo, but include no export, render or save function ([Song](https://docs.cycling74.com/apiref/lom/song/)). The Application functions are limited to version queries, `get_document` and `press_current_dialog_button` ([Application](https://docs.cycling74.com/apiref/lom/application/)).
- **Talking to an external app.** Max's `udpsend` sends messages "as OSC-compatible UDP packets" ([udpsend](https://docs.cycling74.com/reference/udpsend)), so a device can push meters and state to the desktop app over localhost OSC. (Unverified for this note: Node for Max `node.script` could also open a WebSocket or TCP connection.)
- **Setup for Aden.** Low. "Max for Live is included by default in Live Suite" ([Ableton: Buying Max for Live](https://help.ableton.com/hc/en-us/articles/206407124)), and Live 12 bundles Max 9.1.5 as of 12.4.5 ([Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/)). Aden would drag a `.amxd` onto the master track, plus one per track if audio taps are wanted.
- **Brittleness.** Moderate to low. The LOM is the publicly documented, versioned API, and Live 12 point releases mostly add to it: `insert_device` in 12.3, `replace_sample` in 12.4, Clip scale properties in 12.4.15. Each point release also fixes LOM crashes ([Live 12 release notes](https://www.ableton.com/en/release-notes/live-12/)). The bundled Max version changes with Live updates (same source).

### 2. MIDI Remote Scripts (Python control surfaces)

- **What it is.** A Python package in `Documents\Ableton\User Library\Remote Scripts` that is chosen as a "Control Surface" in Preferences ([Ableton: Installing third-party remote scripts](https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts)). It sees the same object model as the LOM. AbletonOSC describes its aim as exposing "the entire Live Object Model API" ([AbletonOSC README](https://github.com/ideoforms/AbletonOSC)). Ableton does not document the Python framework itself; the docs people use are community XML dumps ([AbletonOSC acknowledgements](https://github.com/ideoforms/AbletonOSC)).
- **What it reads.** The same objects and properties as route 1: tracks, devices, parameters, meters and the song position.
- **Audio and spectrum.** None. A script has no audio path, only the LOM, which exposes peak meter floats but no samples. (This follows from the LOM pages above. No Ableton document says it outright.)
- **Export.** None, for the same reason as route 1.
- **Talking to an external app.** The script can open its own UDP or TCP socket. AbletonOSC uses OSC on UDP 11000/11001 ([README](https://github.com/ideoforms/AbletonOSC)), and ableton-mcp uses JSON over TCP ([ableton-mcp](https://github.com/ahujasid/ableton-mcp)).
- **Setup for Aden.** Medium. He copies a folder into User Library\Remote Scripts, restarts Live and selects the script in a free Control Surface slot ([Ableton help](https://help.ableton.com/hc/en-us/articles/209072009-Installing-third-party-remote-scripts)).
- **Brittleness.** Highest of the three. "Ableton does not provide technical support for third-party scripts" (same source). Live 11 moved scripts to Python 3 (same source). In Live 12.1, "Ableton updated the embedded Python interpreter to version 3.11.6", which broke scripts that ship compiled `.pyc` files, and Native Instruments said "Ableton did not inform us of this change" ([NI community, Matthew_NI](https://community.native-instruments.com/discussion/comment/183331)). Scripts shipped as `.py` source survive that kind of change better.

### 3. Community bridges (AbletonOSC and similar)

- **AbletonOSC** is a remote script (route 2) packaged as an OSC API. It "requires Ableton Live 11 or above" and carries a "beta" stability badge ([README](https://github.com/ideoforms/AbletonOSC)).
  - **Reads.** Track names, volume, pan, sends, mute and solo. It also reads `/live/track/get/output_meter_left|right|level`, `/live/song/get/current_song_time`, a beat listener, and device and parameter names, values, min/max and `value_string` (for example "2500 Hz"), with listeners for parameter changes (same source).
  - **Does.** Sets parameters, controls the transport, edits clips and notes, and creates MIDI CC mappings. It cannot export.
  - **Live 12.** Users run it on Live 12, but the README's stated floor is Live 11. One user writing in 2024 was "hoping it is compatible with 12" ([issue #127](https://github.com/ideoforms/abletonosc/issues/127)).
- **ableton-mcp** is a remote script with a TCP/JSON socket and an MCP server. It reads "session and track information" and creates and edits tracks and clips. It lists no meters and no export ([ableton-mcp](https://github.com/ahujasid/ableton-mcp)).
- **Brittleness.** It combines route 2's Python-interpreter risk with dependence on a third-party maintainer.

## Comparison

| | M4L device (LOM) | Own remote script | AbletonOSC / bridges |
|---|---|---|---|
| Tracks, devices, params | Yes | Yes | Yes |
| Peak meters (0–1, smoothed) | Yes | Yes | Yes |
| Playhead | Yes | Yes | Yes |
| Audio / spectrum tap | Yes, per track, real time, stereo | No | No |
| Trigger stem/mixdown export | No | No | No |
| Transport to desktop app | OSC/UDP via `udpsend` | Any socket | OSC UDP 11000/11001; TCP JSON (ableton-mcp) |
| Setup for Aden | Drop `.amxd` on master | Copy folder, pick Control Surface | Same as remote script |
| Brittleness | Lowest (documented API) | Highest (undocumented, Python changes) | High, plus maintainer risk |

## What a live link adds over `.als` + bounced audio

1. **Unsaved, current state.** It reads parameter values as they are now, without asking Aden to save. That matters little for an assistant run on a finished bounce.
2. **Live peak meters and the playhead.** These are peak values only and run in real time. The bounced audio already gives exact offline peak, RMS, LUFS and spectrum, so this is worse data for v1's measurements.
3. **Real-time audio taps (Max for Live only).** These would let the tool skip bouncing stems, but only with a device on every track and real-time playback. They are also limited to stereo, and the devices get saved into the Set.
4. **Write-back.** Applying a suggested move ("cut 3 dB at 250 Hz on Bass") through `DeviceParameter.value`. v1 is advise-only, so this is out of scope.

What it does **not** add: stem or mixdown export (no API route), more plug-in parameter visibility than the `.als` (both are limited to configured or exposed parameters), or automation envelope data.

**Verdict for v1:** not worth it. The core inputs are the measurements, and those come from bounced audio. Everything structural the link offers is also in the `.als`. The live link's real value is write-back and in-context hints, so it belongs in a later version. If it is built, do it as a Max for Live device that sends OSC over `udpsend` rather than as a Python remote script, because the device is the documented and more update-stable surface.

## Open / unverified

- Exact meter update rate is undocumented.
- Whether Windows UI automation could press Live's Export dialog was not researched. It would be fragile in any case.
- Node for Max socket options were not checked against Max 9 docs.
