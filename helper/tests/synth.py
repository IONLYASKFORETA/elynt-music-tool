"""A made-up EDM track with a known grid and known sections, for testing analysis.

128 BPM, 4/4, with a pickup before bar 1:
intro (hats and a pad) 8 bars, build (snare roll and a noise riser) 8, drop (kick,
sub bass, saw chords) 16, breakdown (pad) 8, drop 8, outro (kick and hats, softer) 8.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

RATE = 22050
BPM = 128.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
PICKUP = 0.3  # seconds of silence before the first downbeat
LAYOUT = [("intro", 8), ("build", 8), ("drop", 16), ("breakdown", 8), ("drop", 8), ("outro", 8)]


@dataclass
class Truth:
    bpm: float
    downbeats: np.ndarray
    sections: list[tuple[str, float, float]]  # label, start, end


def _env(n: int, attack: float, decay: float) -> np.ndarray:
    t = np.arange(n) / RATE
    return np.minimum(t / attack, 1.0) * np.exp(-t / decay)


def _add(out: np.ndarray, start: float, sound: np.ndarray, gain: float = 1.0) -> None:
    i = int(round(start * RATE))
    if i >= len(out):
        return
    sound = sound[: len(out) - i]
    out[i : i + len(sound)] += gain * sound


def make_track(seed: int = 7, layout: list[tuple[str, int]] = LAYOUT) -> tuple[np.ndarray, Truth]:
    rng = np.random.default_rng(seed)
    bars = sum(n for _, n in layout)
    total = PICKUP + bars * BAR + 0.5
    out = np.zeros(int(total * RATE), np.float64)

    n_kick = int(0.25 * RATE)
    tk = np.arange(n_kick) / RATE
    kick = np.sin(2 * np.pi * (50 * tk + 120 * (1 - np.exp(-tk / 0.03)) * 0.03)) * _env(n_kick, 0.001, 0.12)
    hat = rng.standard_normal(int(0.05 * RATE)) * _env(int(0.05 * RATE), 0.0005, 0.01)
    hat = np.diff(hat, prepend=0)  # brighten
    snare = rng.standard_normal(int(0.15 * RATE)) * _env(int(0.15 * RATE), 0.001, 0.05)

    def tone(freqs: list[float], seconds: float, saw: bool = False) -> np.ndarray:
        t = np.arange(int(seconds * RATE)) / RATE
        wave = np.zeros_like(t)
        for f in freqs:
            wave += (2 * ((t * f) % 1.0) - 1) if saw else np.sin(2 * np.pi * f * t)
        return wave / len(freqs)

    a_minor = [220.0, 261.63, 329.63]
    sections = []
    t0 = PICKUP
    for label, n in layout:
        start, end = t0, t0 + n * BAR
        sections.append((label, start, end))
        for b in range(n * 4):
            beat = start + b * BEAT
            progress = b / (n * 4)
            if label in ("intro", "outro", "drop"):
                _add(out, beat + BEAT / 2, hat, 0.15)
            if label in ("drop", "outro"):
                _add(out, beat, kick, 0.9 if label == "drop" else 0.5)
            if label == "drop":
                _add(out, beat, tone([55.0], BEAT * 0.9) * _env(int(BEAT * 0.9 * RATE), 0.005, 0.3), 0.6)
                if b % 2 == 0:
                    _add(out, beat, tone(a_minor, BEAT * 1.9, saw=True) * _env(int(BEAT * 1.9 * RATE), 0.01, 0.5), 0.35)
                if b % 4 == 2:
                    _add(out, beat, snare, 0.5)
            if label == "build":
                hits = 2 if progress < 0.5 else 4
                for k in range(hits):
                    _add(out, beat + k * BEAT / hits, snare, 0.1 + 0.4 * progress)
        if label in ("intro", "breakdown", "build"):
            pad = tone(a_minor, n * BAR) * 0.25
            _add(out, start, pad * np.minimum(np.arange(len(pad)) / (0.5 * RATE), 1.0))
        if label == "build":
            noise = rng.standard_normal(int(n * BAR * RATE))
            ramp = np.linspace(0.0, 1.0, len(noise)) ** 2
            _add(out, start, np.diff(noise, prepend=0) * ramp * 0.25)
        t0 = end

    out /= np.max(np.abs(out)) * 1.05
    downbeats = PICKUP + BAR * np.arange(bars)
    return out.astype(np.float32), Truth(bpm=BPM, downbeats=downbeats, sections=sections)
