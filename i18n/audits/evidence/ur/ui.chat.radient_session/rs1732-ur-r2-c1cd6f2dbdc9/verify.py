#!/usr/bin/env python3
"""Mechanical checks for the PR #1732 round-2 ui.chat.radient_session re-audit.

Usage: python3 verify.py <locale> <repo-root> <prev-audited-ref>
Read-only: hashes the files on disk, compares them with <prev-audited-ref> (the head
round 1 audited, dee5636) via git show, and prints one line per check. Round 2 changed
title.not_cleared and prose.not_cleared in every locale, plus action.open_console in
vi only (VI-N1 applied). The semantic verdict is the auditor's, in record.json; this
script proves only the byte facts that verdict rests on.
"""
import hashlib, json, re, subprocess, sys, unicodedata
loc, repo, prev = sys.argv[1], sys.argv[2], sys.argv[3]
NS = "ui.chat.radient_session"
CHANGED = [f"{NS}.title.not_cleared", f"{NS}.prose.not_cleared"] + ([f"{NS}.action.open_console"] if loc == "vi" else [])
EN_CHANGED = [f"{NS}.prose.not_cleared", f"{NS}.title.not_cleared"]
def p(l): return f"src/i18n/catalogues/{l}/{NS}.json"
def disk(path): return open(f"{repo}/{path}", "rb").read()
def at(ref, path): return subprocess.run(["git", "-C", repo, "show", f"{ref}:{path}"], capture_output=True, check=True).stdout
sha = lambda b: hashlib.sha256(b).hexdigest()
ok = True
def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(f"{'PASS' if cond else 'FAIL'} {name}{': ' + detail if detail else ''}")
en_b, tg_b = disk(p("en")), disk(p(loc))
ctx_b = disk(f"src/i18n/catalogues/en/{NS}.context.json")
print(f"sha256 en={sha(en_b)}\nsha256 {loc}={sha(tg_b)}\nsha256 context={sha(ctx_b)}")
en, tg = json.loads(en_b), json.loads(tg_b)
en0, tg0 = json.loads(at(prev, p("en"))), json.loads(at(prev, p(loc)))
check("key set equals English", set(en) == set(tg), f"{len(tg)}/{len(en)}")
check("key set unchanged since previous audited head", set(tg) == set(tg0) and set(en) == set(en0))
check("English values changed since previous audit are exactly the two not_cleared keys", sorted(k for k in en if en[k] != en0.get(k)) == sorted(EN_CHANGED))
check("target values changed since previous audit are exactly the expected keys", sorted(k for k in tg if tg[k] != tg0.get(k)) == sorted(CHANGED), str(sorted(k for k in tg if tg[k] != tg0.get(k))))
ph = lambda s: sorted(set(re.findall(r"\{\s*([A-Za-z0-9_]+)", s)))
for k in CHANGED:
    v = tg[k]
    check(f"{k} placeholders equal English", ph(v) == ph(en[k]), str(ph(v)))
    check(f"{k} NFC", unicodedata.normalize("NFC", v) == v)
    check(f"{k} no bidi controls", not re.search("[\u200e\u200f\u202a-\u202e\u2066-\u2069]", v))
    check(f"{k} Radient kept in Latin", "Radient" in v)
    check(f"{k} no terminal/command advice", not re.search(r"lop |`|terminal|терминал|टर्मिनल|ٹرمینل|终端|命令|commande|comando|lệnh|команд", v, re.I))
    print(f"VALUE {k} = {v}")
nav = {}
for f, key in (("ui.settings", "ui.settings.page.title"), ("ui.settings.navigation", "ui.settings.navigation.settings_sidebar.model_providers")):
    nav[key] = json.loads(disk(f"src/i18n/catalogues/{loc}/{f}.json"))[key]
prose = tg[f"{NS}.prose.not_cleared"]
stem = lambda s: s[:max(4, len(s) - 2)]
for key, label in nav.items():
    check(f"prose.not_cleared does not name Settings/Providers ({key}={label})", label not in prose and stem(label) not in prose)
act = tg[f"{NS}.action.open_console"]
print(f"INFO action.open_console = {act}")
again = json.loads(disk(f"src/i18n/catalogues/{loc}/ui.providers.json"))["ui.providers.provider_detail.sign_in_again"]
print(f"INFO not-cleared retry button (ui.providers.provider_detail.sign_in_again) = {again}")
print("RESULT", "all mechanical checks pass" if ok else "mechanical check FAILED")
sys.exit(0 if ok else 1)
