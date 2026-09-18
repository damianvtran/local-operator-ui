#!/usr/bin/env python3
"""Replay the two placeholder lines the guide used to print, into a transcript.

WHY THIS FILE EXISTS. The panel's extractor is exercised by real transcript TEXT,
and the text that produced the phantom tiles in review round 1 came from the
backend guide's own examples:

    `scratchpad://logs/run.md -> /…/sessions/<id>/scratchpad/logs/run.md`
    the printed path (`bash /…/scratchpad/probe.sh`, `eval`, `grep`)

The backend has since edited those examples out of the guide, so a fresh run no
longer carries them - and a fresh run would therefore show a four-tile panel for
the wrong reason (there is nothing abbreviated in the transcript to reject).
Replaying the two lines keeps the before/after honest and reproducible: the base
tree tiles six files from this transcript, and this tree tiles four.

The record is a copy of a REAL assistant row from the same transcript with its
text replaced, rather than a hand-built one, so it is the shape the reducer and
the canonical frontend already parse. Nothing else about the session changes: the
turn itself, the four files it wrote and their tool results are the run's own.

Usage: seed-placeholder-lines.py <transcript.jsonl>
"""

import json
import secrets
import sys
import time

# The lines, verbatim from the guide as round 1 measured them.
SEEDED_TEXT = (
    "From the guide: the shape every result prints is "
    "`scratchpad://logs/run.md -> /…/sessions/<id>/scratchpad/logs/run.md`, "
    "and the printed path (`bash /…/scratchpad/probe.sh`, `eval`, `grep`) is "
    "what you hand to a shell."
)


def main(path: str) -> int:
    rows = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
    assistant = next(
        (
            row
            for row in rows
            if row.get("type") == "message"
            and row.get("payload", {}).get("role") == "assistant"
        ),
        None,
    )
    if assistant is None:
        print("no assistant row to model the seeded record on", file=sys.stderr)
        return 1
    seeded = json.loads(json.dumps(assistant))
    seeded["id"] = secrets.token_hex(16)
    seeded["ts"] = time.time()
    seeded["payload"]["content"] = [{"text": SEEDED_TEXT}]
    seeded["payload"]["tool_calls"] = []
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(seeded) + "\n")
    print(f"seeded the two placeholder lines into {path}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
