"""Track analysis (V1): tempo, beats, downbeats, sections, energy and a coarse mood, from one mixdown.

The result is saved on the shared track record, so the Mix & Master and Release
assistants read the same section grid as the Visualizer. Every part of it is a
proposal the owner can correct in the "What I heard" check (V3).
"""

from __future__ import annotations

import sys
import time
from typing import Callable

import numpy as np

from . import beat_this_engine
from .audio import ANALYSIS_RATE, load_mono
from .beats import BeatGrid, NoBeat, dsp_beats, snap_to_grid
from .features import compute, energy_curve
from .mood import read_mood
from .sections import find_sections

# Bump when the output's meaning changes, so the app knows to re-run analysis on old tracks.
ANALYZER_VERSION = 1
ENERGY_HZ = 10.0

BeatTracker = Callable[[np.ndarray, int], tuple[np.ndarray, np.ndarray]]


class SilentAudio(Exception):
    pass


__all__ = ["NoBeat", "SilentAudio", "analyze_file", "analyze_signal"]


def default_beat_tracker() -> BeatTracker | None:
    return beat_this_engine.track if beat_this_engine.available() else None


def analyze_signal(signal: np.ndarray, rate: int, beat_tracker: BeatTracker | None = None) -> dict:
    started = time.monotonic()
    if signal.size == 0 or float(np.max(np.abs(signal))) < 1e-4:
        raise SilentAudio("the mixdown is silent")

    features = compute(signal, rate)
    grid, notes = _beat_grid(signal, rate, features, beat_tracker)
    sections = find_sections(features, grid.downbeats)
    mood = read_mood(features, grid.bpm)
    notes = [*notes, *grid.notes, "Build, drop and breakdown come from energy and low-end heuristics on the bar grid."]

    return {
        "analyzerVersion": ANALYZER_VERSION,
        "durationSeconds": round(features.duration, 3),
        "bpm": round(grid.bpm, 2),
        "beatsPerBar": 4,
        "beats": _times(grid.beats),
        "downbeats": _times(grid.downbeats),
        "beatSource": grid.source,
        "constantTempo": grid.constant_tempo,
        "sections": [s.to_json() for s in sections],
        "energy": {"hz": ENERGY_HZ, "values": energy_curve(features, ENERGY_HZ)},
        "mood": mood,
        "notes": notes,
        "seconds": round(time.monotonic() - started, 2),
    }


def analyze_file(path: str, beat_tracker: BeatTracker | None | str = "default") -> dict:
    tracker = default_beat_tracker() if beat_tracker == "default" else beat_tracker
    return analyze_signal(load_mono(path, ANALYSIS_RATE), ANALYSIS_RATE, tracker)  # type: ignore[arg-type]


def _beat_grid(signal: np.ndarray, rate: int, features, beat_tracker: BeatTracker | None) -> tuple[BeatGrid, list[str]]:
    if beat_tracker is not None:
        try:
            beats, downbeats = beat_tracker(signal, rate)
            grid = snap_to_grid(beats, downbeats, features.duration, "beat-this")
            if grid.constant_tempo and 60.0 <= grid.bpm <= 200.0:
                return grid, []
            # Club tracks keep one tempo. A model that disagrees is more likely confused than right.
            return dsp_beats(features), [*grid.notes, "The beat model's beats didn't fit one tempo, so the signal-processing tracker was used."]
        except Exception as e:  # noqa: BLE001 - the model is optional; the DSP grid always works
            print(f"beat tracker failed, using the DSP grid: {type(e).__name__}: {e}", file=sys.stderr)
            note = f"The beat model failed ({type(e).__name__}), so beats come from the signal-processing tracker."
            return dsp_beats(features), [note]
    return dsp_beats(features), ["Beats come from the signal-processing tracker (the beat model isn't installed)."]


def _times(values: np.ndarray) -> list[float]:
    return [round(float(v), 3) for v in values]
