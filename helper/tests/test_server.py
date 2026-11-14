import json
import subprocess
import sys
import wave
from pathlib import Path

import pytest

from elynt_helper.install_check import requirement_name, songformer_requirements
from elynt_helper import stems
from elynt_helper.server import handle_line, serve


def write_wav(path: Path, seconds: float, rate: int = 48000, channels: int = 2, level: int = 0) -> None:
    """Silence by default; `level` writes a square wave of that 16-bit amplitude."""
    frames = int(seconds * rate)
    sample = level.to_bytes(2, "little", signed=True)
    low = (-level).to_bytes(2, "little", signed=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join((sample if (i // 50) % 2 else low) * channels for i in range(frames)))


def call(method: str, **params):
    return handle_line(json.dumps({"id": 7, "method": method, "params": params}))


def test_probe_reads_duration_and_sample_rate(tmp_path):
    wav = tmp_path / "mixdown.wav"
    write_wav(wav, seconds=1.5, rate=48000)
    response = call("audio.probe", path=str(wav))
    assert response["id"] == 7
    assert response["result"]["sampleRate"] == 48000
    assert response["result"]["channels"] == 2
    assert response["result"]["durationSeconds"] == pytest.approx(1.5)


def test_probe_missing_file_is_a_coded_error(tmp_path):
    response = call("audio.probe", path=str(tmp_path / "nope.wav"))
    assert response["error"]["code"] == "file_not_found"


def test_probe_non_audio_is_a_coded_error(tmp_path):
    junk = tmp_path / "junk.wav"
    junk.write_text("not audio")
    assert call("audio.probe", path=str(junk))["error"]["code"] == "unreadable_audio"


def test_unknown_method_and_bad_json():
    assert call("nope")["error"]["code"] == "unknown_method"
    assert handle_line("{not json")["error"]["code"] == "bad_request"
    assert handle_line("   ") is None


def test_info_reports_python_and_gpu():
    result = call("helper.info")["result"]
    assert result["protocol"] == 2
    assert result["python"].startswith("3.12")
    assert "available" in result["gpu"]


def test_process_says_ready_then_answers_in_order(tmp_path):
    wav = tmp_path / "a.wav"
    write_wav(wav, seconds=0.25, rate=44100, channels=1)
    requests = [
        {"id": 1, "method": "audio.probe", "params": {"path": str(wav)}},
        {"id": 2, "method": "nope"},
    ]
    proc = subprocess.run(
        [sys.executable, "-m", "elynt_helper"],
        input="".join(json.dumps(r) + "\n" for r in requests),
        capture_output=True, text=True, timeout=60, check=True,
    )
    lines = [json.loads(line) for line in proc.stdout.splitlines()]
    assert lines[0]["event"] == "ready"
    # Calls run on worker threads, so answers can arrive in any order.
    by_id = {line["id"]: line for line in lines[1:]}
    assert by_id[1]["result"]["sampleRate"] == 44100
    assert by_id[2]["error"]["code"] == "unknown_method"


def test_a_slow_call_does_not_hold_up_a_quick_one():
    import io
    import threading

    release = threading.Event()

    def slow(_params, progress):
        progress("Splitting", 0.5)
        release.wait(5)
        return "slow"

    def quick(_params, _progress):
        release.set()
        return "quick"

    out = io.StringIO()
    inp = io.StringIO('{"id":1,"method":"slow"}\n{"id":2,"method":"quick"}\n')
    serve(inp, out, methods={"slow": slow, "quick": quick})
    lines = [json.loads(line) for line in out.getvalue().splitlines()]
    assert lines[0]["event"] == "ready"
    assert {"id": 1, "progress": {"stage": "Splitting", "fraction": 0.5}} in lines
    # The quick call answered first, and the slow one still finished before serve returned.
    answers = [line for line in lines if "result" in line]
    assert [a["id"] for a in answers] == [2, 1]


def fake_separator(names, silent=()):
    def separate(path, out_dir, model, progress):
        progress("Splitting", 0.5)
        written = []
        for name in names:
            target = Path(out_dir) / f"{name}.wav"
            write_wav(target, seconds=0.1, level=0 if name in silent else 8000)
            written.append(str(target))
        return written

    return separate


def test_split_lists_each_stem_with_drums_and_bass_first(tmp_path):
    mixdown = tmp_path / "SUPERFLY.wav"
    write_wav(mixdown, seconds=0.2)
    seen = []
    result = stems.split_stems(
        {"path": str(mixdown), "outDir": str(tmp_path / "out")},
        lambda stage, fraction=None: seen.append((stage, fraction)),
        separate=fake_separator(["other", "vocals", "bass", "drums", "piano", "guitar"]),
    )
    assert [s["name"] for s in result["stems"]] == ["drums", "bass", "vocals", "other", "guitar", "piano"]
    assert result["stems"][1]["path"] == str(tmp_path / "out" / "bass.wav")
    assert result["model"] == stems.DEFAULT_MODEL
    assert ("Splitting", 0.5) in seen


def test_split_needs_the_mixdown_to_exist(tmp_path):
    with pytest.raises(stems.HelperError) as e:
        stems.split_stems({"path": str(tmp_path / "nope.wav"), "outDir": str(tmp_path)}, lambda *a: None, separate=fake_separator([]))
    assert e.value.code == "file_not_found"


def test_split_that_writes_nothing_is_a_coded_error(tmp_path):
    mixdown = tmp_path / "a.wav"
    write_wav(mixdown, seconds=0.1)
    with pytest.raises(stems.HelperError) as e:
        stems.split_stems({"path": str(mixdown), "outDir": str(tmp_path / "out")}, lambda *a: None, separate=fake_separator([]))
    assert e.value.code == "split_failed"


def test_split_drops_stems_that_are_silent_all_the_way_through(tmp_path):
    mixdown = tmp_path / "flip.wav"
    write_wav(mixdown, seconds=0.2)
    out = tmp_path / "out"
    result = stems.split_stems(
        {"path": str(mixdown), "outDir": str(out)},
        lambda *a: None,
        separate=fake_separator(["drums", "bass", "piano"], silent={"piano"}),
    )
    assert [s["name"] for s in result["stems"]] == ["drums", "bass"]
    assert not (out / "piano.wav").exists()


@pytest.mark.parametrize(
    ("file", "name"),
    [("/x/bass.wav", "bass"), ("SUPERFLY_(Drums)_BS-Roformer-SW.wav", "drums"), ("C:/a/Other.WAV", "other")],
)
def test_stem_name(file, name):
    assert stems.stem_name(file) == name


def test_split_without_the_separation_stack_says_to_rerun_setup(tmp_path, monkeypatch):
    import builtins

    real_import = builtins.__import__

    def no_audio_separator(name, *args, **kwargs):
        if name.startswith("audio_separator"):
            raise ImportError("No module named 'audio_separator'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_audio_separator)
    mixdown = tmp_path / "a.wav"
    write_wav(mixdown, seconds=0.1)
    response = call("stems.split", path=str(mixdown), outDir=str(tmp_path / "out"))
    assert response["error"]["code"] == "separation_not_installed"


@pytest.mark.parametrize(
    ("line", "name"),
    [("torch==2.4.0", "torch"), ("torchaudio==2.4.0", "torchaudio"), ("x-transformers==2.4.14", "x-transformers"),
     ("# Core", ""), ("", ""), ("numpy>=1.25 # pinned", "numpy")],
)
def test_requirement_name(line, name):
    assert requirement_name(line) == name


def test_songformer_requirements_drop_torch_and_fix_numpy():
    lines = ["# Core", "torch==2.4.0", "torchaudio==2.4.0", "numpy==1.25.0", "pandas==2.2.3", "jams==0.3.4", ""]
    assert songformer_requirements(lines) == ["numpy>=1.26,<2", "pandas==2.2.3", "jams>=0.3.5"]
