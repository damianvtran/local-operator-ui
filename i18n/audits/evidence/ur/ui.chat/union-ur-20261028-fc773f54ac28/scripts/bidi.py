#!/usr/bin/env python3
"""RTL / bidi verification of the ur/ui.chat UNION, over the rendered strings.

Base paragraph direction is RTL: the app sets `dir=rtl` for `ur`, and the style
guide's RTL section says storage is logical order with render-layer FSI/PDI
isolation, so a manual bidi control in the catalogue would be double-applied.

Uses GNU FriBidi 1.0.16 locally — a bidi reordering pass, never a translation
service. Positions come from FriBidi's own visual-to-logical map (`--vtol`) and
embedding levels (`--levels`), NOT from its shaped string: this build shapes
Arabic into presentation forms and merges lam-alef, which changes the code-point
multiset and would make an order proof unreliable. The shaped string is kept for
display only.

Checks every RENDERED string (real intl-messageformat output, audit-tools/
renders.json; braces and select syntax never print, so a template-level reading
would measure characters the reader never sees):
  A. a terminal stop (۔ ؟ ! ؛ ، :) occupies VISUAL INDEX 0 — the leftmost
     character, where an Urdu reader needs the full stop;
  B. no manual bidi control characters;
  C. bidi-run analysis: every maximal same-level run is contiguous in visual
     order, an LTR run keeps ascending order and an RTL run is reversed, and the
     runs are laid out right-to-left (the first logical run takes the highest
     visual start, each later run a lower one);
  D. every Latin/digit island is contiguous and internally un-reversed;
  E. the stored value is NFC and the visual permutation is a permutation of the
     same code points (nothing lost, added or duplicated).
  F. brackets are mirrored by the reordering (open<->close), as RTL requires.
"""
import json
import pathlib
import re
import subprocess
import unicodedata

ROOT = pathlib.Path("src/i18n/catalogues")
ur = json.loads((ROOT / "ur/ui.chat.json").read_text())
renders = json.loads(pathlib.Path("audit-tools/renders.json").read_text())

BIDI_CONTROLS = {
    0x200E: "LRM", 0x200F: "RLM", 0x061C: "ALM",
    0x202A: "LRE", 0x202B: "RLE", 0x202C: "PDF",
    0x202D: "LRO", 0x202E: "RLO",
    0x2066: "LRI", 0x2067: "RLI", 0x2068: "FSI", 0x2069: "PDI",
}
ISLAND = re.compile(r"[A-Za-z0-9][A-Za-z0-9/_.:'<>${}\-]*")
MIRROR = {"(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<"}
STOPS = set("۔؟!؛،:")


def fribidi(text, *flags):
    proc = subprocess.run(
        ["fribidi", "--nopad", "--nobreak", "--rtl", *flags],
        input=text.encode("utf-8"), capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode(errors="replace"))
    return proc.stdout.decode("utf-8").rstrip("\n")


def vtol(text):
    return [int(x) for x in fribidi(text, "--novisual", "--vtol").split()]


def levels(text):
    return [int(x) for x in fribidi(text, "--novisual", "--levels").split()]


def runs(lev):
    out, start = [], 0
    for i in range(1, len(lev) + 1):
        if i == len(lev) or lev[i] != lev[start]:
            out.append((lev[start], start, i))
            start = i
    return out


problems = []
rows = []
seen = set()
stats = {"rendered_strings": 0, "runs": 0, "islands": 0, "terminal_stops": 0, "bracketed": 0}

# template-level: NFC, controls, permutation over every stored value
for key, value in ur.items():
    if unicodedata.normalize("NFC", value) != value:
        problems.append({"key": key, "kind": "nfc", "text": value})
    controls = [BIDI_CONTROLS[ord(c)] for c in value if ord(c) in BIDI_CONTROLS]
    if controls:
        problems.append({"key": key, "kind": "bidi-control", "controls": controls})

for row in renders:
    key, text = row["key"], row["out"]
    if (key, text) in seen:
        continue
    seen.add((key, text))
    stats["rendered_strings"] += 1
    n = len(text)
    m = vtol(text)
    lev = levels(text)
    if sorted(m) != list(range(n)) or len(lev) != n:
        problems.append({"key": key, "kind": "map", "text": text})
        continue
    pos = [0] * n
    for visual, logical in enumerate(m):
        pos[logical] = visual

    # C. run analysis
    run_starts = []
    for lvl, s, e in runs(lev):
        positions = [pos[i] for i in range(s, e)]
        contiguous = sorted(positions) == list(range(min(positions), max(positions) + 1))
        ordered = positions == sorted(positions) if lvl % 2 == 0 else positions == sorted(positions, reverse=True)
        run_starts.append(min(positions) if lvl % 2 == 0 else max(positions))
        stats["runs"] += 1
        if not contiguous or not ordered:
            problems.append({"key": key, "kind": "bidi-run", "text": text,
                             "level": lvl, "span": text[s:e], "positions": positions})
    if any(b >= a for a, b in zip(run_starts, run_starts[1:])):
        problems.append({"key": key, "kind": "run-layout", "text": text, "starts": run_starts})

    # D. islands
    for match in ISLAND.finditer(text):
        token = match.group(0)
        s, e = match.start(), match.end()
        stats["islands"] += 1
        positions = [pos[i] for i in range(s, e)]
        if positions != list(range(positions[0], positions[0] + len(positions))):
            problems.append({"key": key, "kind": "island", "token": token, "text": text,
                             "positions": positions})

    # A. terminal stop leftmost
    stripped = text.rstrip(" ")
    if stripped and stripped[-1] in STOPS:
        stats["terminal_stops"] += 1
        if pos[len(stripped) - 1] != 0:
            problems.append({"key": key, "kind": "terminal-stop", "text": text,
                             "detail": f"'{stripped[-1]}' at visual {pos[len(stripped) - 1]}"})

    # F. bracket mirroring
    brackets = [c for c in text if c in MIRROR]
    if brackets:
        stats["bracketed"] += 1
        visual = "".join(text[i] for i in m)
        expected = "".join(MIRROR[c] for c in text if c in MIRROR)
        got = "".join(c for c in visual if c in MIRROR)
        if got != expected:
            problems.append({"key": key, "kind": "mirror", "text": text,
                             "expected": expected, "got": got})

    rows.append({"key": key, "text": text, "runs": len(runs(lev)),
                 "levels": sorted({lvl for lvl, _, _ in runs(lev)})})

print(json.dumps({
    "checked": stats,
    "problems": problems,
    "sample_layouts": [r for r in rows if r["key"] in {
        "ui.chat.checkpoint.turn",
        "ui.chat.header_identity.aria_agent_assign",
        "ui.chat.hub_update.update_all",
        "ui.chat.provider_error.headline.out_of_credits",
        "ui.chat.skill_invocation.trigger_label",
        "ui.chat.question_dock.hint.approval",
        "ui.chat.session_status.not_signed_in",
    }][:14],
}, ensure_ascii=False, indent=1))
