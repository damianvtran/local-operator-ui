#!/usr/bin/env python3
"""Same-length sanitization for this round's scenario copies, following the
conventions `scripts/fixtures/seed-label-gap.json` (at f1ef98c4c) states for
itself in `derivation.sanitization`:

  * every text / argument / output / diff-line / path / url / handle string
    becomes a deterministic LENGTH-PRESERVING placeholder;
  * same original value -> same placeholder;
  * a diff line keeps its FIRST character, the only part `diffLineKind` reads;
  * a scheme prefix (`spill://`, `guide://`, `skill://`, `session/`, http(s)://)
    is kept;
  * STRUCTURE IS UNTOUCHED: ids, ts, types, roles, call ids, tool names,
    ordering and `details.added/removed` are verbatim.

This exists because my round-1 scenarios were cut from the journal BEFORE the
coder sanitized the repo fixture, so my round-1 frames and scenario JSON carry
the operator's real prompt, prose and paths. Structural invariance is asserted
below rather than assumed: every string keeps its exact length, so the fixture's
own length-driven behaviour (the backend's frame-share stripping) is unchanged.
"""
import json, pathlib, random, string, sys

import argparse, os
_ap = argparse.ArgumentParser()
_ap.add_argument("--in", dest="inp", default="scen")
_ap.add_argument("--out", dest="out", default="scen-san")
_a = _ap.parse_args()
IN = pathlib.Path(_a.inp)
OUT = pathlib.Path(_a.out)

# Keys whose value is a plain string that is still structural.
KEEP_STRING_KEYS = {
    "type", "role", "kind", "custom_type", "tool_call_id", "tool_name",
    "producer_command_id", "id", "history", "open",
}
SCHEMES = ("spill://", "guide://", "skill://", "session/", "http://", "https://")
ALPHA = string.ascii_lowercase


class Ph:
    """Deterministic, length-preserving placeholder pool (same value -> same text)."""

    def __init__(self, seed=4902):
        self.rng = random.Random(seed)
        self.map: dict[str, str] = {}

    def text(self, s: str, keep_first: bool = False) -> str:
        if s in self.map:
            return self.map[s]
        if s == "" or s == "~":
            self.map[s] = s
            return s
        prefix = ""
        for sc in SCHEMES:
            if s.startswith(sc):
                prefix = sc
                break
        head = s[0] if keep_first else ""
        body_len = len(s) - len(prefix) - len(head)
        body = "".join(self.rng.choice(ALPHA) for _ in range(max(0, body_len)))
        out = prefix + head + body
        assert len(out) == len(s), (len(out), len(s))
        self.map[s] = out
        return out


ph = Ph()


def walk(node, key=None, in_diff=False):
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k in ("diff",) and isinstance(v, list):
                out[k] = [ph.text(x, keep_first=True) if isinstance(x, str) else walk(x, k) for x in v]
                continue
            out[k] = walk(v, k, in_diff)
        return out
    if isinstance(node, list):
        return [walk(v, key, in_diff) for v in node]
    if isinstance(node, str):
        if key in KEEP_STRING_KEYS:
            return node
        return ph.text(node)
    return node


def structure(a, b, path="$", problems=None):
    """Assert b has a's exact shape and, for every string, its exact length."""
    if problems is None:
        problems = []
    if type(a) is not type(b):
        problems.append(f"{path}: type {type(a).__name__} != {type(b).__name__}")
        return problems
    if isinstance(a, dict):
        if set(a) != set(b):
            problems.append(f"{path}: keys differ {set(a) ^ set(b)}")
            return problems
        for k in a:
            structure(a[k], b[k], f"{path}.{k}", problems)
    elif isinstance(a, list):
        if len(a) != len(b):
            problems.append(f"{path}: length {len(a)} != {len(b)}")
            return problems
        for i, (x, y) in enumerate(zip(a, b)):
            structure(x, y, f"{path}[{i}]", problems)
    elif isinstance(a, str):
        if len(a) != len(b):
            problems.append(f"{path}: string length {len(a)} != {len(b)}")
    return problems


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bad = 0
    for src in sorted(IN.glob("*.json")):
        original = json.loads(src.read_text())
        clean = walk(original)
        problems = structure(original, clean)
        # id and structural-string invariance, asserted explicitly.
        if json.dumps(clean) == json.dumps(original):
            problems.append("NOTHING WAS CHANGED — sanitizer is a no-op")
        for p in problems:
            print(f"  {src.name}: {p}")
        bad += len(problems)
        (OUT / src.name).write_text(json.dumps(clean))
    print(f"sanitized {len(list(IN.glob('*.json')))} scenarios into {OUT} "
          f"({bad} structural problems)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
