# PROTOTYPE: mix-mode stepping stones (throwaway)

Answers the question in "Prototype stepping stones on one of Aden's projects" (#33): what should stepping stones look and read like? It runs on a demo project, because Aden's own projects weren't available yet.

- `source-pyableton-test.als`: the test Live Set from [pyableton](https://pypi.org/project/pyableton/) (MIT). Saved in Live 11.1.5.
- `make_demo.py`: renames its tracks to EDM parts and writes `demo/Neon Drop.als`. It also synthesizes stems, a mixdown and a stand-in reference, with problems planted on purpose.
- `analyze.py`: parses the Set and measures the bounces, writing `demo/measurements.json`.
- `stepping-stones.html`: the stones Claude wrote from `measurements.json`, shown in three views (Checklist, Coach, Numbers). Published privately as an Artifact.

Run with `pip install numpy scipy soundfile pyloudnorm pyebur128`, then `python make_demo.py && python analyze.py`.

This branch is never merged.
