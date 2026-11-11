#!/usr/bin/env python3
"""Mechanical checks for the L1 tool-row verb slice, zh-CN (audit suffix A).

Read-only: opens the prepared en+context sidecar and the candidate locale file,
runs every mechanical rule the audit brief names, and prints one PASS/FAIL line
per rule plus the evidence for each failure. Nothing is written outside stdout.
"""

import json
import re
import sys
import unicodedata
from collections import defaultdict

PREP = "/Users/damian/local-operator-ui/.worktrees/_l1-prep"
KEYS = f"{PREP}/keys.json"
TARGET = f"{PREP}/zh-CN.json"
VERB = "ui.chat.canonical.tool_row.verb."

failures = []


def result(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  {detail}" if detail else ""))
    if not ok:
        failures.append(name)


def cells(text):
    """Terminal width in cells: CJK/full-width glyphs are 2, everything else 1."""
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in text)


def main():
    with open(KEYS, encoding="utf-8") as fh:
        keys = json.load(fh)
    with open(TARGET, encoding="utf-8") as fh:
        zh = json.load(fh)

    result("valid JSON, both in", isinstance(keys, dict) and isinstance(zh, dict),
           f"en+context={len(keys)} target={len(zh)}")
    result("key set equal", set(keys) == set(zh),
           f"missing={sorted(set(keys) - set(zh))[:5]} extra={sorted(set(zh) - set(keys))[:5]}")
    result("key order equal", list(keys) == list(zh))
    result("all 182 keys in slice", len(keys) == 182, f"count={len(keys)}")

    empty = [k for k, v in zh.items() if not isinstance(v, str) or not v.strip()]
    result("no empty/non-string value", not empty, str(empty[:5]))

    # Placeholders, markup, code spans, printf tokens: byte-identical sets.
    pattern = re.compile(r"\{[^{}]*\}|<[^>]+>|`[^`]+`|%[sd]")
    diffs = [(k, keys[k]["en"], zh[k]) for k in keys
             if set(pattern.findall(keys[k]["en"])) != set(pattern.findall(zh[k]))]
    result("placeholder/markup sets identical to en", not diffs, str(diffs[:3]))

    # No value may carry ICU structure the English does not have.
    icu = [k for k in keys if ("{" in zh[k] or "}" in zh[k]) and "{" not in keys[k]["en"]]
    result("no ICU structure added", not icu, str(icu[:5]))

    bidi = [k for k, v in zh.items()
            if any(c in v for c in "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\u061c")]
    result("no manual bidi control characters", not bidi, str(bidi[:5]))

    same = [(k, zh[k]) for k in keys if zh[k] == keys[k]["en"]]
    result("no value left identical to English", not same, str(same[:5]))

    latin = {k: sorted(set(re.findall(r"[A-Za-z][A-Za-z0-9_.\-]*", v))) for k, v in zh.items()}
    latin = {k: v for k, v in latin.items() if v}
    allowed = {"Python"}
    strays = {k: v for k, v in latin.items() if not set(v) <= allowed}
    result("no stray English (allowlist: Python as a technology name)", not strays,
           f"allowed hits={sorted(latin)} stray={strays}")

    dup = defaultdict(list)
    for k, v in zh.items():
        dup[v].append(k)
    collisions = {v: ks for v, ks in dup.items() if len(ks) > 1}
    result("no two keys share a value", not collisions, str(collisions))

    # Every settled value needs its running sibling and vice versa.
    stems = defaultdict(dict)
    for k in keys:
        if k.endswith(".settled"):
            stems[k[: -len(".settled")]]["settled"] = zh[k]
        elif k.endswith(".running"):
            stems[k[: -len(".running")]]["running"] = zh[k]
    incomplete = {s: p for s, p in stems.items() if set(p) != {"settled", "running"}}
    result("every stem has both settled and running", not incomplete, str(incomplete))
    result("91 settled/running pairs", len(stems) == 91, f"pairs={len(stems)}")

    # Aspect markers: settled 已…, running 正在… (shipped catalogue convention).
    bad_marks = [(s, p) for s, p in stems.items()
                 if not p["settled"].startswith("已") or not p["running"].startswith("正在")]
    result("settled uses 已-, running uses 正在-", not bad_marks, str(bad_marks))

    # One verb per pair, except where a single-stem pair would be ungrammatical
    # Chinese. 正在+找到 does not exist, so `find` must settle as 已找到 and run as
    # 正在查找 - the two keys carrying the English Found/Finding pair. Reviewed by
    # hand and recorded as correct; every other stem must match.
    allowed_stem_diff = {"found_definition", "found_references"}
    stem_diff = [(s.split(VERB)[-1], p["settled"], p["running"]) for s, p in stems.items()
                 if p["settled"][1:] != p["running"][2:]]
    unexplained = [d for d in stem_diff if d[0] not in allowed_stem_diff]
    print(f"INFO  pair stem mismatches (reviewed, 正在+找到 is ungrammatical): {stem_diff}")
    result("pair uses one verb, bar the reviewed find/finding pair", not unexplained,
           str(unexplained))

    # Style-guide prohibitions for zh-CN.
    banned = {
        "您 (rejected address form)": [k for k, v in zh.items() if "您" in v],
        "！ (no exclamation in status copy)": [k for k, v in zh.items() if "！" in v or "!" in v],
        "。 (no sentence-final full stop in labels)": [k for k, v in zh.items() if "。" in v],
        "「」 quotes (mainland uses “”)": [k for k, v in zh.items() if "「" in v or "」" in v],
        "... ellipsis (use ……)": [k for k, v in zh.items() if "..." in v],
        "ASCII punctuation (，：； are full-width in prose)":
            [k for k, v in zh.items() if re.search(r"[,:;?!]", v)],
        "space before a Latin run (guide: none)":
            [k for k, v in zh.items() if re.search(r"[\u4e00-\u9fff] [A-Za-z]", v)],
        "leading/trailing whitespace": [k for k, v in zh.items() if v != v.strip()],
    }
    for label, hits in banned.items():
        result(f"style: no {label}", not hits, str(hits[:5]))

    # Width: the gutter never truncates the verb and English tops out at 23 cells.
    worst_en = max((cells(keys[k]["en"]), k) for k in keys)
    widest = sorted(((cells(v), k, v) for k, v in zh.items()), reverse=True)[:5]
    print(f"INFO  widest English verb in slice: {worst_en[0]} cells ({keys[worst_en[1]]['en']})")
    for c, k, v in widest:
        print(f"INFO  {c:2} cells  {v}   (en {cells(keys[k]['en'])}: {keys[k]['en']})")
    over = [(c, v) for c, k, v in widest if c > worst_en[0]]
    result(f"width: no value exceeds the widest English verb ({worst_en[0]} cells)", not over, str(over))

    # Glossary bindings from the L1 brief and i18n/glossary.md §2.
    required = ["会话", "智能体", "子智能体", "项目", "团队", "唤醒", "网络", "设备",
                "控制台", "待办", "里程碑", "重命名", "变量", "符号", "定义", "引用"]
    missing = [t for t in required if not any(t in v for v in zh.values())]
    print(f"INFO  glossary terms present: {', '.join(t for t in required if t not in missing)}")
    # Any locale-call term that IS used must be the glossary rendering, not a synonym.
    synonyms = {"session": ("会话", ["对话"]), "agent": ("智能体", ["代理"]),
                "subagent": ("子智能体", ["子代理"]), "project": ("项目", ["工程"]),
                "device": ("设备", ["装置"]), "milestone": ("里程碑", ["阶段目标"])}
    for term, (good, bads) in synonyms.items():
        hits = [(k, b) for k, v in zh.items() for b in bads if b in v]
        result(f"glossary: {term} is {good} (no synonym)", not hits, str(hits[:5]))

    print(f"\nSUMMARY failures={len(failures)}"
          + (f": {failures}" if failures else " — all mechanical rules pass"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
