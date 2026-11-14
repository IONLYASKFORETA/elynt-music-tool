#!/usr/bin/env bash
# Sets up the Elynt helper inside WSL2 (the default on Windows, see ADR 0003).
# Run it from WSL, in this folder:   bash setup-wsl.sh
# The venv lives in WSL's own disk (fast), and the helper's code is installed
# editable from this repo, so pulling new code needs no re-run unless deps change.
set -euo pipefail
cd "$(dirname "$0")"

VENV="${ELYNT_HELPER_VENV:-$HOME/.elynt/helper-venv}"

if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

export UV_PROJECT_ENVIRONMENT="$VENV"
uv sync --inexact --python 3.12
uv pip install --python "$VENV/bin/python" torch==2.13.0 --index-url https://download.pytorch.org/whl/cu130
# NATTEN (used by section analysis) only ships prebuilt wheels for specific torch + CUDA builds.
uv pip install --python "$VENV/bin/python" "natten==0.21.7+torch2130cu130" --find-links https://whl.natten.org
# The stem splitter (BS-RoFormer via audio-separator). Installed after torch so it keeps the CUDA build above.
# The [cpu] extra is only its ONNX runtime, for models we do not use: RoFormer runs on torch, on the GPU.
# audioread: audio-separator imports it, but librosa 1.0 stopped pulling it in (found 2026-11-14).
# Its model (about 700 MB) downloads on the first split, into ~/.elynt/models.
uv pip install --python "$VENV/bin/python" "audio-separator[cpu]==0.48.0" audioread

echo
echo "Helper venv ready at $VENV. Checking it:"
echo '{"id":1,"method":"helper.info"}' | "$VENV/bin/python" -m elynt_helper
