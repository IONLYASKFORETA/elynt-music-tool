"""PROTOTYPE, throwaway. Parses the demo Live Set and measures its bounces.

Writes demo/measurements.json: the facts every stepping stone must cite.
Run after make_demo.py:  python analyze.py
"""
import gzip, glob, json, os, xml.etree.ElementTree as ET
import numpy as np, soundfile as sf, pyloudnorm as pyln, pyebur128 as e128
from scipy.signal import butter, sosfilt, welch

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, "demo")
BANDS = {"sub <60": (20, 60), "low 60-250": (60, 250), "low-mid 250-2k": (250, 2000),
         "presence 2-6k": (2000, 6000), "air >6k": (6000, 20000)}
DEVICE_NAMES = {"Eq8": "EQ Eight", "Compressor2": "Compressor", "GlueCompressor": "Glue Compressor",
                "Limiter": "Limiter", "StereoGain": "Utility", "Saturator": "Saturator",
                "Reverb": "Reverb", "Delay": "Delay", "AutoFilter": "Auto Filter"}


def db(x):
    return float(20 * np.log10(max(x, 1e-12)))


def parse_set(path):
    root = ET.fromstring(gzip.open(path).read())
    ls = root.find("LiveSet")
    main = ls.find("MainTrack") or ls.find("MasterTrack")  # Live 12 vs Live 11 and older
    out = {"creator": root.get("Creator"), "tracks": [],
           "main_track_devices": [d.tag for d in main.find("DeviceChain/DeviceChain/Devices")]}
    for tr in ls.find("Tracks"):
        name = tr.find("Name/EffectiveName").get("Value")
        devs = []
        for d in tr.iter():
            if d.tag in DEVICE_NAMES:
                p = {c.tag: c.find("Manual").get("Value") for c in d if c.find("Manual") is not None}
                devs.append({"device": DEVICE_NAMES[d.tag], "on": p.get("On") == "true",
                             "params": {k: p[k] for k in list(p)[:40] if k in (
                                 "Threshold", "Ratio", "Attack", "Release", "DecayTime", "DryWet",
                                 "PreDelay", "Cutoff", "Resonance", "RoomSize", "StereoSeparation")}})
        vol = float(tr.find("DeviceChain/Mixer/Volume/Manual").get("Value"))
        out["tracks"].append({"name": name, "type": tr.tag, "volume_db": db(vol), "devices": devs})
    return out


def load(path):
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    return x, sr


def loudness(x, sr):
    st = e128.R128State(2, sr, e128.MeasurementMode.MODE_I | e128.MeasurementMode.MODE_S
                        | e128.MeasurementMode.MODE_TRUE_PEAK | e128.MeasurementMode.MODE_LRA)
    hop = sr // 10
    shorts = []
    for i in range(0, len(x), hop):
        st.add_frames(np.ascontiguousarray(x[i:i + hop], dtype=np.float64).ravel(), len(x[i:i + hop]))
        shorts.append(e128.get_loudness_shortterm(st))
    tp = max(e128.get_true_peak(st, 0), e128.get_true_peak(st, 1))
    return {"integrated_lufs": round(e128.get_loudness_global(st), 1),
            "max_short_term_lufs": round(max(s for s in shorts if s > -70), 1),
            "true_peak_dbtp": round(db(tp), 1),
            "sample_peak_dbfs": round(db(float(np.max(np.abs(x)))), 1),
            "lra_lu": round(e128.get_loudness_range(st), 1)}


def band_db(x, sr):
    f, p = welch(x.mean(1), sr, nperseg=8192)
    tot = p.sum()
    return {b: round(10 * np.log10(p[(f >= lo) & (f < hi)].sum() / tot), 1) for b, (lo, hi) in BANDS.items()}


def lowpass(x, sr, fc):
    return sosfilt(butter(4, fc, "lowpass", fs=sr, output="sos"), x, axis=0)


def low_end_stereo(x, sr):
    lo = lowpass(x, sr, 120)
    L, R = lo[:, 0], lo[:, 1]
    corr = float(np.dot(L, R) / np.sqrt(np.dot(L, L) * np.dot(R, R) + 1e-12))
    mono = (L + R) / 2
    loss = db(np.sqrt(np.mean(mono ** 2))) - db(np.sqrt(np.mean(((L ** 2 + R ** 2) / 2))))
    return {"correlation_below_120hz": round(corr, 2), "mono_foldown_change_db_below_120hz": round(loss, 1)}


def ducking(kick, bass, sr, bpm=128):
    """How much the bass drops in the 60 ms after each kick vs between kicks."""
    lo = lowpass(bass.mean(1), sr, 120)
    beat = int(sr * 60 / bpm)
    on, off = [], []
    for s in range(0, len(lo) - beat, beat):
        if np.abs(kick[s:s + 200]).max() < 1e-3:
            continue
        on.append(np.sqrt(np.mean(lo[s:s + int(0.06 * sr)] ** 2)))
        off.append(np.sqrt(np.mean(lo[s + beat // 2:s + beat // 2 + int(0.06 * sr)] ** 2)))
    return round(db(np.mean(on)) - db(np.mean(off)), 1) if on else None


def overlap_40_100(kick, bass, sr):
    f, pk = welch(kick.mean(1), sr, nperseg=8192)
    _, pb = welch(bass.mean(1), sr, nperseg=8192)
    m = (f >= 40) & (f <= 100)
    return round(10 * np.log10(pb[m].sum() / pk[m].sum()), 1)


def gain_match(x, sr, target):
    meter = pyln.Meter(sr)
    return x * 10 ** ((target - meter.integrated_loudness(x)) / 20)


als = parse_set(os.path.join(D, "Neon Drop.als"))
mix, sr = load(glob.glob(os.path.join(D, "Elynt Bounces", "*(mixdown).wav"))[0])
ref, _ = load(os.path.join(D, "Reference - stand-in.wav"))
stems = {os.path.basename(p)[:-4]: load(p)[0] for p in glob.glob(os.path.join(D, "Elynt Bounces", "*.wav"))
         if "(mixdown)" not in p}

mix_b, ref_b = band_db(gain_match(mix, sr, -14), sr), band_db(gain_match(ref, sr, -14), sr)
m = {
    "live_set": als,
    "mixdown": {**loudness(mix, sr), **low_end_stereo(mix, sr), "bands_db_rel": mix_b},
    "reference": {**loudness(ref, sr), **low_end_stereo(ref, sr), "bands_db_rel": ref_b},
    "tone_vs_reference_db": {b: round(mix_b[b] - ref_b[b], 1) for b in BANDS},
    "stems": {n: {"peak_dbfs": round(db(float(np.abs(s).max())), 1),
                  "rms_dbfs": round(db(float(np.sqrt(np.mean(s ** 2)))), 1),
                  **low_end_stereo(s, sr),
                  "presence_2_6k_db_rel": band_db(s, sr)["presence 2-6k"]} for n, s in stems.items()},
    "kick_vs_bass": {"bass_ducking_db_on_kick": ducking(stems["Drums"].mean(1), stems["Sub Bass"], sr),
                     "bass_over_kick_40_100hz_db": overlap_40_100(stems["Drums"], stems["Sub Bass"], sr)},
}
json.dump(m, open(os.path.join(D, "measurements.json"), "w"), indent=2, default=float)
print(json.dumps(m, indent=2, default=float))
