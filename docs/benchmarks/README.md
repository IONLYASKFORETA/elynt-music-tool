# Export benchmarks

Ticket #54 (V5) asks whether a 4K60 export inside Electron is fast enough, or
whether only the export renderer should move to a native wgpu helper running
the same WGSL shaders (ADR 0001). Targets, as wall-clock time over video time:

- 3840×2160 60 fps: under 10× real time
- 1920×1080 60 fps: under 3× real time

## Running it

On the PC with the RTX card, from the repo:

```
npm ci
npm run build
npx electron . --bench-export="D:\path\to\flip.wav" --bench-out=docs/benchmarks/<date>-flip-<gpu>.md
```

The app opens a window showing progress, exports the track at 4K and 1080p
with NVENC into a temp folder, checks the files, writes the report (and a
`.json` beside it) and quits. It uses a throwaway library, never your own.

Options: `--bench-encoder=x264` (no NVIDIA card), `--bench-formats=youtube-1080p60`,
`--bench-seconds=10` (render only the start).

## What the report checks

- **Export vs preview**: the same frame drawn by the preview onto its canvas and
  by the export offscreen, compared pixel by pixel. Must match exactly (largest
  difference at most 1 of 255).
- **Frames and sync**: the file's audio and video end within one frame of each
  other, and a frame decoded from the middle of the file matches its own render
  better than the renders either side of it.
- **Bitrate**: with NVENC, the 4K file's video bitrate sits in YouTube's
  53 to 68 Mbps band.
- **Speed**: against the targets above. A miss doesn't fail the run; it's what
  decides whether the native export helper gets built.

`npm run check:export` runs the same checks on a generated one-second clip with
software WebGPU and x264. CI runs it on every PR.
