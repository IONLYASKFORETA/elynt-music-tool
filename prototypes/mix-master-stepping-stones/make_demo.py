"""PROTOTYPE, throwaway. Builds a demo EDM Live Set and test bounces.

The Live Set is pyableton's MIT-licensed test set (Live 11.1.5, see
source-pyableton-test.als) with its tracks renamed to EDM roles. Its
devices and settings are real and untouched: the Reverb with a 6.2 s
decay on the bass track was already in it.

Audio is synthesized (not from the Set's MIDI) with planted problems:
- Sub Bass: wide (L/R detuned) low end, smeared, too loud, never ducks
  under the kick.
- Lead Synth: a hard 3.5 kHz boost (harsh).
- Mix bus: peaks just under 0 dBFS (no headroom).
The stand-in "reference" is the same arrangement mixed cleanly and
pushed to about -8 LUFS.

Run: python make_demo.py   (writes demo/ next to this file)
"""
import gzip, os, xml.etree.ElementTree as ET
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "demo")
BOUNCES = os.path.join(OUT, "Elynt Bounces")
os.makedirs(BOUNCES, exist_ok=True)
SR, BPM, BARS = 44100, 128, 32
beat = 60 / BPM
N = int(SR * beat * 4 * BARS)
t = np.arange(N) / SR
rng = np.random.default_rng(7)

RENAME = {"Bass": "Sub Bass", "Drums": "Drums", "Guitar": "Lead Synth", "Voice": "Vocal Chop"}


def make_set():
    raw = gzip.open(os.path.join(HERE, "source-pyableton-test.als")).read()
    root = ET.fromstring(raw)
    for tr in root.find("LiveSet/Tracks"):
        n = tr.find("Name/EffectiveName")
        if n.get("Value") in RENAME:
            new = RENAME[n.get("Value")]
            n.set("Value", new)
            tr.find("Name/UserName").set("Value", new)
    with gzip.open(os.path.join(OUT, "Neon Drop.als"), "wb") as f:
        f.write(ET.tostring(root, xml_declaration=True, encoding="UTF-8"))


def bp(x, lo, hi, order=4):
    return sosfilt(butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def hp(x, f):
    return sosfilt(butter(4, f, "highpass", fs=SR, output="sos"), x)


def section_gain(bar_from):
    g = np.zeros(N)
    g[int(SR * beat * 4 * bar_from):] = 1
    return g


DROP = section_gain(16)  # bars 17-32 are the drop
BUILD = section_gain(8)


def kick_track():
    k = np.zeros(N)
    L = int(0.35 * SR)
    tt = np.arange(L) / SR
    f = 50 + 110 * np.exp(-tt * 30)
    hit = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9)
    for i in range(int(BARS * 4)):
        s = int(i * beat * SR)
        k[s:s + L] += hit[: max(0, min(L, N - s))]
    return k * DROP, k


def hats():
    h = hp(rng.standard_normal(N), 7000) * 0.15
    env = np.zeros(N)
    L = int(0.05 * SR)
    for i in range(int(BARS * 8)):
        s = int((i + 0.5) * beat / 2 * SR)
        env[s:s + L] = np.exp(-np.arange(min(L, N - s)) / SR * 80)
    return h * env * BUILD


def bass(clean):
    f = 55.0
    if clean:
        x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
        L = R = x
    else:  # detuned L/R + reverb-ish smear = wide, phasey low end
        L = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
        R = np.sin(2 * np.pi * (f + 0.9) * t + 1.3) + 0.25 * np.sin(2 * np.pi * 2 * (f + 0.9) * t)
    duck = np.ones(N)
    if clean:  # sidechain-style ducking under every kick
        for i in range(int(BARS * 4)):
            s = int(i * beat * SR)
            d = int(0.18 * SR)
            duck[s:s + d] = np.linspace(0.15, 1, min(d, N - s))
    g = (0.30 if clean else 0.55) * DROP * duck
    return np.stack([L * g, R * g], 1)


def lead(clean):
    x = np.zeros(N)
    for f in (440, 554.4, 659.3):
        ph = 2 * np.pi * f * t
        x += sum(np.sin(k * ph) / k for k in range(1, 30)) * 0.12
    if not clean:
        x = x + 2.2 * bp(x, 2800, 4500)  # harsh presence boost
    gate = (np.floor(t / (beat / 2)) % 2 == 0).astype(float)
    x = x * (0.5 + 0.5 * gate) * BUILD * 0.5
    return np.stack([x * 0.9, x * 1.1], 1)


def vocal():
    x = bp(rng.standard_normal(N), 600, 1400) * 0.6 + bp(rng.standard_normal(N), 2200, 2800) * 0.3
    chop = ((np.floor(t / (beat / 4)) % 4) == 0).astype(float)
    x = x * chop * DROP * 0.5
    return np.stack([x, x], 1)


def stereo(m):
    return np.stack([m, m], 1)


def limit(x, target_peak):
    y = np.tanh(x * 1.0)
    return y / np.max(np.abs(y)) * target_peak


def build(clean):
    k, _ = kick_track()
    stems = {
        "Drums": stereo(k * 0.9 + hats()),
        "Sub Bass": bass(clean),
        "Lead Synth": lead(clean),
        "Vocal Chop": vocal(),
    }
    mix = sum(stems.values())
    return stems, mix


make_set()
stems, mix = build(clean=False)
mix = mix / np.max(np.abs(mix)) * 0.97  # about -0.3 dBFS: no headroom left
scale = 0.97 / np.max(np.abs(sum(stems.values())))
for name, s in stems.items():
    sf.write(os.path.join(BOUNCES, f"{name}.wav"), (s * scale).astype(np.float32), SR, subtype="FLOAT")
sf.write(os.path.join(BOUNCES, "Neon Drop (mixdown).wav"), mix.astype(np.float32), SR, subtype="FLOAT")

_, ref = build(clean=True)
ref = limit(ref * 3.0, 0.89)
sf.write(os.path.join(OUT, "Reference - stand-in.wav"), ref.astype(np.float32), SR, subtype="FLOAT")
print("wrote", OUT)
