"""Subject images: a prompt in, one PNG out (Visualizer ticket V9, #77).

The model is FLUX.2 [klein] 4B (Black Forest Labs, Apache 2.0), run through diffusers. It is a
step-distilled model: four steps and no classifier-free guidance give a finished image. The app
writes the prompt (the track's motif in the house style, see src/shared/subject-images.ts); the
helper only runs it. Nothing generative runs per frame: images are made ahead of time and saved.

The image stack (diffusers, transformers, accelerate) is installed by the setup scripts, not by
`uv sync`, because it rides on the CUDA build of PyTorch (see helper/README.md).
"""

from __future__ import annotations

import os
import random
import time
from dataclasses import dataclass
from typing import Any, Callable

from .gpu import gpu_lock
from .methods import HelperError, Progress

DEFAULT_MODEL = "black-forest-labs/FLUX.2-klein-4B"
# klein is distilled for 4 steps; more steps don't help it.
STEPS = 4
# The model works on 16-pixel patches; sizes are rounded to the nearest multiple.
SIZE_STEP = 16
MIN_SIZE, MAX_SIZE = 256, 2048
DEFAULT_SIZE = 1024
# Downloaded once on first use (about 16 GB: the 4B transformer and its Qwen3 text encoder), then reused.
MODEL_DIR = os.path.join(os.environ.get("ELYNT_MODEL_DIR", os.path.join(os.path.expanduser("~"), ".elynt", "models")), "huggingface")


@dataclass(frozen=True)
class ImageRequest:
    prompt: str
    width: int
    height: int
    seed: int
    steps: int
    model: str


# Runs the model and writes a PNG at out_path. Swapped out in tests.
Engine = Callable[[ImageRequest, str, Progress], None]


def generate_image(params: dict[str, Any], progress: Progress, engine: Engine | None = None) -> dict[str, Any]:
    prompt = params.get("prompt")
    out_path = params.get("outPath")
    if not isinstance(prompt, str) or not prompt.strip():
        raise HelperError("bad_request", "prompt is required")
    if not isinstance(out_path, str) or not out_path:
        raise HelperError("bad_request", "outPath is required")
    seed = params.get("seed")
    if not isinstance(seed, int):
        seed = random.randrange(2**31)
    request = ImageRequest(
        prompt=prompt.strip(),
        width=model_size(params.get("width")),
        height=model_size(params.get("height")),
        seed=seed,
        steps=STEPS,
        model=params.get("model") or DEFAULT_MODEL,
    )
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    progress("Waiting for the GPU")
    with gpu_lock:
        started = time.monotonic()
        (engine or generate_with_diffusers)(request, out_path, progress)
        seconds = round(time.monotonic() - started, 1)
    if not os.path.isfile(out_path):
        raise HelperError("generation_failed", "the image model wrote no image")
    return {
        "path": out_path,
        "seed": request.seed,
        "width": request.width,
        "height": request.height,
        "model": request.model,
        # Generation alone, not the wait for the GPU: the number to compare across runs.
        "seconds": float(seconds),
    }


def model_size(value: Any) -> int:
    """A side length the model takes: the nearest multiple of 16 within 256 to 2048."""
    if not isinstance(value, (int, float)) or value <= 0:
        return DEFAULT_SIZE
    rounded = int(value / SIZE_STEP + 0.5) * SIZE_STEP
    return max(MIN_SIZE, min(MAX_SIZE, rounded))


# The loaded pipeline, kept between calls: loading takes far longer than a 4-step image.
_pipeline: Any = None
_pipeline_model: str | None = None


def generate_with_diffusers(request: ImageRequest, out_path: str, progress: Progress) -> None:
    global _pipeline, _pipeline_model
    try:
        import torch
        from diffusers import Flux2KleinPipeline
    except ImportError as e:
        raise HelperError(
            "image_model_not_installed",
            f"the image model isn't installed ({e}). Re-run the helper setup script.",
        ) from e
    if not torch.cuda.is_available():
        raise HelperError("no_gpu", "the image model needs the CUDA GPU, and PyTorch can't see one")

    if _pipeline is None or _pipeline_model != request.model:
        progress("Loading the image model")
        _pipeline = None
        pipe = Flux2KleinPipeline.from_pretrained(request.model, torch_dtype=torch.bfloat16, cache_dir=MODEL_DIR)
        # The transformer and its text encoder together come close to the 5080's 16 GB; offloading
        # keeps only the part that is running on the GPU.
        pipe.enable_model_cpu_offload()
        _pipeline, _pipeline_model = pipe, request.model

    def on_step_end(_pipe: Any, step: int, _timestep: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
        progress("Generating", (step + 1) / request.steps)
        return kwargs

    progress("Generating", 0.0)
    image = _pipeline(
        prompt=request.prompt,
        width=request.width,
        height=request.height,
        num_inference_steps=request.steps,
        guidance_scale=1.0,
        generator=torch.Generator(device="cpu").manual_seed(request.seed),
        callback_on_step_end=on_step_end,
    ).images[0]
    progress("Saving the image")
    image.save(out_path, format="PNG")
