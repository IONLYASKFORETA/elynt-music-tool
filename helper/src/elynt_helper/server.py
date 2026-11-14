"""Line-delimited JSON over stdio.

The app writes one request per line to stdin:
    {"id": 1, "method": "audio.probe", "params": {"path": "/mnt/d/x.wav"}}
and the helper answers on stdout, one line each, in any order:
    {"id": 1, "result": {...}}
    {"id": 1, "error": {"code": "file_not_found", "message": "..."}}

A long call (a stem split) may send progress lines for its id before its answer:
    {"id": 1, "progress": {"stage": "Splitting", "fraction": 0.4}}

Before the first request, the helper writes one ready line:
    {"event": "ready", "protocol": 2, "version": "0.1.0"}

Each request runs on its own worker thread, so a split that takes a minute doesn't hold up a probe.
stdout carries only protocol lines. Anything else (logs, library noise) goes to stderr.
"""

from __future__ import annotations

import json
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, TextIO

from . import PROTOCOL_VERSION, __version__
from .methods import METHODS, HelperError, Handler, Progress

Respond = Callable[[dict[str, Any]], None]

# Enough for a split, an analysis and a few quick calls at once. The GPU work queues itself.
MAX_WORKERS = 4


def _no_progress(_stage: str, _fraction: float | None = None) -> None:
    pass


def parse_line(line: str, methods: dict[str, Handler]) -> tuple[Any, Handler, dict[str, Any]] | dict[str, Any] | None:
    """A request ready to run as (id, handler, params), an error response, or None for a blank line."""
    line = line.strip()
    if not line:
        return None
    try:
        request = json.loads(line)
    except json.JSONDecodeError as e:
        return {"id": None, "error": {"code": "bad_request", "message": f"not JSON: {e}"}}
    if not isinstance(request, dict):
        return {"id": None, "error": {"code": "bad_request", "message": "request must be an object"}}

    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}
    handler = methods.get(method) if isinstance(method, str) else None
    if handler is None:
        return {"id": request_id, "error": {"code": "unknown_method", "message": f"no method {method!r}"}}
    if not isinstance(params, dict):
        return {"id": request_id, "error": {"code": "bad_request", "message": "params must be an object"}}
    return request_id, handler, params


def run(request_id: Any, handler: Handler, params: dict[str, Any], progress: Progress = _no_progress) -> dict[str, Any]:
    try:
        return {"id": request_id, "result": handler(params, progress)}
    except HelperError as e:
        return {"id": request_id, "error": {"code": e.code, "message": str(e)}}
    except Exception as e:  # noqa: BLE001 - one bad call must not kill the helper
        traceback.print_exc(file=sys.stderr)
        return {"id": request_id, "error": {"code": "internal", "message": f"{type(e).__name__}: {e}"}}


def handle_line(line: str, methods: dict[str, Handler] = METHODS, respond: Respond | None = None) -> dict[str, Any] | None:
    """Turn one request line into one response, or None for a blank line. Runs on the calling thread.

    With `respond`, progress lines for this request are passed to it as they happen.
    """
    parsed = parse_line(line, methods)
    if parsed is None or isinstance(parsed, dict):
        return parsed
    request_id, handler, params = parsed
    return run(request_id, handler, params, _progress_for(request_id, respond) if respond else _no_progress)


def _progress_for(request_id: Any, respond: Respond) -> Progress:
    def progress(stage: str, fraction: float | None = None) -> None:
        update: dict[str, Any] = {"stage": stage}
        if fraction is not None:
            update["fraction"] = max(0.0, min(1.0, float(fraction)))
        respond({"id": request_id, "progress": update})

    return progress


def serve(inp: TextIO, out: TextIO, methods: dict[str, Handler] = METHODS) -> int:
    # Some libraries print to stdout on import. Keep the real stdout for protocol lines only.
    protocol_out = out
    if out is sys.stdout:
        sys.stdout = sys.stderr

    lock = threading.Lock()

    def respond(message: dict[str, Any]) -> None:
        line = json.dumps(message, separators=(",", ":")) + "\n"
        with lock:  # one whole line at a time, whichever thread is talking
            protocol_out.write(line)
            protocol_out.flush()

    respond({"event": "ready", "protocol": PROTOCOL_VERSION, "version": __version__})
    # Leaving the with-block waits for calls still running, so stdin closing doesn't cut off a split's answer.
    with ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="call") as pool:
        for line in inp:
            parsed = parse_line(line, methods)
            if parsed is None:
                continue
            if isinstance(parsed, dict):
                respond(parsed)
                continue
            request_id, handler, params = parsed
            pool.submit(lambda r=request_id, h=handler, p=params: respond(run(r, h, p, _progress_for(r, respond))))
    return 0
