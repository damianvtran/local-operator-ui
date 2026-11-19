#!/usr/bin/env python3
"""Union delta proof for ur/ui.chat: per-key equality against the snapshots the
two wave receipts hashed, by parsed JSON *and* by raw source line.

Snapshots (git show into ~/qa/union-ui-chat-ur-work/snap, never the checkout):
  81f286ee5c  pre-wave base (#1431)                      115 base keys
  80ee119bbd  wave A head, receipt 59ea19dc68ac          133 keys
  a5356ce91c  wave B head, receipt c89cee263ac2          124 keys (= 1d631be71f)
  1d631be71f  origin/main after wave B merge             124 keys
  c5e19ecec8  PR #1449 head, the union                   142 keys
"""
import hashlib
import json
import pathlib
import sys

SNAP = pathlib.Path.home() / "qa/union-ui-chat-ur-work/snap"
COMMITS = ["81f286ee5c", "80ee119bbd", "a5356ce91c", "1d631be71f", "c5e19ecec8"]

WAVE_A_TAG = "ui.chat.checkpoint."  # not used; explicit lists below
WAVE_A = [
    "ui.chat.checkpoint.generating_name",
    "ui.chat.checkpoint.jump_agent",
    "ui.chat.checkpoint.jump_agent_unnamed",
    "ui.chat.checkpoint.jump_user",
    "ui.chat.checkpoint.jump_user_no_clock",
    "ui.chat.checkpoint.turn",
    "ui.chat.header_identity.aria_agent_assign",
    "ui.chat.header_identity.aria_agent_closed",
    "ui.chat.header_identity.aria_agent_switch",
    "ui.chat.header_identity.aria_team_assign",
    "ui.chat.header_identity.aria_team_closed",
    "ui.chat.header_identity.aria_team_switch",
    "ui.chat.header_identity.assign_agent",
    "ui.chat.header_identity.assign_team",
    "ui.chat.header_identity.no_agent",
    "ui.chat.header_identity.no_team",
    "ui.chat.region.composer",
    "ui.chat.region.conversation",
]
WAVE_B = [
    "ui.chat.session_status.context_heading",
    "ui.chat.session_status.context_nothing_measured_tooltip",
    "ui.chat.session_status.conversation_starting",
    "ui.chat.session_status.model_none_resolved_tooltip",
    "ui.chat.session_status.not_signed_in",
    "ui.chat.session_status.not_signed_in_description",
    "ui.chat.session_status.nothing_measured_yet",
    "ui.chat.session_status.temporarily_unavailable",
    "ui.chat.session_status.temporarily_unavailable_description",
]


def load(locale, commit):
    path = SNAP / f"{locale}-{commit}.json"
    raw = path.read_bytes()
    return json.loads(raw), raw.decode("utf-8").splitlines(), hashlib.sha256(raw).hexdigest()


def raw_lines(lines):
    """Map key -> the exact source line carrying it (one key per line here)."""
    out = {}
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith('"'):
            continue
        key = json.loads(stripped[: stripped.index('":', 1) + 1])
        out[key] = line
    return out


def main():
    report = {"snapshot_sha256": {}, "counts": {}, "waveA_keys": WAVE_A, "waveB_keys": WAVE_B}
    data = {}
    for commit in COMMITS:
        for locale in ("en", "ur"):
            parsed, lines, sha = load(locale, commit)
            data[(locale, commit)] = parsed
            report["snapshot_sha256"][f"{locale}-{commit}.json"] = sha

    report["counts"] = {
        "pre_wave_81f286ee5c": len(data[("ur", "81f286ee5c")]),
        "waveA_head_80ee119bbd": len(data[("ur", "80ee119bbd")]),
        "main_after_waveB_1d631be71f": len(data[("ur", "1d631be71f")]),
        "union_c5e19ecec8": len(data[("ur", "c5e19ecec8")]),
    }

    union_ur = data[("ur", "c5e19ecec8")]
    union_en = data[("en", "c5e19ecec8")]
    report["union_key_count"] = len(union_ur)
    report["shared_key_names"] = sorted(set(WAVE_A) & set(WAVE_B))
    base = [key for key in union_ur if key not in set(WAVE_A) and key not in set(WAVE_B)]
    report["base_key_count"] = len(base)

    # 1. Key set and order: origin/main's 124 keys, then wave A's 18 in its order.
    main_order = list(data[("ur", "1d631be71f")])
    report["union_order_is_main_plus_waveA"] = (
        list(union_ur) == main_order + WAVE_A
    )
    report["en_union_order_is_main_plus_waveA"] = (
        list(union_en) == list(data[("en", "1d631be71f")]) + WAVE_A
    )
    report["en_ur_key_sets_equal"] = set(union_en) == set(union_ur)
    report["en_ur_key_order_equal"] = list(union_en) == list(union_ur)
    report["key_set_union_equals"] = (
        set(union_ur) == set(data[("ur", "81f286ee5c")]) | set(WAVE_A) | set(WAVE_B)
    )
    report["main_key_set_is_prewave_plus_waveB"] = (
        set(data[("ur", "1d631be71f")]) == set(data[("ur", "81f286ee5c")]) | set(WAVE_B)
    )

    # 2. Parsed-value equality per family, per locale.
    checks = {
        "waveA_vs_80ee119bbd": (WAVE_A, "80ee119bbd"),
        "waveB_vs_a5356ce91c": (WAVE_B, "a5356ce91c"),
        "waveB_vs_1d631be71f": (WAVE_B, "1d631be71f"),
        "base_vs_1d631be71f": (base, "1d631be71f"),
        "base_vs_81f286ee5c": (base, "81f286ee5c"),
    }
    value_mismatches = []
    for name, (keys, commit) in checks.items():
        for locale in ("en", "ur"):
            union = data[(locale, "c5e19ecec8")]
            other = data[(locale, commit)]
            missing = [key for key in keys if key not in other]
            if missing:
                value_mismatches.append({"check": name, "locale": locale, "missing_in_snapshot": missing})
                continue
            for key in keys:
                if union[key] != other[key]:
                    value_mismatches.append({
                        "check": name, "locale": locale, "key": key,
                        "union": union[key], "snapshot": other[key],
                    })
    report["value_mismatches"] = value_mismatches

    # 3. Raw-line equality: the exact stored line (key + value + indentation).
    raw_mismatches = []
    separator_only = []
    for name, (keys, commit) in checks.items():
        for locale in ("en", "ur"):
            u_lines = raw_lines(load(locale, "c5e19ecec8")[1])
            s_lines = raw_lines(load(locale, commit)[1])
            for key in keys:
                u = u_lines.get(key)
                v = s_lines.get(key)
                # The only legal difference is the JSON member separator: the last
                # member of a file carries no trailing comma, an interior one does.
                if (u or "").rstrip(",") != (v or "").rstrip(","):
                    raw_mismatches.append({
                        "check": name, "locale": locale, "key": key,
                        "union_raw": u, "snapshot_raw": v,
                    })
                elif u != v:
                    separator_only.append({
                        "check": name, "locale": locale, "key": key,
                        "detail": "line differs only by the trailing JSON comma (last member vs interior member)",
                    })
    report["raw_text_mismatches"] = raw_mismatches
    report["raw_separator_only"] = separator_only
    report["raw_line_checks"] = {
        "union_lines_parsed": len(raw_lines(load("ur", "c5e19ecec8")[1])),
        "all_142_lines_parsed": len(raw_lines(load("ur", "c5e19ecec8")[1])) == 142,
    }

    # 4. No key whose value changed is silent: report the 27 wave values' provenance.
    report["wave_value_origin"] = {
        "18_wave_A_equal_at": "80ee119bbd (receipt 59ea19dc68ac read ur f7aaa99d / en 1a1c9329)",
        "9_wave_B_equal_at": "a5356ce91c = 1d631be71f (receipt c89cee263ac2 read ur f426744c / en 4d07ed6d)",
        "115_base_equal_at": "81f286ee5c and 1d631be71f",
    }
    report["sha256_cross_check"] = {
        "waveA_receipt_ur": "f7aaa99d5737272bba0f862d657e1947c670448b6352082100aed208abf86a5d",
        "observed_ur_at_80ee119bbd": report["snapshot_sha256"]["ur-80ee119bbd.json"],
        "waveB_receipt_ur": "f426744c3577e192c66c94f3dcad22918fd7ebf38361cc0a83ff1f6ca201a643",
        "observed_ur_at_a5356ce91c": report["snapshot_sha256"]["ur-a5356ce91c.json"],
        "observed_ur_at_1d631be71f": report["snapshot_sha256"]["ur-1d631be71f.json"],
        "observed_union_ur": report["snapshot_sha256"]["ur-c5e19ecec8.json"],
    }
    print(json.dumps(report, ensure_ascii=False, indent=1))
    ok = (
        not value_mismatches
        and not raw_mismatches
        and report["union_order_is_main_plus_waveA"]
        and report["en_ur_key_order_equal"]
        and report["key_set_union_equals"]
        and report["main_key_set_is_prewave_plus_waveB"]
        and len(union_ur) == 142
        and len(base) == 115
        and not report["shared_key_names"]
    )
    print("\nDELTA PROOF:", "PASS" if ok else "FAIL", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
