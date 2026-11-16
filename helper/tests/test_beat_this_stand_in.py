"""The torchaudio stand-in for Beat This! must give the same mel spectrogram torchaudio would.

Runs only where torch and librosa are installed (Aden's helper venv, not CI): librosa's slaney
filterbank is the reference, and the STFT normalisation matches torchaudio's "frame_length".
"""

import numpy as np
import pytest

torch = pytest.importorskip("torch")
librosa = pytest.importorskip("librosa")

from elynt_helper.analysis.beat_this_engine import _torchaudio_stand_in  # noqa: E402


def test_mel_spectrogram_matches_the_slaney_reference():
    module = _torchaudio_stand_in()
    mel = module.transforms.MelSpectrogram(
        sample_rate=22050, n_fft=1024, hop_length=441, f_min=30, f_max=11000, n_mels=128,
        mel_scale="slaney", normalized="frame_length", power=1,
    )
    rng = np.random.default_rng(0)
    signal = rng.standard_normal(22050 * 2).astype(np.float32)
    ours = mel(torch.from_numpy(signal)).numpy()

    spec = np.abs(librosa.stft(signal, n_fft=1024, hop_length=441, window="hann", center=True, pad_mode="reflect"))
    spec /= np.sqrt(1024)  # torch.stft(normalized=True) divides by sqrt(frame length)
    fb = librosa.filters.mel(sr=22050, n_fft=1024, n_mels=128, fmin=30, fmax=11000, htk=False, norm=None)
    reference = fb @ spec

    assert ours.shape == reference.shape
    assert np.allclose(ours, reference, rtol=1e-3, atol=1e-4)


def test_beat_this_imports_with_the_stand_in(monkeypatch):
    pytest.importorskip("beat_this")
    import sys

    monkeypatch.setitem(sys.modules, "torchaudio", _torchaudio_stand_in())
    from beat_this.preprocessing import LogMelSpect

    spect = LogMelSpect()(torch.zeros(22050))
    assert spect.shape[1] == 128
