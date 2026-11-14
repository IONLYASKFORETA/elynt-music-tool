"""Elynt helper: the local Python process that does the suite's heavy work."""

__version__ = "0.1.0"

# Bump when a request or response shape changes, so the app can refuse a stale helper.
PROTOCOL_VERSION = 1
