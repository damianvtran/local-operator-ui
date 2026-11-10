"""Compose the audited ur values and measure their RTL composition with GNU
FriBidi, so "reading order correct" is an observation rather than an assertion.

Each case is composed twice:
  raw       - data spliced as plain bytes (a renderer with no isolation).
  shipping  - the same Latin-led values wrapped in FSI..PDI, which is what
              src/i18n/bidi.ts `isolateArguments` does for a plain argument in
              a message an RTL catalogue answered. The dialog takes this path,
              so the `shipping` row is the one that renders.

`fribidi --levels` prints its level array in LOGICAL order (noted in the log
below: "xy ز" -> levels 2 2 1 1 while the visual string is "ﺯ xy"), so the
level string is paired with the LOGICAL text and each run of equal level is a
real island of that direction. Level 2 = an LTR island, level 1 = the RTL base.
"""
import json, subprocess

UR = "src/i18n/catalogues/ur/ui.agents.upload.json"
cat = json.load(open(UR))
FSI, PDI = "\u2068", "\u2069"
PLURAL = "{count, plural, one {{org}} other {اوپر نشان زدہ تنظیموں میں سے کسی ایک}}"

def compose(key, phrase=None, name=None, destination=None):
    text = cat["ui.agents.upload." + key]
    if PLURAL in text and phrase is not None:
        text = text.replace(PLURAL, phrase)
    if name is not None:
        text = text.replace("{name}", name)
    if destination is not None:
        text = text.replace("{destination}", destination)
    return text

def run(args, text):
    return subprocess.run(args, input=text.encode(), capture_output=True,
                          check=False).stdout.decode("utf-8", "replace")

def measure(text):
    raw = run(["fribidi", "--rtl", "--nobreak", "--nopad", "--levels"], text)
    lines = [l for l in raw.split("\n") if l != ""]
    visual = lines[0] if lines else ""
    levels = next((l.strip() for l in lines[1:] if l.strip() and l.strip()[0].isdigit()), "")
    levels = levels.replace(" ", "")
    spans, start = [], 0
    for i in range(1, len(levels) + 1):
        if i == len(levels) or levels[i] != levels[start]:
            spans.append((int(levels[start]), text[start:i]))
            start = i
    return visual, levels, spans

def show(key, label, text):
    visual, levels, spans = measure(text)
    print(f"### {key} [{label}]")
    print("logical:", "".join(f"<U+{ord(c):04X}>" if ord(c) in (0x2068, 0x2069) else c for c in text))
    print("levels (logical order):", levels)
    print("level-2 (LTR) islands:", [s for lvl, s in spans if lvl == 2])
    print("visual:", visual)
    print()

print("calibration: fribidi prints LEVELS in logical order")
show("_calibration", "proof", "xy ز")
print()

show("ui.agents.upload.published.org_listed", "raw",
     compose("published.org_listed", name="fleet-ops", destination="Acme Corp"))
show("ui.agents.upload.published.org_listed", "shipping",
     compose("published.org_listed", name=FSI + "fleet-ops" + PDI,
             destination=FSI + "Acme Corp" + PDI))
show("ui.agents.upload.title.published_org", "shipping",
     compose("title.published_org", name=FSI + "fleet-ops" + PDI,
             destination=FSI + "Acme Corp" + PDI))
show("ui.agents.upload.target.blocked_hint", "shipping count=1",
     compose("target.blocked_hint", phrase=FSI + "Acme Corp" + PDI))
show("ui.agents.upload.target.blocked_hint", "shipping count>1",
     compose("target.blocked_hint", phrase="اوپر نشان زدہ تنظیموں میں سے کسی ایک"))
show("ui.agents.upload.availability.reserved_named", "shipping",
     compose("availability.reserved_named", name=FSI + "fleet-ops" + PDI))
show("ui.agents.upload.title.update_listing", "shipping",
     compose("title.update_listing", name=FSI + "fleet-ops" + PDI))
show("ui.agents.upload.intro.org", "shipping",
     compose("intro.org", destination=FSI + "Acme Corp" + PDI))
show("ui.agents.upload.not_leaving.org", "shipping",
     compose("not_leaving.org", destination=FSI + "Acme Corp" + PDI))
