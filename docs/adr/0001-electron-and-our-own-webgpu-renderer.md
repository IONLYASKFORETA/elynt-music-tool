# Electron shell with our own WebGPU renderer, not a game engine

Elynt Music Tool is one Electron app that hosts all three tools. The Visualizer renders with our own WebGPU shaders, not Unreal, Unity, TouchDesigner or Notch. We chose this because the house style is pure shader work with no photoreal 3D, and the app itself has to generate scenes from a vision, which is far easier against our own layer data model than against an engine's project format. Every tool in the suite also needs a normal app UI. We picked Electron over Tauri because it pins its own Chromium, so the WebGPU stack can't change underneath us when Windows updates WebView2.

## Consequences

- Export renders offline, frame by frame, at exact beat-grid times, and pipes the frames to FFmpeg using NVENC on the RTX 5080. Nothing is ever screen-captured.
- Heavy AI work (stem separation, track analysis, local image generation) runs in a local Python/CUDA helper process. Claude and Gemini are called over their APIs using the owner's keys, which are kept in the Windows credential vault.
- If 4K export is too slow inside Electron, only the export renderer moves to a native wgpu helper that runs the same WGSL shaders. Benchmark this first in the build.
