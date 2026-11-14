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

Write-Host "`nHelper venv ready in helper\.venv. Checking it:"
'{"id":1,"method":"helper.info"}' | .venv\Scripts\python.exe -m elynt_helper
