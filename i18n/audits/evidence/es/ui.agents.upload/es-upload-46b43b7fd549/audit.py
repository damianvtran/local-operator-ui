#!/usr/bin/env python3
"""Independent es audit of the 15 new ui.agents.upload keys (head 2b72db6a56a).

Mechanical checks only: structure, ICU/placeholder equality against English, the
es catalogue's own `many`-branch convention, ASCII-lexeme leakage, and text
width in the app's real font at the app's real body size (system-ui = SF Pro on
this macOS host; --text-body: 0.875rem = 14px).  Judgement calls live in
report.md; this file is the measurement those calls rest on.
"""
import subprocess, glob, json, re, os, sys, ctypes, ctypes.util, hashlib

REPO = "."
EN = f"{REPO}/src/i18n/catalogues/en/ui.agents.upload.json"
ES = f"{REPO}/src/i18n/catalogues/es/ui.agents.upload.json"
CTX = f"{REPO}/src/i18n/catalogues/en/ui.agents.upload.context.json"
BASE = "3378319980f"
HEAD = "2b72db6a56a"

def sha(p): return hashlib.sha256(open(p,"rb").read()).hexdigest()
def base_json(path):
    return json.loads(subprocess.run(["git","show",f"{BASE}:{path}"],capture_output=True,text=True,check=True).stdout)

out = []
def say(*a):
    line = " ".join(str(x) for x in a); out.append(line); print(line)

say("== provenance ==")
say("head:", subprocess.run(["git","rev-parse","HEAD"],capture_output=True,text=True).stdout.strip())
say("base:", subprocess.run(["git","rev-parse",BASE],capture_output=True,text=True).stdout.strip())
for label,p in (("en",EN),("es",ES),("context",CTX)):
    say(f"sha256 {label:7s} {sha(p)}  {p}")

say("\n== A. structure ==")
raw = open(ES,"rb").read()
say("valid utf-8:", True)
say("ends with newline:", raw.endswith(b"\n"))
dups = [k for k in re.findall(r'^\t"([^"]+)":', raw.decode(), re.M)
        if re.findall(r'^\t"([^"]+)":', raw.decode(), re.M).count(k) > 1]
say("duplicate keys:", sorted(set(dups)) or "none")
es = json.loads(raw.decode()); en = json.load(open(EN)); ctx = json.load(open(CTX))
say("indent style: tab (leading \\t on every key line):", all(l.startswith('\t"') for l in raw.decode().splitlines()[1:-1]))
say("keys sorted ascending:", list(es) == sorted(es))
say("key count en/es/context:", len(en), len(es), len(ctx))
say("es key set == en key set:", set(es) == set(en))
say("every es key has context:", [k for k in es if k not in ctx] or "yes")

say("\n== B. delta vs parent (scope proof) ==")
es_base = base_json("src/i18n/catalogues/es/ui.agents.upload.json")
new = [k for k in es if k not in es_base]
say("new keys:", len(new))
for k in new: say("  +", k)
say("pre-existing keys:", len(es_base))
changed = [k for k in es_base if es.get(k) != es_base[k]]
say("pre-existing values changed:", changed or "none (byte-identical)")
gone = [k for k in es_base if k not in es]
say("pre-existing keys removed:", gone or "none")

say("\n== C. placeholders + ICU per new key (es vs en) ==")
CATS = r'(=\d+|zero|one|two|few|many|other)'
def walk(msg, path="", depth=0):
    """Return (top_level_args, categories_by_arg, nested_refs)."""
    args, cats, refs = [], {}, []
    i = 0
    while i < len(msg):
        ch = msg[i]
        if ch == "{":
            d = 1; j = i+1
            while j < len(msg) and d:
                if msg[j] == "{": d += 1
                elif msg[j] == "}": d -= 1
                j += 1
            inner = msg[i+1:j-1]
            if "," in inner.split("{")[0]:
                head, rest = inner.split(",", 1)
                name = head.strip()
                typ = rest.split(",", 1)[0].strip()
                args.append((name, typ))
                if typ in ("plural", "selectordinal"):
                    c = {}
                    for m in re.finditer(CATS + r'\s*\{', rest):
                        b = m.end(); dd = 1; k = b
                        while k < len(rest) and dd:
                            if rest[k] == "{": dd += 1
                            elif rest[k] == "}": dd -= 1
                            k += 1
                        c[m.group(1)] = rest[b:k-1]
                    cats[name] = c
                    for cat, body in c.items():
                        refs += [(r, name, cat) for r in re.findall(r'\{(\w+)\}', body)]
                elif typ == "select":
                    for cat, body in re.findall(CATS + r'\s*\{([^{}]*)\}', rest):
                        refs += [(r, name, cat) for r in re.findall(r'\{(\w+)\}', body)]
            else:
                args.append((inner.strip(), None))
            i = j
        else:
            i += 1
    return args, cats, refs

for k in new:
    ea, ec, er = walk(en[k]); sa, sc, sr = walk(es[k])
    same_args = [a[0] for a in ea] == [a[0] for a in sa]
    en_cats = {n: sorted(c) for n, c in ec.items()}
    es_cats = {n: sorted(c) for n, c in sc.items()}
    refs_en = sorted((n, c) for _, n, c in er)
    refs_es = sorted((n, c) for _, n, c in sr)
    flag = []
    if not same_args: flag.append("ARGS DIFFER")
    if en_cats != es_cats: flag.append(f"CATS {en_cats} -> {es_cats}")
    if refs_en != refs_es: flag.append(f"REFS {refs_en} -> {refs_es}")
    say(f"  {k.split('upload.')[1]:38s} args={[a[0] for a in sa]} cats={es_cats or '-'} {' '.join(flag) or 'identical'}")

say("\n== D. es CLDR plural categories (Intl.PluralRules) ==")
node = subprocess.run(["node","-e",
  'const r=new Intl.PluralRules("es");console.log("categories:",JSON.stringify(r.resolvedOptions().pluralCategories));'
  'console.log("select:",[1,2,100,1000000,2000000].map(n=>n+"="+r.select(n)).join(" "));'],
  capture_output=True,text=True)
say(node.stdout.strip() or node.stderr.strip())

say("\n== E. blocked_hint plural-category reachability (count = blocked orgs) ==")
bc = walk(es["ui.agents.upload.target.blocked_hint"])[1]["count"]
say("es branches:", sorted(bc))
say("one  ->", bc["one"].strip())
say("many ->", bc["many"].strip())
say("other->", bc["other"].strip())
say("many text equals one:", bc["many"].strip() == bc["one"].strip(),
    "| equals other:", bc["many"].strip() == bc["other"].strip())
say("'many' is selected by Intl.PluralRules('es') only at exact millions -> count >= 1,000,000 blocked orgs")

say("\n== F. es catalogue-wide `many` convention (the translator's cited precedent) ==")
def blocks_of(msg):
    res = []
    for m in re.finditer(r'\{\s*(\w+)\s*,\s*(plural|selectordinal)\s*,', msg):
        start = m.end(); depth = 1; i = 0
        while start+i < len(msg) and depth > 0:
            if msg[start+i] == "{": depth += 1
            elif msg[start+i] == "}":
                depth -= 1
                if depth == 0: break
            i += 1
        block = msg[start:start+i]; c = {}
        for cm in re.finditer(CATS + r'\s*\{', block):
            b = cm.end(); d = 1; j = 0
            while b+j < len(block) and d > 0:
                if block[b+j] == "{": d += 1
                elif block[b+j] == "}":
                    d -= 1
                    if d == 0: break
                j += 1
            c[cm.group(1)] = block[b:b+j]
        res.append((m.group(1), c))
    return res
files = sorted(glob.glob(f"{REPO}/src/i18n/catalogues/es/*.json"))
with_plural = with_many = 0
tot = eq_both = eq_one = eq_other = distinct = 0
eq_one_cases = []
for f in files:
    d = json.load(open(f)); hp = hm = False
    for k, v in d.items():
        if not isinstance(v, str): continue
        for arg, cats in blocks_of(v):
            hp = True
            if "many" not in cats: continue
            hm = True; tot += 1
            mn = cats["many"].strip(); one = cats.get("one","").strip(); other = cats.get("other","").strip()
            if mn == one and mn == other: eq_both += 1
            elif mn == one: eq_one += 1; eq_one_cases.append((os.path.basename(f), k))
            elif mn == other: eq_other += 1
            else: distinct += 1
    with_plural += hp; with_many += hm
say(f"es catalogue files: {len(files)} | with >=1 plural: {with_plural} | with >=1 `many`: {with_many}")
say(f"es `many` branches: {tot} = distinct(de-form/count-aware) {distinct} + many==other {eq_other} + many==one==other {eq_both} + many==one-only {eq_one}")
say("many==one-only cases (branch duplicates the singular while the plural differs):")
for c in eq_one_cases: say("   ", c[0], "|", c[1])

say("\n== G. ASCII-lexeme leakage (words shared with the English value) ==")
ALLOW = {"radient","team","hub","the"}
for k in new:
    ew = set(re.findall(r"[A-Za-z]{3,}", en[k].lower()))
    sw = set(re.findall(r"[A-Za-z]{3,}", es[k].lower()))
    shared = sorted(w for w in sw & ew if w not in ALLOW)
    say(f"  {k.split('upload.')[1]:38s} {shared or 'none'}")

say("\n== H. width in the app font (system-ui/SF Pro @14px = --text-body) ==")
ct = ctypes.CDLL(ctypes.util.find_library("CoreText"))
cf = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))
cf.CFStringCreateWithCString.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
ct.CTFontCreateUIFontForLanguage.restype = ctypes.c_void_p
ct.CTFontCreateUIFontForLanguage.argtypes = [ctypes.c_int32, ctypes.c_double, ctypes.c_void_p]
cf.CFAttributedStringCreate.restype = ctypes.c_void_p
cf.CFAttributedStringCreate.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
cf.CFDictionaryCreate.restype = ctypes.c_void_p
cf.CFDictionaryCreate.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p), ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p]
ct.CTLineCreateWithAttributedString.restype = ctypes.c_void_p
ct.CTLineCreateWithAttributedString.argtypes = [ctypes.c_void_p]
ct.CTLineGetTypographicBounds.restype = ctypes.c_double
ct.CTLineGetTypographicBounds.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_double)]
FA = ctypes.c_void_p.in_dll(ct, "kCTFontAttributeName")
def measure(text, size=14.0):
    s = cf.CFStringCreateWithCString(None, text.encode(), 0x08000100)
    font = ct.CTFontCreateUIFontForLanguage(0, size, None)
    keys = (ctypes.c_void_p * 1)(FA.value); vals = (ctypes.c_void_p * 1)(font)
    attrs = cf.CFDictionaryCreate(None, keys, vals, 1, None, None)
    astr = cf.CFAttributedStringCreate(None, s, attrs)
    line = ct.CTLineCreateWithAttributedString(astr)
    a = ctypes.c_double(); d = ctypes.c_double(); l = ctypes.c_double()
    return ct.CTLineGetTypographicBounds(line, ctypes.byref(a), ctypes.byref(d), ctypes.byref(l))
def fill(msg, name="Revisor de código", dest="Minerva Labs"):
    return msg.replace("{name}", name).replace("{destination}", dest).replace("{org}", dest)
say("  sample substitution: {name}='Revisor de código', {destination}/{org}='Minerva Labs'")
for k in new:
    e = measure(fill(en[k])); s = measure(fill(es[k]))
    delta = (s-e)/e*100 if e else 0
    say(f"  {k.split('upload.')[1]:38s} en {e:7.1f}px  es {s:7.1f}px  {delta:+6.1f}%")
say("  footer row (Cancel + primary) at the update-listing state:")
cancel = measure("Cancelar"); say(f"    'Cancelar' {cancel:.1f}px + 'Actualizar la ficha' {measure('Actualizar la ficha'):.1f}px = {cancel+measure('Actualizar la ficha'):.1f}px before gaps/padding")

open(sys.argv[1], "w").write("\n".join(out) + "\n")
