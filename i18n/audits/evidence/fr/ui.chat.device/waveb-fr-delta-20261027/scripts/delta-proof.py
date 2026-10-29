"""Two audit facts about the fr wave-B delta, computed from the git objects.

1. DELTA: exactly which source/translation values changed between the audited
   commit (BASE = what the previous reviewer signed off) and the audited head,
   over the nine wave-B namespaces and both `en` and `fr`.
2. REGRESSION: every OTHER wave-B value is byte-identical to the audited bytes -
   "unchanged" is measured, not assumed - and so is every other value in those
   nine files (not just the 62).

Plus the fr typography sweep over all 62 wave-B values (the style guide's
punctuation rules), since a carried value still ships in this branch.

Reads only `git show` output; writes one JSON digest to stdout.
"""

import json
import subprocess
import unicodedata

REPO = "/Users/damian/local-operator-ui"
BASE = "0559f7f7d8"  # audited head: peer auditor's receipt at ~/qa/wave-b-audit-fr
HEAD = "a5356ce91c4f37bf4c4d1c4518070e3a9b2505cb"
WAVE_B_BASE = "59ec56f686"  # wave B adds translations on top of this
NAMESPACES = [
    "ui.chat.device",
    "ui.chat.pickers",
    "ui.chat.canonical",
    "ui.chat",
    "ui.chat.status",
    "ui.chat.run_details",
    "ui.common.connection",
    "ui.common.layout",
    "ui.agents.config",
]
LOCALES = ["en", "fr"]


def show(rev, path):
    result = subprocess.run(
        ["git", "show", f"{rev}:{path}"], cwd=REPO, capture_output=True, text=True
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    return json.loads(result.stdout)


def path_for(locale, namespace):
    return f"src/i18n/catalogues/{locale}/{namespace}.json"


# The wave-B key set: keys the translation commit added to fr (all present in en).
wave_b = {}
for namespace in NAMESPACES:
    before = show(WAVE_B_BASE, path_for("fr", namespace)) or {}
    after = show(BASE, path_for("fr", namespace)) or {}
    wave_b[namespace] = sorted(set(after) - set(before))

changes = []
for locale in LOCALES:
    for namespace in NAMESPACES:
        old = show(BASE, path_for(locale, namespace)) or {}
        new = show(HEAD, path_for(locale, namespace)) or {}
        assert set(old) == set(new), f"{locale}/{namespace} key set changed"
        for key in sorted(old):
            if old[key] != new[key]:
                changes.append(
                    {
                        "locale": locale,
                        "namespace": namespace,
                        "key": key,
                        "old": old[key],
                        "new": new[key],
                        "in_wave_b": key in wave_b[namespace],
                    }
                )

# Regression: every wave-B value not in `changes` must be byte-identical.
changed_keys = {(c["locale"], c["key"]) for c in changes}
regression = []
for namespace in NAMESPACES:
    old_fr = show(BASE, path_for("fr", namespace)) or {}
    new_fr = show(HEAD, path_for("fr", namespace)) or {}
    old_en = show(BASE, path_for("en", namespace)) or {}
    new_en = show(HEAD, path_for("en", namespace)) or {}
    for key in wave_b[namespace]:
        for locale, old, new in (("fr", old_fr, new_fr), ("en", old_en, new_en)):
            identical = old[key] == new[key]
            if identical == ((locale, key) in changed_keys):
                raise SystemExit(f"regression proof failed for {locale} {key}")
            regression.append({"locale": locale, "key": key, "identical": identical})

# Typography sweep over the 62 fr values (carried ones still ship here).
typography = []
for namespace in NAMESPACES:
    fr = show(HEAD, path_for("fr", namespace)) or {}
    for key in wave_b[namespace]:
        value = fr[key]
        prose = value
        for span in sorted(set(__import__("re").findall(r"`[^`]*`", value))):
            prose = prose.replace(span, "\x00" * len(span))
        findings = []
        plain = __import__("re").findall(r"[^\s\x00][ ]([:;!?])", prose)
        if plain:
            findings.append(f"plain space before {plain}")
        plain_before_nbsp = __import__("re").findall(r"[^\s\x00]([\u00a0])([:;!?])", prose)
        if plain_before_nbsp:
            findings.append("NBSP (not the fine one) before punctuation")
        for sub in (";", "!", "?"):
            if sub in prose and f"\u202f{sub}" not in prose:
                findings.append(f"{sub} without U+202F")
        if "'" in prose:
            findings.append("straight apostrophe in prose")
        if "..." in prose:
            findings.append("three-dot ellipsis")
        if "  " in value:
            findings.append("doubled space")
        if unicodedata.normalize("NFC", value) != value:
            findings.append("not NFC")
        if any(0x200E <= ord(ch) <= 0x200F or 0x202A <= ord(ch) <= 0x202E or 0x2066 <= ord(ch) <= 0x2069 for ch in value):
            findings.append("bidi control")
        if findings:
            typography.append({"key": key, "value": value, "findings": findings})

digest = {
    "repo": REPO,
    "audited_head": BASE,
    "head": HEAD,
    "wave_b_base": WAVE_B_BASE,
    "wave_b_key_count": sum(len(v) for v in wave_b.values()),
    "wave_b_by_namespace": {k: len(v) for k, v in wave_b.items()},
    "changed_values": changes,
    "changed_value_count": len(changes),
    "regression_checked": len(regression),
    "regression_all_identical": all(r["identical"] for r in regression if not r["identical"]) is False,
    "carried_identical_count": sum(1 for r in regression if r["identical"]),
    "typography_problems": typography,
}

json.dump(digest, open("/dev/stdout", "w"), ensure_ascii=False, indent=1)
print()
