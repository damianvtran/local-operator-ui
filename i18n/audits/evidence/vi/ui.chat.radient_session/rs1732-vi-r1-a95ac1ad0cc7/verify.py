#!/usr/bin/env python3
"""Mechanical checks for the PR #1732 ui.chat.radient_session delta audit.

Usage: python3 verify.py <locale> <repo-root> <base-ref>
Read-only: hashes the files on disk, compares them with <base-ref> via git show,
and prints one line per check. The semantic verdict is the auditor's, recorded in
record.json; this only proves the byte facts that verdict rests on.
"""
import hashlib, json, re, subprocess, sys, unicodedata
loc, repo, base = sys.argv[1], sys.argv[2], sys.argv[3]
NS = "ui.chat.radient_session"
NEW = [f"{NS}.title.not_cleared", f"{NS}.prose.not_cleared", f"{NS}.action.open_console"]
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
en0, tg0 = json.loads(at(base, p("en"))), json.loads(at(base, p(loc)))
check("key set equals English", set(en) == set(tg), f"{len(tg)}/{len(en)}")
check("delta vs base is exactly the three new keys", sorted(set(tg) - set(tg0)) == sorted(NEW) and not set(tg0) - set(tg))
check("English delta is exactly the three new keys", sorted(set(en) - set(en0)) == sorted(NEW) and not set(en0) - set(en))
check("every pre-existing value byte-identical to base", all(tg[k] == tg0[k] for k in tg0) and all(en[k] == en0[k] for k in en0))
ph = lambda s: sorted(set(re.findall(r"\{\s*([A-Za-z0-9_]+)", s)))
for k in NEW:
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
print(f"INFO shipped nav terms {json.dumps(nav, ensure_ascii=False)}")
stem = lambda s: s[:max(4, len(s) - 2)]  # tolerate case endings (ru «Настройках»)
for key, label in nav.items():
    print(f"INFO prose.not_cleared contains shipped label {key}: {label in prose or stem(label) in prose} (exact={label in prose})")
print("RESULT", "all mechanical checks pass" if ok else "mechanical check FAILED")
sys.exit(0 if ok else 1)
