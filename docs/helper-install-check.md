# Helper install check (#47)

The question: do NATTEN, SongFormer, Essentia and pyebur128 install natively on Aden's Windows PC (RTX 5080, Python 3.12)? If any fails, the helper runs under WSL2.

**Outcome: the helper runs under WSL2 (ADR 0003).** Confirmed on Aden's PC on 2026-11-14: natively on Windows, PyTorch sees the RTX 5080 and pyebur128 installs, but Essentia, NATTEN and SongFormer's requirements fail. Inside WSL2 (Ubuntu) on the same PC, all of them install and PyTorch sees the GPU.

## 1. What PyPI publishes (checked 2026-11-13)

| Package | Latest | Windows wheel for Python 3.12 | Linux x86_64 wheel for Python 3.12 | Native Windows? |
|---|---|---|---|---|
| pyebur128 | 0.1.1 | yes (`cp312-win_amd64`) | yes | yes |
| Essentia | 2.1b6.dev1438 | **none, in any release ever** | yes (dev1389) | **no** |
| NATTEN | 0.21.7 | **none, in any release ever** (source only) | on whl.natten.org only, for the two newest torch releases and CUDA 12.6 / 13.0 / 13.2 | **no** |
| SongFormer | not on PyPI | installed from its GitHub repo | | needs its requirements |
| PyTorch | 2.15.0 | yes (`cp312-win_amd64`) | yes | yes |

SongFormer's own `requirements.txt` pins `torch==2.4.0`, which predates RTX 50 series (Blackwell) support. The helper keeps its own torch (2.13, CUDA 13.0) and installs the rest of SongFormer's list around it.

Two more of its pins can't install on Python 3.12 on any OS, so the check replaces them: `numpy==1.25.0` contradicts its own `pandas==2.2.3` (which needs numpy 1.26 or newer), and `jams==0.3.4` has no wheel and its setup script imports `imp`, which Python 3.12 removed (0.3.5 ships a wheel). With those fixed, the whole list resolves for Linux on Python 3.12 (181 packages). It does not resolve for Windows at all, because it needs `triton`, which has no Windows build. NATTEN has no wheel for CUDA 12.8, so the helper uses torch 2.13 with CUDA 13.0 and NATTEN's matching wheel. torchaudio is left out: PyTorch's last torchaudio release is 2.9.1, so none exists for torch 2.13. SongFormer lists torchaudio, so its audio loading will need to go through soundfile or librosa instead when it's wired in (V1). Under WSL2, `pesq` builds from source, so Ubuntu needs a C compiler (`sudo apt install build-essential`).

## 2. On Aden's machine

Run the check once inside WSL2 (and, if you're curious, once in Windows) from the repo's `helper` folder:

```sh
uv run python -m elynt_helper.install_check --out ../docs/install-check-wsl2.md
```

It builds a throwaway Python 3.12 venv, installs PyTorch 2.13 (CUDA 13.0) and confirms it sees the GPU, then tries pyebur128, Essentia, NATTEN and SongFormer's requirements one at a time. The report lands next to this file.

| Where | Result |
|---|---|
| Windows (native), 2026-11-14 | **wsl2**: 3 of 6 steps pass. See below. |
| WSL2 (Ubuntu), 2026-11-14 | **everything installs**: 6 of 6 steps pass. See below. |

### Windows 11 (native), 2026-11-14

Windows 11 build 26300, RTX 5080 (16 GB), driver 621.01, Python 3.12.11.

| Step | Result | Time | Why it failed |
|---|---|---|---|
| Python 3.12 venv | pass | 0 s | |
| PyTorch (CUDA 12.8, run before the switch to 13.0) sees the GPU | pass | 46 s | |
| pyebur128 | pass | 1 s | |
| Essentia | FAIL | 4 s | No Windows wheel; building from source crashes in its setup script (`IndexError: list index out of range`). |
| NATTEN | FAIL | 11 s | No wheel; building from source needs CMake (and then the CUDA toolkit). |
| SongFormer requirements | FAIL | 4 s | Its numpy pin contradicts its pandas pin (fixed in the check since). Would still fail on Windows: needs `triton`. |

### WSL2 (Ubuntu), 2026-11-14

Linux 6.18.58.1-microsoft-standard-WSL2, glibc 2.43, RTX 5080 seen through the Windows driver (621.01), gcc 15.2.

| Step | Result | Time |
|---|---|---|
| Python 3.12 venv | pass | 0 s |
| PyTorch 2.13.0 (CUDA 13.0) sees the GPU | pass | 4 s |
| pyebur128 | pass | 0 s |
| Essentia | pass | 1 s |
| NATTEN (`0.21.7+torch2130cu130` wheel) | pass | 6 s |
| SongFormer requirements | pass | 0 s (cached) |

Getting there took three runs, and each one found something that's now fixed in the check or the setup notes:

1. `torchaudio==2.13.0` doesn't exist, because torchaudio's last release is 2.9.1. It's dropped now.
2. Ubuntu had no C compiler, and `pesq` builds from source. Fixed by installing `build-essential`, which the README now lists.
3. In WSL2, `/tmp` is a 7.8 GB RAM disk, and the throwaway venv filled it. The check now builds its venv under `~/.cache/elynt-install-check`.

That run also showed that installing SongFormer's list pulled in a CUDA 12 torch from PyPI over our CUDA 13.0 one. The run checked the GPU before that step but not after it. The cause was SongFormer's `triton==3.0.0` pin, so the check now leaves triton out (torch brings its own) and holds torch at 2.13.0 with a constraint during that step, and it ends with a second GPU check that fails unless torch is still the `+cu130` build.
