"""Install check: do the analysis stack's hard dependencies install on this machine?

Run it on Aden's PC, once in Windows and once inside WSL2:

    uv run python -m elynt_helper.install_check --out install-check-windows.md

It builds a throwaway Python 3.12 venv (so the helper's own venv is never touched),
installs the CUDA build of PyTorch, then tries pyebur128, Essentia, NATTEN and
SongFormer's requirements one at a time. Each step records pass or fail with the
tail of its output. A last step checks the GPU again, because SongFormer's list can
swap the CUDA build of torch for another one. The verdict says whether the whole
stack installs on this machine (ADR 0003). Needs `uv` on PATH and a network connection.
"""

from __future__ import annotations

import argparse
import datetime as dt
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

# NATTEN only publishes wheels for the two newest torch releases, on its own index, and not
# for CUDA 12.8. torch 2.13 + CUDA 13.0 has a NATTEN wheel and supports the RTX 5080.
TORCH_VERSION = "2.13.0"
TORCH_INDEX = "https://download.pytorch.org/whl/cu130"
NATTEN_WHEEL = "natten==0.21.7+torch2130cu130"
NATTEN_INDEX = "https://whl.natten.org"
SONGFORMER_REQUIREMENTS = "https://raw.githubusercontent.com/ASLP-lab/SongFormer/main/requirements.txt"
# SongFormer pins torch 2.4, which predates Blackwell (RTX 50 series) support.
# We keep our CUDA 13.0 torch and install the rest of its list around it.
GPU_CHECK = (
    "import torch; assert torch.cuda.is_available(), 'CUDA not available'; "
    "torch.ones(1, device='cuda'); print(torch.__version__, torch.cuda.get_device_name(0))"
)
# triton too: its pin (3.0.0) is what dragged in an old CUDA 12 torch; torch brings its own.
SONGFORMER_SKIP = ("torch", "torchaudio", "torchvision", "triton")
# Pins in its list that can't install on Python 3.12 (found 2026-11-14):
# - numpy==1.25.0 contradicts pandas==2.2.3, which needs numpy>=1.26.
# - jams==0.3.4 is source-only and its setup.py imports `imp`, gone in 3.12; 0.3.5 ships a wheel.
SONGFORMER_OVERRIDES = {"numpy": "numpy>=1.26,<2", "jams": "jams>=0.3.5"}


@dataclass
class Step:
    name: str
    ok: bool
    seconds: float
    note: str = ""
    tail: list[str] = field(default_factory=list)


def run(cmd: list[str], timeout: int = 3600) -> tuple[bool, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, f"timed out after {timeout}s"
    except OSError as e:
        return False, str(e)
    return p.returncode == 0, (p.stdout or "") + (p.stderr or "")


def tail(text: str, n: int = 25) -> list[str]:
    return [line for line in text.strip().splitlines() if line.strip()][-n:]


class Checker:
    def __init__(self, workdir: Path) -> None:
        self.workdir = workdir
        self.venv = workdir / "venv"
        self.python = self.venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        self.steps: list[Step] = []

    def step(self, name: str, cmds: list[list[str]], note: str = "") -> bool:
        start = time.monotonic()
        output = ""
        ok = True
        for cmd in cmds:
            ok, out = run(cmd)
            output += out
            if not ok:
                break
        self.steps.append(Step(name, ok, time.monotonic() - start, note, [] if ok else tail(output)))
        print(f"{'PASS' if ok else 'FAIL'}  {name}", file=sys.stderr)
        return ok

    def pip(self, *args: str) -> list[str]:
        return ["uv", "pip", "install", "--python", str(self.python), *args]

    def py(self, code: str) -> list[str]:
        return [str(self.python), "-c", code]

    def run_all(self) -> None:
        if not self.step("Python 3.12 venv", [["uv", "venv", "--python", "3.12", str(self.venv)]]):
            return
        self.step(
            f"PyTorch {TORCH_VERSION} (CUDA 13.0) sees the GPU",
            [
                # No torchaudio pin: there is no torchaudio 2.13.
                self.pip(f"torch=={TORCH_VERSION}", "--index-url", TORCH_INDEX),
                self.py(GPU_CHECK),
            ],
        )
        self.step("pyebur128", [self.pip("pyebur128"), self.py("import pyebur128")])
        self.step("Essentia", [self.pip("essentia"), self.py("import essentia.standard")])
        self.step(
            "NATTEN",
            [
                self.pip(NATTEN_WHEEL, "--find-links", NATTEN_INDEX),
                self.py("import natten; print(natten.__version__)"),
            ],
            note=f"Prebuilt wheel {NATTEN_WHEEL} from {NATTEN_INDEX}. NATTEN publishes Linux wheels only.",
        )
        self.songformer()
        self.step(
            "GPU still works after everything",
            [self.py(GPU_CHECK + f"; assert torch.__version__.startswith('{TORCH_VERSION}+cu130'), torch.__version__")],
            note="SongFormer's list must not replace the CUDA 13.0 torch.",
        )

    def songformer(self) -> None:
        start = time.monotonic()
        try:
            with urllib.request.urlopen(SONGFORMER_REQUIREMENTS, timeout=30) as r:
                lines = r.read().decode().splitlines()
        except OSError as e:
            self.steps.append(Step("SongFormer requirements", False, time.monotonic() - start, tail=[str(e)]))
            return
        keep = songformer_requirements(lines)
        req = self.workdir / "songformer-requirements.txt"
        req.write_text("\n".join(keep) + "\n")
        # Hold torch at the CUDA 13.0 build: without this, a dependency pulls a CUDA 12 torch
        # from PyPI over it (seen on Aden's PC, 2026-11-14).
        constraints = self.workdir / "constraints.txt"
        constraints.write_text(f"torch=={TORCH_VERSION}\n")
        self.step(
            "SongFormer requirements",
            [self.pip("-r", str(req), "--constraint", str(constraints), "--extra-index-url", TORCH_INDEX, "--index-strategy", "unsafe-best-match")],
            note="Installs SongFormer's pinned list minus torch/torchaudio/torchvision/triton (torch kept at the CUDA 13.0 build), with the numpy and jams pins fixed for Python 3.12.",
        )


def requirement_name(line: str) -> str:
    """The package name of a requirements.txt line, lowercased; "" for blanks and comments."""
    match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", line.split("#", 1)[0])
    return match.group(1).lower() if match else ""


def songformer_requirements(lines: list[str]) -> list[str]:
    """SongFormer's requirements.txt without torch, and with its broken pins replaced."""
    out = []
    for line in lines:
        name = requirement_name(line)
        if name in ("", *SONGFORMER_SKIP):
            continue
        out.append(SONGFORMER_OVERRIDES.get(name, line.strip()))
    return out


def gpu_line() -> str:
    smi = shutil.which("nvidia-smi")
    if not smi:
        return "nvidia-smi not found"
    ok, out = run([smi, "--query-gpu=name,driver_version", "--format=csv,noheader"], timeout=20)
    return out.strip().splitlines()[0] if ok and out.strip() else "nvidia-smi failed"


def report(steps: list[Step]) -> str:
    is_wsl = "microsoft" in platform.release().lower()
    where = "WSL2" if is_wsl else platform.system()
    all_ok = bool(steps) and all(s.ok for s in steps)
    verdict = f"the whole stack installs on {where}" if all_ok else f"not everything installs on {where}"
    lines = [
        f"# Helper install check: {where}",
        "",
        f"- Run: {dt.datetime.now().astimezone().isoformat(timespec='minutes')}",
        f"- OS: {platform.platform()}",
        f"- GPU: {gpu_line()}",
        f"- Verdict: **{verdict}**",
        "",
        "| Step | Result | Time |",
        "|---|---|---|",
    ]
    lines += [f"| {s.name} | {'pass' if s.ok else 'FAIL'} | {s.seconds:.0f} s |" for s in steps]
    for s in steps:
        if s.note or s.tail:
            lines += ["", f"## {s.name}", ""]
            if s.note:
                lines.append(s.note)
            if s.tail:
                lines += ["", "```", *s.tail, "```"]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, help="write the Markdown report here as well as to stdout")
    parser.add_argument("--keep", action="store_true", help="keep the scratch venv for poking at")
    args = parser.parse_args(argv)

    if shutil.which("uv") is None:
        print("uv is not on PATH. Install it first: https://docs.astral.sh/uv/", file=sys.stderr)
        return 2

    # Not /tmp: in WSL2 that's a small RAM disk, and the venv (torch, CUDA libs) fills it.
    base = Path.home() / ".cache" / "elynt-install-check"
    base.mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="run-", dir=base))
    checker = Checker(workdir)
    try:
        checker.run_all()
    finally:
        if not args.keep:
            shutil.rmtree(workdir, ignore_errors=True)

    text = report(checker.steps)
    print(text)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    return 0 if all(s.ok for s in checker.steps) else 1


if __name__ == "__main__":
    sys.exit(main())
