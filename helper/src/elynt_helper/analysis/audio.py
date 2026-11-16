"""Reading a mixdown into one mono signal at the analysis sample rate."""

from __future__ import annotations

from math import gcd

import numpy as np

ANALYSIS_RATE = 22050


class AudioReadError(Exception):
    pass


def load_mono(path: str, rate: int = ANALYSIS_RATE) -> np.ndarray:
    """The file as mono float32 at `rate`. Reads WAV, AIFF and FLAC through libsndfile."""
    import soundfile
    from scipy.signal import resample_poly

    try:
        data, source_rate = soundfile.read(path, dtype="float32", always_2d=True)
    except (RuntimeError, soundfile.LibsndfileError) as e:
        raise AudioReadError(str(e)) from e
    mono = data.mean(axis=1)
    if source_rate != rate:
        g = gcd(int(source_rate), rate)
        mono = resample_poly(mono, rate // g, int(source_rate) // g).astype(np.float32)
    return np.ascontiguousarray(mono, dtype=np.float32)
