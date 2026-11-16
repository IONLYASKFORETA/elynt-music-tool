import json
from pathlib import Path

import pytest

from elynt_helper import images
from elynt_helper.server import handle_line

# Enough of a PNG for the helper to see a file was written; the fake engine never draws anything.
PNG = b"\x89PNG\r\n\x1a\n"


def fake_engine(seen=None):
    """Stands in for FLUX.2 klein at the helper seam: reports each step and writes a file."""

    def generate(request, out_path, progress):
        if seen is not None:
            seen.append(request)
        for step in range(request.steps):
            progress("Generating", (step + 1) / request.steps)
        Path(out_path).write_bytes(PNG)

    return generate


def test_generates_one_image_to_the_path_given(tmp_path):
    out = tmp_path / "subjects" / "1.png"
    progress = []
    seen = []
    result = images.generate_image(
        {"prompt": "a chrome mecha", "outPath": str(out), "seed": 42},
        lambda stage, fraction=None: progress.append((stage, fraction)),
        engine=fake_engine(seen),
    )
    assert out.read_bytes() == PNG
    assert result["path"] == str(out)
    assert result["seed"] == 42
    assert result["model"] == images.DEFAULT_MODEL
    assert (result["width"], result["height"]) == (1024, 1024)
    assert isinstance(result["seconds"], float)
    # The distilled klein model takes 4 steps; each reports how far it has got.
    assert seen[0].steps == 4 and seen[0].prompt == "a chrome mecha"
    assert ("Generating", 1.0) in progress


def test_picks_a_seed_when_none_is_given_and_reports_it(tmp_path):
    seen = []
    result = images.generate_image(
        {"prompt": "a sigil", "outPath": str(tmp_path / "a.png")}, lambda *a: None, engine=fake_engine(seen)
    )
    assert isinstance(result["seed"], int)
    assert seen[0].seed == result["seed"]


def test_size_is_rounded_to_what_the_model_takes(tmp_path):
    seen = []
    result = images.generate_image(
        {"prompt": "a figure", "outPath": str(tmp_path / "a.png"), "width": 1000, "height": 1500},
        lambda *a: None,
        engine=fake_engine(seen),
    )
    assert (seen[0].width, seen[0].height) == (1008, 1504)
    assert (result["width"], result["height"]) == (1008, 1504)


@pytest.mark.parametrize(
    "params",
    [{"outPath": "/tmp/x.png"}, {"prompt": "  ", "outPath": "/tmp/x.png"}, {"prompt": "a mecha"}],
)
def test_prompt_and_out_path_are_required(params):
    with pytest.raises(images.HelperError) as e:
        images.generate_image(params, lambda *a: None, engine=fake_engine())
    assert e.value.code == "bad_request"


def test_an_engine_that_writes_nothing_is_a_coded_error(tmp_path):
    with pytest.raises(images.HelperError) as e:
        images.generate_image(
            {"prompt": "a mecha", "outPath": str(tmp_path / "a.png")}, lambda *a: None, engine=lambda *a: None
        )
    assert e.value.code == "generation_failed"


def test_without_the_image_stack_says_to_rerun_setup(tmp_path, monkeypatch):
    import builtins

    real_import = builtins.__import__

    def no_diffusers(name, *args, **kwargs):
        if name.startswith("diffusers"):
            raise ImportError("No module named 'diffusers'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_diffusers)
    response = handle_line(
        json.dumps({"id": 3, "method": "image.generate", "params": {"prompt": "a mecha", "outPath": str(tmp_path / "a.png")}})
    )
    assert response["error"]["code"] == "image_model_not_installed"
