"""Line-delimited JSON over stdio.

The app writes one request per line to stdin:
    {"id": 1, "method": "audio.probe", "params": {"path": "/mnt/d/x.wav"}}
and the helper answers on stdout, one line each, in any order:
    {"id": 1, "result": {...}}
    {"id": 1, "error": {"code": "file_not_found", "message": "..."}}

Before the first request, the helper writes one ready line:
    {"event": "ready", "protocol": 1, "version": "0.1.0"}

stdout carries only protocol lines. Anything else (logs, library noise) goes to stderr.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable, TextIO

from . import PROTOCOL_VERSION, __version__
from .methods import METHODS, HelperError

Handler = Callable[[dict[str, Any]], Any]


def handle_line(line: str, methods: dict[str, Handler] = METHODS) -> dict[str, Any] | None:
    """Turn one request line into one response, or None for a blank line."""
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

    try:
        return {"id": request_id, "result": handler(params)}
    except HelperError as e:
        return {"id": request_id, "error": {"code": e.code, "message": str(e)}}
    except Exception as e:  # noqa: BLE001 - one bad call must not kill the helper
        traceback.print_exc(file=sys.stderr)
        return {"id": request_id, "error": {"code": "internal", "message": f"{type(e).__name__}: {e}"}}


def _write(out: TextIO, message: dict[str, Any]) -> None:
    out.write(json.dumps(message, separators=(",", ":")) + "\n")
    out.flush()


def serve(inp: TextIO, out: TextIO) -> int:
    # Some libraries print to stdout on import. Keep the real stdout for protocol lines only.
    protocol_out = out
    if out is sys.stdout:
        sys.stdout = sys.stderr

    _write(protocol_out, {"event": "ready", "protocol": PROTOCOL_VERSION, "version": __version__})
    for line in inp:
        response = handle_line(line)
        if response is not None:
            _write(protocol_out, response)
    return 0
