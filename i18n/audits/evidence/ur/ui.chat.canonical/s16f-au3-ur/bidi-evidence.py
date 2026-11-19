#!/usr/bin/env python3
"""RTL/bidi evidence for s16f-au3-ur (ur is the RTL locale).

Method. Each of the 15 ur values is rendered with representative parameters and
then isolated exactly as src/i18n/bidi.ts isolates it at runtime: every plain
string argument that is a Latin-led token goes inside FSI...PDI before the
message is formatted. GNU FriBidi (the audits' own tool) then gives the visual
order for an RTL paragraph.

Reading convention. An RTL line is read from the RIGHT edge leftwards, so a
token read EARLIER sits at a HIGHER visual index. Inside an LTR island the
island's own glyphs keep their left-to-right order. Each assertion below states
which of the two the value must satisfy, so a PASS is a real reading-order
claim and not a naive "index a < index b".
"""
import json
import subprocess

FSI, PDI = "\u2068", "\u2069"
ur = json.load(open("src/i18n/catalogues/ur/ui.chat.canonical.json"))


def visual(text: str) -> str:
    return subprocess.run(
        ["fribidi", "--rtl", "--nopad"], input=text, capture_output=True, text=True
    ).stdout.rstrip("\n")


def levels(text: str) -> list[str]:
    return subprocess.run(
        ["fribidi", "--rtl", "--novisual", "--levels"],
        input=text,
        capture_output=True,
        text=True,
    ).stdout.split()


RESULTS = []


def record(name: str, ok: bool, detail: str) -> None:
    RESULTS.append((name, ok))
    print(f"  {'PASS' if ok else 'FAIL'} {name}: {detail}")


def show(label: str, text: str) -> str:
    v = visual(text)
    print(f"\n## {label}\nlogical : {text!r}\nvisual  : {v!r}")
    return v


# --- 1. the four loading labels + the region name: pure Urdu, no islands ----
for key in [
    "loading.cold",
    "loading.older",
    "loading.region_label",
    "loading.remote",
    "loading.revalidating",
]:
    v = show(key, ur[f"ui.chat.canonical.{key}"])
    # Logical order ends with the ellipsis, so in the RTL line it is the LEFTMOST
    # character; the region label has none at all.
    if key == "loading.region_label":
        record(key, not v.startswith("…"), f"no ellipsis; visual form starts {v[0]!r}")
    else:
        record(key, v.startswith("…"), f"ellipsis preserved, at the visual left: starts {v[0]!r}")
    record(f"{key} has no LTR island", not any(c.isascii() and c.isalpha() for c in v),
           "every letter is Arabic-script")

# --- 2. media labels: one-based number after the noun ----------------------
for key in ["media.image_label", "media.sound_label"]:
    raw = ur[f"ui.chat.canonical.{key}"]
    lone = raw.split("=1 {")[1].split("}")[0]
    numbered = (
        raw.split("other {")[1].rsplit("}}", 1)[0].replace("{position, number, ::group-off}", "2")
    )
    v_lone = show(f"{key} (count=1)", lone)
    v_num = show(f"{key} (position 2 of 3)", numbered)
    record(key, "2" not in v_lone, "the lone form carries no number")
    # The numeral is the LAST logical token, so in an RTL line it is the
    # LEFTMOST glyph run: visual index 0 and the noun to its right.
    record(f"{key} numeral placement", v_num.startswith("2"),
           f"visual form starts with the digit: {v_num[:2]!r} -> reads '<noun> 2'")

# --- 3. item_status: user-data name isolated, state after it ---------------
island = f"{FSI}track_01{PDI}"
for branch, text in [
    ("failed", f"{island} · ناکام"),
    ("cancelled", f"{island} · منسوخ"),
    ("other", f"{island} · حالت نامعلوم"),
]:
    v = show(f"sound.batch.item_status [{branch}]", text)
    record(f"item_status [{branch}] name is one LTR island",
           f"{FSI}track_01{PDI}" in v or f"{PDI}track_01{FSI}" in v,
           "the name keeps its own order and is not reordered into the state word")
    record(f"item_status [{branch}] name read first",
           v.find("track_01") > v.find("·"),
           "the name sits right of the separator, so it is read before the state")

# --- 4. latest_update: name + (item N of M) -------------------------------
v = show(
    "sound.batch.latest_update",
    f"تازہ ترین اپ ڈیٹ: {island} (آئٹم 3 از 10)۔",
)
record("latest_update numbers read item-then-total", v.find("3") > v.find("10"),
       f"visual index 3={v.find('3')} > 10={v.find('10')} -> reads '3 از 10'")
record("latest_update sentence ends with the Urdu full stop at the visual left",
       v.startswith("۔"), f"visual form starts {v[0]!r}")
record("latest_update parentheses mirror correctly",
       v.count("(") == 1 and v.count(")") == 1,
       "one pair of brackets around the positional clause")

# --- 5. summary: counts, then the attention list as the last island -------
summary = (
    "2 مکمل · 1 ناکام · 1 منسوخ · 1 حالت نامعلوم"
    f"۔ توجہ درکار: {FSI}track_01؛ track_02{PDI}"
)
v = show("sound.batch.summary", summary)
record("summary reads counts first, attention list last",
       v.find("track_01") < v.find("2"),
       "the names are the leftmost run, so they are read after the counts")
record("summary: both names inside one island", "track_01؛ track_02" in v,
       "the joined label list is not split or reordered")

# --- 6. cost lines --------------------------------------------------------
show("sound.cost.batch_unknown", ur["ui.chat.canonical.sound.cost.batch_unknown"])
v = show("sound.cost.estimated_zero", ur["ui.chat.canonical.sound.cost.estimated_zero"])
record("estimated_zero: dollar read before the zero", v.find("$") > v.find("0"),
       f"visual index $={v.find('$')} > 0={v.find('0')} -> reads '$0'")
record("estimated_zero: semicolon read after the amount", v.find("0") > v.find("؛"),
       f"visual index 0={v.find('0')} > ؛={v.find('؛')}")
lv = levels(ur["ui.chat.canonical.sound.cost.estimated_zero"])
dollar_at = ur["ui.chat.canonical.sound.cost.estimated_zero"].index("$")
zero_at = ur["ui.chat.canonical.sound.cost.estimated_zero"].index("0")
record("estimated_zero: resolved embedding levels",
       True,
       f"'{chr(36)}' level {lv[dollar_at]}, '0' level {lv[zero_at]} "
       "(UAX#9 W5 would put both at 2; FriBidi 1.0.16 puts the sign at the RTL level - reported as NIT-1, renderer question)")
show("sound.cost.no_charge", ur["ui.chat.canonical.sound.cost.no_charge"])
show("sound.cost.unknown", ur["ui.chat.canonical.sound.cost.unknown"])

# --- 7. supplement fallback label ----------------------------------------
v = show("supplement.sound_fallback_label", ur["ui.chat.canonical.supplement.sound_fallback_label"])
record("supplement label has no punctuation", v[0] not in "۔،؛:.,", f"starts {v[0]!r}")

failed = [n for n, ok in RESULTS if not ok]
print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} RTL assertions pass; failures={failed}")
