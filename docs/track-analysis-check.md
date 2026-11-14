# Track analysis check on the three test tracks

Ticket #52 (V1) asks for analysis to run on SUPERFLY, flip and THE WAY I and for its sections to be compared with Aden's own markings, as the build-risk check. The audio stays in the project files (`test-tracks/`) and is never committed.

Run on 2026-11-14 with the helper's signal-processing path (`beatSource: dsp`). Beat This! could not be tried here, because its weights download from a server the cloud session can't reach. It runs on Aden's PC after the helper setup script is run again.

## What analysis found

Times are minutes:seconds into the excerpt. Bars count from 1.

| Track | BPM | Sections | Key and mood |
|---|---|---|---|
| SUPERFLY (1:07) | 147.1 | intro 0:00, **build 0:07.5** (bar 6), **drop 0:25.4** (bar 17), breakdown 0:33.6 (bar 22), **drop 0:40.1** (bar 26) | G♯ major (low confidence), euphoric |
| flip (1:12) | 134.1 | intro 0:00, **build 0:14.3** (bar 9), **drop 0:42.95** (bar 25) | C major, euphoric |
| THE WAY I (0:55) | 140.0 | intro 0:00, **build 0:13.7** (bar 9), **drop 0:27.4** (bar 17) | C minor, moody |

Each run took under 0.2 seconds on the cloud CPU. The synthetic test track also checks out at 120, 124, 128, 140, 150, 160 and 174 BPM: tempo within 0.05 BPM, every downbeat within 15 ms, and all six sections labelled right. The beat model will add a few seconds on the GPU.

## Compared with markings

Aden hasn't marked these tracks yet. The only earlier reference is the visual-language prototype (#10), which read flip by hand-tuned measurement: a 134 BPM grid, a long rise from about 0:15, and the drop at 0:42.7.

| Track | Earlier reference | Analysis | Verdict |
|---|---|---|---|
| flip | 134 BPM, rise from ~0:15, drop 0:42.7 | 134.1 BPM, build 0:14.3, drop 0:42.95 | Agrees. The drop's sample-level energy jump is at 0:42.95, so 0:42.95 is the more exact time. |
| SUPERFLY | none | two drops with a short gap between | Needs Aden's marks. This is the least certain track: its loudness only moves about 4 dB across the excerpt, and where the build starts is a guess. |
| THE WAY I | none | build 0:13.7, drop 0:27.4 | Needs Aden's marks. The drop is a clear 8 dB lift in loudness and low end. |

## Build risk

- **Build and drop labels are heuristics, as agreed.** No model labels builds or drops (research #6), so the heuristics are the main path rather than a fallback. Drops are the loudest parts with full low end. A build is the part just before a drop that rises in loudness, brightness or hats. Breakdowns are quieter parts between drops.
- **Boundaries sit on downbeats.** The built-in tracker places the bar at the biggest lift in the track (kick, bass and level all coming in), which is how club tracks are arranged. On the synthetic test track every boundary lands within 30 ms of the truth.
- **Downbeats were the weak spot.** Earlier versions of the tracker were off by one or two beats on SUPERFLY and THE WAY I. Beat This! finds downbeats directly, so its first run on Aden's PC is the check that matters.
- **Mood is coarse.** It comes from tempo, loudness, brightness and major or minor. The Gemini listen (V12) adds the detail.
