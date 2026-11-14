# Elynt helper

The local Python process that does the suite's heavy work: track analysis, stem separation, image generation, Live Set parsing and measurement (ADR 0001). The app starts it on launch, restarts it if it dies, and shows its status at the bottom of the sidebar.

On Windows it runs inside WSL2 (ADR 0003). Python is pinned to 3.12.

## Set it up on Aden's PC (WSL2, the default)

1. Install WSL2 with Ubuntu if it isn't there yet, from PowerShell: `wsl --install -d Ubuntu`, then restart.
2. Make sure the NVIDIA Windows driver is current. Don't install a Linux NVIDIA driver inside WSL; the Windows one covers it.
3. Open Ubuntu and run this repo's setup script (the repo is visible under `/mnt/c/...` or `/mnt/d/...`):

   ```sh
   bash /mnt/c/path/to/elynt-music-tool/helper/setup-wsl.sh
   ```

   It installs `uv`, makes a venv at `~/.elynt/helper-venv`, installs the helper and the CUDA 12.8 build of PyTorch, then prints the helper's own report. Look for `"available":true` and `RTX 5080` in the `gpu` part.
4. Start the app (`npm run dev`). The sidebar should say **Helper running** with the GPU name.

Native Windows instead: run `helper\setup-windows.ps1` and start the app with `ELYNT_HELPER_MODE=native`.

## Settings

| Variable | What it does |
|---|---|
| `ELYNT_HELPER_MODE` | `wsl` (default on Windows) or `native` (default elsewhere) |
| `ELYNT_HELPER_WSL_DISTRO` | Which WSL distro to use, if not the default one |
| `ELYNT_HELPER_WSL_PYTHON` | The Python inside WSL (default `$HOME/.elynt/helper-venv/bin/python`) |
| `ELYNT_HELPER_PYTHON` | Native mode: any Python with the helper installed (default `helper/.venv`) |

## Protocol

One JSON object per line over stdin/stdout, described in `src/elynt_helper/server.py`. The calls are listed in `src/elynt_helper/methods.py` and mirrored as types in `src/shared/helper.ts`; change both together and bump the protocol version when a shape changes.

## Develop and test

```sh
cd helper
uv sync          # Python 3.12 venv in helper/.venv with the dev tools
uv run pytest
```

The app's own tests (`npm test`) use a Node stand-in for this helper, so they run without Python.

## Install check

`uv run python -m elynt_helper.install_check` checks whether NATTEN, SongFormer, Essentia and pyebur128 install on the current machine. Results are in `docs/helper-install-check.md`.
