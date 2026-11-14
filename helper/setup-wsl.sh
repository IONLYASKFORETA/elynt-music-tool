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
uv pip install --python "$VENV/bin/python" torch torchaudio --index-url https://download.pytorch.org/whl/cu128

echo
echo "Helper venv ready at $VENV. Checking it:"
echo '{"id":1,"method":"helper.info"}' | "$VENV/bin/python" -m elynt_helper
