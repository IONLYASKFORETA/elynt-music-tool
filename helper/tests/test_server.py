import json
import subprocess
import sys
import wave
from pathlib import Path

import pytest

from elynt_helper.install_check import requirement_name
from elynt_helper.server import handle_line


def write_wav(path: Path, seconds: float, rate: int = 48000, channels: int = 2) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * channels * int(seconds * rate))


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
    assert result["protocol"] == 1
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
    assert lines[1]["result"]["sampleRate"] == 44100
    assert lines[2]["error"]["code"] == "unknown_method"


@pytest.mark.parametrize(
    ("line", "name"),
    [("torch==2.4.0", "torch"), ("torchaudio==2.4.0", "torchaudio"), ("x-transformers==2.4.14", "x-transformers"),
     ("# Core", ""), ("", ""), ("numpy>=1.25 # pinned", "numpy")],
)
def test_requirement_name(line, name):
    assert requirement_name(line) == name
