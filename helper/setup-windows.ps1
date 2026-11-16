# Sets up the Elynt helper natively on Windows, in helper\.venv.
# Only for ELYNT_HELPER_MODE=native. The default on Windows is WSL2 (ADR 0003),
# because Essentia and NATTEN publish no Windows wheels.
# Run from PowerShell, in this folder:   .\setup-windows.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

uv sync --inexact --python 3.12
uv pip install --python .venv\Scripts\python.exe torch==2.13.0 --index-url https://download.pytorch.org/whl/cu130
# The stem splitter (BS-RoFormer via audio-separator). Installed after torch so it keeps the CUDA build above.
# The [cpu] extra is only its ONNX runtime, for models we do not use: RoFormer runs on torch, on the GPU.
uv pip install --python .venv\Scripts\python.exe "audio-separator[cpu]==0.48.0" audioread
# Beat This! for track analysis, without letting it replace torch (see setup-wsl.sh).
uv pip install --python .venv\Scripts\python.exe "einops>=0.8" "soxr>=0.5"
uv pip install --python .venv\Scripts\python.exe --no-deps "beat-this==1.1.0" "rotary-embedding-torch==0.9.2"
# Subject images (V9): FLUX.2 [klein] 4B through diffusers, after torch so the CUDA build stays (see setup-wsl.sh).
uv pip install --python .venv\Scripts\python.exe "diffusers>=0.37" "transformers>=4.57" "accelerate>=1.10" sentencepiece

Write-Host "`nHelper venv ready in helper\.venv. Checking it:"
'{"id":1,"method":"helper.info"}' | .venv\Scripts\python.exe -m elynt_helper
