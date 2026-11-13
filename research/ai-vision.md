# How can AI help turn a track into a vision?

Research for [#8](https://github.com/ionlyaskforeta/elynt-music-tool/issues/8) under the Visualizer map [#4](https://github.com/ionlyaskforeta/elynt-music-tool/issues/4). Researched 2026-11-13. Vocabulary follows `GLOSSARY.md` (track, mixdown, stem, section, layer, scene, vision, track analysis, reactivity).

**Question.** How can AI models take track analysis plus a short conversation with Aden and propose a vision (mood, palette, motifs, per-section look, how things react)? What role, if any, should generative image or video models play in the visuals themselves? Covers costs, latency and licence terms.

## Answer in short

1. **Claude cannot listen to audio.** Every current Claude model takes text and image input only. Claude therefore works from a *text and image* digest of the track: local track analysis (tempo, beat grid, sections, energy curves) as JSON, plus optional plots or spectrogram images, plus an optional plain-language "listening note" from a model that can hear audio.
2. **Ears are optional and cheap.** Gemini can hear a whole mixdown, at 32 tokens per second. A 4-minute track is about 7,700 tokens, which costs under a cent on Flash-class pricing. Gemini first squashes the audio to 16 kbps mono. That is fine for "what's the mood" and useless for precise analysis. Qwen3-Omni Captioner is Apache 2.0 and could run locally, but at 32B parameters it does not fit 16 GB of VRAM without heavy quantization. It also wants clips of 30 seconds or less, so it would run once per section.
3. **Claude should run the interview and write the vision, with the vision as a schema'd JSON object.** Structured outputs guarantee that the JSON matches the schema. The vision names layers and parameters from the Visualizer's own library, and maps analysis features to parameters for reactivity. A session costs well under $1 on Claude Opus 5.5.
4. **Turn the vision into scenes with parameters, not generated shader code, in v1.** The LLM fills in values for a fixed, tested library of layers. Generated GLSL is possible. It is also fragile and hard to keep beat-accurate, and it pulls toward the out-of-scope "write your own shaders." Claude can see images, so a later loop can render preview frames and let Claude critique them against the vision.
5. **Generative image and video models make assets, not the beat.** None of the video models checked here can lock motion to a beat grid. Veo makes 4, 6 or 8 second clips at 24 fps with its own generated soundtrack, and takes 11 seconds to 6 minutes per request. Local video models take minutes per 5-second clip. Beat accuracy must come from the Visualizer's own render engine animating layers. Generated stills, textures and loops become the *material* those layers move.
6. **Best local fit on an RTX 5080 (16 GB): FLUX.2 [klein] 4B for images.** It is Apache 2.0, needs about 13 GB of VRAM, and claims sub-second generation. Wan2.2 TI2V-5B (Apache 2.0) and LTX-2.x can do local video, but their stated VRAM needs are at or above 16 GB, or rely on distilled and FP8 variants. Treat local video as an experiment, not part of v1.
7. **Licences matter even for a personal tool, because the videos are published.** Avoid the FLUX [dev] and FLUX.2 [klein] 9B non-commercial weights. Apache 2.0 weights (FLUX.2 klein 4B, Wan2.2, Qwen3-Omni) are clean. LTX-2 is free below $10M of annual revenue. The Anthropic, Google and Black Forest Labs terms all leave output ownership with the user. Use Google's *paid* tier for unreleased tracks, because unpaid-tier data may be read by human reviewers.

## 1. LLMs for the interview and the vision proposal

### Can the LLM listen to the track directly?

| Model | Hears audio? | Notes | Source |
|---|---|---|---|
| Claude (all current: Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5) | **No** | "All current models support text and image input, text output." | [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview) |
| Gemini (2.5 / 3.x Flash and Pro) | Yes | WAV, MP3, AIFF, AAC, OGG, FLAC and more. Up to 9.5 h per prompt. 32 tokens/s. Can do "emotion detection in speech and music" and answer questions about `MM:SS` segments. Audio is "downsampled to 16 Kbps" and multi-channel audio is "combined to single channel". Inline requests are capped at 20 MB, so use the Files API for a WAV mixdown. | [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio) |
| OpenAI GPT-Audio-1.5 | Yes (speech-oriented) | "The best voice model for audio in, audio out". Audio tokens cost $32/M in and $64/M out. 128K context. The page does not mention music. | [GPT-Audio-1.5 model page](https://developers.openai.com/api/docs/models/gpt-audio-1.5) |
| Qwen3-Omni-30B-A3B-Captioner (open weights) | Yes | Apache 2.0. Gives "detailed, low-hallucination captions for arbitrary audio inputs", including music. The model card recommends clips of "no more than 30 seconds". Listed at 32B parameters in BF16. | [Qwen3-Omni tech report](https://arxiv.org/abs/2509.17765), [Captioner model card](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Captioner) |

What this means:

- **Precise facts come from DSP, not an LLM.** That covers tempo, beat and downbeat times, section boundaries, and energy and band curves. They come from the track-analysis step, which is a separate ticket. An audio LLM that hears 16 kbps mono cannot place beats to the frame, and nothing above claims it can.
- **An audio LLM adds a subjective "listening note"**: mood, genre cues, instrument character, and a description per section. Gemini is the cheap, easy option. Ask it about each section using `MM:SS` ranges taken from the analysis, so its words line up with the sections. Qwen3-Omni is the local, private option, but see the VRAM note in §3.
- **Claude can still "see" the track.** Claude accepts images: PNG, JPEG, GIF and WebP, up to 600 per request, at about ⌈w/28⌉×⌈h/28⌉ tokens each, and a 1000×1000 image is about 1,296 tokens ([Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)). A rendered energy curve, a section timeline or a mel-spectrogram image can go in next to the JSON. Whether Claude reads spectrograms usefully is not documented. Treat it as something to test.

### Who runs the conversation?

Claude runs the conversation and writes the vision (Opus 5.5 by default, `claude-opus-5-5`). Its inputs:

1. The track-analysis JSON: tempo, key if available, section list with times, per-section energy and band summaries, and stem presence.
2. Optionally, the listening note from the audio model.
3. Optionally, plot images, plus any reference images Aden drops in. The map already welcomes Aden's own media.
4. Aden's answers to a few short questions. The map's v1 flow: analyse, ask a few short questions, take Aden's suggestions.

Its output is a **vision object** under a JSON schema, via structured outputs. Structured outputs "guarantee schema-compliant responses through constrained decoding", set with `output_config.format` and `type: "json_schema"` ([structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). Limits that matter for the schema design: no `minimum`/`maximum`/`multipleOf`, no `minLength`/`maxLength`, no recursive schemas, and `additionalProperties` must be `false`. So the app must **clamp numeric ranges itself** after parsing.

A sketch of the vision object (illustrative only, not a decision):

```json
{
  "mood": ["euphoric", "nocturnal"],
  "palette": [{"hex": "#0B0F2A", "role": "base"}, {"hex": "#FF3EA5", "role": "accent"}],
  "motifs": ["liquid chrome", "city lights through rain"],
  "sections": [
    {"section_id": "drop1",
     "look": "full-frame chrome ripples, strobing accent",
     "layers": [{"layer": "fluid_sim", "params": {"viscosity": 0.3}},
                {"layer": "particles", "params": {"count": 20000}}],
     "reactivity": [{"feature": "kick_onset", "target": "fluid_sim.impulse", "curve": "attack_fast_decay", "amount": 0.8},
                    {"feature": "bass_energy", "target": "camera.shake", "amount": 0.4}]}
  ],
  "rationale": "..."
}
```

### Cost and latency of the LLM part

Prices are from the [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview) and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). The token counts are this note's own estimates.

| Step | Model | Rough size | Cost |
|---|---|---|---|
| Listening note, whole 4-min mixdown | Gemini 2.5 Flash / 3 Flash Preview ($1.00 per M audio tokens) | 240 s × 32 = 7,680 tokens | ≈ $0.008 + output |
| Interview + vision, ~5 turns | Claude Opus 5.5 ($4 in / $20 out per M) | ~100K input in total (context resent each turn) + ~10K output | ≈ $0.40 + $0.20 ≈ **$0.60** |
| Same on Sonnet 5.5 ($2 / $10) | | | ≈ $0.30 |

Prompt caching cuts the repeated-context cost. Cache reads are 5% of the base input price on Opus 5.5 and Sonnet 5.5 (models overview, pricing notes). Anthropic rates the latency of Opus 5.5 "Moderate" and Sonnet 5.5 "Fast". Each turn of an interview is seconds, not minutes. That is an expectation; no benchmark was found.

## 2. From vision to concrete scenes

Two options, compared:

| | A. Parameters for a fixed layer library (recommended for v1) | B. LLM writes shader / scene code |
|---|---|---|
| What the LLM produces | Values and reactivity mappings for layers the Visualizer already ships | GLSL/WGSL fragment shaders or scene scripts |
| Reliability | High. Schema-guaranteed JSON, values clamped by the app | Low to medium. Can fail to compile, can look wrong, the LLM cannot see its own output without a render loop |
| Beat accuracy | Guaranteed by the render engine, which reads the beat grid | Only as good as the uniforms the code is wired to |
| Fit with the map | Matches "Customization covers presets, settings, and layering layers into scenes" | Leans toward the out-of-scope "writing your own visualizers in code or shaders" |
| "Hand-made VFX" look | Bounded by how rich the layer library is | Unbounded in theory, inconsistent in practice |

A path that keeps option B open: render a few still frames from each proposed scene, send them back to Claude as images (vision input is supported), and ask it to critique and adjust parameters against the vision. The same loop could later judge generated shaders. Nothing found documents how well this works for VFX art direction. It is a prototype question.

## 3. Generative image and video models

### Do they keep up with beat-accurate reactivity?

No, not as the thing that moves on the beat:

- **Veo 3.1 (API):** clips are 4, 6 or 8 s at 24 fps, 720p/1080p/4k, in 16:9 or 9:16, with native audio "always on". The listed inputs are text, image and video, with no audio input to drive motion. Latency runs from 11 s to 6 min at peak. Output carries a SynthID watermark and is kept on the server for 2 days ([Veo docs](https://ai.google.dev/gemini-api/docs/veo)). **The same page says the Veo 3.1 Preview models were shut down on 2026-10-22** and points to *Gemini Omni Flash* (`gemini-omni-1.1-flash`) and the GA models on Google's Enterprise Agent Platform. Its docs say audio input is not supported yet: "Uploading audio references is unsupported in the current version of the API". Resolutions are 360p, 720p, and upscaled 1080p/4k, in 16:9 or 9:16. Extensions add up to 10 s each, to 40 s in total. Latency "varies" ([Omni docs](https://ai.google.dev/gemini-api/docs/omni)). So the API successor cannot follow a track either.
- **LTX-2.x (open weights, Lightricks):** the vendor lists **audio-to-video**, "video driven by audio input (voice, music, or sound effects)". It runs at 24/25/48/50 fps, makes up to 20 s per generation, and can render native 4K. The full dev model needs 80 GB+. Distilled and FP8 variants are said to run with "as little as 12GB VRAM" ([ltx.io/llm-info](https://ltx.io/llm-info)). These are vendor claims. Sync quality against an EDM beat grid is unverified.
- **Wan2.2 TI2V-5B (open weights):** 720p at 24 fps. The card says it "can run on a GPU with at least 24GB VRAM (e.g, RTX 4090)" and makes "a 5-second 720P video in under 9 minutes on a single consumer-grade GPU" ([model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B)). The RTX 5080 has 16 GB of GDDR7 ([NVIDIA spec](https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5080/)), below the stated figure, so expect heavy offloading and slower runs.
- **StreamDiffusion (per-frame image diffusion):** about 94 fps img2img with SD-Turbo at 1 step on an RTX 4090 + i9-13900K ([repo](https://github.com/cumulo-autumn/StreamDiffusion), Apache 2.0). This is the only family fast enough to be modulated frame by frame by audio features. Per-frame diffusion tends to flicker. The repo does not discuss temporal consistency, and the SD-Turbo weights' own licence was not checked.

An offline render does not need real time, but the numbers still bite. A 3-minute video at 60 fps is 10,800 frames. At 1 s per frame, that is 3 hours of GPU time.

### Recommended role

Generative models **make material, ahead of time**: textures, backdrops, keyframe stills, short ambient loops, style references, and motif images from the vision's `motifs`. The Visualizer's own layers then move, warp, mask, colour-grade and flash that material on the beat grid. Beat accuracy stays deterministic and in the Visualizer's hands, and the "made for this track" quality comes from the vision. Audio-driven video (LTX-2.x) and per-frame diffusion (StreamDiffusion) are worth a later prototype as an optional *layer type*, not as the core.

### Local (RTX 5080, 16 GB) vs API

| Model | Where | Fits 16 GB? | Speed (stated) | Licence | Source |
|---|---|---|---|---|---|
| FLUX.2 [klein] 4B | Local | Yes, "~13GB VRAM" | "end-to-end inference in as low as under a second" (vendor) | **Apache 2.0** | [model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) |
| FLUX.2 [klein] 9B / FLUX [dev] | Local | Not checked | Not checked | **Non-commercial** | [BFL non-commercial licence](https://bfl.ai/legal/non-commercial-license-terms), [klein 9B discussion](https://huggingface.co/black-forest-labs/FLUX.2-klein-9B/discussions/24) |
| Wan2.2 TI2V-5B | Local | Stated minimum is 24 GB | < 9 min per 5 s 720p | Apache 2.0 | [model card](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B) |
| LTX-2.x distilled / FP8 | Local | Claimed down to 12 GB | Not stated in absolute terms | LTX licence, free below $10M revenue | [ltx.io/llm-info](https://ltx.io/llm-info), [LICENSE](https://huggingface.co/Lightricks/LTX-2.3/blob/main/LICENSE) |
| Qwen3-Omni Captioner (audio, not visuals) | Local | 32B params in BF16 is about 64 GB of weights (own arithmetic), so it needs about 4-bit quantization and still may not fit | n/a | Apache 2.0 | [model card](https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Captioner) |
| Imagen 4 Fast / Standard / Ultra | API | n/a | n/a | Google terms | $0.02 / $0.04 / $0.06 per image ([pricing](https://ai.google.dev/gemini-api/docs/pricing)) |
| Gemini 3.1 Flash Image | API | n/a | n/a | Google terms | $0.045 (0.5K) to $0.151 (4K) per image |
| Veo 3.1 (Preview, now shut down) | API | n/a | 11 s to 6 min | Google terms | Standard $0.40/s, Fast $0.10 to $0.30/s, Lite $0.05 to $0.08/s |

For scale: 20 generated stills per track cost about $0.40 to $1.20 on Imagen 4, and about nothing beyond electricity on FLUX.2 klein 4B locally. One 8-second Veo-class clip at $0.10 to $0.40/s costs $0.80 to $3.20.

## 4. Licence and terms

- **Claude API (Anthropic Commercial Terms):** "Customer … owns its Outputs" and "Anthropic may not train models on Customer Content from Services" ([commercial terms](https://www.anthropic.com/legal/commercial-terms)).
- **Gemini API:** Google "won't claim ownership over that content". On **unpaid** services, Google may use content to improve products, and "human reviewers may read, annotate, and process your API input and output". On paid services it "doesn't use your prompts … or responses to improve our products". Apps that serve users in the EEA, Switzerland or the UK may use only paid services ([Gemini API terms](https://ai.google.dev/gemini-api/terms)). **Send unreleased tracks only on a paid key.**
- **FLUX [dev] Non-Commercial Licence v2.0:** the model is for non-commercial purposes only. §2(d) says "You may use Output for any purpose (including for commercial purposes)". §4(a) bars using "any data produced by the FLUX [dev] Model" for "commercial or production purposes". The two clauses conflict ([licence](https://bfl.ai/legal/non-commercial-license-terms)). Aden publishes music videos, so treat these weights as off-limits and use FLUX.2 klein 4B (Apache 2.0) instead.
- **Apache 2.0** (FLUX.2 klein 4B, Wan2.2, Qwen3-Omni, StreamDiffusion code): commercial use is fine. Wan's card adds "We claim no rights over the your generated contents".
- **LTX-2 licence:** free for any purpose subject to use restrictions, except entities with "annual revenues of at least $10,000,000". "Licensor claims no rights in the Output". Use is barred for anyone in comprehensively sanctioned countries ([LICENSE](https://huggingface.co/Lightricks/LTX-2.3/blob/main/LICENSE)).
- **Veo:** output carries a SynthID watermark ([Veo docs](https://ai.google.dev/gemini-api/docs/veo)).

## 5. Implications for the v1 spec

- The vision step is a **pipeline**: DSP track analysis, then an optional audio-LLM listening note, then a Claude interview, then a schema'd vision. It is not one magic model.
- The **vision schema** needs designing alongside the layer library and the reactivity model. It is the contract between the AI and the renderer.
- **Generated material is optional and comes per vision.** The vision's motifs can ask a local FLUX.2 klein 4B for stills and textures that become layer inputs, just like Aden's own media.
- **Beat-accurate reactivity is the Visualizer's job**, not the generative model's.
- Budget per track: under $1 of LLM calls, plus $0 to $3 of optional API imagery or video.

## Open questions / not verified

- **Gemini Omni Flash** pricing per second was not read (it is on the pricing page, which was cut off). A "1.2 Flash" with 15-second clips and lower prices appears in Google blog titles. It was not read.
- How well Claude reads spectrogram or energy-plot images. How good Gemini's or Qwen's mood descriptions of EDM are. Both are prototype questions.
- Whether Qwen3-Omni Captioner runs usefully on 16 GB once quantized.
- How well LTX-2.x audio-to-video syncs to a beat, and the real VRAM and speed of its distilled and FP8 variants on an RTX 5080.
- The licence of the SD-Turbo weights used in the StreamDiffusion benchmark.
- Whether Wan2.2 TI2V-5B runs at all on 16 GB with offloading.
