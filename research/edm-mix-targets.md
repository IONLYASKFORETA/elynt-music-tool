# What targets do pro engineers use for EDM mixes and masters?

Ticket: #29 (on map #24, Mix & Master Assistant v1 spec). Researched 2026-11-13.

## Short answer

- There is **no single loudness target** for EDM masters. Current chart dance and electronic masters measure about **-8 LUFS integrated on average, with a range of about -11 to -6**. Their true peaks often sit at or above 0 dBTP. Streaming services turn these masters down to about -14 LUFS (or -16 on Apple Music), so extra loudness buys nothing on streaming. It still matters in DJ and club use, where nothing normalises the level.
- Platform documents set a **true-peak ceiling of -1 dBTP**, and **-2 dBTP for masters louder than -14 LUFS** (Spotify, SoundCloud). Apple says to leave at least 1 dB of headroom.
- Before mastering, engineers want **mix peaks around -6 to -3 dBFS (true peak)**, **no limiter on the mix bus** and only light bus processing.
- **Tonal targets by subgenre are not published by any primary source** found. The evidence shows one shared "electronic" contour, with a strongly extended sub-bass and a fairly bright top end. Subgenres differ more in rhythm and tempo than in spectrum. Engineers handle tonal balance by comparing against reference tracks, not against fixed curves.
- The most common problems engineers report are **unbalanced or muddy low end, poor mono compatibility, overall spectral imbalance, too much mix-bus limiting or clipping, harshness or sibilance, and render glitches**. They find them with mono checks, small-speaker and headphone checks, reference A/B and loudness meters.
- A **stock Live 12 master chain** is EQ Eight (M/S, oversampled) → Glue Compressor (light) → Utility (Bass Mono) → Limiter (True Peak mode). Live's Limiter has Standard, Soft Clip and True Peak modes, plus a Maximize mode with threshold and output.

## 1. Platform normalisation and delivery specs

| Platform | Reference playback level | Turns quiet tracks up? | Peak guidance | Source |
|---|---|---|---|---|
| Spotify | -14 LUFS (ITU-R BS.1770). Premium listeners can choose Loud -11, Normal -14 or Quiet -19 | Yes ("Positive gain is applied to softer masters"). On the Loud setting a limiter acts at -1 dB, with 5 ms attack and 100 ms decay | "Keep it below -1dB TP"; "If your master is louder than -14dB integrated LUFS, keep True Peak below -2dB" | [Spotify for Artists: Loudness normalization](https://support.spotify.com/artists/article/loudness-normalization/) |
| Spotify album mode | Normalises a whole album as one unit, so gain stays the same between tracks. Shuffle and playlists are normalised per track | n/a | n/a | same |
| Apple Music | About -16 LUFS (Sound Check). **Apple does not publish this number**; the figure comes from iZotope's Ian Stewart | Only as far as peak levels allow (Stewart) | Apple: "leave at least 1 dB of headroom" to avoid clipping when encoding or oversampling. Apple says to check for inter-sample clipping with afclip | [Apple Digital Masters PDF](https://apple.com/itunes/docs/apple-digital-masters.pdf) pp.4–8; [iZotope, Stewart 2025](https://www.izotope.com/en/learn/mastering-for-streaming-platforms) |
| YouTube | About -14 LUFS (Stewart). YouTube does not document the level; Ian Shepherd calls it the "Distribution Loudness" reference | **No**: "YouTube doesn't turn up quieter videos" (Shepherd). Right-click → "Stats for nerds" → "content loudness" shows how many dB above the reference a track is | n/a | [Production Advice, Shepherd](https://productionadvice.co.uk/stats-for-nerds/); [iZotope](https://www.izotope.com/en/learn/mastering-for-streaming-platforms) |
| SoundCloud | SoundCloud says it "applies Loudness Normalization to your tracks as they're played". It advises aiming for -14 LUFS | n/a | "below -1 dB TP", or below -2 dBTP if the master is louder than -14 LUFS | [SoundCloud Help](https://help.soundcloud.com/hc/en-us/articles/360053660014-Will-SoundCloud-play-my-track-at-the-level-it-s-mastered) |
| Beatport | **No published loudness normalisation or LUFS target.** Distributor requirements are WAV or AIFF, at least 44.1 kHz, 16- or 24-bit, "Mastered, DJ-ready", peaks below 0 dBFS, no "excessive limiting or compression" | n/a | below 0 dBFS | [LabelGrid: Beatport requirements](https://help.labelgrid.com/en/distribution/beatport-requirements/) (distributor documentation; Beatport's own specification was not found) |
| Amazon / Tidal / Deezer | -14 / -14 / -15 LUFS; none turns quiet tracks up | | | [iZotope, Stewart 2025](https://www.izotope.com/en/learn/mastering-for-streaming-platforms) |

**Conflict:** iZotope's 2025 table says SoundCloud has "No normalization", but SoundCloud's own help page says it normalises. The tool should follow the owner's page, SoundCloud's.

**Standards background:** AES TD1008 (2021) is written for streaming *services*, not for mastering engineers. It recommends about -16 LUFS for the overall music stream and favours album normalisation. With album normalisation the loudest song sits around -14 LUFS ([Production Advice summary of TD1008](https://productionadvice.co.uk/td1008/)).

**True-peak practice in mastering:** Stewart sets a -1 dBFS ceiling, followed by a true-peak limiter at -0.3 dBTP. For lossless streams he considers "below -0.3 dBTP or so" fine ([iZotope 2025](https://www.izotope.com/en/learn/mastering-for-streaming-platforms)). In his 2024 survey of 54 Global-200 top-10 songs, only 20% peaked below 0 dBTP ([iZotope Mastering trends 2024](https://www.izotope.com/en/learn/mastering-trends)). Commercial masters therefore often break the platform guidance.

## 2. What EDM masters actually measure

Ian Stewart (iZotope, 8 April 2025) measured 10 Billboard Hot Dance/Electronic songs ([source](https://www.izotope.com/en/learn/dance-electronic-analysis)):

- **Integrated loudness:** average -8.3 LUFS, range -6.2 to -11.3. Across the whole chart the average was about -7.8, pulled up by two outliers near -2.5 LUFS.
- **Maximum short-term loudness:** average -6.1, range -4.5 to -8.6.
- **LRA:** average 6.6 LU, range 3.5 to 13.8.
- **True peak:** most songs between -0.3 and +1.5 dBTP.
- Stewart's conclusion: there is no single target loudness for dance music, and strong songs exist at -10 to -11 LUFS.

Other evidence about engineer practice:

- **Club and techno:** Kevin McHugh (Ambivalent, label owner) reports about -6 dB RMS in current digital club releases. His label and its mastering house target about -10 to -9 dB RMS. He warns that crushed drums kill danceability ([Attack Magazine, 2016](https://www.attackmagazine.com/features/long-read/surviving-the-loudness-wars-ambivalent-on-mastering/)).
- Daniel Wyatt, an EDM mastering engineer, makes masters "'as loud' but not louder" than good-sounding current Beatport releases ([Sonnox](https://sonnox.com/articles/daniel-wyatt-on-mastering-electronic-dance-music/)). He matches references rather than a number.
- Sage Audio, a mastering studio, says "most masters have an integrated LUFS of -16 to -9" ([Sage Audio](https://sageaudio.com/articles/how-to-prepare-your-mix-for-mastering)).

**Implication for the tool:** do not hard-code one target. Report integrated LUFS, maximum short-term LUFS, true peak, LRA and PLR. Compare them against two things:

- the streaming reference (-14, or -16 for Apple), showing how much each platform will turn the track down;
- a "club" band of about -9 to -6 LUFS integrated.

Then let Aden choose the intent.

## 3. Tonal balance and how much subgenres really differ

- **One shared "electronic" contour.** In a study of commercial recordings from 1950–2010, Pestana, Ma and Reiss found that "spectra are dependent on genre". Electronic and hip-hop show "the extremely extended low end". Electronic is among the brightest genres. Electronic mixes "allow and benefit from bigger frequency extensions". The overall industry contour is a roughly linear fall from 100 Hz to 4 kHz that steepens above that, with a low cut around 60 Hz ([AES 135, 2013, PDF](https://joshreiss.github.io/documents/2013/Pestana%20Ma%20Reiss%20-%20AES135.pdf)). The study did not split electronic music into subgenres.
- **Subgenres are mostly rhythm, not spectrum.** A 2025 EPFL study of Beatport's 35 genre labels found only about 19–23 acoustically distinct groups. In that study, "temporal features outperform traditional MFCCs and spectral features" ([Xu et al., arXiv 2509.11474](https://arxiv.org/html/2509.11474v1)). Tonal differences between, say, house and techno are smaller than the labels suggest.
- **Commercial target curves are coarse.** iZotope Tonal Balance Control ships only three factory curves: Orchestral, Bass Heavy and Modern. They were "created by analyzing the spectral characteristics of numerous tracks across different genres/styles" ([iZotope docs](https://downloads.izotope.com/docs/tonal-balance-control/meters-and-target-curves/index.html)). Stewart's 2024 survey built one combined curve, and the widest spread was in the low end ([iZotope 2024](https://www.izotope.com/en/learn/mastering-trends)).
- **Gap:** no primary source found gives numeric tonal targets per subgenre (house, techno, dubstep, DnB, future bass, trance). Any per-subgenre advice in v1 should be labelled as a heuristic. The better approach is to compare Aden's mix with a reference track he chooses, in bands such as sub <60 Hz, low 60–250 Hz, low-mid 250–2k, presence 2–6k and air >6k, rather than with fixed curves. *(This is the researcher's inference from the above, not from a source.)*

## 4. Gain staging and headroom before mastering

- **Peaks.** "Your loudest peak should be between -6dBTP and -3dBTP", measured as true peak ([Sage Audio](https://sageaudio.com/articles/how-to-prepare-your-mix-for-mastering)). McHugh asks for 24-bit premasters "peaking somewhere between -6 and -3 dB", with no master-bus compression ([Attack](https://www.attackmagazine.com/features/long-read/surviving-the-loudness-wars-ambivalent-on-mastering/)). Stewart gives no fixed number: keep peaks off the clipping point, and simply turn the mix down if more headroom is needed ([iZotope, 2021](https://www.izotope.com/en/learn/audio-mixing/mixing-levels)).
- **Mix-bus processing.** Sage says not to use "limiting on your mix's output to simulate a finished sound". It also advises against more than 3 dB of compression, EQ moves above 3 dB, distortion above 1% THD, or stereo wideners. Stewart says to check that the mix holds up without bus saturation or limiting. If a mix is delivered limited, he suggests keeping it around -12 to -10 LUFS or lower ([iZotope 2025](https://www.izotope.com/en/learn/audio-mastering-issues)).
- **Typical unmastered mix loudness:** about -25 to -18 LUFS (Sage).
- **Format.** Deliver at the session's sample rate and bit depth, with no dither if the bit depth is unchanged (Sage). McHugh asks for 24-bit/44.1k.

## 5. Common mixing mistakes in producer-made EDM, and how engineers find them

| Problem | How engineers detect it | Source |
|---|---|---|
| Overall spectral imbalance ("by far the most common mix issue I encounter") | A/B against good reference mixes | [SOS, Inglis 2022](https://www.soundonsound.com/sound-advice/10-essential-mix-checks) |
| Muddy or undefined low end; kick and bass at the wrong level | Low-end visualisation, checks on several systems (headphones, car), kick/bass level check | [iZotope 2025](https://www.izotope.com/en/learn/audio-mastering-issues); SOS Inglis |
| Bass not centred, mono problems | Mono fold-down; check whether elements drop or vanish | iZotope 2025; SOS Inglis; [SOS White & Senior 2001](https://www.soundonsound.com/techniques/increasing-loudness-dance-music-production) ("most dance tracks should really have their bass sounds panned to the centre") |
| Bass that disappears on small speakers (no harmonics above the fundamental) | Small-speaker check | SOS White & Senior; SOS Inglis |
| Mix-bus limiting, clipping or saturation used up too early | Bounce with and without the bus chain; check LUFS | iZotope 2025; Attack (McHugh) |
| Crushed transients from heavy limiting (a "flat-lined airhorn"); mid-range build-up under hard limiting | Listening; PLR/crest factor | Attack (McHugh); Sonnox (Wyatt) |
| Too much reverb or delay eating headroom and impact | Listening | SOS White & Senior |
| Harsh 3–4 kHz or sibilant vocals | Listening, de-essing | iZotope 2025 |
| Clicks, pops, render artifacts | Listen to the exported file from start to finish | iZotope 2025 |

**What code can measure** (the researcher's mapping for the stepping stones):

- mono fold-down loss and low-band side energy (correlation below about 150 Hz);
- band energy compared with a reference;
- crest factor or PLR and LRA;
- mix-bus true peak and LUFS;
- clipped-sample counts;
- whether the .als master track contains Limiter or Glue Compressor devices.

## 6. A master chain from Live 12 stock devices

Device facts come from Ableton's own documentation. The order and settings are standard practice as described by the engineers above.

1. **EQ Eight** for broad corrective or tonal moves. It has Stereo, L/R and **M/S** modes and **Oversampling** in its context menu ([Live manual, Audio Effect Reference](https://www.ableton.com/en/manual/live-audio-effect-reference/)). Keep the moves gentle: White & Senior suggest mainly around 80 Hz and 15 kHz, and Sage advises against moves above 3 dB.
2. **Glue Compressor**, light: about 1–2 dB of gain reduction, slow attack, auto release. It glues the mix rather than adding loudness. (White & Senior use multiband at about 1.25:1 with no more than about 6 dB GR; Sage says no more than 3 dB on a premaster.)
3. **Utility** with **Bass Mono** on, adjustable from 50 to 500 Hz, plus an audition switch for the mono band ([Ableton DSP package `abl.device.utility~`](https://docs.cycling74.com/reference/abl.device.utility~)). Around 100–150 Hz is a common choice; this figure is the researcher's suggestion, not from a source.
4. Optionally **Saturator** or **Drum Buss** for density. Use them carefully; Drum Buss "Hard" is clipping distortion with bass boost (Live manual).
5. **Limiter** last. Its modes are **Standard, Soft Clip and True Peak**. Ceiling ranges from -24 to 0 dB. Lookahead is 1.5, 3 or 6 ms ("shorter times give more compression but can add distortion"). Routing is L/R or M/S, with stereo link and auto release. **Maximize** mode adds a threshold and an output level ([Ableton DSP package `abl.device.limiter~`](https://docs.cycling74.com/reference/abl.device.limiter~), which documents the Limiter's DSP for Max). For streaming, use True Peak mode with the ceiling at -1.0 dBTP, or -2.0 if the master is louder than -14 LUFS.
6. **Metering.** This research found no LUFS or true-peak loudness meter among Live 12's stock devices; the release notes and device reference checked mention none. The tool should compute BS.1770 LUFS and true peak itself from the bounce.

Caveat: Ableton's Live 12 reference page was cut off when fetched, so the Limiter and Utility details come from Ableton's own Max DSP package documentation for the same devices. Confirm them in Live 12's Info View.

## 7. How much targets vary by subgenre (verdict)

- **Loudness:** the spread within the dance chart (-11.3 to -6.2 LUFS) is larger than any documented difference between subgenres. Techno and club engineers lean slightly quieter for drum punch (McHugh: -10 to -9 dB RMS). Big-room and festival styles push towards -6 (Stewart's loudest examples). This is only a weak tendency, not a standard.
- **True peak and headroom:** the same for every subgenre.
- **Tonal balance:** one broad electronic contour (extended sub-bass, bright top end). Subgenre differences come mainly from rhythm, tempo and arrangement, so use reference tracks rather than per-subgenre curves.

## Sources

- Spotify for Artists, "Loudness normalization": https://support.spotify.com/artists/article/loudness-normalization/
- SoundCloud Help, "Will SoundCloud play my track at the level it's mastered?": https://help.soundcloud.com/hc/en-us/articles/360053660014
- Apple, "Apple Digital Masters" (PDF): https://apple.com/itunes/docs/apple-digital-masters.pdf
- Ian Shepherd, "Stats for nerds" (YouTube normalisation): https://productionadvice.co.uk/stats-for-nerds/
- Ian Shepherd, AES TD1008 summary: https://productionadvice.co.uk/td1008/
- LabelGrid, Beatport requirements: https://help.labelgrid.com/en/distribution/beatport-requirements/
- Ian Stewart (iZotope), "How to master for streaming platforms" (Jul 2025): https://www.izotope.com/en/learn/mastering-for-streaming-platforms
- Ian Stewart (iZotope), "Mastering trends in 2024" (Jul 2024): https://www.izotope.com/en/learn/mastering-trends
- Ian Stewart (iZotope), "LUFS and tonal analysis of 10 top-charting dance and electronic songs" (Apr 2025): https://www.izotope.com/en/learn/dance-electronic-analysis
- Ian Stewart (iZotope), mastering issues (Nov 2025): https://www.izotope.com/en/learn/audio-mastering-issues
- Ian Stewart (iZotope), "Headroom" (Nov 2021): https://www.izotope.com/en/learn/audio-mixing/mixing-levels
- iZotope Tonal Balance Control docs: https://downloads.izotope.com/docs/tonal-balance-control/meters-and-target-curves/index.html
- Pestana, Ma, Reiss, "Spectral characteristics of popular commercial recordings 1950–2010", AES 135 (2013): https://joshreiss.github.io/documents/2013/Pestana%20Ma%20Reiss%20-%20AES135.pdf
- Xu et al., "Acoustic overspecification in electronic dance music taxonomy": https://arxiv.org/html/2509.11474v1
- Sage Audio, "How to prepare your mix for mastering": https://sageaudio.com/articles/how-to-prepare-your-mix-for-mastering
- Kevin McHugh, Attack Magazine (Jan 2016): https://www.attackmagazine.com/features/long-read/surviving-the-loudness-wars-ambivalent-on-mastering/
- Sonnox, Daniel Wyatt on mastering EDM: https://sonnox.com/articles/daniel-wyatt-on-mastering-electronic-dance-music/
- Paul White & Mike Senior, SOS (Jun 2001): https://www.soundonsound.com/techniques/increasing-loudness-dance-music-production
- Sam Inglis, SOS "10 essential mix checks" (Dec 2022): https://www.soundonsound.com/sound-advice/10-essential-mix-checks
- Ableton Live manual, Audio Effect Reference: https://www.ableton.com/en/manual/live-audio-effect-reference/
- Ableton/Cycling '74, `abl.device.limiter~`: https://docs.cycling74.com/reference/abl.device.limiter~
- Ableton/Cycling '74, `abl.device.utility~`: https://docs.cycling74.com/reference/abl.device.utility~
