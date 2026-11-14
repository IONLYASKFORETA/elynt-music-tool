# The Python helper runs inside WSL2 on Windows

The heavy-work helper from ADR 0001 runs as a Linux process inside WSL2 on Aden's Windows PC, not as a native Windows Python. The app spawns it through `wsl.exe` and talks to it over stdin/stdout. We chose this because two of the four packages the analysis stack depends on publish no Windows builds at all: Essentia has never shipped a Windows wheel on PyPI, and NATTEN ships source only and doesn't support Windows. Building either one from source on Windows is the kind of yak-shave that eats a week. Under WSL2 all four install from Linux wheels, and the GPU is still reachable, because WSL2 passes the RTX 5080 through to CUDA via the Windows NVIDIA driver.

## Consequences

- Python is pinned to 3.12 (pyebur128 and the analysis stack target it). PyTorch comes from PyTorch's CUDA 12.8 index, since the RTX 50 series (Blackwell) needs torch 2.7 or newer.
- SongFormer pins torch 2.4, which predates Blackwell. We install its other requirements and keep our newer torch.
- The app turns Windows paths into WSL paths before sending them (`D:\Music Projects\x.wav` becomes `/mnt/d/Music Projects/x.wav`). Network paths (`\\nas\...`) aren't supported.
- Reading audio from `/mnt/<drive>` is slower than from WSL's own disk. That's fine for analysis; revisit if stem separation turns out to be I/O bound.
- `ELYNT_HELPER_MODE=native` still runs the helper natively from `helper\.venv`, for the day the Windows wheels exist.
- The evidence and Aden's on-machine install check live in `docs/helper-install-check.md`. If that check shows a native install works after all, this ADR gets superseded.
- Decided in #47 on 2026-11-13. Builds on ADR 0001.
