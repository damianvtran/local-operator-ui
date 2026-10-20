"""Seed one Library-visible session: a long opening message, one image asset, and
a GENERATED title sidecar written by the harness's own API.

The transcript row shapes are imported from `tests/unit/library/_fixtures.py` —
the shapes the scanner's own tests pin — rather than invented here. The image
bytes are registered through `cache_media`, the same content-addressed store
call a real `generate_image` tool result goes through, so the Library's
attachment route can serve them.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

src = Path(os.environ["LO_SOURCE"]).resolve()
spec = importlib.util.spec_from_file_location(
    "library_fixtures", src / "tests/unit/library/_fixtures.py"
)
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)

from local_operator import resume  # noqa: E402
from local_operator.session.attachments import cache_media  # noqa: E402

config = Path(os.environ["LOCAL_OPERATOR_CONFIG_DIR"])
session_id = "b1a5e7c0d2f4"
directory = config / "sessions" / session_id
directory.mkdir(parents=True, exist_ok=True)

opening = (
    "Can you review Victor's message in non-urgent-tech-support, and delegate "
    "to a minervadev team to draft the reply?"
)
generated = "Victor support reply triage"

block = cache_media(
    fixtures.png(320, 200, seed=17),
    "image/png",
    kind="image",
    name="victor-reply-draft.png",
)
if block is None:
    raise SystemExit("cache_media refused the image")

rows = [
    fixtures.user_row("u-opening", 1761000000.0, opening),
    *fixtures.image_rows(
        "g-victor",
        1761000001.0,
        block.attachment,
        name="victor-reply-draft.png",
    ),
]
(directory / "transcript.jsonl").write_text(
    "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows),
    encoding="utf-8",
)

# The sidecar exactly as the naming process writes it: user_set=False (generated,
# not typed), no past names.
resume.write_session_title(directory, generated, user_set=False, past_names=[])

stored = resume.stored_session_title(directory)
print(
    json.dumps(
        {
            "session_id": session_id,
            "session_dir": str(directory),
            "digest": block.attachment,
            "opening": opening,
            "generated_title": generated,
            "stored_title_read_back": stored,
            "transcript_rows": len(rows),
        },
        indent=1,
    )
)
if stored != generated:
    sys.exit(f"sidecar did not read back: {stored!r}")
