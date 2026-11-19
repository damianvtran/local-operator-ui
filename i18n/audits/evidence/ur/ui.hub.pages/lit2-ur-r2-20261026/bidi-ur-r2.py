#!/usr/bin/env python3
"""Round-2 ur remediation audit — bidi composition, measured with GNU FriBidi.

For every composed sentence the audit composes from the shipped ur age phrases
(ui.hub.comments.age.*), the "just now" phrase (ui.hub.updates.ago.now), the
absolute short date that recencyOf() substitutes on a clock-skewed timestamp,
and the two by-hand link labels, this prints:

  - the UTF-8 visual string FriBidi produces for an RTL paragraph
  - the logical->visual mapping (--ltov) for the {when} span and the verb span
  - which end the age occupies and which end the verb occupies

Read-only. The catalogue values are read from the worktree at HEAD; nothing is
written.
"""
import json
import re
import subprocess
import unicodedata
from pathlib import Path

ROOT = Path.home() / "local-operator-ui/.worktrees/i18n-agents-literals-2"
UR = ROOT / "src/i18n/catalogues/ur"


def value(ns, key):
    return json.loads((UR / f"{ns}.json").read_text())[key]


def fribidi(text, extra=()):
    out = subprocess.run(
        ["fribidi", "--rtl", "--nopad", "--nobreak", *extra],
        input=text.encode(),
        capture_output=True,
        check=True,
    )
    return out.stdout.decode("utf-8")


def ltov(text):
    out = subprocess.run(
        ["fribidi", "--rtl", "--nopad", "--nobreak", "--ltov"],
        input=text.encode(),
        capture_output=True,
        check=True,
    )
    tail = out.stdout.decode("utf-8").strip().splitlines()[-1]
    numbers = [int(p) for p in tail.split()]
    if len(numbers) != len(text):
        raise SystemExit(f"ltov returned {len(numbers)} positions for {len(text)} characters")
    return dict(enumerate(numbers))


def esc(text):
    return "".join(
        c if 0x20 <= ord(c) < 0x7F else f"\\u+{ord(c):04X}" for c in text
    )


def span(text, needle):
    start = text.index(needle)
    return start, start + len(needle) - 1


def case(label, text, when=None, verb=None):
    visual = fribidi(text)
    mapping = ltov(text)
    print(f"CASE {label}")
    print(f"  logical : {text}")
    print(f"  rtl_vis : {visual}")
    print(f"  rtl_esc : {esc(visual)}")
    print(f"  length  : {len(text)}")
    for name, needle in (("when", when), ("verb", verb)):
        if not needle:
            continue
        lo, hi = span(text, needle)
        vis = sorted(mapping[i] for i in range(lo, hi + 1))
        where = []
        if min(vis) == 0:
            where.append("left-edge")
        if max(vis) == len(text) - 1:
            where.append("right-edge")
        print(
            f"  {name:<5}: logical {lo}..{hi} -> visual {min(vis)}..{max(vis)}"
            f" {'/'.join(where) or 'interior'}"
        )
    print()


def age(key, count):
    """Resolve a shipped ur age plural through its one arm, with a real count.

    The arms are read from the catalogue itself (not retyped here) so the audit
    composes exactly the phrase the UI composes; one arm is used because the
    houns per unit are identical in both ur arms except hours/months/years.
    """
    message = value("ui.hub.comments", key)
    match = re.fullmatch(
        r"\{count, plural, one \{(.*?)\} other \{(.*?)\}\}", message, re.S
    )
    if not match:
        raise SystemExit(f"unexpected plural shape for {key}: {message!r}")
    arm = match.group(1) if count == 1 else match.group(2)
    return arm.replace("{count}", str(count))


AGE_DAYS = age("ui.hub.comments.age.days", 3)
AGE_HOURS = age("ui.hub.comments.age.hours", 2)
AGE_MINUTES = age("ui.hub.comments.age.minutes", 5)
JUST_NOW = value("ui.hub.updates", "ui.hub.updates.ago.now")
DATE = "10 اکتوبر، 2026"  # formatTeamDate(date) shape: day, short month, year, U+060C

CARD = value("ui.hub.pages", "ui.hub.pages.card.updated")
UPDATED = value("ui.hub.teams", "ui.hub.teams.recency.updated")
CREATED = value("ui.hub.teams", "ui.hub.teams.recency.created")
LINK_AGENT = value("ui.agents.pages", "ui.agents.pages.ask.manual_agent")
LINK_TEAM = value("ui.agents.pages", "ui.agents.pages.ask.manual_team")
ROSTER_AGENT = value("ui.agents.pages", "ui.agents.pages.add_manual.agent")
ROSTER_TEAM = value("ui.agents.pages", "ui.agents.pages.add_manual.team")

print(f"# fribidi: {subprocess.run(['fribidi','--version'],capture_output=True,text=True).stdout.splitlines()[0]}")
print(f"# HEAD {subprocess.run(['git','rev-parse','HEAD'],cwd=ROOT,capture_output=True,text=True).stdout.strip()}")
print(f"# age phrases read from ui.hub.comments.age.*: {AGE_DAYS!r} {AGE_HOURS!r} {AGE_MINUTES!r}")
print(f"# just-now phrase: {JUST_NOW!r}; absolute short date: {DATE!r}\n")

case("ui.hub.pages.card.updated when=3 دن پہلے", CARD.replace("{when}", AGE_DAYS), AGE_DAYS, "اپ ڈیٹ کیا گیا")
case("ui.hub.pages.card.updated when=2 گھنٹے پہلے", CARD.replace("{when}", AGE_HOURS), AGE_HOURS, "اپ ڈیٹ کیا گیا")
case("ui.hub.pages.card.updated when=5 منٹ پہلے", CARD.replace("{when}", AGE_MINUTES), AGE_MINUTES, "اپ ڈیٹ کیا گیا")
case("ui.hub.pages.card.updated when=(empty, unreachable)", CARD.replace("{when}", ""), None, "اپ ڈیٹ کیا گیا")
case("ui.hub.teams.recency.updated when=2 گھنٹے پہلے", UPDATED.replace("{when}", AGE_HOURS), AGE_HOURS, "اپ ڈیٹ کیا گیا")
case("ui.hub.teams.recency.updated when=ابھی", UPDATED.replace("{when}", JUST_NOW), JUST_NOW, "اپ ڈیٹ کیا گیا")
case("ui.hub.teams.recency.updated when=absolute date (clock skew)", UPDATED.replace("{when}", DATE), DATE, "اپ ڈیٹ کیا گیا")
case("ui.hub.teams.recency.created when=3 دن پہلے", CREATED.replace("{when}", AGE_DAYS), AGE_DAYS, "بنایا گیا")
case("ui.hub.teams.recency.created when=ابھی", CREATED.replace("{when}", JUST_NOW), JUST_NOW, "بنایا گیا")
case("ui.hub.teams.recency.created when=absolute date (clock skew)", CREATED.replace("{when}", DATE), DATE, "بنایا گیا")
case(
    "full hub card line author · card.updated",
    "Damian Tran · " + CARD.replace("{when}", AGE_DAYS),
    AGE_DAYS,
    "اپ ڈیٹ کیا گیا",
)
case(
    "full teams provenance project · author · recency.updated (absolute date)",
    "Pergamon · Damian Tran · " + UPDATED.replace("{when}", DATE),
    DATE,
    "اپ ڈیٹ کیا گیا",
)
case("ui.agents.pages.ask.manual_agent", LINK_AGENT, None, None)
case("ui.agents.pages.ask.manual_team", LINK_TEAM, None, None)
case("roster contrast add_manual.agent", ROSTER_AGENT, None, None)
case("roster contrast add_manual.team", ROSTER_TEAM, None, None)
case("link + roster read as a pair (agent)", LINK_AGENT + " / " + ROSTER_AGENT, None, None)
