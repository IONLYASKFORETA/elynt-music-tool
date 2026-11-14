"""The calls the app can make. Keep this in step with src/shared/helper.ts."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from typing import Any

from . import PROTOCOL_VERSION, __version__


class HelperError(Exception):
    """An expected failure with a stable code the app can act on."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def audio_probe(params: dict[str, Any]) -> dict[str, Any]:
    """Duration, sample rate and channels of an audio file, read from its header."""
    path = params.get("path")
    if not isinstance(path, str) or not path:
        raise HelperError("bad_request", "path is required")
    if not os.path.isfile(path):
        raise HelperError("file_not_found", f"no file at {path}")

    import soundfile  # imported here so a broken audio stack doesn't stop the helper starting

    try:
        info = soundfile.info(path)
    except RuntimeError as e:  # libsndfile's "format not recognised" and friends
        raise HelperError("unreadable_audio", str(e)) from e
    return {
        "durationSeconds": info.frames / info.samplerate,
        "sampleRate": info.samplerate,
        "channels": info.channels,
        "frames": info.frames,
        "format": info.format,
    }


def gpu_info() -> dict[str, Any]:
    """What CUDA device the helper can use. Prefers PyTorch's view, falls back to nvidia-smi."""
    try:
        import torch
    except ImportError:
        torch = None

    if torch is not None:
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            return {
                "available": True,
                "via": "torch",
                "name": props.name,
                "cudaVersion": torch.version.cuda,
                "computeCapability": f"{props.major}.{props.minor}",
                "memoryGb": round(props.total_memory / 1024**3, 1),
                "torchVersion": torch.__version__,
            }
        reason = "PyTorch is installed but cannot see a CUDA device"
        if torch.version.cuda is None:
            reason = "PyTorch is a CPU-only build; install the gpu extra"
        return {"available": False, "via": "torch", "reason": reason, "torchVersion": torch.__version__}

    smi = shutil.which("nvidia-smi")
    if smi:
        try:
            out = subprocess.run(
                [smi, "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=10, check=True,
            ).stdout.strip().splitlines()
        except (subprocess.SubprocessError, OSError) as e:
            return {"available": False, "via": "nvidia-smi", "reason": f"nvidia-smi failed: {e}"}
        if out:
            name, driver, memory = (part.strip() for part in out[0].split(","))
            return {
                "available": False,
                "via": "nvidia-smi",
                "name": name,
                "driverVersion": driver,
                "memory": memory,
                "reason": "GPU found, but PyTorch is not installed; install the gpu extra",
            }
    return {"available": False, "via": "none", "reason": "no PyTorch and no nvidia-smi"}


def helper_info(_params: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": __version__,
        "protocol": PROTOCOL_VERSION,
        "python": platform.python_version(),
        "platform": sys.platform,
        # True inside WSL2: the kernel release names Microsoft.
        "wsl": "microsoft" in platform.release().lower(),
        "gpu": gpu_info(),
    }


METHODS = {
    "helper.info": helper_info,
    "audio.probe": audio_probe,
}
