"""The one lock every GPU model holds while it runs.

A stem split and an image generation at once would only fight over the RTX 5080's 16 GB, so the
heavy calls queue behind each other. Quick calls (probe, info) never take it.
"""

from __future__ import annotations

import threading

gpu_lock = threading.Lock()
