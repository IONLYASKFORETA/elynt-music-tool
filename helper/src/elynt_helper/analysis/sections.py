"""Sections from the bar grid: where the arrangement changes, and what each part is.

No model labels builds or drops (research #6), so this is the agreed fallback made
the main path: boundaries go where bar-level measurements change most, snapped to
four-bar phrases, and labels come from energy and low end.

- drop: the loud parts with full low end
- build: the part leading into a drop, where energy or brightness rises
- breakdown: a quieter part between drops
- intro / outro: what comes before the first drop or build, and after the last drop
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .beats import frame_time_offset
from .features import Features, db

LABELS = ("intro", "build", "drop", "breakdown", "outro")
PHRASE = 4  # bars; boundaries land on four-bar phrases
MIN_SECTION_BARS = 4
FLOOR_DB = 50.0  # quieter than this below a band's loudest bar counts as silent
MIN_BUILD_RISE = 0.15  # how much a part must climb to count as a build
BUILD_BARS = 8  # a long part before a drop splits so its last eight bars are the build
DROP_LOUD_DB = 3.0  # a drop is within this of the loudest part...
DROP_LOW_DB = 4.0  # ...and its low end within this of the strongest low end
FLAT_RANGE_DB = 2.0  # parts this close in loudness and low end are all the same kind
SILENT_DB = 30.0  # bars this far below the loudest bar are silence or a tail
MIN_CHANGE = 0.35  # of the biggest change: smaller changes don't start a part


@dataclass
class Section:
    label: str
    start: float
    end: float
    start_bar: int
    confidence: float

    def to_json(self) -> dict:
        return {
            "label": self.label,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "startBar": self.start_bar,
            "confidence": round(self.confidence, 2),
            "source": "heuristic",
        }


@dataclass
class _Part:
    first: int  # bar index
    last: int  # exclusive
    novelty: float  # strength of the change at its start
    label: str = ""
    confidence: float = 0.5


def find_sections(features: Features, downbeats: np.ndarray) -> list[Section]:
    duration = features.duration
    bar_starts = _bar_starts(downbeats, duration)
    bars = len(bar_starts)
    if bars == 0:
        return [Section("intro", 0.0, duration, 0, 0.1)]

    measures = _bar_measures(features, bar_starts, duration)
    # Silence or a fade-out tail at either end would look like the biggest change of all; leave it out.
    audible = np.flatnonzero(measures["loud"] > measures["loud"].max() - SILENT_DB)
    first, last = int(audible[0]), int(audible[-1]) + 1
    inner = {k: v[first:last] for k, v in measures.items()}
    parts = _split(inner, last - first)
    _label(parts, inner)
    parts = _merge_same(parts)
    for p in parts:
        p.first += first
        p.last += first
    parts[0].first = 0
    parts[-1].last = bars

    sections = []
    for i, part in enumerate(parts):
        start = 0.0 if i == 0 else bar_starts[part.first]
        end = duration if part.last >= bars else bar_starts[part.last]
        sections.append(Section(part.label, float(start), float(end), part.first, part.confidence))
    return sections


def _bar_starts(downbeats: np.ndarray, duration: float) -> np.ndarray:
    starts = np.asarray([d for d in downbeats if 0.0 <= d < duration], dtype=np.float64)
    if len(starts) < 2:
        return starts
    bar = float(np.median(np.diff(starts)))
    if starts[0] > 0.5 * bar:
        # A pickup of most of a bar counts as bar 0, so bar numbers follow the music.
        starts = np.r_[max(0.0, starts[0] - bar), starts]
    if duration - starts[-1] < 0.5 * bar:
        # A sliver of a bar at the very end belongs to the bar before it.
        starts = starts[:-1]
    return starts


def _bar_measures(features: Features, bar_starts: np.ndarray, duration: float) -> dict[str, np.ndarray]:
    offset = frame_time_offset(features.rate)
    edges = [int(round(max(0.0, t - offset) * features.fps)) for t in bar_starts]
    edges[0] = 0
    edges.append(features.frames)
    power = features.rms.astype(np.float64) ** 2
    low = features.bands["sub"] + features.bands["bass"]
    out: dict[str, list[float]] = {k: [] for k in ("loud", "low", "high", "kick", "hats", "bright")}
    for a, b in zip(edges[:-1], edges[1:]):
        b = max(b, a + 1)
        out["loud"].append(float(db(power[a:b].mean())))
        out["low"].append(float(db(low[a:b].mean())))
        out["high"].append(float(db(features.bands["high"][a:b].mean())))
        out["kick"].append(float(np.mean(features.onset_low[a:b])))
        out["hats"].append(float(np.mean(features.onset_high[a:b])))
        out["bright"].append(float(np.mean(features.centroid[a:b])))
    measures = {k: np.asarray(v) for k, v in out.items()}
    # Near-silence in one band reads as -100 dB and swamps every slope; floor it.
    for key in ("loud", "low", "high"):
        measures[key] = np.maximum(measures[key], measures[key].max() - FLOOR_DB)
    return measures


def _zscore(x: np.ndarray) -> np.ndarray:
    spread = np.percentile(x, 90) - np.percentile(x, 10)
    if spread <= 1e-9:
        return np.zeros_like(x)
    return (x - np.median(x)) / spread


def _split(measures: dict[str, np.ndarray], bars: int) -> list[_Part]:
    """Bar indices where a new part starts, from how much the bars before and after differ."""
    if bars < 2 * MIN_SECTION_BARS:
        return [_Part(0, bars, 0.0)]
    rows = np.stack(
        [
            _zscore(measures["loud"]),
            _zscore(measures["low"]) * 1.5,
            _zscore(measures["high"]),
            _zscore(np.log1p(measures["kick"])),
            _zscore(np.log1p(measures["hats"])),
            _zscore(measures["bright"]) * 0.5,
        ],
        axis=1,
    )
    novelty = np.zeros(bars)
    for j in range(1, bars):
        w = min(PHRASE, j, bars - j)
        novelty[j] = np.linalg.norm(rows[j - w : j].mean(axis=0) - rows[j : j + w].mean(axis=0))
        # The bar right at the change carries most of it.
        novelty[j] += 0.5 * np.linalg.norm(rows[j - 1] - rows[j])

    # Phrases are counted from the biggest change in the track, which is surely on one.
    phase = int(np.argmax(novelty[MIN_SECTION_BARS : bars - MIN_SECTION_BARS + 1])) + MIN_SECTION_BARS
    phase %= PHRASE
    candidates = list(range(MIN_SECTION_BARS, bars - MIN_SECTION_BARS + 1))
    if not candidates:
        return [_Part(0, bars, 0.0)]

    values = np.array([novelty[j] for j in candidates])
    # Against the bigger changes, not the single biggest: one pre-drop silence shouldn't hide the rest.
    threshold = max(float(np.median(novelty[1:])), float(np.percentile(values, 90)) * MIN_CHANGE)

    def needed(j: int) -> float:
        # Off the phrase grid a change has to be twice as clear to count.
        return threshold if j % PHRASE == phase else 2.0 * threshold

    chosen: list[int] = []
    for j in sorted(candidates, key=lambda c: -novelty[c]):
        if novelty[j] < needed(j):
            continue
        if all(abs(j - c) >= MIN_SECTION_BARS for c in chosen):
            chosen.append(j)
    chosen.sort()

    top = values.max() if values.max() > 0 else 1.0
    starts = [0, *chosen]
    ends = [*chosen, bars]
    return [_Part(a, b, float(novelty[a] / top) if a else 1.0) for a, b in zip(starts, ends)]


def _label(parts: list[_Part], m: dict[str, np.ndarray]) -> None:
    # The typical bar, so one loud fill doesn't make a part a drop.
    loud = np.array([float(np.median(m["loud"][p.first : p.last])) for p in parts])
    low = np.array([float(np.median(m["low"][p.first : p.last])) for p in parts])
    span = loud.max() - loud.min()
    level = (loud - loud.min()) / span if span > 0 else np.ones_like(loud)

    if span < FLAT_RANGE_DB and low.max() - low.min() < FLAT_RANGE_DB:
        # One energy all the way through: a drop if the low end is there, else a breakdown.
        full_low = low >= low.max() - DROP_LOW_DB
        for p, is_full in zip(parts, full_low):
            p.label = "drop" if is_full else "breakdown"
            p.confidence = 0.4
        return

    is_drop = (loud >= loud.max() - DROP_LOUD_DB) & (low >= low.max() - DROP_LOW_DB)
    drops = [i for i, d in enumerate(is_drop) if d]
    for i in drops:
        parts[i].label = "drop"
        parts[i].confidence = float(np.clip(0.5 + 0.5 * level[i], 0, 1))

    if not drops:
        for i, p in enumerate(parts):
            p.label = "intro" if i == 0 else ("outro" if i == len(parts) - 1 else "breakdown")
            p.confidence = 0.3
        return

    # Builds: the run of parts leading into each drop. It starts at the clearest change in
    # that run (where the riser or snare roll comes in), if everything from there to the drop
    # climbs. A dip right before the drop (a pre-drop pause) is part of the build.
    for i in drops:
        run = []
        k = i - 1
        while k >= 0 and not parts[k].label:
            run.insert(0, k)
            k -= 1
        if not run:
            continue
        inner = run[1:]
        start = max(inner, key=lambda r: parts[r].novelty) if inner else run[0]
        rise = _rise(m, parts[start].first, parts[i].first)
        if rise <= MIN_BUILD_RISE and start != run[0]:
            start = run[0]
            rise = _rise(m, parts[start].first, parts[i].first)
        if rise > MIN_BUILD_RISE:
            for r in range(start, i):
                parts[r].label = "build"
                parts[r].confidence = float(np.clip(0.4 + rise, 0.3, 0.9))

    first, last = drops[0], drops[-1]
    for i, p in enumerate(parts):
        if p.label:
            continue
        if i < first:
            p.label = "intro"
        elif i > last:
            p.label = "outro"
        else:
            p.label = "breakdown"
        p.confidence = float(np.clip(0.4 + 0.5 * (1 - level[i]), 0.3, 0.9))

    _split_long_builds(parts, m)


def _split_long_builds(parts: list[_Part], m: dict[str, np.ndarray]) -> None:
    """A long non-drop part right before a drop whose last eight bars rise: those eight bars are the build."""
    i = 1
    while i < len(parts):
        prev, part = parts[i - 1], parts[i]
        long_enough = prev.last - prev.first >= BUILD_BARS + MIN_SECTION_BARS
        if part.label == "drop" and prev.label in ("intro", "breakdown", "build") and long_enough:
            cut = prev.last - BUILD_BARS
            tail_rise = _rise(m, cut, prev.last)
            head_rise = _rise(m, prev.first, cut)
            if tail_rise > MIN_BUILD_RISE and tail_rise > head_rise:
                head_label = "intro" if prev.label == "build" and i - 1 == 0 else prev.label
                if head_label == "build":
                    head_label = "breakdown"
                parts[i - 1 : i] = [
                    _Part(prev.first, cut, prev.novelty, head_label, prev.confidence),
                    _Part(cut, prev.last, 0.5, "build", float(np.clip(0.4 + tail_rise, 0.3, 0.9))),
                ]
                i += 1
        i += 1


def _rise(m: dict[str, np.ndarray], first: int, last: int) -> float:
    """How much loudness, high end and hats climb across bars first..last, roughly 0 (flat) to 1 (steep).

    Slopes are medians of bar-to-bar slopes (Theil-Sen), so one odd bar, like the next
    part bleeding into the last bar, can't make a flat part look like a build.
    """
    if last - first < 2:
        return 0.0
    n = last - first
    i, j = np.triu_indices(n, k=1)

    def slope(y: np.ndarray) -> float:
        return float(np.median((y[j] - y[i]) / (j - i)))

    slopes = [slope(m[key][first:last]) * n / scale for key, scale in (("loud", 6.0), ("high", 9.0), ("bright", 1500.0))]
    hats = np.log1p(m["hats"][first:last])
    slopes.append(slope(hats) * n / (abs(hats.mean()) + 1e-6))
    return float(np.mean(slopes))


def _mean_db(values: np.ndarray) -> float:
    return float(10.0 * np.log10(np.mean(10.0 ** (values / 10.0)) + 1e-12))


def _merge_same(parts: list[_Part]) -> list[_Part]:
    merged: list[_Part] = []
    for p in parts:
        if merged and merged[-1].label == p.label:
            prev = merged[-1]
            merged[-1] = _Part(prev.first, p.last, prev.novelty, prev.label, max(prev.confidence, p.confidence))
        else:
            merged.append(p)
    return merged
