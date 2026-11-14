"""Frame-level measurements every later step reads: band energies, onsets, brightness, pitch classes."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

HOP = 441  # 50 frames a second at 22.05 kHz, the same grid Beat This! uses
N_FFT = 2048
# Onsets use a shorter window around the same centre: a long window "sees" an attack coming
# and puts it early, by up to half its length.
N_ONSET = 1024

BANDS = {
    "sub": (20.0, 90.0),
    "bass": (90.0, 250.0),
    "mid": (250.0, 2000.0),
    "high": (2000.0, 11000.0),
}


@dataclass
class Features:
    rate: int
    fps: float
    duration: float
    rms: np.ndarray  # linear RMS per frame
    bands: dict[str, np.ndarray]  # power per band per frame
    onset: np.ndarray  # spectral flux, whole spectrum
    onset_low: np.ndarray  # spectral flux below 150 Hz (kicks)
    onset_high: np.ndarray  # spectral flux above 2 kHz (snares, hats, noise)
    centroid: np.ndarray  # Hz
    chroma: np.ndarray  # frames x 12, pitch-class energy (C = 0)

    @property
    def frames(self) -> int:
        return len(self.rms)

    def frame_of(self, seconds: float) -> int:
        return int(round(seconds * self.fps))


def compute(signal: np.ndarray, rate: int) -> Features:
    n = len(signal)
    frames = max(1, 1 + (n - N_FFT) // HOP) if n >= N_FFT else 1
    padded = np.pad(signal, (0, max(0, N_FFT + (frames - 1) * HOP - n)))
    window = np.hanning(N_FFT).astype(np.float32)
    freqs = np.fft.rfftfreq(N_FFT, 1.0 / rate)

    band_masks = {name: (freqs >= lo) & (freqs < hi) for name, (lo, hi) in BANDS.items()}
    onset_window = np.hanning(N_ONSET).astype(np.float32)
    onset_freqs = np.fft.rfftfreq(N_ONSET, 1.0 / rate)
    low_mask = onset_freqs < 150.0
    high_mask = onset_freqs >= 2000.0
    centre = slice((N_FFT - N_ONSET) // 2, (N_FFT + N_ONSET) // 2)
    chroma_map = _chroma_map(freqs)

    rms = np.empty(frames, np.float32)
    bands = {name: np.empty(frames, np.float32) for name in BANDS}
    onset = np.zeros(frames, np.float32)
    onset_low = np.zeros(frames, np.float32)
    onset_high = np.zeros(frames, np.float32)
    centroid = np.empty(frames, np.float32)
    chroma = np.empty((frames, 12), np.float32)

    prev_log: np.ndarray | None = None
    chunk = 512  # frames per FFT batch, keeps memory flat on long tracks
    for start in range(0, frames, chunk):
        stop = min(frames, start + chunk)
        idx = np.arange(N_FFT)[None, :] + HOP * np.arange(start, stop)[:, None]
        block = padded[idx]
        rms[start:stop] = np.sqrt(np.mean(block**2, axis=1))
        mag = np.abs(np.fft.rfft(block * window, axis=1)).astype(np.float32)
        power = mag**2
        for name, mask in band_masks.items():
            bands[name][start:stop] = power[:, mask].sum(axis=1)
        total = mag.sum(axis=1) + 1e-9
        centroid[start:stop] = (mag * freqs[None, :]).sum(axis=1) / total
        chroma[start:stop] = np.log1p(10.0 * mag) @ chroma_map

        log_mag = np.log1p(100.0 * np.abs(np.fft.rfft(block[:, centre] * onset_window, axis=1)))
        if prev_log is None:
            prev = np.concatenate([log_mag[:1], log_mag[:-1]])
        else:
            prev = np.concatenate([prev_log[None, :], log_mag[:-1]])
        rise = np.maximum(log_mag - prev, 0.0)
        onset[start:stop] = rise.sum(axis=1)
        onset_low[start:stop] = rise[:, low_mask].sum(axis=1)
        onset_high[start:stop] = rise[:, high_mask].sum(axis=1)
        prev_log = log_mag[-1]

    return Features(
        rate=rate,
        fps=rate / HOP,
        duration=n / rate,
        rms=rms,
        bands=bands,
        onset=onset,
        onset_low=onset_low,
        onset_high=onset_high,
        centroid=centroid,
        chroma=chroma,
    )


def _chroma_map(freqs: np.ndarray) -> np.ndarray:
    """Bins x 12 matrix folding notes C3 to B6 onto pitch classes.

    Each note reads the spectrum at its own centre frequency (linear between the two nearest
    bins), so every note counts once however many FFT bins its range covers.
    """
    out = np.zeros((len(freqs), 12), np.float32)
    step = freqs[1] - freqs[0]
    for midi in range(48, 96):
        centre = 440.0 * 2.0 ** ((midi - 69) / 12.0)
        pos = centre / step
        lo = int(np.floor(pos))
        frac = pos - lo
        out[lo, midi % 12] += 1.0 - frac
        out[lo + 1, midi % 12] += frac
    return out


def db(x: np.ndarray | float) -> np.ndarray:
    return 10.0 * np.log10(np.asarray(x, dtype=np.float64) + 1e-12)


def energy_curve(features: Features, hz: float = 10.0) -> list[float]:
    """Loudness over time, 0 to 1, at `hz` points a second. 1 is the loudest moment, 0 is 40 dB below it."""
    step = max(1, int(round(features.fps / hz)))
    count = int(np.ceil(features.frames / step))
    power = features.rms.astype(np.float64) ** 2
    means = np.array([power[i * step : (i + 1) * step].mean() for i in range(count)])
    level = db(means)
    top = level.max()
    curve = np.clip((level - (top - 40.0)) / 40.0, 0.0, 1.0)
    return [round(float(v), 3) for v in curve]
