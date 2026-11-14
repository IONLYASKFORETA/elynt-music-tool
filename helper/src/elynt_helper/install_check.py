"""Install check: do the analysis stack's hard dependencies install on this machine?

Run it on Aden's PC, once in Windows and once inside WSL2:

    uv run python -m elynt_helper.install_check --out install-check-windows.md

It builds a throwaway Python 3.12 venv (so the helper's own venv is never touched),
installs the CUDA build of PyTorch, then tries pyebur128, Essentia, NATTEN and
SongFormer's requirements one at a time. Each step records pass or fail with the
tail of its output. The verdict is "native" when everything passes and "wsl2"
otherwise (ADR 0003). Needs `uv` on PATH and a network connection.
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

TORCH_INDEX = "https://download.pytorch.org/whl/cu128"
SONGFORMER_REQUIREMENTS = "https://raw.githubusercontent.com/ASLP-lab/SongFormer/main/requirements.txt"
# SongFormer pins torch 2.4, which predates Blackwell (RTX 50 series) support.
# We keep our CUDA 12.8 torch and install the rest of its list around it.
SONGFORMER_SKIP = ("torch", "torchaudio", "torchvision")


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
            "PyTorch (CUDA 12.8) sees the GPU",
            [
                self.pip("torch", "torchaudio", "--index-url", TORCH_INDEX),
                self.py(
                    "import torch; assert torch.cuda.is_available(), 'CUDA not available'; "
                    "print(torch.__version__, torch.cuda.get_device_name(0))"
                ),
            ],
        )
        self.step("pyebur128", [self.pip("pyebur128"), self.py("import pyebur128")])
        self.step("Essentia", [self.pip("essentia"), self.py("import essentia.standard")])
        self.step(
            "NATTEN",
            [
                self.pip("natten", "--no-build-isolation"),
                self.py("import natten; print(natten.__version__)"),
            ],
            note="Builds against the installed torch; needs the CUDA toolkit if no wheel matches.",
        )
        self.songformer()

    def songformer(self) -> None:
        start = time.monotonic()
        try:
            with urllib.request.urlopen(SONGFORMER_REQUIREMENTS, timeout=30) as r:
                lines = r.read().decode().splitlines()
        except OSError as e:
            self.steps.append(Step("SongFormer requirements", False, time.monotonic() - start, tail=[str(e)]))
            return
        keep = [line for line in lines if requirement_name(line) not in ("", *SONGFORMER_SKIP)]
        req = self.workdir / "songformer-requirements.txt"
        req.write_text("\n".join(keep) + "\n")
        self.step(
            "SongFormer requirements",
            [self.pip("-r", str(req))],
            note="Installs SongFormer's pinned list minus torch/torchaudio (kept at the CUDA 12.8 build).",
        )


def requirement_name(line: str) -> str:
    """The package name of a requirements.txt line, lowercased; "" for blanks and comments."""
    match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", line.split("#", 1)[0])
    return match.group(1).lower() if match else ""


def gpu_line() -> str:
    smi = shutil.which("nvidia-smi")
    if not smi:
        return "nvidia-smi not found"
    ok, out = run([smi, "--query-gpu=name,driver_version", "--format=csv,noheader"], timeout=20)
    return out.strip().splitlines()[0] if ok and out.strip() else "nvidia-smi failed"


def report(steps: list[Step]) -> str:
    is_wsl = "microsoft" in platform.release().lower()
    where = "WSL2" if is_wsl else platform.system()
    verdict = "native" if steps and all(s.ok for s in steps) else "wsl2"
    lines = [
        f"# Helper install check: {where}",
        "",
        f"- Run: {dt.datetime.now().astimezone().isoformat(timespec='minutes')}",
        f"- OS: {platform.platform()}",
        f"- GPU: {gpu_line()}",
        f"- Verdict: **{verdict}**" + ("" if verdict == "native" else " (at least one step failed here)"),
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

    workdir = Path(tempfile.mkdtemp(prefix="elynt-install-check-"))
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
