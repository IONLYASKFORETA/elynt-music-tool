# Rendering engine and app shell for the Visualizer

Research for issue #7, part of map #4. Researched 2026-11-13.

## Question

What are the realistic options for rendering VFX-quality, audio-reactive visuals and exporting them as frame-accurate video on Windows (RTX 5080, i9-10850K, 32 GB RAM), inside a desktop app that also hosts the Mix & Master Assistant and the Release Assistant?

Candidates compared:

- a web-tech shell (Electron or Tauri) with WebGPU, WebGL, or three.js
- a native GPU stack (wgpu, Vulkan, or DirectX)
- existing engines and tools (Unreal, Unity, TouchDesigner, Notch)

This file lays out options and trade-offs. The choice is made later, in grilling ticket #11.

## Short answer

- **Offline export makes every option fast enough.** The Visualizer renders a video. It doesn't perform live (see map #4, Out of scope). So each frame only has to be correct, not fast. With the track analysis computed ahead of time and time driven by the frame number, 4K60 is reachable in every option. The things that actually separate the options are the visual ceiling, how well each one hosts the rest of the suite's UI, and licensing.
- **The RTX 5080 has two NVENC encoders.** FFmpeg reaches them through `h264_nvenc`, `hevc_nvenc` and `av1_nvenc`. This works the same whichever renderer produces the frames, so the video encoder doesn't decide the engine.
- **Web shells are best at UI.** The other two tools are mostly UI. WebGPU on Windows runs on D3D12 and gives compute shaders. three.js has a WebGPU renderer with its own shader language, TSL. Their limits: the WebGPU renderer is still "experimental", and the browser sandbox stands between the renderer and the GPU and encoder.
- **A native wgpu renderer has the highest ceiling of anything you write yourself.** It can sit next to a web UI, as a Rust core under Tauri or as a sidecar process for Electron. The cost is engineering effort, since you build the whole renderer.
- **Engines give the highest visual ceiling straight away, but they are hard to make into a normal app.** Unreal has the path tracer and Movie Render Queue. Notch has a path tracer. TouchDesigner has a large toolkit. None of them is a natural host for the suite's forms and chat UI. Each needs to be driven by the app, or embedded, which only TouchDesigner offers (TouchEngine).
- **Licences.** Unreal and Unity are free at Aden's scale. TouchDesigner needs Commercial ($600) for anything above 1280×1280 and for H.264/H.265/AV1 export. Notch Indie ($279/yr) is capped at 1080p export, so 4K needs Notch VFX (about $1,399/yr).

## Constraint that frames the comparison

The Visualizer exports a rendered video. It is not a live visual (map #4, Out of scope: "Live performance, VJ use, and OBS streaming overlays"). This matters in two ways:

1. **Frame-accurate output.** Every stack can produce it if time is set from the frame number (`t = frame / fps`) rather than the wall clock. The audio-driven parameters also have to come from analysis done ahead of time, not from a live FFT. Unity Recorder's "Constant" mode is built this way: it uses "the same time interval between each recorded frame without regard to the time required to render the frame" ([Unity Recorder: recording properties](https://docs.unity3d.com/Packages/com.unity.recorder@5.1/manual/RecorderWindowRecordingProperties.html)). TouchDesigner's Movie File Out TOP says "recording a movie without frame drops can be done in non-realtime" ([Movie File Out TOP](https://derivative.ca/UserGuide/Movie_File_Out_TOP)). In a custom stack (web or native), you write this frame loop yourself.
2. **4K60 is a render-time budget, not a pass/fail test.** If a heavy 4K frame takes 200 ms, a 3-minute track at 60 fps (10,800 frames) takes about 36 minutes. That is acceptable for an export job. The real limit is the visual ceiling and how complex a scene can be.

## Encoding: shared by every option

- NVIDIA's FFmpeg guide: "The NVENC plugin in FFMPEG supports the following codecs: h264_nvenc … hevc_nvenc … av1_nvenc" ([NVIDIA: Using FFmpeg with NVIDIA GPU Hardware Acceleration, SDK 13.0](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)). Building FFmpeg with NVENC uses the "non free" configuration (same source). That is fine for a personal tool, but it matters if the app is ever distributed.
- The RTX 5080 has "two encoders and two decoders". The 5090 has three ([NVIDIA blog: RTX 50 Series for creators](https://blogs.nvidia.com/blog/generative-ai-studio-ces-geforce-rtx-50-series/)). The same post describes a new AV1 Ultra Quality mode that "achieves 5% more compression at the same quality".
- Blackwell's NVENC adds 4:2:2 chroma for H.264 and HEVC, 10-bit H.264, and UHQ tuning for HEVC and AV1 ([NVIDIA: Video Codec SDK 13.0 powered by Blackwell](https://developer.nvidia.com/blog/nvidia-video-codec-sdk-13-0-powered-by-nvidia-blackwell/)).
- Getting frames to the encoder, by stack:
  - Engines have built-in exporters. Unreal Movie Render Queue writes EXR, PNG, ProRes and DNx, and has a "Command Line Encoder" that can "create your own output format from third party software, such as FFmpeg", paired with an image-sequence export ([Unreal: cinematic rendering export formats](https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-rendering-export-formats-in-unreal-engine)). TouchDesigner encodes H.264, H.265 and AV1 on NVIDIA GPUs, and also writes ProRes, HAP and NotchLC ([Movie File Out TOP](https://derivative.ca/UserGuide/Movie_File_Out_TOP)).
  - A custom stack reads frames back from the GPU and pipes raw frames into `ffmpeg -f rawvideo … -c:v hevc_nvenc`. The alternative is calling the NVENC SDK directly, keeping frames on the GPU. In the browser, WebCodecs `VideoEncoder` accepts `hardwareAcceleration: "prefer-hardware"` ([MDN: VideoEncoder](https://developer.mozilla.org/docs/Web/API/VideoEncoder/VideoEncoder)). It only produces encoded chunks, though, so muxing and audio still have to be done separately.
  - Rough readback cost (my arithmetic, not from a source): a 4K RGBA8 frame is about 33 MB. 10,800 frames is about 360 GB pushed through a pipe. Encoding offline makes this manageable, but it is the main overhead a custom stack has that an engine doesn't.

## Option A: web-tech shell (Electron or Tauri) with WebGPU, WebGL, or three.js

**Shader and visual ceiling**
- WebGPU shipped in Chrome 113, using Direct3D 12 on Windows. It offers "first-class support for general computations on the GPU" ([Chrome: WebGPU release](https://developer.chrome.com/en/blog/webgpu-release/)). Compute shaders are enough for GPU particles, fluid sims and SDF raymarching.
- Guaranteed default limits: `maxTextureDimension2D` 8192, `maxBufferSize` 256 MiB, `maxStorageBufferBindingSize` 128 MiB. Adapters "are always guaranteed to support the defaults or better", and a page can ask for more through `requiredLimits` ([W3C WebGPU spec](https://www.w3.org/TR/webgpu/)). 4K render targets fit inside the defaults.
- three.js `WebGPURenderer`: shaders are written in TSL, which is "transpiled to WGSL or GLSL depending on the available backend". It falls back to WebGL 2 automatically. Caveats: it "is still in an experimental state", `ShaderMaterial`/`onBeforeCompile` are not supported, and `EffectComposer` is replaced by a node-based post-processing stack ([three.js manual: WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer.html)).
- No hardware ray tracing is exposed to the web, and there is no path tracer of an engine's quality. Achieving a VFX look depends on shader work and post-processing.

**Offline render and NVENC**
- You write a deterministic frame loop: set `t` from the frame number, render, then read back.
- Electron offscreen rendering has a shared-texture mode that hands over GPU textures "very fast because there's no CPU-GPU memory copies overhead". Using it needs a native Node module. The default bitmap mode is slower and capped at 240 fps ([Electron: Offscreen Rendering](https://electronjs.org/docs/latest/tutorial/offscreen-rendering)).
- Electron's main process is Node, so it can launch `ffmpeg` with `hevc_nvenc` and pipe frames into it. The other route is WebCodecs with `prefer-hardware`, plus a JS muxer.

**4K60 feasibility**
- It works offline. Readback and IPC are the overhead. Shared-texture mode or WebCodecs (encoding inside the renderer) avoid the CPU copy.

**Hosting a normal UI**
- Best of all the options. The Mix & Master Assistant and the Release Assistant are mostly forms, lists and chat, which is what web UI is made for. One codebase covers all three tools.

**Electron vs Tauri**
- Tauri on Windows uses WebView2, which is "based on Microsoft Edge and therefore Chromium" and "can update itself" ([Tauri: Webview Versions](https://v2.tauri.app/reference/webview-versions/)).
  - Good: the WebGPU stack is Chromium's.
  - Bad: the browser version changes underneath the app on its own schedule, which is a risk for a GPU-heavy renderer.
  - Tauri's Rust backend is also a natural place to run a native wgpu renderer and FFmpeg, which leads into Option C below.
- Electron bundles a fixed Chromium version. That makes builds reproducible at the cost of a larger app, and its Node main process makes it easy to drive FFmpeg.

**Licence cost**
- Free (MIT and similar licences).

## Option B: native GPU stack (wgpu, Vulkan, or Direct3D 12)

**Shader and visual ceiling**
- On Windows, wgpu supports Vulkan and DX12 as first-class backends, and GL 3.3+ as "downlevel/best effort". It accepts shaders in WGSL, plus SPIR-V and GLSL behind feature flags ([wgpu README](https://docs.rs/crate/wgpu/0.20.0/source/README.md); note that this crate version is yanked, but the backend table is long-standing).
- Raw Vulkan or D3D12 adds hardware ray tracing, mesh shaders and direct NVENC interop. You get no scene graph, materials, or post-processing stack, so you write everything.

**Offline render and NVENC**
- You have full control. Frames can stay on the GPU and go straight to NVENC through the Video Codec SDK, or you read them back and pipe them to FFmpeg.

**4K60 feasibility**
- Best of the custom options: no sandbox and no IPC copy.

**Hosting a normal UI**
- Native Rust UI exists, for example egui with its wgpu integration ([egui](https://github.com/emilk/egui)). For the suite's form- and chat-heavy tools, though, it is weaker than web UI.
- The realistic pattern is a hybrid: a web UI (Tauri or Electron) for the suite, with a native wgpu render core as a Rust library under Tauri or as a sidecar process. Preview could be streamed back to the UI, and the final export renders headless.

**Licence cost**
- Free (wgpu is MIT/Apache-2.0). The cost is engineering time instead.

## Option C: hybrid, a web shell plus a native render core

This is not a separate technology. It is the composition implied by A and B, listed so ticket #11 can pick it explicitly.

- **UI:** a Tauri or Electron web UI for all three tools.
- **Renderer:** a Rust/wgpu core (in-process under Tauri) or a sidecar exe.
- **Interface:** the renderer takes a scene description plus the track analysis and outputs frames to NVENC.
- **Trade-off:** you get the best UI and the best native ceiling, but two languages and a protocol for the scene format.

## Option D: existing engines and tools

### Unreal Engine 5

**Visual ceiling**
- Highest of all the options: Lumen, Niagara, Nanite, and an offline path tracer ([Unreal: Path Tracer](https://dev.epicgames.com/documentation/unreal-engine/path-tracer-in-unreal-engine)).

**Offline render**
- The Movie Render Pipeline is "Unreal Engine's offline image sequence and movie rendering solution", with temporal sub-sampling for motion blur, 16-bit HDR output, and remote or scripted render jobs ([Unreal: Movie Render Pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/movie-render-pipeline-in-unreal-engine)).
- It exports EXR, ProRes and DNx, plus FFmpeg through the Command Line Encoder (source above).

**Audio reactivity**
- The Audio Synesthesia plugin provides non-real-time ("NRT") analyzers for loudness, onset and constant-Q ([Unreal: Audio Synesthesia](https://dev.epicgames.com/documentation/en-us/unreal-engine/audio-synesthesia-in-unreal-engine); [UOnsetNRT API](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/AudioSynesthesia/UOnsetNRT)). Bespoke analysis, such as section and emotion detection, could also be imported as curves.

**Hosting a normal UI**
- Poor. The suite would either live inside Unreal's UI frameworks (UMG/Slate) or run as an outside app that drives Unreal through scripted MRQ jobs (Python or the command line).
- Either way it is a multi-GB install and an editor-based workflow, and it is far from a "normal desktop app".

**Licence cost**
- Free for individuals and companies with under $1M annual gross revenue. Above that: 5% royalty for games, or $1,850 per seat per year for non-game and linear content ([Unreal Engine licence](https://www.unrealengine.com/en-US/license)).

### Unity 6

**Visual ceiling**
- High (HDRP/URP, VFX Graph), but below Unreal's for cinematic quality. (This is a general assessment, not taken from a source.)

**Offline render**
- Unity Recorder's Constant frame-rate mode gives fixed time steps whatever the render time (source above). Not verified this session: Recorder is documented as an Editor tool. If so, a built standalone app would need its own capture path.

**Hosting a normal UI**
- Possible with UI Toolkit, but it is a game-engine runtime, not a normal app shell. The same "suite inside an engine" problem as Unreal applies.

**Licence cost**
- Unity Personal is free "up to $200,000 in revenue and funding", and the splash screen is optional with Unity 6. Pro costs $2,310 per seat per year ([Unity: plan pricing updates](https://unity.com/products/pricing-updates)).

### TouchDesigner (Derivative)

**Visual ceiling**
- High for generative and abstract work, which is the core of audio-reactive art: node-based GLSL, particles and instancing. Its 3D realism is below Unreal's.

**Offline render**
- Movie File Out supports non-realtime recording. It encodes H.264, H.265 and AV1 on NVIDIA hardware, and writes ProRes, HAP and NotchLC ([Movie File Out TOP](https://derivative.ca/UserGuide/Movie_File_Out_TOP)).

**Hosting a normal UI**
- TouchDesigner's own UI is for authoring. The way to embed it is TouchEngine, which lets "other software packages … load TouchDesigner components from .tox files". It is free to include, but "the feature becomes enabled by the end-user installing a paid TouchDesigner or TouchPlayer license", and TouchDesigner must be installed ([TouchEngine](https://derivative.ca/UserGuide/TouchEngine)). SDKs exist for Windows and macOS.
- So a suite app could host TouchDesigner scenes as a render back end.

**Licence cost** ([Licensing](https://derivative.ca/UserGuide/Licensing))

| Tier | Price | Resolution | H.264/H.265/AV1 export | Paid work allowed |
|---|---|---|---|---|
| Non-Commercial | Free | 1280×1280 max | No | No |
| Educational | $300 | Unlimited | Yes | No (needs approval as a student or educator) |
| Commercial | $600 | Unlimited | Yes | Yes |
| Pro | $2,200 | Unlimited | Yes | Yes |

- Encoding H.264, H.265 or AV1 "is only available with a Commercial or Pro license" (Movie File Out page).
- Release visuals for Aden's own music are arguably paid or commercial work, so Commercial ($600) is the realistic floor.

### Notch

**Visual ceiling**
- Very high for real-time motion graphics, a staple of concert visuals. Its renderer list includes a Path Tracer, a Hybrid Renderer and a Standard Renderer (navigation of the [Notch manual](https://manual.notch.one/2026.1/en/docs/learning/rendering/rendering-basics/)).

**Offline render**
- Notch has video export and a render queue ([Notch manual: Export Video](https://manual.notch.one/0.9.23/en/docs/user-interface/exporting-video/)). The manual warns that heavy scenes take a long time to export.
- The full codec and motion-blur details could not be read this session (the manual pages render client-side).
- Exporting requires a "Learning or higher license"; trial users can't export ([Notch Essentials: export options](https://manual.notch.one/1.0/en/docs/learning/courses/essentials/008-export-options)).

**Hosting a normal UI**
- Poor. Notch is a closed authoring tool. "Notch Blocks" for embedding in media servers are an RFX-tier feature, and there is no general SDK for hosting it in a custom app (none was found).

**Licence cost** ([Notch pricing](https://notch.one/pricing))

| Tier | Price | Export |
|---|---|---|
| Indie | $279/yr | MP4 H.264/H.265, capped at 1080p |
| VFX | $1,399/yr (or $139/mo) | Up to 16k×16k |
| RFX | $2,589/yr | Adds Blocks and standalone executables |

- For 4K export, VFX is the minimum.

## Comparison

| | Visual ceiling | Offline / frame-accurate export | 4K60 offline | Hosts the suite UI | Licence (Aden's scale) |
|---|---|---|---|---|---|
| Electron/Tauri + WebGPU/three.js | Medium-high (compute shaders, no RT; three.js WebGPU still "experimental") | Build it yourself (frame clock + readback → FFmpeg/NVENC or WebCodecs) | Yes; readback/IPC overhead | Excellent | Free |
| Native wgpu / Vulkan / D3D12 | High (Vulkan/D3D12 add RT); everything built yourself | Build it yourself; direct NVENC possible | Yes; best custom throughput | Weak alone; strong as a hybrid with a web UI | Free |
| Unreal Engine 5 | Highest (path tracer, Lumen, Niagara) | Built in (MRQ, ProRes/EXR, FFmpeg CLI encoder) | Yes | Poor (engine UI, or drive it externally) | Free under $1M revenue |
| Unity 6 | High | Recorder, Constant mode (Editor-based) | Yes | Moderate-poor | Free under $200k |
| TouchDesigner | High for generative/abstract | Built in (non-realtime Movie File Out, NVENC) | Yes (Commercial tier and up) | Embeddable via TouchEngine; needs TD installed and licensed | $600 Commercial (free tier: 1280² and no H.264) |
| Notch | Very high for motion graphics, has a path tracer | Built-in export, details unverified | VFX tier only (Indie capped at 1080p) | Poor (closed tool) | $279/yr (1080p) to $1,399/yr (4K) |

## Things for ticket #11 to weigh

- **Who writes the looks?** Map #4 rules out "Writing your own visualizers in code or shaders" as a user feature. So the app, meaning Claude-built code, must generate scenes from a vision.
  - In a custom stack (A, B or C), the scene and layer system is our own code and data, which the vision step can target directly.
  - In an engine, the app has to generate or parameterize engine assets: Unreal levels and sequences, TouchDesigner .tox networks, or Notch projects. That is a much harder automation target, Notch most of all.
- **Suite fit.** Two of the three tools are UI-heavy and not GPU-heavy. A web UI is the natural shell for them, whatever renders the Visualizer.
- **Version stability.** Tauri's evergreen WebView2 changes the GPU stack without warning. Electron's pinned Chromium and native wgpu don't.
- **Unverified (worth checking in a prototype):**
  - Notch's export codecs, motion blur, and whether it renders frame by frame.
  - Whether Unity Recorder runs outside the Editor.
  - Real readback throughput for 4K WebGPU frames in Electron's shared-texture mode on the RTX 5080.

## Sources

- Chrome: [WebGPU release](https://developer.chrome.com/en/blog/webgpu-release/)
- W3C: [WebGPU spec](https://www.w3.org/TR/webgpu/)
- three.js: [WebGPURenderer manual](https://threejs.org/manual/pages/webgpurenderer.html)
- Tauri: [Webview Versions](https://v2.tauri.app/reference/webview-versions/)
- Electron: [Offscreen Rendering](https://electronjs.org/docs/latest/tutorial/offscreen-rendering)
- MDN: [VideoEncoder](https://developer.mozilla.org/docs/Web/API/VideoEncoder/VideoEncoder)
- wgpu: [README](https://docs.rs/crate/wgpu/0.20.0/source/README.md)
- egui: [repository](https://github.com/emilk/egui)
- NVIDIA:
  - [FFmpeg with NVIDIA GPU (SDK 13.0)](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)
  - [Video Codec SDK 13.0 / Blackwell](https://developer.nvidia.com/blog/nvidia-video-codec-sdk-13-0-powered-by-nvidia-blackwell/)
  - [RTX 50 Series for creators](https://blogs.nvidia.com/blog/generative-ai-studio-ces-geforce-rtx-50-series/)
- Epic:
  - [Unreal Engine licence](https://www.unrealengine.com/en-US/license)
  - [Movie Render Pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/movie-render-pipeline-in-unreal-engine)
  - [Export formats](https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-rendering-export-formats-in-unreal-engine)
  - [Path Tracer](https://dev.epicgames.com/documentation/unreal-engine/path-tracer-in-unreal-engine)
  - [Audio Synesthesia](https://dev.epicgames.com/documentation/en-us/unreal-engine/audio-synesthesia-in-unreal-engine)
- Unity:
  - [Plan pricing updates](https://unity.com/products/pricing-updates)
  - [Recorder: recording properties](https://docs.unity3d.com/Packages/com.unity.recorder@5.1/manual/RecorderWindowRecordingProperties.html)
- Derivative:
  - [Licensing](https://derivative.ca/UserGuide/Licensing)
  - [Movie File Out TOP](https://derivative.ca/UserGuide/Movie_File_Out_TOP)
  - [TouchEngine](https://derivative.ca/UserGuide/TouchEngine)
- Notch:
  - [Pricing](https://notch.one/pricing)
  - [Export Video](https://manual.notch.one/0.9.23/en/docs/user-interface/exporting-video/)
  - [Essentials: export options](https://manual.notch.one/1.0/en/docs/learning/courses/essentials/008-export-options)
