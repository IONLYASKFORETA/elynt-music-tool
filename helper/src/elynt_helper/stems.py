"""Stem splitting: a mixdown in, one WAV per stem out (Visualizer ticket V2, #53).

The model is BS-RoFormer SW (jarredou), run through python-audio-separator. It gives six stems:
drums, bass, vocals, other, guitar and piano. Drums and bass separate best, and they are the ones
the Visualizer leans on most. Research: research/track-analysis.md section 7 on the research branch.

The separation stack (audio-separator and its model) is installed by the setup scripts, not by
`uv sync`, because it pulls in PyTorch, which comes from PyTorch's own CUDA index (see helper/README.md).
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any, Callable

from .gpu import gpu_lock
from .methods import HelperError, Progress

DEFAULT_MODEL = "BS-Roformer-SW.ckpt"
# Downloaded once on first use (about 700 MB), then reused.
MODEL_DIR = Path(os.environ.get("ELYNT_MODEL_DIR", Path.home() / ".elynt" / "models")) / "audio-separator"

# A stem quieter than this all the way through is dropped: nothing for the Visualizer to react to
# (BS-RoFormer SW often hands back an empty piano or guitar stem on EDM).
SILENT_DBFS = -60.0

# The order stems are listed in: the ones the Visualizer reacts to most first.
STEM_ORDER = ["drums", "bass", "vocals", "other", "guitar", "piano"]

# Runs the separation and returns the paths of the files it wrote. Swapped out in tests.
Separate = Callable[[str, str, str, Progress], list[str]]

def split_stems(params: dict[str, Any], progress: Progress, separate: Separate | None = None) -> dict[str, Any]:
    path = params.get("path")
    out_dir = params.get("outDir")
    model = params.get("model") or DEFAULT_MODEL
    if not isinstance(path, str) or not path:
        raise HelperError("bad_request", "path is required")
    if not isinstance(out_dir, str) or not out_dir:
        raise HelperError("bad_request", "outDir is required")
    if not os.path.isfile(path):
        raise HelperError("file_not_found", f"no file at {path}")
    os.makedirs(out_dir, exist_ok=True)

    progress("Waiting for the GPU")
    with gpu_lock:
        started = time.monotonic()
        written = (separate or separate_with_audio_separator)(path, out_dir, model, progress)

    stems = []
    for f in written:
        stem_path = os.path.join(out_dir, os.path.basename(f))
        if is_silent(stem_path):
            os.remove(stem_path)
            continue
        stems.append({"name": stem_name(f), "path": stem_path})
    stems.sort(key=lambda s: (STEM_ORDER.index(s["name"]) if s["name"] in STEM_ORDER else len(STEM_ORDER), s["name"]))
    if not stems:
        raise HelperError("split_failed", "the model wrote no stems")
    return {"stems": stems, "model": model, "seconds": round(time.monotonic() - started, 1)}


def is_silent(path: str) -> bool:
    """True if the whole file stays below SILENT_DBFS (RMS)."""
    import numpy as np
    import soundfile

    total, count = 0.0, 0
    for block in soundfile.blocks(path, blocksize=1 << 16, dtype="float32"):
        total += float(np.square(block, dtype=np.float64).sum())
        count += block.size
    if count == 0:
        return True
    rms = (total / count) ** 0.5
    return rms == 0 or 20 * np.log10(rms) < SILENT_DBFS


def stem_name(file_path: str) -> str:
    """"bass.wav" -> "bass"; audio-separator's default "SUPERFLY_(Bass)_BS-Roformer-SW.wav" -> "bass"."""
    base = Path(file_path).stem
    match = re.search(r"_\(([^)]+)\)", base)
    return (match.group(1) if match else base).strip().lower()


def separate_with_audio_separator(path: str, out_dir: str, model: str, progress: Progress) -> list[str]:
    try:
        from audio_separator.separator import Separator
        from audio_separator.separator.architectures import mdxc_separator
    except ImportError as e:
        raise HelperError(
            "separation_not_installed",
            f"the stem splitter isn't installed ({e}). Re-run the helper setup script.",
        ) from e
    import logging

    progress("Loading the stem model")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    separator = Separator(
        log_level=logging.WARNING,
        model_file_dir=str(MODEL_DIR),
        output_dir=out_dir,
        output_format="WAV",
    )
    separator.load_model(model_filename=model)

    # audio-separator has no progress callback, but its RoFormer loop runs through tqdm over chunks.
    # Swap that tqdm for one that reports to the app while this split runs (we hold the GPU lock).
    original_tqdm = mdxc_separator.tqdm

    def reporting_tqdm(iterable, *args, **kwargs):
        items = list(iterable)
        for i, item in enumerate(items):
            progress("Splitting", i / max(len(items), 1))
            yield item
        progress("Saving stems")

    mdxc_separator.tqdm = reporting_tqdm
    try:
        progress("Splitting", 0.0)
        # Plain names ("bass.wav"): the folder is already one per split.
        written = separator.separate(path, custom_output_names={name: name for name in STEM_ORDER})
    finally:
        mdxc_separator.tqdm = original_tqdm
    return [f if os.path.isabs(f) else os.path.join(out_dir, f) for f in written]
