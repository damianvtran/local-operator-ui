#!/usr/bin/env python3
"""L1 tool-row verbs (fr, pass A) — mechanical checks.

Read-only. Proves, against the en source and the prep translation, that:
  * the key set and its ORDER equal the English side;
  * no value is empty, padded or non-string;
  * no placeholder / markup token exists on either side (this slice has none);
  * no control or bidi-format character was introduced;
  * French typography: U+2019 apostrophe, no ASCII quotes, no trailing
    punctuation, no double spaces;
  * no value is English-identical;
  * no two keys render identically while their English differs (collision check);
  * verb-cell width: absolute cell count, en->fr ratio, and word count.

Usage: python3 checks.py --prep <_l1-prep dir> --repo <worktree root>
"""
import argparse, collections, json, re, statistics, sys, unicodedata


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prep", required=True, help="_l1-prep directory")
    ap.add_argument("--repo", required=True, help="local-operator-ui worktree root")
    a = ap.parse_args()

    keys = json.load(open(f"{a.prep}/keys.json"))
    fr = json.load(open(f"{a.prep}/fr.json"))
    en_path = f"{a.repo}/src/i18n/catalogues/en/ui.chat.canonical.json"
    en_cat = json.load(open(en_path))

    print(f"keys.json keys: {len(keys)} | fr.json keys: {len(fr)}")
    print(f"key set equal: {set(keys) == set(fr)} | order equal: {list(keys) == list(fr)}")
    en = {k: v["en"] for k, v in keys.items()}
    print(f"keys.json 'en' values equal to the en catalogue on disk: "
          f"{all(en_cat.get(k) == v for k, v in en.items())}")

    print("empty/blank values:", [k for k, v in fr.items() if not v.strip()])
    print("non-string values:", [k for k, v in fr.items() if not isinstance(v, str)])
    print("padded values:", [(k, v) for k, v in fr.items() if v != v.strip()])
    print("double spaces:", [(k, v) for k, v in fr.items() if "  " in v])

    ph = re.compile(r"\{[^}]*\}|%[sd]|\$\{|<[A-Za-z/][^>]*>")
    print("placeholder/markup tokens in fr:", [k for k, v in fr.items() if ph.search(v)])
    print("placeholder/markup tokens in en:", [k for k, v in en.items() if ph.search(v)])

    bad = [(k, repr(v)) for k, v in fr.items()
           if any(unicodedata.category(c) in ("Cc", "Cf", "Zl", "Zp") for c in v)]
    print("control/bidi-format characters:", bad)
    print("ASCII apostrophe:", [k for k, v in fr.items() if "'" in v])
    print('ASCII double quote:', [k for k, v in fr.items() if '"' in v])
    print("backtick in value:", [k for k, v in fr.items() if "`" in v])
    print("trailing punctuation:", [(k, v) for k, v in fr.items() if v.rstrip()[-1] in ".:;!?"])
    print("colon/spacing-in-note chars present:",
          [(k, v) for k, v in fr.items() if ":" in v or "\u202f" in v])

    same = [k for k, v in fr.items() if v.strip().lower() == en[k].strip().lower()]
    print("English-identical values:", [(k, fr[k]) for k in same])

    by_fr = collections.defaultdict(list)
    for k, v in fr.items():
        by_fr[v.strip()].append(k)
    print("identical fr values shared by >1 key (English differs?):")
    for v, ks in by_fr.items():
        if len(ks) > 1:
            print("  ", repr(v))
            for k in ks:
                print("     ", k, "<=", repr(en[k]), "| en distinct:", len({en[x] for x in ks}) > 1)

    latin = "éèêëàâäîïôöùûüçÉÈÊËÀÂÄÎÏÔÖÙÛÜÇ’«»…—"
    weird = sorted({(hex(ord(c)), k) for k, v in fr.items() for c in v
                    if ord(c) > 127 and c not in latin})
    print("unexpected non-ASCII characters:", weird)

    rows = []
    for k in keys:
        if k.endswith(".settled"):
            op = k.split(".")[-2]
            rk = k[: -len("settled")] + "running"
            rows.append((op, en[k], en[rk], fr[k], fr[rk]))
    ratios = [len(s) / len(e) for _, e, _, s, _ in rows]
    flat = [(op, state, v) for op, es, er, ss, sr in rows for state, v in (("settled", ss), ("running", sr))]
    four = [(op, state, v) for op, state, v in flat if len(v.split()) == 4]
    over5 = [(op, state, v) for op, state, v in flat if len(v.split()) > 4]
    wide = [(op, state, len(v), v) for op, state, v in flat if len(v) > 26]
    print(f"pairs: {len(rows)} | max cells {max(len(v) for _,_,v in flat)} "
          f"| median en->fr ratio (settled) {round(statistics.median(ratios), 3)}")
    print(f"values >4 words: {over5} | values at exactly 4 words: {len(four)}")
    print("values >26 cells:", sorted(wide, key=lambda x: -x[2]))
    print("settled values NOT starting with 'A ':", sum(1 for _,_,_,s,_ in rows if not s.startswith("A ")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
