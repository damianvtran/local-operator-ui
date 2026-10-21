"""Seed two real project updates, the second carrying four real attachment files.

    LOCAL_OPERATOR_CONFIG_DIR=/tmp/rig/config \\
      PYTHONPATH=/path/to/local-operator \\
      /path/to/local-operator/.venv/bin/python seed.py --config-dir /tmp/rig/config

WHY THIS IS PYTHON AGAINST THE STORE. The evidence run exists to prove the app
reads REAL files and renders them; fabricating JSON rows would prove the
renderer against a shape no writer produces. So this script imports the
backend's own `local_operator.projects` (from the local-operator checkout the
branch under test uses) and goes through `ProjectRegistry` exactly as the
`project` tool and the desktop routes do: `update_project(..., attachments=[…])`
copies the files into the store, derives each attachment's `kind` from its
suffix, and appends the update entry that owns them.

IT IS DESTRUCTIVE ONLY INSIDE `--config-dir`: an existing project with the same
name is deleted first so a rerun is reproducible. The script refuses to run
against the operator's own store (`~/.local-operator`) — pass a scratch root,
which is what the isolated daemon the driver boots uses.

WHAT IT WRITES. Two generated files, no committed binary assets:
  * two PNGs drawn by hand (RGB gradient + a solid band), so both pictures are
    real decodable images with different bytes;
  * a short 440 Hz WAV, so `SoundPlayer` gets a real playable stream;
  * a markdown note whose heading is the string the driver asserts on.
"""

from __future__ import annotations

import argparse
import os
import shutil
import struct
import subprocess
import sys
import wave
import zlib
from pathlib import Path

PROJECT = "rig-assets"
NOTE_HEADING = "Rig evidence note"


def _png_chunk(tag: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + tag
        + payload
        + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, top: tuple, bottom: tuple) -> None:
    """A real RGB PNG: a vertical gradient with one solid band, no Pillow."""
    rows = []
    for y in range(height):
        ratio = y / max(height - 1, 1)
        colour = tuple(
            int(top[channel] + (bottom[channel] - top[channel]) * ratio)
            for channel in range(3)
        )
        row = bytearray()
        for x in range(width):
            # A darker band across the middle third, so the two pictures differ
            # in structure as well as in hue.
            band = 48 if height // 3 <= y < 2 * height // 3 and x % 17 < 9 else 0
            row.extend(max(0, min(255, value - band)) for value in colour)
        rows.append(b"\x00" + bytes(row))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    data = (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
        + _png_chunk(b"IEND", b"")
    )
    path.write_bytes(data)


def _usable_ffmpeg() -> str | None:
    """The first candidate that is a real encoder, not a launcher stub.

    The app's bin directory carries a nine-byte `ffmpeg` placeholder on this
    machine, and it sits ahead of Homebrew on PATH, so `shutil.which` alone
    finds a file that cannot encode anything. `-version` is the check that
    tells the two apart.
    """
    candidates = [
        shutil.which("ffmpeg"),
        "/opt/homebrew/bin/ffmpeg",
        str(Path.home() / "Library/Application Support/Local Operator/bin/ffmpeg"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            probe = subprocess.run(
                [candidate, "-version"], capture_output=True, timeout=10, check=False
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if probe.returncode == 0 and b"ffmpeg version" in probe.stdout:
            return candidate
    return None


def write_wav(path: Path, seconds: float = 0.4, rate: int = 22050) -> None:
    """A short sine tone, so the player has real metadata and a real length."""
    import math

    frames = bytearray()
    for index in range(int(rate * seconds)):
        sample = int(9000 * math.sin(2 * math.pi * 440 * index / rate))
        frames.extend(struct.pack("<h", sample))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(bytes(frames))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config-dir",
        required=True,
        help="the isolated daemon's config root (LOCAL_OPERATOR_CONFIG_DIR)",
    )
    parser.add_argument(
        "--name",
        default=PROJECT,
        help=f"the project name the driver navigates to (default: {PROJECT})",
    )
    args = parser.parse_args()

    config_dir = Path(os.path.expanduser(args.config_dir)).resolve()
    operator_store = (Path.home() / ".local-operator").resolve()
    # Only the store itself (and its projects directory) is protected: session
    # scratchpads live UNDER the same root and are legitimate isolated roots.
    if config_dir in {operator_store, operator_store / "projects"}:
        print(
            "refusing to seed the operator's own store; pass a scratch --config-dir",
            file=sys.stderr,
        )
        return 2

    from local_operator.projects import ProjectEdit, ProjectRegistry

    assets = config_dir / "rig-assets"
    assets.mkdir(parents=True, exist_ok=True)
    first = assets / "dashboard-cutover.png"
    second = assets / "parity.png"
    sound = assets / "standup.wav"
    clip = assets / "standup.mp4"
    note = assets / "release-notes.md"

    write_png(first, 240, 150, (31, 111, 235), (126, 231, 135))
    write_png(second, 180, 180, (219, 109, 40), (245, 222, 179))
    write_wav(sound)
    # A real short clip for the video tile. ffmpeg is present in the app's own
    # runtime bundle; when it is not, the seed still succeeds and the grid
    # simply has no clip (the scene does not assert one).
    ffmpeg = _usable_ffmpeg()
    if ffmpeg is not None:
        try:
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=#1f6feb:s=320x180:d=1",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(clip),
                ],
                check=True,
                capture_output=True,
            )
        except (OSError, subprocess.CalledProcessError):
            clip.unlink(missing_ok=True)
    note.write_text(
        f"# {NOTE_HEADING}\n\n"
        "The asset grid is reading the seeded files, not a fixture.\n\n"
        "- two pictures in one gallery\n"
        "- a sound in the compact player\n"
        "- this note in the in-app reader\n"
    )

    registry = ProjectRegistry(config_dir)
    existing = registry.get_project_by_name(args.name)
    if existing is not None:
        registry.delete_project(existing.id)

    created = registry.create_project(
        ProjectEdit(
            name=args.name,
            title="Rig assets",
            description="The live-app rig for the project update asset grid.",
            status="active",
            owner="atlas",
            team="platform",
        )
    )
    registry.update_project(
        created.id,
        ProjectEdit(progress="First report: the seed and the daemon are up."),
        reporter="operator",
    )
    updated = registry.update_project(
        created.id,
        ProjectEdit(
            progress=(
                "Second report: the update carries two real pictures, a short "
                "sound and a markdown note."
            )
        ),
        reporter="operator",
        attachments=[first, second, sound, note, clip]
        if clip.exists()
        else [first, second, sound, note],
    )

    print(f"project: {args.name} ({created.id})")
    for entry in updated.project.updates:
        names = ", ".join(attachment.name for attachment in entry.attachments)
        print(f"  update {entry.at}: {names or '(no attachments)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
