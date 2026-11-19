#!/usr/bin/env python3
"""Typography + surface scan over the 15 s16f keys in ur/ui.chat.canonical.

Checks the ur style guide's punctuation calls (۔ ، ؛ “ ”, never the Hindi danda
or Arabic-only signs), the runtime ban on manual bidi controls, NFC, and reports
cell widths (Arabic-script text measures ~1 cell/char; FSI/PDI cost 0) beside the
English width.
"""
import json
import re
import unicodedata

BASE = "src/i18n/catalogues"
KEYS = [
    "loading.cold",
    "loading.older",
    "loading.region_label",
    "loading.remote",
    "loading.revalidating",
    "media.image_label",
    "media.sound_label",
    "sound.batch.item_status",
    "sound.batch.latest_update",
    "sound.batch.summary",
    "sound.cost.batch_unknown",
    "sound.cost.estimated_zero",
    "sound.cost.no_charge",
    "sound.cost.unknown",
    "supplement.sound_fallback_label",
]
en = json.load(open(f"{BASE}/en/ui.chat.canonical.json"))
ur = json.load(open(f"{BASE}/ur/ui.chat.canonical.json"))

BIDI_CONTROL = re.compile("[\u200e\u200f\u202a-\u202e\u2066-\u2069]")
BANNED_SCRIPT = re.compile("[\u0964\u0965\u0600-\u0605\u061c]")
ASCII_SENTENCE = re.compile(r"[.;?!](?!\d)")
ARABIC_ONLY = re.compile("[\u061f]")  # Arabic question mark, not ur's ؟

print(f"{'key':34} {'en':>4} {'ur':>4}  nfc  danda  bidi  ascii-sentence  latin-period")
for k in KEYS:
    K = "ui.chat.canonical." + k
    e, u = en[K], ur[K]
    nfc = unicodedata.normalize("NFC", u) == u
    ascii_punct = sorted(set(ASCII_SENTENCE.findall(u)))
    print(
        f"{k:34} {len(e):4d} {len(u):4d}  {str(nfc):5} "
        f"{str(bool(BANNED_SCRIPT.search(u))):5} {str(bool(BIDI_CONTROL.search(u))):5} "
        f"{str(ascii_punct):15} {str(bool(ARABIC_ONLY.search(u)))}"
    )

chars = set()
for k in KEYS:
    chars |= set(ur["ui.chat.canonical." + k])
punct = sorted(c for c in chars if unicodedata.category(c).startswith("P"))
print("\npunctuation characters used across the 15 values:",
      " ".join(f"{c}(U+{ord(c):04X})" for c in punct))
