# Elynt helper

The local Python process that does the suite's heavy work: track analysis, stem separation, image generation, Live Set parsing and measurement (ADR 0001). The app starts it on launch, restarts it if it dies, and shows its status at the bottom of the sidebar.

On Windows it runs inside WSL2 (ADR 0003). Python is pinned to 3.12.

## Set it up on Aden's PC (WSL2, the default)

1. Install WSL2 with Ubuntu if it isn't there yet, from PowerShell: `wsl --install -d Ubuntu`, then restart.
2. In Ubuntu, install a C compiler for the packages that build from source: `sudo apt update && sudo apt install -y build-essential`.
3. Make sure the NVIDIA Windows driver is current. Don't install a Linux NVIDIA driver inside WSL; the Windows one covers it.
4. Open Ubuntu and run this repo's setup script (the repo is visible under `/mnt/c/...` or `/mnt/d/...`):

   ```sh
   bash /mnt/c/path/to/elynt-music-tool/helper/setup-wsl.sh
   ```

   It installs `uv`, makes a venv at `~/.elynt/helper-venv`, installs the helper, PyTorch 2.13 (CUDA 13.0; there is no matching torchaudio) and NATTEN's matching wheel, then prints the helper's own report. Look for `"available":true` and `RTX 5080` in the `gpu` part.
5. Start the app (`npm run dev`). The sidebar should say **Helper running** with the GPU name.

Native Windows instead: run `helper\setup-windows.ps1` and start the app with `ELYNT_HELPER_MODE=native`.

## Stem splitting

`stems.split` splits a mixdown into stems with BS-RoFormer SW (via `audio-separator`, installed by the setup scripts after PyTorch). The model (about 700 MB) downloads on the first split into `~/.elynt/models` (override with `ELYNT_MODEL_DIR`). It writes one WAV per stem into the folder the app gives it, drops stems that are silent all the way through, and sends progress lines while it works. One split runs at a time on the GPU.

## Subject images

`image.generate` (V9) makes one subject image for the Visualizer's Subject layer with FLUX.2 [klein] 4B (Black Forest Labs, Apache 2.0) through diffusers, installed by the setup scripts after PyTorch. The app writes the prompt (the motif in the house style, on black or off-white, in the track's colors); the helper runs 4 steps, writes a PNG where the app asks, and answers with the seed and how many seconds generation took. The app keeps both with the image. The weights (about 16 GB with the text encoder) download on the first image into `~/.elynt/models/huggingface`, and the pipeline stays loaded afterwards. It shares one GPU lock with stem splitting, so the two never run at once. Tests use a fake engine (`tests/test_images.py`), so they need no GPU.

## Settings

| Variable | What it does |
|---|---|
| `ELYNT_HELPER_MODE` | `wsl` (default on Windows) or `native` (default elsewhere) |
| `ELYNT_HELPER_WSL_DISTRO` | Which WSL distro to use, if not the default one |
| `ELYNT_HELPER_WSL_PYTHON` | The Python inside WSL (default `$HOME/.elynt/helper-venv/bin/python`) |
| `ELYNT_MODEL_DIR` | Where model weights are kept (default `~/.elynt/models`) |
| `ELYNT_HELPER_PYTHON` | Native mode: any Python with the helper installed (default `helper/.venv`) |

## Protocol

One JSON object per line over stdin/stdout, described in `src/elynt_helper/server.py`. Each call runs on its own thread, and long calls send `progress` lines for their id before the answer. The calls are listed in `src/elynt_helper/methods.py` and mirrored as types in `src/shared/helper.ts`; change both together and bump the protocol version when a shape changes.

## Develop and test

```sh
cd helper
uv sync          # Python 3.12 venv in helper/.venv with the dev tools
uv run pytest
```

The app's own tests (`npm test`) use a Node stand-in for this helper, so they run without Python.

## Live Set reader

`liveset.read` (M1) reads an Ableton Live .als (gzipped XML, Live 10 to 12) and returns its Live tracks, returns and main track with grouping, routing, mixer values, sends and device chains, racks included (`src/elynt_helper/live_set.py`). Native device parameters come with their stored values and ranges; third-party plug-ins and Max for Live devices are listed by name and ID only. Anything missing is `"unknown"`, never an error. Every call logs the Set's `Creator` and `MinorVersion` to stderr. Fixtures are in `tests/fixtures/live-sets`: pyableton's Live 11.1.5 test Set (MIT) and hand-made Live 10 and 12 Sets.

## Track analysis

`track.analyze` (V1) reads a mixdown and returns tempo, beats, downbeats, sections, an energy curve and a coarse mood (`src/elynt_helper/analysis/`). The app runs it when a track is added and saves the result on the track.

- **Beats** come from Beat This! when it is installed (the setup scripts install it), snapped to one constant-tempo grid. Without it, a built-in signal-processing tracker does the job. The model's weights (about 80 MB) download once on first use.
- Beat This! asks for torchaudio, which has no build for torch 2.13. It only uses torchaudio for one mel spectrogram, so the helper provides that class itself when torchaudio is missing (`beat_this_engine.py`, checked against librosa in `tests/test_beat_this_stand_in.py`).
- **Sections** (intro, build, drop, breakdown, outro) come from energy and low-end heuristics on four-bar phrases, because no model labels builds or drops (research #6).
- The results on the three test tracks are in `docs/track-analysis-check.md`.

## Install check

`uv run python -m elynt_helper.install_check` checks whether NATTEN, SongFormer, Essentia and pyebur128 install on the current machine. Results are in `docs/helper-install-check.md`.
