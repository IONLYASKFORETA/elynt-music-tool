"""The Live Set reader (M1), tested at the helper seam: a `liveset.read` request in, the parsed Set out.

Fixtures in tests/fixtures/live-sets:
- pyableton-test-live-11.1.5.als: pyableton 0.0.15's own test Set (MIT), saved by Live 11.1.5 on Windows.
- live-10.als.xml, live-12.als.xml: small Sets written by hand to the shape of real Live 10 and Live 12 files.
  They are gzipped into an .als at test time, so the XML stays readable in review.
"""

import gzip
import json
from pathlib import Path

import pytest

from elynt_helper.server import handle_line

FIXTURES = Path(__file__).parent / "fixtures" / "live-sets"
PYABLETON_SET = FIXTURES / "pyableton-test-live-11.1.5.als"


def read_set(path: Path) -> dict:
    response = handle_line(json.dumps({"id": 1, "method": "liveset.read", "params": {"path": str(path)}}))
    assert "error" not in response, response
    return response["result"]


def gzipped(tmp_path: Path, xml_name: str) -> Path:
    """Writes a hand-made fixture's XML out as a gzipped .als, as Live saves it."""
    als = tmp_path / xml_name.replace(".als.xml", ".als")
    als.write_bytes(gzip.compress((FIXTURES / xml_name).read_bytes()))
    return als


def track(live_set: dict, name: str) -> dict:
    return next(t for t in [*live_set["tracks"], *live_set["returns"]] if t["name"] == name)


def test_live_11_set_lists_its_live_tracks_and_returns():
    live_set = read_set(PYABLETON_SET)
    assert live_set["creator"] == "Ableton Live 11.1.5"
    assert live_set["minorVersion"] == "11.0_436"
    assert live_set["liveVersion"] == 11
    assert [(t["name"], t["kind"], t["id"]) for t in live_set["tracks"]] == [
        ("Bass", "midi", 12),
        ("Drums", "midi", 13),
        ("Guitar", "midi", 15),
        ("Voice", "midi", 16),
    ]
    assert [(t["name"], t["kind"]) for t in live_set["returns"]] == [("A-Reverb", "return"), ("B-Delay", "return")]
    assert live_set["main"]["kind"] == "main"


def test_live_11_mixer_routing_and_sends():
    drums = track(read_set(PYABLETON_SET), "Drums")
    assert drums["groupId"] is None
    assert drums["output"] == {"target": "AudioOut/Master", "display": "Master", "kind": "main"}
    mixer = drums["mixer"]
    assert mixer["volume"] == {"value": 1.0, "min": 0.0003162277571, "max": 1.99526238}
    assert mixer["volumeDb"] == 0.0
    assert mixer["pan"] == {"value": 0.0, "min": -1.0, "max": 1.0}
    assert mixer["muted"] is False
    assert mixer["soloed"] is False
    # One send per return track, in return order; Live's floor (0.000316) is "off", shown as -inf.
    assert [(s["returnName"], s["db"]) for s in mixer["sends"]] == [("A-Reverb", "-inf"), ("B-Delay", "-inf")]


def device_names(devices: list[dict]) -> list:
    """A device chain as nested (name, [branch chains]) for easy comparison."""
    return [
        (d["name"], [device_names(b["devices"]) for b in d["branches"]]) if d.get("branches") else d["name"]
        for d in devices
    ]


def test_live_11_device_chains_are_read_in_signal_order_through_racks():
    drums = track(read_set(PYABLETON_SET), "Drums")
    [kit] = drums["devices"]
    assert (kit["type"], kit["kind"], kit["name"]) == ("InstrumentGroupDevice", "rack", "Dry Session Kit")
    [branch] = kit["branches"]
    drum_rack, bus = branch["devices"]
    assert drum_rack["type"] == "DrumGroupDevice" and len(drum_rack["branches"]) == 16
    assert device_names(drum_rack["branches"][6]["devices"]) == ["Hihat Closed", "Channel EQ"]
    assert device_names(bus["branches"][0]["devices"]) == [
        "EQ Presets 1",
        "EQ Presets 2",
        "Drum Buss",
        "Utility",
        "Glue Compressor",
    ]


def test_live_11_max_for_live_devices_are_opaque_too():
    bass = track(read_set(PYABLETON_SET), "Bass")
    chain = bass["devices"][0]["branches"][0]["devices"]
    assert [(d["name"], d["kind"]) for d in chain] == [
        ("MPE Control", "max"),
        ("Nylon Concerto Guitar", "native"),
        ("Auto Filter", "native"),
        ("EQ Three", "native"),
        ("Compressor", "native"),
        ("Ambience Medium", "native"),
    ]
    assert "parameters" not in chain[0]


def test_live_11_native_parameters_have_values_and_ranges():
    drums = track(read_set(PYABLETON_SET), "Drums")
    bus = drums["devices"][0]["branches"][0]["devices"][1]
    eq, _, _, utility, glue = bus["branches"][0]["devices"]
    assert eq["type"] == "Eq8" and eq["kind"] == "native" and eq["on"] is True
    assert eq["parameters"]["Bands.0/ParameterA/Freq"] == {"value": 75.7852936, "min": 10.0, "max": 22000.0}
    assert eq["parameters"]["Bands.1/ParameterA/Gain"] == {"value": -3.09917355, "min": -15.0, "max": 15.0}
    assert eq["parameters"]["Bands.0/ParameterA/IsOn"] == {"value": False, "min": False, "max": True}
    assert glue["parameters"]["Ratio"] == {"value": 1.0, "min": 0.0, "max": 2.0}
    assert utility["type"] == "StereoGain"
    # Glue has a sidechain section, switched off and pointing nowhere.
    assert glue["sidechain"] == {"on": False, "target": "AudioIn/None", "display": "No Output", "kind": "none"}


def test_live_11_drum_rack_return_chains_are_read_too():
    drums = track(read_set(PYABLETON_SET), "Drums")
    drum_rack = drums["devices"][0]["branches"][0]["devices"][0]
    assert [b["name"] for b in drum_rack["returnBranches"]] == [
        "A A Hybrid Reverb",  # sic: that's the chain's name in the Set
        "B Drum - K+S Parallel",
        "C Tape Saturation",
        "D Auto Filter | Utility | Auto Filter",
        "E Pedal",
    ]
    parallel = drum_rack["returnBranches"][1]["devices"][0]
    glue = next(d for d in parallel["branches"][0]["devices"] if d["type"] == "GlueCompressor")
    assert glue["parameters"]["Threshold"] == {"value": -28.8888893, "min": -40.0, "max": 0.0}


def test_live_12_set_reads_the_main_track_and_grouping(tmp_path):
    live_set = read_set(gzipped(tmp_path, "live-12.als.xml"))
    assert (live_set["creator"], live_set["minorVersion"], live_set["liveVersion"]) == (
        "Ableton Live 12.1.5",
        "12.0_12117",
        12,
    )
    assert [(t["name"], t["kind"], t["groupId"]) for t in live_set["tracks"]] == [
        ("Kick", "audio", None),
        ("Low End", "group", None),
        ("Bass", "midi", 10),
    ]
    assert track(live_set, "Kick")["output"]["kind"] == "main"
    assert track(live_set, "Kick")["mixer"]["volumeDb"] == -3.0
    bass = track(live_set, "Bass")
    assert bass["output"] == {
        "target": "AudioOut/GroupTrack",
        "display": "Group",
        "kind": "group",
        "trackId": 10,
        "trackName": "Low End",
    }
    assert (bass["mixer"]["muted"], bass["mixer"]["volumeDb"], bass["mixer"]["pan"]["value"]) == (True, -6.0, -0.25)
    assert bass["mixer"]["sends"][0]["returnName"] == "A-Reverb"
    assert bass["mixer"]["sends"][0]["db"] == -20.0
    assert track(live_set, "Low End")["mixer"]["soloed"] is True
    main = live_set["main"]
    assert main["name"] == "Main"
    assert [(d["name"], d["parameters"]["Ceiling"]["value"]) for d in main["devices"]] == [("Limiter", -0.3000000119)]


def test_live_12_sidechain_routing_names_the_feeding_track(tmp_path):
    bass = track(read_set(gzipped(tmp_path, "live-12.als.xml")), "Bass")
    duck = bass["devices"][1]
    assert (duck["type"], duck["name"]) == ("Compressor2", "Duck")
    assert duck["sidechain"] == {
        "on": True,
        "target": "AudioIn/Track.8/PostFxOut",
        "display": "1-Kick Post FX",
        "kind": "track",
        "trackId": 8,
        "trackName": "Kick",
    }


def test_missing_and_unexpected_elements_come_back_unknown(tmp_path):
    als = tmp_path / "bare.als"
    als.write_bytes(
        gzip.compress(
            b"""<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5">
  <LiveSet>
    <Tracks>
      <AudioTrack>
        <DeviceChain>
          <AudioOutputRouting><Target Value="AudioOut/SomethingNew" /></AudioOutputRouting>
          <Mixer>
            <Volume><Manual Value="loud" /></Volume>
            <Sends><TrackSendHolder Id="0"><Send><Manual Value="0.5" /></Send></TrackSendHolder></Sends>
          </Mixer>
          <DeviceChain>
            <Devices>
              <FutureDevice Id="0"><Knob><Manual Value="0.25" /></Knob></FutureDevice>
              <AudioEffectGroupDevice Id="1"><Branches><AudioEffectBranch /></Branches></AudioEffectGroupDevice>
              <PluginDevice Id="2" />
            </Devices>
          </DeviceChain>
        </DeviceChain>
      </AudioTrack>
      <MidiTrack Id="3" />
      <ScrollTrack Id="4" />
    </Tracks>
  </LiveSet>
</Ableton>"""
        )
    )
    live_set = read_set(als)
    assert (live_set["creator"], live_set["minorVersion"], live_set["liveVersion"]) == ("unknown",) * 3
    assert live_set["main"] == "unknown"
    audio, midi = live_set["tracks"]
    assert (audio["id"], audio["name"], audio["groupId"]) == ("unknown", "unknown", "unknown")
    assert audio["output"] == {"target": "AudioOut/SomethingNew", "display": "", "kind": "unknown"}
    assert audio["mixer"]["volume"] == {"value": "unknown", "min": "unknown", "max": "unknown"}
    assert (audio["mixer"]["volumeDb"], audio["mixer"]["muted"], audio["mixer"]["soloed"]) == ("unknown",) * 3
    # A send with no return track to match it.
    assert audio["mixer"]["sends"][0]["returnName"] == "unknown"
    future, rack, plugin = audio["devices"]
    assert (future["name"], future["kind"], future["on"]) == ("FutureDevice", "native", "unknown")
    assert future["parameters"] == {"Knob": {"value": 0.25, "min": "unknown", "max": "unknown"}}
    assert rack["branches"] == [{"name": "unknown", "devices": []}]
    assert plugin["plugin"] == {"format": "unknown", "name": "unknown", "id": "unknown"}
    assert midi["output"]["kind"] == "unknown" and midi["devices"] == [] and midi["mixer"]["sends"] == []


@pytest.mark.parametrize(
    "content, code",
    [
        (b"not gzip at all", "unreadable_live_set"),
        (gzip.compress(b"<not xml"), "unreadable_live_set"),
        (gzip.compress(b"<Something><Else /></Something>"), "unreadable_live_set"),
    ],
)
def test_a_file_that_is_not_a_live_set_is_a_coded_error(tmp_path, content, code):
    als = tmp_path / "x.als"
    als.write_bytes(content)
    response = handle_line(json.dumps({"id": 1, "method": "liveset.read", "params": {"path": str(als)}}))
    assert response["error"]["code"] == code


def test_a_missing_file_is_a_coded_error(tmp_path):
    response = handle_line(json.dumps({"id": 1, "method": "liveset.read", "params": {"path": str(tmp_path / "no.als")}}))
    assert response["error"]["code"] == "file_not_found"


def test_creator_and_minor_version_are_logged_with_every_result(capsys):
    read_set(PYABLETON_SET)
    assert "Creator='Ableton Live 11.1.5' MinorVersion='11.0_436'" in capsys.readouterr().err


def test_live_10_set_opens_with_master_track_groups_and_vst2(tmp_path):
    live_set = read_set(gzipped(tmp_path, "live-10.als.xml"))
    assert (live_set["creator"], live_set["minorVersion"], live_set["liveVersion"]) == (
        "Ableton Live 10.1.30",
        "10.0_377",
        10,
    )
    assert [(t["name"], t["kind"], t["groupId"]) for t in live_set["tracks"]] == [
        ("Drums", "group", None),
        ("Kick", "audio", 20),
        ("Synth", "midi", None),
    ]
    assert track(live_set, "Kick")["output"]["trackName"] == "Drums"
    assert track(live_set, "Kick")["mixer"]["volumeDb"] == 2.0
    synth = track(live_set, "Synth")
    assert [(s["returnName"], s["db"]) for s in synth["mixer"]["sends"]] == [("A-Reverb", -10.0), ("B-Delay", 0.0)]
    serum, glue = synth["devices"]
    assert serum["plugin"] == {"format": "vst2", "name": "Serum_x64", "id": "1483109208"}
    assert (glue["sidechain"]["trackName"], glue["sidechain"]["on"]) == ("Kick", True)
    assert glue["parameters"]["Threshold"] == {"value": -18.0, "min": -40.0, "max": 0.0}
    assert [d["name"] for d in track(live_set, "B-Delay")["devices"]] == ["Ping Pong Delay"]
    utility = live_set["main"]["devices"][0]
    assert live_set["main"]["name"] == "Master"
    assert utility["name"] == "Utility"
    assert utility["parameters"]["StereoWidth"] == {"value": 1.2, "min": 0.0, "max": 4.0}
    assert utility["parameters"]["BassMono"]["value"] is True


def test_third_party_plugins_are_opaque_name_and_id_only(tmp_path):
    live_set = read_set(gzipped(tmp_path, "live-12.als.xml"))
    serum = track(live_set, "Bass")["devices"][0]
    assert serum == {
        "type": "PluginDevice",
        "kind": "plugin",
        "name": "Serum",
        "on": True,
        "plugin": {"format": "vst3", "name": "Serum", "id": "56535350-58667358-73657173-656D616E"},
    }
    rack = track(live_set, "Low End")["devices"][0]
    assert rack["name"] == "Low Glue"
    saturator, pro_q = rack["branches"][0]["devices"]
    assert rack["branches"][0]["name"] == "Warm"
    assert saturator["parameters"]["PreDrive"] == {"value": 3.5, "min": -36.0, "max": 36.0}
    assert (pro_q["name"], pro_q["kind"], pro_q["on"], pro_q["plugin"]["format"]) == ("Pro-Q 3", "plugin", False, "vst3")
