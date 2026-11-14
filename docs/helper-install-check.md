# Helper install check (#47)

The question: do NATTEN, SongFormer, Essentia and pyebur128 install natively on Aden's Windows PC (RTX 5080, Python 3.12)? If any fails, the helper runs under WSL2.

**Outcome: the helper runs under WSL2 (ADR 0003).** Essentia and NATTEN publish no Windows builds, so a native Windows install can't work without building them from source.

## 1. What PyPI publishes (checked 2026-11-13)

| Package | Latest | Windows wheel for Python 3.12 | Linux x86_64 wheel for Python 3.12 | Native Windows? |
|---|---|---|---|---|
| pyebur128 | 0.1.1 | yes (`cp312-win_amd64`) | yes | yes |
| Essentia | 2.1b6.dev1438 | **none, in any release ever** | yes (dev1389) | **no** |
| NATTEN | 0.21.7 | **none, in any release ever** (source only) | source only, builds against torch | **no** |
| SongFormer | not on PyPI | installed from its GitHub repo | | needs its requirements |
| PyTorch | 2.15.0 | yes (`cp312-win_amd64`) | yes | yes |

SongFormer's own `requirements.txt` pins `torch==2.4.0`, which predates RTX 50 series (Blackwell) support. The helper keeps a CUDA 12.8 build of torch and installs the rest of SongFormer's list around it.

## 2. On Aden's machine

Run the check once inside WSL2 (and, if you're curious, once in Windows) from the repo's `helper` folder:

```sh
uv run python -m elynt_helper.install_check --out ../docs/install-check-wsl2.md
```

It builds a throwaway Python 3.12 venv, installs the CUDA 12.8 PyTorch and confirms it sees the GPU, then tries pyebur128, Essentia, NATTEN and SongFormer's requirements one at a time. The report lands next to this file.

| Where | Result |
|---|---|
| WSL2 | not run yet |
| Windows (native) | not run yet; expected to fail on Essentia and NATTEN per the table above |
