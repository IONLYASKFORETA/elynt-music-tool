# PROTOTYPE: visual language sketches (throwaway)

Answers "Prototype the visual language on one of Aden's tracks" (#10, map #4). This is not production code and is never merged.

- `index.html`: four WebGL sketches (Color Bleed, One Accent, Holo Chrome, Ember Type) switchable by `#bleed` `#accent` `#chrome` `#ember`. All are driven by `analysis.json`.
- `analysis.json`: per-frame (30 fps) features of Aden's "flip" excerpt (kick, snare, sub, bass, mid, high, energy), plus the beat grid (134 BPM) and the drop at 42.73 s.
- `analyze.py` / `feat.py`: the numpy-only analysis that produced it.
- The audio (`flip.mp3`) is left out on purpose, because the repo is public. It lives in the project files at `test-tracks/flip.wav`. To run locally, put an MP3 of it next to `index.html` and serve the folder (`python -m http.server`).
