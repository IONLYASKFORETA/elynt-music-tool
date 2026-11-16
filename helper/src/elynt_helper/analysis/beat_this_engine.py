"""Beat This! (CPJKU, MIT code and weights): the beat and downbeat model research #6 picked.

It is optional. The setup scripts install it with --no-deps next to our CUDA 13.0
torch, because it asks for torchaudio and there is no torchaudio build for torch
2.13. It only uses torchaudio for one mel spectrogram, so when torchaudio can't
be imported, `_torchaudio_stand_in` provides that one class, written with plain
torch to give the same numbers (tested against librosa's slaney filterbank).

The weights (final0, about 80 MB) download once from the authors' server on first
use and are cached by torch hub.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import types
from typing import Any

import numpy as np

_tracker: Any = None


def available() -> bool:
    try:
        importlib.import_module("torch")
        return importlib.util.find_spec("beat_this") is not None
    except ImportError:
        return False


def track(signal: np.ndarray, rate: int) -> tuple[np.ndarray, np.ndarray]:
    """Beat and downbeat times in seconds."""
    global _tracker
    if _tracker is None:
        import torch

        _ensure_torchaudio()
        from beat_this.inference import Audio2Beats

        device = "cuda" if torch.cuda.is_available() else "cpu"
        _tracker = Audio2Beats(checkpoint_path="final0", device=device, dbn=False)
    beats, downbeats = _tracker(signal, rate)
    return np.asarray(beats, dtype=np.float64), np.asarray(downbeats, dtype=np.float64)


def _ensure_torchaudio() -> None:
    try:
        importlib.import_module("torchaudio")
    except Exception:  # noqa: BLE001 - missing, or built for another torch
        sys.modules["torchaudio"] = _torchaudio_stand_in()


def _torchaudio_stand_in() -> types.ModuleType:
    import torch

    def hz_to_mel(f: torch.Tensor) -> torch.Tensor:
        # Slaney: linear below 1 kHz, logarithmic above.
        f_sp = 200.0 / 3
        min_log_hz, min_log_mel = 1000.0, 1000.0 / f_sp
        logstep = np.log(6.4) / 27.0
        return torch.where(f >= min_log_hz, min_log_mel + torch.log(f / min_log_hz) / logstep, f / f_sp)

    def mel_to_hz(m: torch.Tensor) -> torch.Tensor:
        f_sp = 200.0 / 3
        min_log_hz, min_log_mel = 1000.0, 1000.0 / f_sp
        logstep = np.log(6.4) / 27.0
        return torch.where(m >= min_log_mel, min_log_hz * torch.exp(logstep * (m - min_log_mel)), f_sp * m)

    def mel_filterbank(n_freqs: int, f_min: float, f_max: float, n_mels: int, sample_rate: int) -> torch.Tensor:
        all_freqs = torch.linspace(0, sample_rate // 2, n_freqs, dtype=torch.float64)
        m_pts = torch.linspace(float(hz_to_mel(torch.tensor(float(f_min)))), float(hz_to_mel(torch.tensor(float(f_max)))), n_mels + 2, dtype=torch.float64)
        f_pts = mel_to_hz(m_pts)
        f_diff = f_pts[1:] - f_pts[:-1]
        slopes = f_pts.unsqueeze(0) - all_freqs.unsqueeze(1)
        down = -slopes[:, :-2] / f_diff[:-1]
        up = slopes[:, 2:] / f_diff[1:]
        return torch.clamp(torch.minimum(down, up), min=0).float()  # n_freqs x n_mels

    class MelSpectrogram(torch.nn.Module):
        """torchaudio.transforms.MelSpectrogram, for the arguments Beat This! passes."""

        def __init__(self, sample_rate=16000, n_fft=400, hop_length=None, f_min=0.0, f_max=None, n_mels=128,
                     mel_scale="htk", normalized=False, power=2.0, **_ignored):
            super().__init__()
            if mel_scale != "slaney":
                raise ValueError("this stand-in only does the slaney mel scale")
            self.n_fft = n_fft
            self.hop_length = hop_length or n_fft // 2
            self.power = power
            # "frame_length" normalises in the STFT itself; True normalises by the window.
            self.frame_norm = normalized == "frame_length"
            self.window_norm = normalized is True or normalized == "window"
            self.register_buffer("window", torch.hann_window(n_fft))
            self.register_buffer("fb", mel_filterbank(n_fft // 2 + 1, f_min, f_max or sample_rate / 2, n_mels, sample_rate))

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            spec = torch.stft(x, self.n_fft, self.hop_length, self.n_fft, self.window, center=True, pad_mode="reflect",
                              normalized=self.frame_norm, onesided=True, return_complex=True)
            if self.window_norm:
                spec = spec / self.window.pow(2.0).sum().sqrt()
            mag = spec.abs() if self.power == 1 else spec.abs().pow(self.power)
            return (mag.transpose(-1, -2) @ self.fb).transpose(-1, -2)

    def load(*_args, **_kwargs):
        raise RuntimeError("torchaudio is not installed; Beat This! falls back to soundfile")

    module = types.ModuleType("torchaudio")
    module.transforms = types.SimpleNamespace(MelSpectrogram=MelSpectrogram)  # type: ignore[attr-defined]
    module.load = load  # type: ignore[attr-defined]
    module.__elynt_stand_in__ = True  # type: ignore[attr-defined]
    return module
