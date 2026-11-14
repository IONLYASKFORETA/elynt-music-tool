"""Tempo, beats and downbeats on one constant-tempo grid.

EDM is made on a fixed grid, so every tracker's output is snapped to one: a straight
line of beat times, with every fourth beat a downbeat. Two sources fill it in:
Beat This! when it is installed (see beat_this_engine.py), and the signal-processing
tracker below, which needs nothing beyond numpy and works on any machine.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .features import HOP, N_FFT, Features, db

BEATS_PER_BAR = 4
# A fitted grid further than this from the tracker's own beats (RMS) means the tempo moves; keep its beats.
MAX_GRID_ERROR_S = 0.04


@dataclass
class BeatGrid:
    bpm: float
    beats: np.ndarray  # seconds
    downbeats: np.ndarray  # seconds, a subset of beats
    source: str  # "beat-this" or "dsp"
    constant_tempo: bool = True
    notes: list[str] = field(default_factory=list)


def frame_time_offset(rate: int) -> float:
    """A frame's measurements describe the middle of its window."""
    return (N_FFT / 2) / rate


def dsp_beats(features: Features) -> BeatGrid:
    """Signal-processing beat grid: tempo from the onset envelope's periodicity, downbeats from where things change."""
    fps = features.fps
    novelty = _onset_envelope(features)
    if features.frames < fps * 4 or novelty.max() <= 0:
        raise ValueError("too short or too quiet to find a beat")

    bpm = _coarse_tempo(novelty, fps)
    # Kicks sit on the beat in club music, while hats often sit between beats, so the low band sets the phase.
    pulse = _onset_envelope(features, low_weight=1.0, full_weight=0.25)
    bpm, phase_frames = _refine(pulse, fps, bpm)
    period = 60.0 * fps / bpm
    period, phase_frames = _fit_line(pulse, period, phase_frames)
    bpm = 60.0 * fps / period
    offset = frame_time_offset(features.rate)

    first = phase_frames % period
    beat_frames = np.arange(first, features.frames, period)
    beats = beat_frames / fps + offset
    beats = beats[beats < features.duration]
    downbeat_phase = _downbeat_phase(features, beats)
    return BeatGrid(bpm=bpm, beats=beats, downbeats=beats[downbeat_phase::BEATS_PER_BAR], source="dsp")


def snap_to_grid(beats: np.ndarray, downbeats: np.ndarray, duration: float, source: str) -> BeatGrid:
    """Fits a straight tempo line through a tracker's beats and rebuilds the whole grid from it."""
    beats = np.asarray(beats, dtype=np.float64)
    downbeats = np.asarray(downbeats, dtype=np.float64)
    if len(beats) < 8:
        raise ValueError("too few beats to fit a grid")

    rough = float(np.median(np.diff(beats)))
    index = np.round((beats - beats[0]) / rough)
    slope, intercept = np.polyfit(index, beats, 1)
    error = float(np.sqrt(np.mean((intercept + slope * index - beats) ** 2)))
    if error > MAX_GRID_ERROR_S:
        bpm = 60.0 / rough
        return BeatGrid(
            bpm=bpm,
            beats=beats,
            downbeats=downbeats,
            source=source,
            constant_tempo=False,
            notes=[f"The tempo seems to move (beats sit {error * 1000:.0f} ms off a straight grid), so the tracker's own beats are kept."],
        )

    start_index = int(np.ceil(-intercept / slope))
    grid_index = np.arange(start_index, int(np.floor((duration - intercept) / slope)) + 1)
    grid = intercept + slope * grid_index
    if len(downbeats):
        votes = Counter(int(round((d - intercept) / slope)) % BEATS_PER_BAR for d in downbeats)
        phase = votes.most_common(1)[0][0]
    else:
        phase = 0
    is_down = (grid_index % BEATS_PER_BAR) == phase
    return BeatGrid(bpm=60.0 / slope, beats=grid, downbeats=grid[is_down], source=source)


def _onset_envelope(features: Features, low_weight: float = 1.0, full_weight: float = 1.0) -> np.ndarray:
    def norm(x: np.ndarray) -> np.ndarray:
        top = np.percentile(x, 99.5)
        return x / top if top > 0 else x

    env = full_weight * norm(features.onset) + low_weight * norm(features.onset_low)
    width = int(features.fps)  # remove the slow trend so loud passages don't dominate
    trend = np.convolve(env, np.ones(width) / width, mode="same")
    return np.maximum(env - trend, 0.0).astype(np.float64)


def _fit_line(pulse: np.ndarray, period: float, phase: float, rounds: int = 3) -> tuple[float, float]:
    """Moves the grid onto the onsets near each beat: find the peak near every beat, fit a straight line."""
    for _ in range(rounds):
        index, peaks, weights = [], [], []
        k0 = int(np.ceil(-phase / period))
        k = k0
        floor = np.percentile(pulse, 75)
        while phase + k * period < len(pulse):
            centre = phase + k * period
            lo, hi = int(max(0, centre - period * 0.2)), int(min(len(pulse), centre + period * 0.2 + 1))
            if hi - lo >= 2:
                window = pulse[lo:hi]
                i = int(np.argmax(window))
                if window[i] > floor and 0 < i < len(window) - 1:
                    # Parabolic interpolation for a sub-frame peak.
                    a, b, c = window[i - 1], window[i], window[i + 1]
                    shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
                    index.append(k)
                    peaks.append(lo + i + shift)
                    weights.append(window[i])
            k += 1
        if len(index) < 8:
            break
        period, phase = np.polyfit(index, peaks, 1, w=np.sqrt(weights))
    return float(period), float(phase)


def _tempo_prior(bpm: np.ndarray) -> np.ndarray:
    """Most club music sits between 120 and 150 BPM. Halves and doubles of those are less likely."""
    return np.exp(-0.5 * (np.log2(bpm / 130.0) / 0.45) ** 2)


def _coarse_tempo(novelty: np.ndarray, fps: float) -> float:
    centred = novelty - novelty.mean()
    spectrum = np.fft.rfft(centred, n=2 * len(centred))
    ac = np.fft.irfft(spectrum * np.conj(spectrum))[: len(centred)]
    candidates = np.arange(60.0, 200.0, 0.25)
    lags = 60.0 * fps / candidates

    def at(lag: np.ndarray) -> np.ndarray:
        return np.interp(lag, np.arange(len(ac)), ac)

    # A true beat period also lines up at two and four beats, so reward those.
    score = (at(lags) + 0.5 * at(2 * lags) + 0.25 * at(4 * lags)) * _tempo_prior(candidates)
    return float(candidates[int(np.argmax(score))])


def _refine(novelty: np.ndarray, fps: float, bpm: float) -> tuple[float, float]:
    """Finds the tempo (to 0.01 BPM) and phase whose pulse train lines up best with the onsets."""
    t = np.arange(len(novelty))
    best = (-1.0, bpm, 0.0)
    for candidate in np.arange(bpm * 0.98, bpm * 1.02, 0.01):
        omega = 2.0 * np.pi * candidate / (60.0 * fps)
        z = np.sum(novelty * np.exp(-1j * omega * t))
        if abs(z) > best[0]:
            phase = (-np.angle(z) / omega) % (2.0 * np.pi / omega)
            best = (abs(z), float(candidate), float(phase))
    return best[1], best[2]


def beat_features(features: Features, beats: np.ndarray) -> np.ndarray:
    """One row per beat: log band energies, high-band onsets and normalised pitch classes."""
    rows = []
    for a, b in _beat_edges(features, beats):
        bands = [float(db(features.bands[name][a:b].mean())) / 10.0 for name in ("sub", "bass", "mid", "high")]
        chroma = features.chroma[a:b].mean(axis=0)
        chroma = chroma / (chroma.sum() + 1e-9)
        rows.append([*bands, float(np.log1p(features.onset_high[a:b].mean())), *(chroma * 3.0)])
    return np.asarray(rows)


def _downbeat_phase(features: Features, beats: np.ndarray) -> int:
    """Which of every four beats starts the bar.

    Club music changes on the downbeat, and the clearest change is a lift: kick, bass and
    loudness coming in together (a drop, or the bar after a build). A beat scores when
    every one of the four beats from it is louder than every one of the four before it,
    in both overall level and low end. Requiring all of them rejects fills, tails and
    one-off hits, so a lift peaks on exactly one beat. Squaring lets the big lifts lead.

    When the track never lifts, the phase falls back to where whole bars differ most.
    """
    if len(beats) < 2 * BEATS_PER_BAR:
        return 0
    loud, low = _beat_levels(features, beats)
    lifts = np.zeros(len(beats))
    w = BEATS_PER_BAR
    for i in range(w, len(beats) - w + 1):
        if np.median(loud[i - w : i]) < loud.max() - 30.0:  # coming out of silence says nothing about the bar
            continue
        lift = (low[i : i + w].min() - low[i - w : i].max()) + (loud[i : i + w].min() - loud[i - w : i].max())
        lifts[i] = max(0.0, lift) ** 2
    if lifts.sum() > 0:
        return int(np.argmax([lifts[p::w].sum() for p in range(w)]))

    rows = beat_features(features, beats)
    changes = np.zeros(len(rows))
    for i in range(w, len(rows) - w + 1):
        changes[i] = np.linalg.norm(rows[i : i + w].mean(axis=0) - rows[i - w : i].mean(axis=0)) ** 2
    return int(np.argmax([changes[p::w].sum() for p in range(w)]))


def _beat_levels(features: Features, beats: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Loudness and sub-plus-bass level of each beat, in dB."""
    edges = _beat_edges(features, beats)
    power = features.rms.astype(np.float64) ** 2
    low = features.bands["sub"] + features.bands["bass"]
    loud = np.array([float(db(power[a:b].mean())) for a, b in edges])
    lows = np.array([float(db(low[a:b].mean())) for a, b in edges])
    return loud, lows


def _beat_edges(features: Features, beats: np.ndarray) -> list[tuple[int, int]]:
    offset = frame_time_offset(features.rate)
    starts = [min(features.frames - 1, max(0, int(round((b - offset) * features.fps)))) for b in beats]
    ends = starts[1:] + [features.frames]
    return [(a, max(b, a + 1)) for a, b in zip(starts, ends)]
