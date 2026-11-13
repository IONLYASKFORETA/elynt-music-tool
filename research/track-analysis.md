# Research: what can track analysis reliably extract from an EDM track?

Ticket: [#6](https://github.com/IONLYASKFORETA/elynt-music-tool/issues/6) (parent map [#4](https://github.com/IONLYASKFORETA/elynt-music-tool/issues/4)).
Researched 2026-11-13 against primary sources (project repos, papers, official model pages).
Target machine: Windows, RTX 5080 (Blackwell), i9-10850K, 32 GB RAM.

## Short answer

| Feature | Reliability on EDM | Best local tool | Licence (code / weights) |
|---|---|---|---|
| Beats, downbeats, BPM | **High** (EDM is a near-ideal case: steady 4/4, strong kick) | Beat This! (`beat_this`) | MIT / MIT |
| Section boundaries | **Medium**: boundaries land near the right place, labels are pop-song labels | SongFormer, or All-In-One (`allin1`) | CC-BY-4.0 / check; MIT / MIT |
| Drop / build labels | **Not off the shelf**: derive from boundaries + energy + bar grid | Own heuristic on top of the above | n/a |
| Kick / snare / hat onsets | **High with stems or a separated drum stem**, medium on the mixdown | Drum stem → DrumSep → onset peaks; or ADTOF | ADTOF: CC BY-NC-SA 4.0 |
| Bass onsets / energy | **High** once a bass stem exists | Separated bass stem + onset/RMS (librosa) | ISC |
| Risers, impacts, sweeps | **No dedicated model**: heuristic only (rising centroid/noise over bars, transient + broadband burst at downbeats) | librosa features on the "other" stem | ISC |
| Key | **Medium** (≈ the best you get; modal/atonal EDM fails) | Essentia `KeyExtractor` with `edma` profile | AGPL-3.0 |
| Harmony (chords) | **Low–medium**: usable only as "colour", not as truth | Essentia chroma/HPCP | AGPL-3.0 |
| Energy / loudness curves | **High** (it's measurement, not inference) | pyloudnorm (BS.1770), librosa RMS/spectral per stem | MIT, ISC |
| Mood / valence / arousal | **Low–medium**, coarse, track-level, trained on non-EDM | Essentia mood + DEAM/emoMusic A/V models; CLAP zero-shot | CC BY-NC-SA 4.0; Apache-2.0 |
| Colour | **No model exists**; colour is derivable from emotion via published human-association findings | Rule mapping from valence/arousal/tempo/mode | n/a |
| Stem separation | **High** for drums/bass, medium for "other" (synths, FX all land there) | BS-RoFormer / Mel-RoFormer via `audio-separator` or MSST; Demucs v4 as fallback | MIT code; per-model weights |

Everything above runs locally. The licences marked non-commercial (NC) are fine because Elynt is a personal tool for one user (map #4: "not a public product"); they would block a commercial release.

**Platform gate:** the RTX 5080 is Blackwell (sm_120). PyTorch supports it only from **2.7.0 built with CUDA 12.8** ([PyTorch forum, staff answer](https://discuss.pytorch.org/t/rtx-5050-sm-120-support-timeline-when-in-stable-pytorch/224288/8)). Any tool pinning older torch/CUDA (e.g. `audio-separator` documents CUDA 11.8 and 12.2 only, [README](https://github.com/nomadkaraoke/python-audio-separator)) must be run with a cu128+ torch swapped in, or it will fail or fall back to CPU. Budget for this.

---

## 1. Beat, downbeat, BPM

**Beat This!** (Foscarin, Schlüter, Widmer, ISMIR 2024) — [repo](https://github.com/CPJKU/beat_this), [paper](https://arxiv.org/abs/2407.21658)
- Outputs beats and downbeats; BPM follows from inter-beat intervals. MIT code **and** weights (some training data has other licences; README says assess for your use).
- Claims to beat prior SOTA F1 without DBN post-processing; trained on 16 datasets.
- GPU by default, `--float16` for recent GPUs; `final0` ≈ 78 MB, `small0` ≈ 8 MB. No published timings (a single track is expected to take seconds on GPU; **unverified**).
- Install: `pip install beat-this` + PyTorch ≥ 2.0 (on Windows/5080: torch ≥ 2.7 cu128).
- Failure modes (paper): "can still fail, especially for difficult and underrepresented genres", weaker on continuity metrics. Without the DBN it does not enforce a steady tempo, so on EDM **snap the output to a constant-tempo grid** (most EDM is fixed BPM; Aden's Ableton exports certainly are). Beatless intros/breakdowns are where it will wobble; extrapolate the grid through them.

**All-In-One (`allin1`)** also emits BPM, beats, downbeats and beat-in-bar position ([repo](https://github.com/mir-aidj/all-in-one)); on Harmonix it reports beat F1 .958, downbeat F1 .915 ([paper](https://arxiv.org/pdf/2307.16425)).

**madmom** is the older reference (BSD code, but **model files CC BY-NC-SA 4.0**, [repo](https://github.com/CPJKU/madmom)); only needed as Beat This!'s optional DBN or as an `allin1` dependency.

**Gotcha:** MP3 decoding offsets of ~20–40 ms are documented by `allin1` ([repo](https://github.com/mir-aidj/all-in-one)); beat tolerance is 70 ms. **Analyse WAV exports**, not MP3s.

## 2. Sections, drops and builds

**SongFormer** (ASLP-lab, 2025) — [repo](https://github.com/aslp-lab/songformer), [paper](https://arxiv.org/html/2510.02797v2)
- Labels: intro, verse, chorus, bridge, inst, outro, silence, pre-chorus. Code CC-BY-4.0 (weights licence not stated in the README; check the HF model page).
- Beats All-In-One on its benchmark: Harmonix boundary HR.5F 0.696 vs 0.596; label accuracy 0.807 vs 0.740. 2–4 s per song on an L40 (vs 9–12 s for All-In-One).
- Tested on Ubuntu only; depends on MuQ/MusicFM self-supervised models. Windows install is **unverified**.

**All-In-One (`allin1`)** — [repo](https://github.com/mir-aidj/all-in-one), [paper](https://arxiv.org/pdf/2307.16425)
- One pass gives tempo, beats, downbeats **and** segments (start, end, intro, outro, break, bridge, inst, solo, verse, chorus). MIT.
- Trained on the Harmonix Set, 912 Western pop tracks ([dataset](https://github.com/urinieto/harmonixset)). Boundary HR.5F .660 (i.e. about two-thirds of boundaries within 0.5 s).
- Runs Demucs internally and feeds stems to the model; ablation shows demixing helps all tasks (boundaries .614 → .660).
- Speed: 10 songs / 33 min of audio in 73 s on an RTX 4090.
- Windows: needs **NATTEN built from source** (`ninja`, clone, `make`), which is the main install risk, especially for sm_120.

**Neither model knows "build" or "drop".** Harmonix/SongFormer vocabularies are pop-song functions; on EDM expect drops to be called "chorus"/"inst" and breakdowns "break"/"bridge".
The only EDM-specific drop paper ([Yadati et al., ISMIR 2014](https://archives.ismir.net/ismir2014/paper/000297.pdf)) does what we should do: take structural boundaries as candidates, then classify them as drops using features around the boundary. Their F1 was only 0.61 (3 s tolerance) to 0.71 (15 s), with 2014-era features on dubstep/electro/house.

**Recommended approach (inference, not a published tool):** take model boundaries, snap them to the nearest downbeat and to 8/16-bar phrase lines (EDM phrases are very regular), then label each section from per-stem energy:
- **drop** = section start where kick + bass energy jump from low to high (often right after a near-silent bar);
- **build** = section before a drop with rising "other"-stem energy/brightness, rising snare-roll density, kick often absent;
- **breakdown** = low kick/bass energy after a drop; **intro/outro** = first/last sections.
This should be reliable on Aden's own tracks, and the vision step lets Aden correct labels in a few clicks. Treat automatic section labels as a proposal, not truth.

## 3. Per-instrument onsets (kick, snare, bass)

- **With Aden's stems**: onset detection on each stem is near-trivial and highly reliable (it's the actual audio of that instrument). If he exports separate kick/snare stems, use them directly.
- **From the mixdown**: separate drums first (§7), then split drums.
  - **DrumSep** models split a drum stem into kick/snare/toms/hats/cymbals. MVSep reports kick SDR 22.2, snare 17.1 for its Mel-Band RoFormer DrumSep and 18.3/13.6 for the open aufr33/jarredou MDX23C DrumSep ([MVSep algorithms](https://www.mvsep.com/algorithms)); these only work on an isolated drum track.
  - **ADTOF** transcribes drums into 5 classes (kick, snare, toms, hi-hat, crash+ride) ([paper](https://arxiv.org/pdf/2111.11737.pdf), [repo](https://github.com/MZehren/ADTOF), CC BY-NC-SA 4.0; an ADTOF-pytorch port exists). Its training data is rhythm-game charts, mostly rock.
  - **EDM failure mode, measured:** on RBMA (electronic drum sounds) ADTOF-style transcription scores F≈0.63 vs ≈0.85–0.89 on acoustic sets, and the authors attribute the gap to electronic drums ([arXiv 2509.24853](https://arxiv.org/html/2509.24853v1)). Layered/sidechained kicks, claps-as-snares, and 808 kicks that also read as bass are the usual confusions.
- **Bass**: the separated bass stem gives a clean envelope and onset curve. Kick and sub-bass overlap below ~100 Hz, so some kick bleed lands in "bass" and vice versa; a sidechained bass's envelope is itself a strong kick-rhythm signal.

For a visualizer, **onset times + per-hit strength** (peak level in a short window, as that paper does for velocity) matter more than perfect class labels.

## 4. Risers, impacts, sweeps

No published, downloadable model detects EDM risers or impacts (none found in the sources above). Use heuristics on the "other" stem (or Aden's FX stem):
- **riser**: sustained rise over 2–16 bars in spectral centroid / high-band energy / noisiness (spectral flatness), usually ending at a section boundary;
- **impact / downlifter**: a broadband transient on a downbeat at a section start, often with a long decay and no matching drum-stem onset;
- **snare roll**: accelerating onset density in the drum/snare stem before a drop.
Features come from librosa (ISC, [repo](https://github.com/librosa/librosa)). Reliability is **medium**; they're well-defined on Aden's own tracks and easy to confirm in the vision step. CLAP zero-shot (§6) can score windows against prompts like "riser sweep" as a tie-breaker (**unverified** accuracy).

## 5. Key and harmony

- **Essentia `KeyExtractor`** has EDM-specific profiles `edma`/`edmm` (plus default `bgate`) ([docs](https://essentia.upf.edu/reference/std_KeyExtractor.html)), from Faraldo, Jordà & Herrera, "A Multi-Profile Method for Key Estimation in EDM" (AES Semantic Audio 2017, [code](https://www.github.com/angelfaraldo/edmkey)).
- Essentia is **AGPL-3.0** ([repo](https://github.com/MTG/essentia)); fine for a personal tool. Its pip wheels are documented for Linux only, so on Windows plan for **WSL2** or Docker (the README doesn't list Windows wheels).
- Failure modes: EDM is often modal, single-chord drones, or atonal (noise/percussion-led), so "key" can be ambiguous; relative major/minor and fifth confusions are common for every key estimator. Aden knows his track's key from the Ableton project, so **ask him** and use analysis only as a default.
- **Chords**: usable as a chroma/HPCP "harmonic colour" curve (which pitch classes dominate per bar) rather than as chord names.

## 6. Energy, mood, emotion, "vibe"

**Energy (reliable, measured):**
- Loudness: pyloudnorm, ITU-R BS.1770-4 integrated loudness and LRA, MIT ([repo](https://github.com/csteinmetz1/pyloudnorm)). Short-term (3 s) / momentary (400 ms) curves are easy to compute with its block-size gating, but the README doesn't expose them directly.
- Per-stem RMS, band energy (sub/low/mid/high), spectral centroid, flux, onset density per bar, all from librosa. These per-stem curves are the most dependable drivers for reactivity.

**Mood (coarse, track- or section-level):**
- Essentia models ([models page](https://essentia.upf.edu/models.html), **CC BY-NC-SA 4.0**): binary happy/aggressive/party/relaxed/sad, danceability, valence/arousal regression (1–9) trained on DEAM and emoMusic, MTG-Jamendo mood/theme tags, and Discogs-EffNet 400-style genre (many EDM subgenres).
- Failure modes: training data is mostly non-EDM; nearly all EDM reads "danceable", "party", "high arousal", so they discriminate poorly *within* EDM. Valence is the weakest dimension in music emotion research generally. Use them per section, compared to the track's own average, not as absolute values.
- **CLAP** zero-shot ([laion/larger_clap_general](https://huggingface.co/laion/larger_clap_general), Apache-2.0, trained on general audio + music + speech): score each section against free text ("euphoric festival drop", "dark melancholic breakdown"). This is the most flexible way to get "vibe" words, and fits the vision step well; accuracy on EDM is **unverified**.

**Colour:** no model predicts colour from audio. The best primary evidence is that **music–colour associations are mediated by emotion**: faster, major-mode, higher-pitched music is matched with more saturated, lighter, yellower colours; slower, minor, lower music with more muted, darker, bluer ones ([Langlois, Peterson & Palmer 2015](https://escholarship.org/uc/item/99n8q5z5), building on Palmer et al. 2013, PNAS). They used controlled melodies, not EDM. Practical route: map arousal → saturation/brightness and valence/mode → hue warmth, as a starting palette Aden then adjusts in the vision.

## 7. Stem separation (when no stems are given)

- **Demucs v4** (`htdemucs`, `htdemucs_ft`, `htdemucs_6s`): MIT, 4 stems (drums, bass, other, vocals); `htdemucs` 9.0 dB SDR on MUSDB-HQ; `_ft` ~4× slower; the 6-stem piano stem has "a lot of bleeding". GPU needs ≥ 3 GB VRAM (≈ 7 GB at defaults); CPU ≈ 1.5× track length. **Archived 2025-01-01, unmaintained** ([repo](https://github.com/facebookresearch/demucs)).
- **Successors: BS-RoFormer / Mel-Band RoFormer / SCNet.** BS-RoFormer won SDX23 and reports 9.80 dB average on MUSDB18HQ without extra data ([paper](https://arxiv.org/abs/2309.02612v2)). On MVSep's Multisong benchmark, BS-RoFormer SW scores bass 14.6 / drums 14.1 / other 8.7 / vocals 11.3 dB vs `htdemucs_ft` 12.1 / 11.2 / 5.7 / 8.3, i.e. ≈ +3 dB everywhere ([MVSep](https://www.mvsep.com/algorithms)). MVSep's top ensemble is a hosted service; which of these exact weights are downloadable varies per model (**check each before relying on it**).
- **Running them locally:** [`python-audio-separator`](https://github.com/nomadkaraoke/python-audio-separator) (MIT, pip, Windows+CUDA, downloads models automatically; runs MDX, VR, Demucs, RoFormer) or [ZFTurbo Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) (MIT; BS/Mel-RoFormer, SCNet, MDX23C, HTDemucs, …). RoFormer overlap settings trade speed for seam quality (`--mdxc_overlap`).
- **EDM failure modes:** "other" becomes a catch-all for leads, pads, plucks, risers and FX, so it can't be split into "synth lead vs pad" reliably; heavy sidechain and distortion cause pumping/bleed; sub-bass vs kick overlap; vocal chops and vocal-like synths swap between "vocals" and "other". Drums and bass separate best, and those are exactly the stems reactivity needs most.
- **Speed on the 5080:** no first-party benchmark for this GPU. Inference from the figures above (allin1 incl. Demucs ≈ 7 s per song on a 4090): separation plus all analysis should be **well under a minute per track**; exact number **unverified**, measure it in the prototype.

## Recommended v1 pipeline

1. Input WAV mixdown (+ Aden's stems if given). Use his stems wherever they exist.
2. If no stems: RoFormer 4-stem separation (fallback `htdemucs_ft`). Optionally DrumSep on the drum stem.
3. Beat This! → snap to constant-tempo grid → bars and 8/16-bar phrases.
4. SongFormer or allin1 boundaries → snap to phrases → EDM labels (intro/build/drop/breakdown/outro) from per-stem energy rules.
5. Per-stem onsets with strengths; per-stem band energy, loudness, brightness curves at frame rate.
6. Riser/impact heuristics on "other"/FX.
7. Key (Essentia `edma`, overridable), chroma colour curve.
8. Per-section mood (Essentia A/V + CLAP text scores) → starting palette via the emotion–colour mapping.
9. Show all of this in the **vision** step for Aden to confirm or correct.

## Open risks / unverified

- Windows installs of NATTEN (allin1), SongFormer, and Essentia; plan WSL2 as the fallback runtime for the analysis step.
- Every tool needs a torch ≥ 2.7 / CUDA 12.8 build for the 5080.
- Licences of individual separation weights and SongFormer weights.
- Real per-track timings on the 5080.
