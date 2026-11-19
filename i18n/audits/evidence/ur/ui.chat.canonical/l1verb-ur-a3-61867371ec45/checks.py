#!/usr/bin/env python3
"""L1 tool-row verbs — Urdu (ur) round-3 delta audit mechanical checks.

Independent auditor script (does not edit any catalogue byte). Reads the
translator's prep files in _l1-prep/ and the English key/context sidecar, then
asserts the mechanical invariants the RFC requires, printing PASS/FAIL per row
and a machine-readable summary at the end.

Run with the core checkout's interpreter so `rich` is importable:
  ~/local-operator/.venv/bin/python checks.py
"""
import json
import os
import sys
import unicodedata
import hashlib

PREP = os.path.expanduser('~/local-operator-ui/.worktrees/_l1-prep')
SHIPPED = os.path.expanduser('~/local-operator-ui/.worktrees/i18n-l1-tool-verbs/src/i18n/catalogues')

CTX = json.load(open(os.path.join(PREP, 'keys.json'), encoding='utf-8'))
V2 = json.load(open(os.path.join(PREP, 'ur.v2.json'), encoding='utf-8'))
V3 = json.load(open(os.path.join(PREP, 'ur.v3.json'), encoding='utf-8'))

# Bidi / zero-width / control characters the render layer applies itself.
BIDI = {
    0x061C: 'ARABIC LETTER MARK', 0x200B: 'ZWSP', 0x200C: 'ZWNJ', 0x200D: 'ZWJ',
    0x200E: 'LRM', 0x200F: 'RLM', 0x202A: 'LRE', 0x202B: 'RLE', 0x202C: 'PDF',
    0x202D: 'LRO', 0x202E: 'RLO', 0x2066: 'LRI', 0x2067: 'RLI', 0x2068: 'FSI',
    0x2069: 'PDI', 0xFEFF: 'BOM',
}
# Arabic-only letter forms that must never appear in Urdu copy.
ARABIC_ONLY = {0x064A: 'ARABIC YEH (use ی U+06CC)', 0x0643: 'ARABIC KAF (use ک U+06A9)',
               0x0629: 'TEH MARBUTA', 0x0649: 'ALEF MAKSURA', 0x06D5: 'AE'}
EXPECTED_LATIN_ONLY = {'Python'}  # the only English-identical value allowed in this slice

results = []


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ''))


def sha256(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


# ---------------------------------------------------------------- structure
check('ur.v3.json parses as JSON', True, f'{len(V3)} values')
en_keys = [k for k in CTX]
check('key count is 182', len(V3) == 182 == len(en_keys), f'v3={len(V3)} keys.json={len(en_keys)}')
check('key set identical to the English sidecar', set(V3) == set(en_keys),
      f'extra={sorted(set(V3) - set(en_keys))[:3]} missing={sorted(set(en_keys) - set(V3))[:3]}')
check('key ORDER identical to the English sidecar (stable review order)',
      list(V3) == en_keys,
      'first divergence: ' + next((f'{i}: {a} vs {b}' for i, (a, b)
                                   in enumerate(zip(list(V3), en_keys)) if a != b), 'none'))
check('v2 -> v3 changes exactly the 3 briefed keys',
      [k for k in V2 if V2[k] != V3.get(k)] == [
          'ui.chat.canonical.tool_row.verb.listed_network_peers.settled',
          'ui.chat.canonical.tool_row.verb.sent_keys.settled',
          'ui.chat.canonical.tool_row.verb.sent_keys.running'],
      str([k.split('.')[-2] + '.' + k.split('.')[-1] for k in V2 if V2[k] != V3.get(k)]))
check('no key added or dropped vs v2', set(V2) == set(V3))

# ------------------------------------------------------------- value hygiene
bad_type = [k for k, v in V3.items() if not isinstance(v, str)]
check('every value is a string', not bad_type, str(bad_type[:3]))
empties = [k for k, v in V3.items() if not v.strip()]
check('no empty or whitespace-only values', not empties, str(empties[:3]))
ws = [k for k, v in V3.items()
      if v != v.strip() or '  ' in v or '\t' in v or '\n' in v or '\u00a0' in v]
check('no leading/trailing/double/odd whitespace', not ws, str(ws[:3]))
nfc = [k for k, v in V3.items() if unicodedata.normalize('NFC', v) != v]
check('all values NFC-stable (byte-identical after re-normalisation)', not nfc, str(nfc[:3]))

ctrl = []
for k, v in V3.items():
    for ch in v:
        cp = ord(ch)
        if cp in BIDI:
            ctrl.append((k, hex(cp), BIDI[cp]))
        elif unicodedata.category(ch) in ('Cc', 'Cf', 'Cs', 'Co', 'Cn') and ch != '\n':
            ctrl.append((k, hex(cp), 'control/format'))
check('no manual bidi controls or other format/control characters', not ctrl, str(ctrl[:4]))

# ------------------------------------------------ placeholders / ICU / markup
brace = [k for k, v in V3.items() if any(c in v for c in '{}')]
check('no placeholder or ICU braces in any value (en has none)', not brace, str(brace[:3]))
en_ph = [k for k, c in CTX.items() if 'placeholders' in c.get('context', {})
         and c['context']['placeholders'] != 'none']
check('English sidecar declares no placeholders in this slice', not en_ph, str(en_ph[:3]))
en_brace = [k for k, c in CTX.items() if '{' in c['en'] or '}' in c['en']]
check('English source values carry no ICU/plural structure', not en_brace, str(en_brace[:3]))
# CLDR categories are therefore N/A; state it rather than silently skipping.
print('INFO  CLDR category check: N/A — no ICU plural/select message in any of the 182 en values')
backtick = [k for k, v in V3.items() if '`' in v or '<' in v]
check('no markup or backtick code spans to preserve', not backtick, str(backtick[:3]))

# ------------------------------------------------------ script / Latin tokens
latin_tokens, arabic_only, non_arabic, digits = {}, [], {}, []
for k, v in V3.items():
    for ch in v:
        cp = ord(ch)
        if cp in ARABIC_ONLY:
            arabic_only.append((k, hex(cp), ARABIC_ONLY[cp]))
        if 0x0660 <= cp <= 0x0669 or 0x06F0 <= cp <= 0x06F9:
            digits.append((k, ch))
    tok = ''
    for ch in v + ' ':
        if ch.isascii() and ch.isalpha():
            tok += ch
        else:
            if tok:
                latin_tokens[tok] = latin_tokens.get(tok, 0) + 1
            tok = ''
    for ch in v:
        cp = ord(ch)
        blk_arabic = 0x0600 <= cp <= 0x06FF or 0x0750 <= cp <= 0x077F or 0xFB50 <= cp <= 0xFDFF or 0xFE70 <= cp <= 0xFEFF
        if not (blk_arabic or cp == 0x20 or ch.isascii()):
            non_arabic[(ch, hex(cp))] = non_arabic.get((ch, hex(cp)), 0) + 1
check('no Arabic-only letter forms where Urdu requires ی/ک/ہ', not arabic_only, str(arabic_only[:4]))
check('no Arabic-Indic or Urdu-Indic digits (guide: Latin digits in v1)', not digits, str(digits[:3]))
check('no characters outside Urdu/Arabic blocks except ASCII (Python)', not non_arabic,
      str(list(non_arabic)[:4]))
print('INFO  Latin tokens present:', {t: c for t, c in sorted(latin_tokens.items())})

# A value with no Arabic-script character at all would be untranslated English.
english_identical = [k for k, v in V3.items()
                     if all(not (0x0600 <= ord(c) <= 0x06FF) for c in v)]
check('no English-identical (Latin-only) values: every value is Urdu script', not english_identical,
      str([(k.split('.')[-2] + '.' + k.split('.')[-1], V3[k]) for k in english_identical][:4]))
# The kept-English token allowed in this slice: `Python` (glossary §1), embedded, never alone.
py = [k for k, v in V3.items() if 'Python' in v]
check('kept-English Latin is only the `Python` token on the two ran_python rows',
      py == ['ui.chat.canonical.tool_row.verb.ran_python.settled',
             'ui.chat.canonical.tool_row.verb.ran_python.running'],
      str([(k.split('.')[-2] + '.' + k.split('.')[-1], V3[k]) for k in py]))

# ------------------------------------------------------------ punctuation
punct_end = [k for k, v in V3.items() if v.rstrip()[-1] in '.۔!?؟،؛:']
check('no terminal punctuation on any label (en has none)', not punct_end,
      str([(k.split('.')[-1], V3[k]) for k in punct_end][:4]))
latin_punct = [(k, v) for k, v in V3.items() if any(c in v for c in ',;:!?') or '۔' in v]
check('no Latin punctuation or Urdu full stop inside prose', not latin_punct, str(latin_punct[:3]))
danda_list = [(k, v) for k, v in V3.items() if '\u0964' in v]
check('no Devanagari danda (Hindi punctuation)', not danda_list, str(danda_list[:3]))

# -------------------------------------------------------------- agreement sweep
# Urdu past forms agree with the OBJECT when the subject is ergative; progressive
# forms agree with the covert SUBJECT. Collect the settled/running ending of each
# pair so a lone disagreement is visible.
settled_end, running_end = {}, {}
for k, v in V3.items():
    leaf = k.split('.')[-1]
    obj = k.split('.')[-2]
    last = v.split()[-1]
    if leaf == 'settled':
        settled_end[obj] = last
    elif leaf == 'running':
        running_end[obj] = last
ends = {}
for obj, e in running_end.items():
    ends.setdefault(e, []).append(obj)
print('INFO  running-form final tokens:', {e: len(o) for e, o in ends.items()})
print('INFO  settled forms not ending in a past-agreeing suffix:',
      {o: e for o, e in settled_end.items()
       if e not in {'کیا', 'کی', 'کیے', 'کیں', 'بنایا', 'بنائی', 'دیا', 'دی', 'دیے', 'لیا', 'لی', 'لیے',
                    'پڑھا', 'پڑھی', 'پڑھیں', 'لکھا', 'کھولا', 'کھولی', 'بھیجا', 'پوچھا', 'حاصل', 'روکا',
                    'ہٹایا', 'ہٹائی', 'بدلا', 'بدلی', 'جڑا', 'چھوڑا', 'وسوص', 'سونپا', 'دیکھا', 'دیکھی',
                    'دکھائی', 'دکھائے', 'دکھائیں', 'ارسال', 'تلاش', 'انتظار', 'لے', 'جاری', 'محفوظ',
                    'اپ ڈیٹ', 'ری سیٹ', 'حجم', 'نصب', 'منسوخ', 'شیڈول', 'ہم', 'آہنگ', 'بحال', 'شروع',
                    'تشخیص', 'تصویر', 'جھلک', 'نام', 'تبدیلی', 'کا', 'کی', 'درکار'} })

# ------------------------------------------------------------------- widths
try:
    from rich.cells import cell_len
    have_rich = True
except Exception as exc:                                    # pragma: no cover
    have_rich = False
    print('INFO  rich not importable:', exc)

if have_rich:
    en_len = {k: cell_len(c['en']) for k, c in CTX.items()}
    rows = sorted(((cell_len(v), k, v) for k, v in V3.items()), reverse=True)
    print(f"INFO  widest ur values (en max {max(en_len.values())}, ur max {rows[0][0]}):")
    for w, k, v in rows[:6]:
        print(f'        {w:3} cells  {k.split(".")[-2]}.{k.split(".")[-1]:14} {v}')
    over32 = [(w, k) for w, k, _ in rows if w > 32]
    check('no value exceeds the 32-cell mark for this narrow gutter', not over32, str(over32[:3]))
    delta = [('listed_network_peers.settled', V3['ui.chat.canonical.tool_row.verb.listed_network_peers.settled']),
             ('sent_keys.settled', V3['ui.chat.canonical.tool_row.verb.sent_keys.settled']),
             ('sent_keys.running', V3['ui.chat.canonical.tool_row.verb.sent_keys.running'])]
    print('INFO  delta key widths:')
    for name, v in delta:
        print(f'        {cell_len(v):3} cells  {name:28} {v}')

# --------------------------------------------------- shipped-catalogue state
shipped = os.path.join(SHIPPED, 'ur')
hit = 0
files = sorted(f for f in os.listdir(shipped) if f.endswith('.json'))
for f in files:
    d = json.load(open(os.path.join(shipped, f), encoding='utf-8'))
    hit += sum(1 for k in V3 if k in d)
print(f'INFO  shipped ur catalogue carries {hit} of the 182 keys '
      f'({len(files)} namespace files) — the namespace is unintegrated, so no repo gate validates these bytes')

print()
fails = [n for n, ok, _ in results if not ok]
print(f'SUMMARY {len(results) - len(fails)} PASS / {len(fails)} FAIL'
      + (f' — failing: {fails}' if fails else ''))
print('HASHES '
      f"v3={sha256(os.path.join(PREP, 'ur.v3.json'))[:16]} "
      f"keys={sha256(os.path.join(PREP, 'keys.json'))[:16]} "
      f"v2={sha256(os.path.join(PREP, 'ur.v2.json'))[:16]}")
sys.exit(0)
