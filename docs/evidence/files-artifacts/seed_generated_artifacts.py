"""Seed an isolated config root with a session that holds GENERATED media.

The Files view's bug: `generate_image` / `generate_video` register their output
with `cache_media` and the transcript carries only a digest, so the view listed
none of it. This builds a session of exactly that shape through the harness's
own code paths (`cache_media` for the bytes, `Transcript.append_message` for the
rows), so what the app reads back is the real wire, not a hand-built JSONL:

  * three `generate_image` results, each a tool result whose content is the
    caption sentence the tool really writes plus one `AttachmentContent` block
    (kind/content_type/attachment/size_bytes/width/height/name) - the shape of a
    real row in the operator's session 9c59d684d16b;
  * two of them share a producer name (a model's `<model>-01.jpg` template does),
    which is the case that needs the row's digest tiebreak;
  * one video COMPLETION, delivered the way a detached `generate_video` job really
    delivers it: a `job_result` custom row built by the backend's own
    `Session._job_result_message` (text `background job '<label>' completed:` then
    `Video ready - job ... attached: digest <hex>`, the receipt `video/jobs.py`
    writes; the clip is real, encoded by ffmpeg). Round 1 of review found the
    first version of this seed used a `video_status` TOOL row, which is not how
    a video normally arrives, so the proof never exercised the real shape;
  * two edge pictures: a white one, whose pixels match the light list ground (the
    thumbnail needs its own edge to be seen), and one registered and then
    DELETED from the store, so its digest 404s (the gone state);
  * one `write` result for an ordinary file, so the list shows an artifact row
    beside a path row.

Usage (isolated; the operator's store is never touched):
    env -i HOME=$RIG/home LOCAL_OPERATOR_CONFIG_DIR=$RIG/home/.local-operator \
      PATH="$PATH" ~/local-operator/.venv/bin/python seed_generated_artifacts.py \
      <session-id> <video.mp4> <scratch-file-path>
"""

from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path

SESSION_ID = sys.argv[1]
VIDEO = Path(sys.argv[2]).read_bytes()
SCRATCH_FILE = sys.argv[3]

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from local_operator.harness.types import (  # noqa: E402
    Message,
    TextContent,
    ToolCall,
    ToolResult,
)
from local_operator.paths import config_dir  # noqa: E402
from local_operator.session.attachments import cache_media  # noqa: E402
from local_operator.session.session import Session  # noqa: E402
from local_operator.session.transcript import Transcript  # noqa: E402


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in ("/System/Library/Fonts/Helvetica.ttc",):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _picture(width: int, height: int, hue: tuple[int, int, int], label: str) -> bytes:
    """A recognisable 'generated' picture: gradient, a sun and a label."""
    img = Image.new("RGB", (width, height), hue)
    draw = ImageDraw.Draw(img)
    for y in range(0, height, 6):
        shade = int(255 * y / height)
        draw.rectangle([0, y, width, y + 6], fill=(hue[0], max(0, hue[1] - shade // 3), 40 + shade // 2))
    draw.ellipse([width * 0.55, height * 0.12, width * 0.9, height * 0.12 + width * 0.35], fill=(250, 200, 70))
    draw.text((width * 0.06, height * 0.82), label, fill=(240, 244, 252), font=_font(max(18, width // 14)))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88)
    return out.getvalue()


async def seed() -> None:
    root = config_dir()
    session_dir = root / "sessions" / SESSION_ID
    session_dir.mkdir(parents=True, exist_ok=True)
    transcript = Transcript(session_dir)

    await transcript.append_message(
        Message.user("Make three promo shots for the game, a short teaser clip, and save the notes.")
    )

    shots = [
        (576, 1024, (30, 120, 180), "GO VIRAL 01", "fixture-model-01.jpg"),
        (576, 1024, (170, 60, 120), "GO VIRAL 02", "fixture-model-01.jpg"),  # same producer name
        (1024, 576, (40, 150, 90), "STORE KEY ART", "fixture-model-02.jpg"),
    ]
    for index, (w, h, hue, label, name) in enumerate(shots, start=1):
        raw = _picture(w, h, hue, label)
        block = cache_media(raw, "image/jpeg", name=name, width=w, height=h)
        assert block is not None and block.attachment
        call_id = f"call_gen_{index}"
        await transcript.append_message(
            Message.assistant(
                "",
                tool_calls=[ToolCall(id=call_id, name="generate_image", arguments={"prompt": f"promo shot {index}"})],
            )
        )
        await transcript.append_message(
            Message.tool_result(
                ToolResult(
                    tool_call_id=call_id,
                    tool_name="generate_image",
                    content=[
                        TextContent(
                            text=(
                                f"Generated 1 image with Fixture (fixture-model), {w}x{h} "
                                f"\u2014 attached to the session (digest {block.attachment}). Cost $0.03."
                            )
                        ),
                        block,
                    ],
                    details={"provider": "fixture", "model": "fixture-model", "prompt": "promo", "cost_usd": 0.03},
                    duration_s=3.1,
                )
            )
        )

    vblock = cache_media(VIDEO, "video/mp4", name="fixture-video-01.mp4", width=640, height=360, duration_s=2.0)
    assert vblock is not None and vblock.attachment

    class _VideoJob:
        """The attributes `_job_result_message` reads off a settled video job."""

        label = "Video generation (t2v, 2s, Fixture)"
        status = "completed"
        type = "video"
        latest_details = {
            "video_receipt": {
                "job": "vj_fixture",
                "digest": vblock.attachment,
                "digests": [vblock.attachment],
                "content_type": "video/mp4",
                "duration_s": 2.0,
                "model": "fixture-video",
                "provider": "fixture",
            }
        }

    # `generate_video` itself only answers "started" and runs detached; the
    # completion arrives later as this custom row.
    await transcript.append_message(
        Message.assistant(
            "",
            tool_calls=[ToolCall(id="call_vid_1", name="generate_video", arguments={"prompt": "teaser"})],
        )
    )
    await transcript.append_message(
        Message.tool_result(
            ToolResult(
                tool_call_id="call_vid_1",
                tool_name="generate_video",
                content=[TextContent(text="Video generation started \u2014 job `vj_fixture`.")],
                details={"job": "vj_fixture"},
                duration_s=0.2,
            )
        )
    )
    await transcript.append_message(
        Session._job_result_message(
            "job_video_fixture",
            (
                "Video ready \u2014 job vj_fixture \u00b7 model fixture-video \u00b7 2s \u00b7 "
                f"$0.4 (reported) \u00b7 attached: digest {vblock.attachment}"
            ),
            _VideoJob(),
        )
    )

    # Edge pictures, each through the same generate_image result shape.
    white = Image.new("RGB", (480, 480), (252, 251, 248))
    buf = io.BytesIO()
    white.save(buf, "PNG")
    gone_img = Image.new("RGB", (480, 480), (90, 90, 160))
    gbuf = io.BytesIO()
    gone_img.save(gbuf, "PNG")
    for index, (raw, name, label) in enumerate(
        [(buf.getvalue(), "paper-ground.png", "white"), (gbuf.getvalue(), "gone.png", "gone")], start=10
    ):
        block = cache_media(raw, "image/png", name=name, width=480, height=480)
        assert block is not None and block.attachment
        call_id = f"call_gen_{index}"
        await transcript.append_message(
            Message.assistant(
                "", tool_calls=[ToolCall(id=call_id, name="generate_image", arguments={"prompt": label})]
            )
        )
        await transcript.append_message(
            Message.tool_result(
                ToolResult(
                    tool_call_id=call_id,
                    tool_name="generate_image",
                    content=[
                        TextContent(
                            text=(
                                "Generated 1 image with Fixture (fixture-model), 480x480 "
                                f"\u2014 attached to the session (digest {block.attachment}). Cost $0.03."
                            )
                        ),
                        block,
                    ],
                    details={"provider": "fixture", "model": "fixture-model", "prompt": label},
                    duration_s=1.0,
                )
            )
        )
        if label == "gone":
            # The row stays in the transcript; the bytes do not (a hand-pruned store).
            (root / "attachments" / f"{block.attachment}.bin").unlink()

    # An ordinary file the agent wrote, so an artifact row sits beside a path row.
    Path(SCRATCH_FILE).parent.mkdir(parents=True, exist_ok=True)
    Path(SCRATCH_FILE).write_text("# Promo notes\n\nThree shots and a teaser.\n")
    await transcript.append_message(
        Message.assistant(
            "",
            tool_calls=[
                ToolCall(id="call_w_1", name="write", arguments={"path": SCRATCH_FILE, "content": "# Promo notes"})
            ],
        )
    )
    await transcript.append_message(
        Message.tool_result(
            ToolResult(
                tool_call_id="call_w_1",
                tool_name="write",
                content=[TextContent(text=f"Wrote {SCRATCH_FILE}")],
                details={"path": SCRATCH_FILE, "added": 3, "removed": 0},
                duration_s=0.01,
            )
        )
    )
    await transcript.append_message(Message.assistant("The shots, the teaser and the notes are ready."))

    try:
        from local_operator.resume import write_session_title

        write_session_title(session_dir, "Promo shots", user_set=True, past_names=[])
    except Exception as exc:  # noqa: BLE001 - optional nicety
        print(f"title skipped: {exc}")
    print("SEED OK", SESSION_ID)


asyncio.run(seed())
