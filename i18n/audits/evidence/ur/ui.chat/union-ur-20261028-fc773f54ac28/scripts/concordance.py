#!/usr/bin/env python3
"""Terminology concordance for ur/ui.chat: one English term -> one Urdu form.

For every English term below, list the keys whose EN value uses the term and
check the UR value uses the recorded form. A key that carries the English term
but none of the Urdu forms is printed as a CANDIDATE so the auditor can read it.
"""
import json
import pathlib
import re

ROOT = pathlib.Path("src/i18n/catalogues")
en = json.loads((ROOT / "en/ui.chat.json").read_text())
ur = json.loads((ROOT / "ur/ui.chat.json").read_text())

TERMS = [
    ("session", r"\bsessions?\b", ["سیشن"]),
    ("agent", r"\bagents?\b", ["ایجنٹ"]),
    ("subagent", r"\bsubagents?\b", ["ذیلی ایجنٹ"]),
    ("team", r"\bteams?\b", ["ٹیم"]),
    ("model", r"\bmodels?\b", ["ماڈل"]),
    ("turn", r"\bturns?\b", ["باری"]),
    ("conversation", r"\bconversations?\b", ["گفتگو"]),
    ("composer", r"\bcomposer\b", ["کمپوزر"]),
    ("message box", r"message box", ["پیغام کا خانہ", "پیغام کے خانے"]),
    ("job", r"\bjobs?\b", ["جاب"]),
    ("wake", r"\bwakes?\b", ["بیداری"]),
    ("monitor", r"\bmonitors?\b", ["نگرانی", "مانیٹر"]),
    ("goal", r"\bgoals?\b", ["ہدف"]),
    ("loop", r"\bloops?\b", ["لوپ"]),
    ("transcript", r"\btranscript\b", ["ٹرانسکرپٹ"]),
    ("hub", r"\bhub\b", ["ہب"]),
    ("raw", r"\braw\b", ["خام"]),
    ("skill", r"\bskills?\b", ["مہارت"]),
    ("approval", r"\bapprovals?\b", ["منظوری"]),
    ("context", r"\bcontext\b", ["کانٹیکسٹ"]),
    ("run details", r"run details", ["رن کی تفصیلات"]),
    ("settings", r"\bsettings\b", ["ترتیبات"]),
    ("provider", r"\bproviders?\b", ["فراہم کنندہ", "فراہم کنندگان"]),
    ("secret", r"\bsecrets?\b", ["راز"]),
]

out = []
for name, pattern, forms in TERMS:
    hits = [k for k, v in en.items() if re.search(pattern, v, re.I)]
    missing = [k for k in hits if not any(f in ur[k] for f in forms)]
    shaped = sorted({f for f in forms if any(f in ur[k] for k in hits)})
    out.append({
        "term": name,
        "en_keys": len(hits),
        "ur_forms_seen": shaped,
        "keys_without_recorded_form": missing,
    })
    print(f"{name:<14} en-keys={len(hits):>3}  ur-forms={shaped}")
    for key in missing:
        print(f"    CANDIDATE {key}")
        print(f"      EN: {en[key]}")
        print(f"      UR: {ur[key]}")
print()
print(json.dumps({"terms": out}, ensure_ascii=False))
