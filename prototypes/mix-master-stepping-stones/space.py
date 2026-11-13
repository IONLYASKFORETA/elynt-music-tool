"""PROTOTYPE, throwaway. Space map: how each stem fills frequency x mid/side space.
Writes demo/space.json. Run after analyze.py."""
import glob, json, os
import numpy as np, soundfile as sf
from scipy.signal import welch
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, "demo")
BANDS = [("sub", 20, 60), ("low", 60, 250), ("low-mid", 250, 2000), ("presence", 2000, 6000), ("air", 6000, 20000)]
def bands(x, sr):
    f, p = welch(x, sr, nperseg=8192)
    return [float(p[(f >= lo) & (f < hi)].sum()) for _, lo, hi in BANDS]
def ms(path):
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    M, S = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2
    return np.array(bands(M, sr)), np.array(bands(S, sr))
stems = {os.path.basename(p)[:-4]: ms(p) for p in glob.glob(os.path.join(D, "Elynt Bounces", "*.wav")) if "(mixdown)" not in p}
mixM, mixS = ms(glob.glob(os.path.join(D, "Elynt Bounces", "*(mixdown).wav"))[0])
refM, refS = ms(os.path.join(D, "Reference - stand-in.wav"))
db = lambda v: float(10 * np.log10(max(v, 1e-20)))
out = {"bands": [b[0] for b in BANDS], "cells": []}
for zone, idx in (("mid", 0), ("side", 1)):
    for bi, b in enumerate(BANDS):
        tot = sum(s[idx][bi] for s in stems.values())
        share = {n: round(100 * s[idx][bi] / tot) if tot > 0 else 0 for n, s in stems.items()}
        out["cells"].append({"zone": zone, "band": b[0], "share_pct": share,
            "mix_side_minus_mid_db": round(db(mixS[bi]) - db(mixM[bi]), 1) if zone == "side" else None,
            "ref_side_minus_mid_db": round(db(refS[bi]) - db(refM[bi]), 1) if zone == "side" else None})
json.dump(out, open(os.path.join(D, "space.json"), "w"), indent=1)
for c in out["cells"]:
    print(c["zone"], c["band"], c["share_pct"], c["mix_side_minus_mid_db"], c["ref_side_minus_mid_db"])
