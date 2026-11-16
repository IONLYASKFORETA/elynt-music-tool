"""A coarse mood read: key, how energetic (arousal) and how bright or dark (valence).

Research #6 found mood models only roughly right on EDM, so this is a measured
guess the vision step treats as a proposal: arousal from tempo, loudness, onset
density and brightness; valence mostly from major or minor.
"""

from __future__ import annotations

import numpy as np

from .features import Features, db

NOTES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
# Krumhansl-Kessler key profiles.
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def estimate_key(features: Features) -> dict:
    weights = features.rms.astype(np.float64) ** 2
    profile = (features.chroma * weights[:, None]).sum(axis=0)
    if profile.sum() <= 0:
        return {"key": None, "mode": None, "confidence": 0.0}
    scores = []
    for tonic in range(12):
        for mode, template in (("major", MAJOR), ("minor", MINOR)):
            scores.append((float(np.corrcoef(profile, np.roll(template, tonic))[0, 1]), tonic, mode))
    scores.sort(reverse=True)
    best, runner_up = scores[0], scores[1]
    # The relative major/minor pair is always close, so even a clear winner stays below 0.9.
    confidence = float(np.clip((best[0] - runner_up[0]) * 5.0 + 0.2 * best[0], 0.0, 0.9))
    return {"key": f"{NOTES[best[1]]} {best[2]}", "mode": best[2], "confidence": round(confidence, 2)}


def _scale(x: float, low: float, high: float) -> float:
    return float(np.clip((x - low) / (high - low) * 2.0 - 1.0, -1.0, 1.0))


def read_mood(features: Features, bpm: float) -> dict:
    key = estimate_key(features)
    power = features.rms.astype(np.float64) ** 2
    loud = float(db(power[power > power.max() * 1e-4].mean())) if power.max() > 0 else -90.0
    brightness = float(np.median(features.centroid))
    busy = float(np.mean(features.onset_high > np.percentile(features.onset_high, 75) * 1.5))

    arousal = float(np.mean([
        _scale(bpm, 90.0, 160.0),
        _scale(loud, -24.0, -6.0),
        _scale(brightness, 800.0, 3500.0),
        _scale(busy, 0.02, 0.2),
    ]))
    mode_sign = {"major": 1.0, "minor": -1.0}.get(key["mode"] or "", 0.0)
    valence = float(np.clip(0.6 * mode_sign * max(key["confidence"], 0.3) + 0.4 * _scale(brightness, 800.0, 3500.0), -1, 1))

    if arousal > 0.2:
        label = "euphoric" if valence > 0 else "dark"
    elif arousal < -0.2:
        label = "dreamy" if valence > 0 else "melancholic"
    else:
        label = "uplifting" if valence > 0 else "moody"

    return {
        "label": label,
        "arousal": round(arousal, 2),
        "valence": round(valence, 2),
        "key": key["key"],
        "keyConfidence": key["confidence"],
        "source": "heuristic",
    }
