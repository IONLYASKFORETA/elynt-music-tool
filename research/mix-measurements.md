# Research: which mix and master measurements can code compute reliably?

Ticket: [#28](https://github.com/IONLYASKFORETA/elynt-music-tool/issues/28) (parent map [#24](https://github.com/IONLYASKFORETA/elynt-music-tool/issues/24)).
Researched 2026-11-13 against primary sources (ITU/EBU specs, library source code and docs, peer-reviewed papers, the Ableton Live 12 manual).
Builds on [research/track-analysis.md](https://github.com/IONLYASKFORETA/elynt-music-tool/blob/research/track-analysis/research/track-analysis.md) (#6) and does not repeat it. In particular, beat/bar grid, section boundaries, per-stem onsets and stem separation are taken from there.

Target: Windows, Python analysis process, Aden's own WAV bounces from Ableton Live 12.

## Short answer

Two very different kinds of number are in play:

- **Standardised measurements** (LUFS, LRA, true peak, sample peak, clipping). These have a published spec and a published conformance test, so code can be *checked*, not just trusted. They are as reliable as any commercial meter.
- **Engineering descriptors** (spectral balance vs a target, stereo width per band, masking between stems, phase). The arithmetic is exact and repeatable, but there is no standard for what the number *means*. They are reliable as *comparisons* (this mix vs the reference, this section vs that one, this bounce vs the last one) and weak as absolute verdicts.

| Measurement | Reliability | Best local tool (licence) | Notes |
|---|---|---|---|
| Integrated LUFS | **High, spec-checked** | libebur128 via `pyebur128` (MIT) or pyloudnorm (MIT) | ±0.1 LU conformance tolerance (EBU Tech 3341) |
| Short-term / momentary LUFS curve | **High** | libebur128 (MIT); Essentia `LoudnessEBUR128` (AGPL) | 3 s / 400 ms windows; per bar or per section |
| Loudness range (LRA) | **High as a number, low as advice** | libebur128 (MIT) | pyloudnorm calls its LRA an "attempt" |
| True peak (dBTP) | **High, with a known small under-read** | libebur128 (MIT) or FFmpeg `ebur128` | 4× oversampling; worst case under-read ≈ 0.55–0.69 dB |
| Sample peak, clipping | **High** | numpy | needs a 32-bit float bounce to see overs |
| Crest factor, PLR, PSR | **High** (derived) | numpy + the above | PSR/PLR are defined on BS.1770, crest factor is not standardised |
| Spectral balance vs tonal target | **Medium**: exact numbers, meaning depends on the target | scipy `welch` / librosa (BSD / ISC) | compare loudness-matched, smoothed, per section |
| Stereo correlation & width, per band | **High as measurement, medium as advice** | numpy + scipy crossover filters | mono fold-down loss is the most actionable number |
| Masking / frequency conflicts between stems | **Medium–low**: no validated perceptual metric | own code (band energy overlap, MPEG-style threshold) | needs real stems; separated stems add artifacts |
| Phase / polarity / timing between stems | **High for detection of gross problems** | scipy `correlate` | only with real (not separated) stems |

All of this runs on CPU in seconds per track. Measured in a Linux container (not Aden's machine): integrated loudness on a 5-minute 48 kHz stereo signal took 0.7 s with pyloudnorm and 1.1 s for libebur128 (I + S + LRA + true peak + sample peak together); a Welch spectrum of the same file took 0.45 s. No GPU is needed for anything in this note; only stem separation (from #6) needs the RTX 5080.

---

## 1. Loudness: integrated, short-term, momentary, LRA

**The standard.** ITU-R BS.1770 defines K-weighted loudness with gating at an absolute −70 LKFS and a relative gate 10 dB below the absolute-gated level ([BS.1770-5, Annex 1](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf)). EBU Tech 3341 adds the meter modes: momentary (400 ms), short-term (3 s sliding window, no gating), integrated, and 23 conformance test cases with a **±0.1 LU** tolerance for M, S and I ([EBU Tech 3341](https://tech.ebu.ch/docs/tech/tech3341.pdf)). LRA is specified in EBU Tech 3342 ([Tech 3342](https://tech.ebu.ch/docs/tech/tech3342.pdf)) as the spread between the 10th and 95th percentiles of gated short-term values, with a −20 LU relative gate (as summarised in [Essentia's LoudnessEBUR128 docs](https://essentia.upf.edu/reference/std_LoudnessEBUR128.html)).

**Libraries.**
- **libebur128** (C, **MIT**): implements M, S and I modes, LRA (Tech 3342), sample peak and true-peak scanning, at any sample rate ([repo](https://github.com/jiixyj/libebur128)). Python binding **`pyebur128`** (MIT) ships Windows wheels for CPython 3.8–3.12 only (v0.1.1, Sept 2024, [PyPI](https://pypi.org/project/pyebur128/)); on 3.13+ it builds from source, which needs a C compiler on Windows. Pin Python 3.12 for the analysis process, or call `ebur128.dll` via ctypes. Its API exposes `get_loudness_global`, `get_loudness_shortterm`, `get_loudness_momentary`, `get_loudness_range`, `get_true_peak`, `get_sample_peak` (checked locally).
- **pyloudnorm** (Python, **MIT**, numpy + scipy): integrated loudness per BS.1770-4; the README calls its LRA "an attempt" and it exposes no short-term curve and **no true peak** ([repo](https://github.com/csteinmetz1/pyloudnorm)). Fine for integrated LUFS, not enough on its own.
- **Essentia `LoudnessEBUR128`** (**AGPL-3.0**): returns momentary and short-term curves, integrated and LRA in one call, with a configurable hop ([docs](https://essentia.upf.edu/reference/std_LoudnessEBUR128.html)). It claims no formal conformance testing. PyPI wheels exist only for Linux and macOS, CPython 3.14 (2.1b6.dev1438, May 2026, [PyPI](https://pypi.org/project/essentia/#files)), so on Windows it means WSL2, as #6 already found.
- **FFmpeg `ebur128` filter**: M/S/I/LRA plus true peak, which it gets by resampling to 192 kHz with libswresample ([source](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/f_ebur128.c)). Useful as an independent cross-check from the command line.

**Trust.** Integrated loudness from libebur128 and pyloudnorm agreed within 0.05 LU on a 5-minute test signal (−13.85 vs −13.90 LUFS), inside the ±0.1 LU tolerance. To make this a guarantee, **run the EBU Tech 3341 / 3342 test signals as unit tests** of whichever library is chosen.

**Limits for advice.**
- BS.1770 K-weighting includes a high-pass "RLB" stage that de-emphasises low frequencies ([BS.1770-5](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf)). For sub-heavy EDM, two tracks at the same LUFS can feel quite different in the low end; pair LUFS with the spectral view (§4), never use it alone for bass decisions.
- LRA is a robust number but EDM is deliberately compressed, so LRA mostly reflects the arrangement (breakdown vs drop), not mix quality. Report it; don't build stones on it alone. Per-section short-term loudness (using the section grid from #6) is the more useful dynamics view: "drop is 1.5 LU quieter than the reference's drop".

## 2. True peak, sample peak, clipping, inter-sample peaks

**True peak.** BS.1770 Annex 2 estimates true peak by 4× oversampling (48 → 192 kHz). Its own attachment gives the worst-case under-read as `20·log10(cos(π·f_norm/n))`: about **0.55 dB** at f_norm = 0.45 and **0.69 dB** at 0.5 for 4× ([BS.1770-5, Annex 2](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf)). EBU Tech 3341 tolerates **+0.2 / −0.4 dB** on its true-peak test cases ([Tech 3341](https://tech.ebu.ch/docs/tech/tech3341.pdf)).
- libebur128 uses a 49-tap FIR interpolator at 4× below 96 kHz and 2× from 96 to 192 kHz ([source, `ebur128.c` lines ~347–351](https://github.com/jiixyj/libebur128/blob/master/ebur128/ebur128.c)).
- Local check with a Tech 3341-style signal (sine at fs/4 with 45° phase, true peak −6.0 dBTP): **sample peak read −9.03 dBFS, libebur128 true peak read −5.92 dBTP**, inside tolerance. That 3 dB gap is exactly the inter-sample peak a sample-peak meter misses.
- Essentia `TruePeakDetector` (AGPL) is an alternative with configurable oversampling factor and BS.1770-4 flow ([docs](https://essentia.upf.edu/reference/std_TruePeakDetector.html)).

**Practical rule for stones:** because the meter can under-read by up to ~0.5 dB on high-frequency content, treat any reading above about −1.5 dBTP as "at the ceiling" rather than trusting the last tenth of a dB. The exact ceiling target belongs to the targets research, not here.

**Sample peak and clipping.**
- Clipping detection is exact arithmetic: count runs of ≥ 2–3 consecutive samples at (or within ~0.01 dB of) the file's maximum, and samples above 0 dBFS.
- **Bounce format matters.** Ableton's export offers 16, 24 or 32-bit; dither applies only below 32-bit; and the manual recommends 32-bit for anything that will be processed further ([Live 12 manual, Exporting audio](https://www.ableton.com/en/live-manual/12/managing-files-and-sets/)). In a 32-bit float file, overs above 0 dBFS survive and can be measured as "how far over". In 16/24-bit, they are already flattened and only show as runs of identical full-scale samples. **Ask Aden to bounce 32-bit float WAV.**
- Ableton's **Normalize** export option "adjusts the audio's gain so that the highest peak reaches the maximum available headroom" ([manual](https://www.ableton.com/en/live-manual/12/managing-files-and-sets/)). It changes every absolute number (LUFS, peaks, headroom). The tool must tell Aden to switch it off for analysis bounces, and should warn if a mixdown's sample peak is exactly 0.00 dBFS.

## 3. Crest factor and dynamics

- **Crest factor** (peak minus RMS, dB) is trivial to compute but is "more of an abstract concept than a defined standard", because "average" can be measured several ways ([MeterPlugs](https://www.meterplugs.com/blog/2017/05/18/crest-factor-psr-and-plr.html)).
- **PLR** (true peak minus integrated loudness) and **PSR** (true peak minus short-term loudness, 3 s) are the BS.1770-based versions, from mastering engineer Ian Shepherd's Dynameter; they stay the same when playback level changes, so they survive streaming normalisation ([MeterPlugs](https://www.meterplugs.com/blog/2017/05/18/crest-factor-psr-and-plr.html), [Dynameter guide](https://www.meterplugs.com/files/dynameter-guide.pdf)). Shepherd's rule of thumb is not to go below PSR ≈ 8 in the loudest parts. That is an engineer's opinion, a candidate target, not a standard.
- **Recommendation:** compute PSR as a curve and summarise it per section (drop PSR is the number that matters for EDM masters). Per-stem crest factor (e.g. kick or drum bus) is a good mix-mode signal for over-compression or transient loss, but only meaningful against Aden's own earlier bounces or the reference.

## 4. Spectral balance against a tonal target

**What is computable, exactly.** A long-term average spectrum (LTAS) from scipy's `welch` (BSD) or librosa's STFT (ISC, [repo](https://github.com/librosa/librosa)), smoothed to 1/3 or 1/6 octave, summed into a few bands (sub, low, low-mid, mid, high-mid, air). Deterministic and fast (0.45 s for 5 min of audio, measured).

**What the target is.** No public standard defines a "correct" mix spectrum. Commercial tonal-balance targets (e.g. iZotope's) are proprietary. The best primary evidence:
- Pestana, Ma, Reiss, Barbosa & Black, AES 135 (2013), measured 772 chart-topping songs (1950–2010) with a 4096-point FFT, normalising each spectrum before averaging ([paper](https://joshreiss.github.io/documents/2013/Pestana%20Ma%20Reiss%20-%20AES135.pdf)). The average falls roughly **5 dB per octave from 100 Hz to 4 kHz**, steeper above, with a low cut near 60 Hz. **Electronic music had the shallowest slope** of all genres (log-log slope −0.75 vs −1.29 for jazz) and an "extremely extended low end"; low-end differences between genres were the only region where confidence intervals did not overlap. Spectra got flatter over the decades, which the authors partly attribute to heavier compression.
- Consequence: a generic "pop" curve is wrong for EDM, and EDM subgenres will differ mostly in the low end. This supports the map's choice of **subgenre-set targets plus 1–3 reference tracks**.

**How to make the comparison fair.**
1. Loudness-match first (see §8).
2. Normalise each spectrum (by integrated loudness or total energy) so the comparison is about *shape*, not level.
3. Compare like with like: drop vs drop, breakdown vs breakdown, using the section grid from #6. A whole-track average mixes sections with and without kick and bass.
4. Smooth heavily (1/3 octave) and only flag deviations that are both large (several dB) and broad (an octave or more). Narrow peaks in one track's spectrum are mostly key and arrangement (notes), not mix errors.

**Trust.** The measurement is exact; the advice is only as good as the target. Treat outputs as "your low-mids sit about 3 dB above your references in the drop", not "your low-mids are wrong".

## 5. Stereo width and correlation, per band; mono-safe low end

All of this is standard signal arithmetic on L/R (numpy + scipy filters). No library is needed or recommended.

- **Correlation** (phase-correlation-meter style): Pearson correlation of L and R at zero lag, per short window (e.g. 400 ms or per bar). +1 = mono, 0 = uncorrelated, negative = out-of-phase content that cancels in mono.
- **Width:** side-to-mid energy ratio, S/M in dB, with M = (L+R)/2 and S = (L−R)/2.
- **Per band:** split with Linkwitz-Riley or Butterworth crossovers (scipy, zero-phase `sosfiltfilt` for offline analysis) into e.g. < 120 Hz, 120–500 Hz, 0.5–2 kHz, 2–8 kHz, > 8 kHz; compute correlation and S/M per band per section.
- **Mono-safe low end:** the most actionable numbers are (a) correlation and S/M **below ~120–150 Hz** (should be near-mono in club-oriented EDM; the exact cutoff and limit are a target, see the targets ticket), and (b) **mono fold-down loss**: integrated or per-section loudness of (L+R)/2 compared to the stereo loudness, overall and in the sub band. A drop that loses several dB of sub when summed is a concrete, verifiable stone.
- **Trust.** High as measurement. Two caveats: correlation of near-silent bands is noisy (gate windows below a level threshold), and an uncorrelated wide reverb is fine in the highs but a problem in the lows, so interpretation must be per band.
- **Per stem.** With real stems, the same numbers per stem point at *which track* is wide in the lows (e.g. a stereo-widened bass or a reverb return). With separated stems (#6), stereo image of the separated stems is less trustworthy because separation artifacts are themselves phasey.

## 6. Masking / frequency conflicts between stems

**State of the art.** There is no validated, off-the-shelf perceptual masking metric for mixes.
- Ronan et al., "Automatic Minimisation of Masking in Multitrack Audio using Subgroups" ([arXiv 1803.09960](https://arxiv.org/pdf/1803.09960)) define a cross-adaptive masking measure from the **MPEG psychoacoustic model**: for each track, the masker is the sum of all other tracks; compute its masking threshold per scale-factor band and the masker-to-signal ratio where the track falls below it. Optimising it reduced inter-track masking and listeners preferred the results to plain summed mixes, but **human mixes still beat it in nearly every case**, and the paper reports no direct correlation between the metric and listener ratings. It also notes that the simpler spectral-magnitude masking measure of Hafezi & Reiss ([JAES 2015, AES e-lib 17637](https://www.aes.org/e-lib/browse.cfm?elib=17637)) "might not correlate well with the perception of human hearing".
- Wichern et al. (iZotope) quantified masking as **loudness loss** (a track's loudness alone minus its partial loudness in the mix) ([AES e-lib 18450](https://www.aes.org/e-lib/browse.cfm?elib=18450)); no open implementation was found.

**What is reliable enough for stones (recommendation, not a published tool):**
- **Kick vs bass, the EDM case.** With the beat grid and kick onsets from #6: measure bass-stem energy in the kick's band (≈ 40–120 Hz) in a short window around each kick hit vs between hits. A dip on every kick = sidechain or ducking is present; no dip and both stems loud in the same band = a concrete "kick and bass collide at ~X Hz" stone. Also compare the two stems' spectral peaks below 150 Hz: if their fundamentals sit within a few semitones, flag it.
- **Generic pairwise conflict.** For each pair of stems, per section and per ERB or 1/3-octave band, count frames where both are within N dB of each other and both are near the mix level in that band. Rank pairs by overlap. This is a heuristic proxy, good for *where to look* ("pad and lead overlap 1–3 kHz in the drop"), not proof of audible masking.
- **Trust:** medium with real stems, **low with separated stems**, because separation bleed (kick in bass, synths in "other", as #6 documents) creates exactly the overlap the metric looks for. When Aden has no stems, keep masking stones to kick-vs-bass only, or ask for stems.

## 7. Phase problems

- **Polarity flips and time offsets between related stems** (e.g. layered kicks, a bass split into sub and top, parallel busses): cross-correlate the pair (scipy `correlate`, FFT method). A strong negative peak at lag 0 = polarity inversion; a strong peak at a small non-zero lag (0.1–5 ms) = a delay that will comb-filter when summed. Reliable when both stems contain the same source; meaningless for unrelated stems, so only check pairs that look related (high coherence in a band).
- **Mix-level phase**: covered by §5 (negative correlation per band, mono fold-down loss).
- **Not reliably computable**: phase rotation from EQs and all-pass effects within a single track, and "phasey" perception in general. No stone should claim those.
- **Requires real stems.** Ableton's "All Individual Tracks" export renders each track post-fader, including group and return tracks, and leaves return and main effects off unless "Include Return and Main Effects" is enabled ([manual](https://www.ableton.com/en/live-manual/12/managing-files-and-sets/)). So stems line up sample-accurately and the sum of track outputs and returns should reconstruct the mixdown (up to main-bus processing). That also gives a cheap **sanity check**: if stems + returns differ wildly from the mixdown, the bounce settings were inconsistent.

## 8. Comparing with a reference track fairly

1. **Same format.** Decode references to float at the mix's sample rate (Ableton itself uses the SoX resampler when exporting at a lower rate, [manual](https://www.ableton.com/en/live-manual/12/managing-files-and-sets/); use soxr or scipy `resample_poly` in code). Prefer lossless references; #6 found MP3 decoders shift timing by ~20–40 ms, which matters for any section-aligned comparison.
2. **Loudness-match before anything else.** Gain both to the same integrated LUFS (BS.1770) before comparing spectrum, width or dynamics, because louder audio is heard as better and fuller. Report the original difference separately as its own finding ("your master is 2.3 LU quieter than reference A").
3. **Section-to-section, not whole-track.** Use the section grid from #6 and compare the reference's loudest drop to the mix's loudest drop using short-term loudness matching. Intros, breakdowns and track lengths differ too much for whole-track averages.
4. **Level-independent dynamics.** Compare PLR/PSR and crest factor, which do not change with gain ([MeterPlugs](https://www.meterplugs.com/blog/2017/05/18/crest-factor-psr-and-plr.html)), rather than raw peak levels.
5. **Mix mode vs master mode.** In mix mode, the mix is unlimited and the reference is a finished master: match loudness *and* expect the reference to have less dynamics; compare spectral shape and stereo, not PSR. In master mode, all comparisons apply.
6. **Several references.** With 1–3 references, show the mix against the *range* they span (min–max per band), not their average; only stones where the mix falls outside every reference are strong.

## 9. Projects bounced without stems (reuse of #6)

From [#6](https://github.com/IONLYASKFORETA/elynt-music-tool/blob/research/track-analysis/research/track-analysis.md): BS-RoFormer / Mel-Band RoFormer (via `python-audio-separator` or ZFTurbo MSST, MIT code) separate drums and bass well (≈ 14 dB SDR on MVSep's benchmark) and "other" poorly; Demucs v4 is the archived fallback; on the RTX 5080 everything needs torch ≥ 2.7 with CUDA 12.8.

What that means for each measurement here:
- **Unaffected** (computed on the mixdown): LUFS, LRA, true peak, clipping, PSR/PLR, whole-mix spectrum, whole-mix stereo and mono fold-down.
- **Usable with care**: per-stem loudness and spectrum of drums and bass, kick-vs-bass sidechain check.
- **Not trustworthy**: masking between non-drum stems, per-stem stereo width, phase/polarity between stems (separation artifacts mimic all three), and anything that names a specific Ableton track, because separated stems do not map to Live tracks. The .als still says which tracks exist, but not which part of "other" each one is.
- **Recommendation:** the tool should say plainly that some stones need stems, and ask for "All Individual Tracks" (32-bit, Normalize off) when it wants them.

## Recommended v1 measurement set

Mixdown (always):
- Integrated LUFS, short-term curve (summarised per section), LRA; true peak and sample peak; clipping runs; PLR and per-section PSR; 1/3-octave LTAS per section; correlation and S/M per band per section; mono fold-down loss overall and below ~120 Hz.

Stems (when given):
- Per-stem loudness, spectrum and crest factor per section; per-stem low-band width; kick-vs-bass collision and sidechain check; pairwise band-overlap ranking; polarity/offset check on related pairs; stems + returns ≈ mixdown sanity check.

References: same mixdown set, loudness-matched, section-aligned.

Validation: Tech 3341/3342 test signals as unit tests for the loudness and true-peak code.

Stack: Python 3.12 on Windows, numpy + scipy + soundfile + `pyebur128` (all permissive licences); librosa only if its STFT helpers are wanted; no Essentia (AGPL, no Windows wheels) and no GPU needed for this part.

## Open risks / unverified

- `pyebur128` has no wheels for Python ≥ 3.13 on Windows (v0.1.1, 2024); the project may be stale. Fallbacks: ctypes over libebur128's DLL, or FFmpeg's `ebur128` filter.
- Timings above are from a Linux container, not Aden's i9-10850K; they are seconds either way.
- The masking heuristics and stone thresholds are untested on Aden's tracks. Prototype them against a few of his projects with and without known problems.
- Numeric targets (LUFS, true-peak ceiling, PSR, low-end mono cutoff, tonal curves per subgenre) are out of scope here; they belong to the targets research ticket.
- The EBU Tech 3342 LRA conformance tolerance was not checked in this pass.
