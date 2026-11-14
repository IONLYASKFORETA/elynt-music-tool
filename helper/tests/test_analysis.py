"""Track analysis at the helper's analyze seam, on a made-up track with a known answer (tests/synth.py)."""

import json

import numpy as np
import pytest
import soundfile

from elynt_helper.analysis import analyze_signal
from elynt_helper.analysis.beats import snap_to_grid
from elynt_helper.server import handle_line
from synth import BAR, BEAT, BPM, LAYOUT, RATE, make_track


@pytest.fixture(scope="module")
def track():
    return make_track()


@pytest.fixture(scope="module")
def result(track):
    signal, _ = track
    return analyze_signal(signal, RATE, beat_tracker=None)


def test_tempo_is_found_to_a_tenth_of_a_bpm(result):
    assert result["bpm"] == pytest.approx(BPM, abs=0.1)
    assert result["beatSource"] == "dsp"
    assert result["constantTempo"] is True


def test_downbeats_land_on_bar_starts(track, result):
    _, truth = track
    downbeats = np.array(result["downbeats"])
    # Every true downbeat has an analysed one within 20 ms.
    errors = [np.min(np.abs(downbeats - t)) for t in truth.downbeats]
    assert max(errors) < 0.02
    beats = np.array(result["beats"])
    assert np.median(np.diff(beats)) == pytest.approx(BEAT, abs=0.002)


def test_sections_are_labelled_and_placed_on_the_bar(track, result):
    _, truth = track
    assert [s["label"] for s in result["sections"]] == [label for label, _ in LAYOUT]
    for found, (_, start, _end) in zip(result["sections"][1:], truth.sections[1:]):
        assert found["start"] == pytest.approx(start, abs=0.03)
    assert result["sections"][0]["start"] == 0.0
    assert result["sections"][-1]["end"] == pytest.approx(result["durationSeconds"])
    for s in result["sections"]:
        assert 0.0 <= s["confidence"] <= 1.0
        assert s["source"] == "heuristic"


def test_energy_curve_follows_the_arrangement(track, result):
    _, truth = track
    energy = result["energy"]
    assert energy["hz"] == 10.0
    values = np.array(energy["values"])
    assert len(values) == pytest.approx(result["durationSeconds"] * 10, abs=2)
    assert values.min() >= 0.0 and values.max() == 1.0

    def mean_between(a, b):
        return values[int(a * 10) : int(b * 10)].mean()

    (_, i0, i1), (_, b0, b1), (_, d0, d1), (_, k0, k1) = truth.sections[:4]
    assert mean_between(d0, d1) > mean_between(k0, k1) + 0.1  # drop louder than breakdown
    assert mean_between(b0 + BAR * 6, b1) > mean_between(b0, b0 + BAR * 2)  # build rises


def test_mood_reads_the_key_and_stays_in_range(result):
    mood = result["mood"]
    assert mood["key"] == "A minor"
    assert -1.0 <= mood["arousal"] <= 1.0 and -1.0 <= mood["valence"] <= 1.0
    assert mood["valence"] < 0  # minor
    assert mood["label"] in {"euphoric", "dark", "dreamy", "melancholic", "uplifting", "moody"}


def test_a_beat_model_is_snapped_to_one_grid(track):
    signal, truth = track

    def wobbly_model(sig, rate):
        rng = np.random.default_rng(1)
        beats = np.arange(0.3, len(sig) / rate, BEAT) + rng.normal(0, 0.008, size=len(np.arange(0.3, len(sig) / rate, BEAT)))
        return beats, beats[::4]

    result = analyze_signal(signal, RATE, beat_tracker=wobbly_model)
    assert result["beatSource"] == "beat-this"
    assert result["bpm"] == pytest.approx(BPM, abs=0.1)
    gaps = np.diff(result["beats"])
    assert gaps.max() - gaps.min() < 0.002  # one straight grid, not the model's wobble
    assert np.min(np.abs(np.array(result["downbeats"]) - truth.downbeats[0])) < 0.01


def test_a_failing_beat_model_falls_back_to_the_dsp_grid(track):
    signal, _ = track

    def broken_model(sig, rate):
        raise RuntimeError("no weights")

    result = analyze_signal(signal, RATE, beat_tracker=broken_model)
    assert result["beatSource"] == "dsp"
    assert result["bpm"] == pytest.approx(BPM, abs=0.1)
    assert any("beat model failed" in n for n in result["notes"])


def test_a_moving_tempo_keeps_the_trackers_own_beats():
    intervals = np.linspace(0.5, 0.4, 64)  # 120 speeding up to 150 BPM
    beats = np.cumsum(intervals)
    grid = snap_to_grid(beats, beats[::4], duration=float(beats[-1] + 1), source="beat-this")
    assert grid.constant_tempo is False
    assert np.allclose(grid.beats, beats)
    assert grid.notes


def test_analyze_method_reads_a_file_end_to_end(tmp_path, track):
    signal, _ = track
    path = tmp_path / "synth.wav"
    stereo = np.stack([signal, signal], axis=1)
    soundfile.write(str(path), stereo, RATE, subtype="FLOAT")
    response = handle_line(json.dumps({"id": 3, "method": "track.analyze", "params": {"path": str(path)}}))
    assert "error" not in response, response
    result = response["result"]
    assert result["bpm"] == pytest.approx(BPM, abs=0.1)
    assert [s["label"] for s in result["sections"]] == [label for label, _ in LAYOUT]
    json.dumps(result)  # plain JSON all the way down


def test_analyze_resamples_a_48k_file(tmp_path, track):
    from scipy.signal import resample_poly

    signal, _ = track
    path = tmp_path / "synth48.wav"
    soundfile.write(str(path), resample_poly(signal, 320, 147).astype(np.float32), 48000, subtype="FLOAT")
    result = handle_line(json.dumps({"id": 4, "method": "track.analyze", "params": {"path": str(path)}}))["result"]
    assert result["bpm"] == pytest.approx(BPM, abs=0.1)
    assert result["sections"][2]["label"] == "drop"


def test_analyze_errors_are_coded(tmp_path):
    def call(path):
        return handle_line(json.dumps({"id": 5, "method": "track.analyze", "params": {"path": str(path)}}))

    assert call(tmp_path / "nope.wav")["error"]["code"] == "file_not_found"
    junk = tmp_path / "junk.wav"
    junk.write_text("not audio")
    assert call(junk)["error"]["code"] == "unreadable_audio"
    silent = tmp_path / "silent.wav"
    soundfile.write(str(silent), np.zeros(RATE * 5, np.float32), RATE)
    assert call(silent)["error"]["code"] == "silent_audio"
    blip = tmp_path / "blip.wav"
    soundfile.write(str(blip), np.sin(np.arange(RATE) * 0.05).astype(np.float32), RATE)
    assert call(blip)["error"]["code"] == "no_beat"
