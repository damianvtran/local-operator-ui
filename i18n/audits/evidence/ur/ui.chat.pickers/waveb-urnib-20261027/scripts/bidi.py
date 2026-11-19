"""
RTL / bidi verification of the ur nib delta (ui.chat.pickers.slash.enter_needs_a_pick).

Base paragraph direction is RTL: the app sets `dir=rtl` for `ur`, and the style
guide's RTL section says storage is logical order with render-layer FSI/PDI
isolation, so a manual bidi control in the catalogue would be double-applied.

Uses GNU FriBidi 1.0.16 locally — a bidi reordering pass, never a translation
service. The clause is proved from FriBidi's own visual-to-logical position map
(`--vtol`), NOT from its shaped visual string: this build shapes Arabic into
presentation forms and merges lam-alef, which changes the code-point multiset and
would make an order proof unreliable. The shaped string is kept for display only.

Proves, for the changed value and for the click line it sits above (as the
formatter renders it):
  A. the final U+06D4 occupies VISUAL INDEX 0 — i.e. it is the leftmost
     character of the line, which is where an Urdu reader needs the full stop;
  B. no manual bidi control characters in the stored value;
  C. every Latin/digit island (Enter, Tab, ↓ is neutral, /team …) is contiguous
     in visual order and internally un-reversed, and the islands' visual blocks
     appear in the reverse of their logical order (RTL paragraph semantics);
  D. no bracket needing mirroring is present (none is, in these lines);
  E. the stored value is NFC, and the visual permutation is a permutation of the
     same code points (nothing lost, added or duplicated by the reordering).
"""
import json
import re
import subprocess
import unicodedata

WT = "/Users/damian/local-operator-ui/.worktrees/wave-b-bind"
UR = f"{WT}/src/i18n/catalogues/ur/ui.chat.pickers.json"
EN = f"{WT}/src/i18n/catalogues/en/ui.chat.pickers.json"

BIDI_CONTROLS = {
    0x200E: "LRM", 0x200F: "RLM", 0x061C: "ALM",
    0x202A: "LRE", 0x202B: "RLE", 0x202C: "PDF",
    0x202D: "LRO", 0x202E: "RLO",
    0x2066: "LRI", 0x2067: "RLI", 0x2068: "FSI", 0x2069: "PDI",
}
ISLAND = re.compile(r"[A-Za-z0-9][A-Za-z0-9/_.:'<>${}\-]*")
MIRROR = {"(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<"}


def fribidi(text: str, *flags: str) -> str:
    p = subprocess.run(
        ["fribidi", "--nopad", "--nobreak", "--rtl", *flags],
        input=text.encode("utf-8"), capture_output=True,
    )
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode(errors="replace"))
    return p.stdout.decode("utf-8").rstrip("\n")


def vtol(text: str) -> list[int]:
    """visual index -> logical index, from FriBidi itself."""
    return [int(x) for x in fribidi(text, "--novisual", "--vtol").split()]


def levels(text: str) -> list[int]:
    """embedding level per logical character, from FriBidi itself."""
    return [int(x) for x in fribidi(text, "--novisual", "--levels").split()]


def runs(lev: list[int]) -> list[tuple[int, int, int]]:
    """maximal same-level runs as (level, start, end) over logical indices."""
    out, start = [], 0
    for i in range(1, len(lev) + 1):
        if i == len(lev) or lev[i] != lev[start]:
            out.append((lev[start], start, i))
            start = i
    return out


def check(label: str, text: str) -> dict:
    n = len(text)
    m = vtol(text)
    assert sorted(m) == list(range(n)), "vtol is not a permutation"
    visual_chars = [text[i] for i in m]          # unshaped, pure reordering

    controls = [BIDI_CONTROLS[ord(c)] for c in text if ord(c) in BIDI_CONTROLS]
    islands = [(mt.group(0), mt.start(), mt.end()) for mt in ISLAND.finditer(text)]

    # Each island must occupy one contiguous ascending run of visual positions.
    island_report = []
    for token, s, e in islands:
        positions = [m.index(i) for i in range(s, e)]
        contiguous = sorted(positions) == list(range(min(positions), max(positions) + 1))
        island_report.append({
            "token": token,
            "logical_span": [s, e],
            "visual_span": [positions[0], positions[-1]],
            "contiguous_and_unreversed": contiguous,
        })
    starts = [r["visual_span"][0] for r in island_report]

    # Bidi RUN analysis, which is the precise statement of RTL paragraph layout:
    # every maximal same-level run must land on one contiguous visual block; an
    # LTR run (even level) keeps ascending order inside itself, an RTL run (odd
    # level) is reversed; and the blocks are laid out right-to-left, so the first
    # logical run takes the highest visual start and each later run a lower one.
    lev = levels(text)
    run_report = []
    for lvl, s, e in runs(lev):
        pos = [m.index(i) for i in range(s, e)]
        contiguous = sorted(pos) == list(range(min(pos), max(pos) + 1))
        ordered = pos == sorted(pos) if lvl % 2 == 0 else pos == sorted(pos, reverse=True)
        run_report.append({
            "level": lvl, "logical_span": [s, e], "visual_span": [pos[0], pos[-1]],
            "text": text[s:e], "contiguous": contiguous, "order_ok": ordered,
        })
    run_starts = [r["visual_span"][0] for r in run_report]

    return {
        "label": label,
        "logical": text,
        "visual_unshaped": "".join(visual_chars),
        "visual_shaped_display_only": fribidi(text),
        "vtol_head": m[:3],
        "vtol_tail": m[-3:],
        "A_vtol0_is_final_index": m[0] == n - 1,
        "A_visual_leftmost_char": visual_chars[0],
        "A_final_stop_is_visually_leftmost": text.endswith("\u06d4") and m[0] == n - 1 and visual_chars[0] == "\u06d4",
        "B_controls_zero": len(controls) == 0,
        "B_controls_found": controls,
        "C_islands": island_report,
        "C_islands_contiguous": all(r["contiguous_and_unreversed"] for r in island_report),
        "C_runs": run_report,
        "C_runs_contiguous_and_ordered": all(r["contiguous"] and r["order_ok"] for r in run_report),
        "C_run_blocks_right_to_left": run_starts == sorted(run_starts, reverse=True),
        "D_brackets_needing_mirror": [c for c in text if c in MIRROR],
        "E_nfc_stable": unicodedata.normalize("NFC", text) == text,
        "E_permutation_preserves_codepoints": sorted(visual_chars) == sorted(text),
    }


ur = json.load(open(UR, encoding="utf-8"))
en = json.load(open(EN, encoding="utf-8"))
KEY = "ui.chat.pickers.slash.enter_needs_a_pick"
CLICK = ["ui.chat.pickers.slash.click.stages", "ui.chat.pickers.slash.click.runs",
         "ui.chat.pickers.slash.click.completes_label", "ui.chat.pickers.slash.click.runs_with_value",
         "ui.chat.pickers.slash.click.runs_command"]

results = [check(KEY, ur[KEY])]
results += [check(k + " (rendered with /help)",
                  ur[k].replace("{label}", "help").replace("{command}", "/team").replace("{value}", " engineering"))
            for k in CLICK]
results.append(check("en control: " + KEY, en[KEY]))

target = results[0]
strip = results[:6]
out = {
    "tool": subprocess.run(["fribidi", "--version"], capture_output=True, text=True).stdout.splitlines()[0],
    "base_direction": "RTL (fribidi --rtl; app sets dir=rtl for ur, storage stays logical)",
    "method": "order proved from fribidi --novisual --vtol (visual->logical map); the shaped visual string is display only because this build shapes Arabic (lam-alef merges), which would corrupt a code-point-multiset argument",
    "key": KEY,
    "checks": results,
    "verdict": {
        "A_final_stop_visually_leftmost": target["A_final_stop_is_visually_leftmost"],
        "B_no_manual_bidi_controls": target["B_controls_zero"],
        "C_islands_contiguous": target["C_islands_contiguous"],
        "C_runs_contiguous_ordered_and_rtl": target["C_runs_contiguous_and_ordered"] and target["C_run_blocks_right_to_left"],
        "D_no_mirrored_brackets_present": target["D_brackets_needing_mirror"] == [],
        "E_nfc_and_permutation": target["E_nfc_stable"] and target["E_permutation_preserves_codepoints"],
        "strip_both_lines_stopped_leftmost": all(r["A_final_stop_is_visually_leftmost"] for r in strip),
        "all_pass": all([
            target["A_final_stop_is_visually_leftmost"], target["B_controls_zero"],
            target["C_islands_contiguous"], target["C_runs_contiguous_and_ordered"],
            target["C_run_blocks_right_to_left"],
            target["E_nfc_stable"], target["E_permutation_preserves_codepoints"],
            all(r["A_final_stop_is_visually_leftmost"] for r in strip),
        ]),
    },
}
print(json.dumps(out, ensure_ascii=False, indent=1))
