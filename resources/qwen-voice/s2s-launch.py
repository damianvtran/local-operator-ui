"""Start speech-to-speech under this app's own memory layers (plan §9, Q12).

The rig's console script (`s2s-venv/bin/speech-to-speech`) only imports
`speech_to_speech.cli.main`; this wrapper does the two things that must happen
BEFORE the models load, then hands over to that same entry point, so nothing of
the rig's own STT/TTS code is copied or changed:

  - MLX's buffer cache is capped at 1 GiB. Its default is the equal of the
    memory limit, 34.2 GB measured on the operator's machine, and freed Metal
    buffers stay cached up to that size - so the cache keeps the high-water
    mark of every shape a long transcription or a long TTS reply has produced.
  - MLX's memory limit is the budget main computed (min(8 GiB, a quarter of
    RAM), or `LOP_QWEN_MEM_BUDGET_GB`). `qwen-rig.ts` passes the same number to
    its group-footprint watchdog (layer 3), so the two cannot disagree.
"""

from __future__ import annotations

import os
import sys

GIB = 1024**3
DEFAULT_BUDGET_BYTES = 8 * GIB
CACHE_LIMIT_BYTES = 1 * GIB


def budget_bytes(raw: str | None) -> int:
    """The budget main passed, or 8 GiB when it is absent or malformed."""
    try:
        value = int(raw) if raw else 0
    except ValueError:
        return DEFAULT_BUDGET_BYTES
    return value if value > 0 else DEFAULT_BUDGET_BYTES


def main() -> int:
    import mlx.core as mx

    mx.set_cache_limit(CACHE_LIMIT_BYTES)
    mx.set_memory_limit(budget_bytes(os.environ.get("LOP_QWEN_MEM_LIMIT_BYTES")))

    from speech_to_speech.cli import main as speech_to_speech_main

    return int(speech_to_speech_main() or 0)


if __name__ == "__main__":
    raise SystemExit(main())
