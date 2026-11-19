# Round-2 (delta) audit — Urdu (`ur`), `ui.chat.canonical.tool_row.verb.*`

- **Auditor** `i18n-auditor` (team `lopdev`), session `3eb6db5381df`
- **Actual served model** `deepseek/deepseek-flash` (harness session header `Model: deepseek/deepseek-flash`; no fallback observed, no role or model pin applied)
- **Date** 2026-11-11 · **Round** 2 (delta) · **Locale** `ur` (RTL) · **Namespace** `ui.chat.canonical`
- **Independent** of the translator session `63cfb8a4238a`; I translated nothing, edited no catalogue, ledger, receipt, context sidecar or prep byte, and read no other round-2 report. No MT service, translation API, SDK or back-translation was used: the judgement is reading-based, and every count below was recomputed here.

Scope: the 76 keys the translator changed in `ur.v2.json`, the unchanged keys a changed
neighbour now contradicts, and a full mechanical pass over all 182 values. The 106
unchanged, already-approved keys were not re-audited for style.

## Verdict

**blocked** — `changes_requested` in ledger terms.

| | count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 1 |
| MINOR | 4 |
| NIT | 4 |

The remediation is **largely correct**: of the 76 revised values, 75 are accurate, idiomatic
and consistent, the systemic habitual-verb defect is genuinely gone, and every declined
finding's evidence survives re-verification except one cited count. What blocks `passed` is a
single value that the remediation itself introduced: `listed_network_peers.settled` is an
**imperative**, not a past status (`F-01`). One-key fix; nothing else here needs another
translation round.

## Findings

### MAJOR

**F-01 · `ui.chat.canonical.tool_row.verb.listed_network_peers.settled` — command register in a status column**
current `نیٹ ورک ڈیوائسز دکھائیں` ("Show network devices") · 4 words, 23 cells

- `دکھائیں` is the **آپ-form imperative**. In a bare verb gutter with no subject that is the
  default reading, and it is exactly the homograph class this remediation fixed elsewhere
  (`sent_keys.settled` `کلیدیں بھیجیں` → `کلیدیں بھیجی گئیں`, `UR-A8`). Both round-1 auditors
  called that class a defect; reintroducing it in the same column in the same round is not a
  style choice.
- The pair is also unparallel: the running sibling is a 3rd-person progressive
  (`نیٹ ورک ڈیوائسز دکھا رہا`), so settled and running now disagree in person as well as in
  tense — the one pair in the file that does.
- The `ur` guide's "commands use the polite imperative" rule covers *commands*; this slice is
  status text (`tone: past tense` in the en sidecar, `context.role: verb column of a finished
  tool row`). The translator's own v2 note says as much.
- Suggested: **`نیٹ ورک ڈیوائسز دکھائے`** (past, same verb root as the running form, 4 words,
  22 cells; matches the sibling `previewed_rename.settled` `… دکھائی`). Running sibling
  `نیٹ ورک ڈیوائسز دکھا رہا` stays as it is.
  - If the manager prefers the twelve-key `… کی فہرست بنائی` family instead, the measured cost
    is `نیٹ ورک ڈیوائسز کی فہرست بنائی` 30 cells / `… بنا رہا` 32 cells — at the brief's
    32-cell mark, which is why the shorter verb is the better fix.

### MINOR

**F-02 · `sent_keys.settled` / `.running` — voice switch inside an active column**
current `کلیدیں بھیجی گئیں` / `کلیدیں بھیجی جا رہیں` ("the keys were sent" / "are being sent")

The passive fixes the imperative homograph correctly, but it is the only passive in the
column (every sibling is active: `بھیجا`, `حذف کیا`, `روکا`) and it costs a word. Active
alternatives keep the fix and the register: `کلیدیں ارسال کیں` (16 cells) and
`کلیدیں ارسال کر رہا` (19 cells); `ارسال کیں` cannot be read as an imperative, which is the
whole reason the passive was introduced. Non-gating either way.

**F-03 · `searched_the_web.running` = `ویب پر تلاش جاری` — lone nominal status after 27 siblings became progressives (unchanged key, contradicted by changed neighbours)**

The brief's "unchanged key a changed neighbour now contradicts" case. In v1 this key was not
alone: 28 running values used the habitual/`جاری` shape. v2 converts 27 of them to genuine
progressives and leaves this one, so 90 running rows now end `رہا`/`رہیں` and this one does
not. Recommended for a later wave: `ویب پر تلاش کر رہا`, matching its own settled sibling
`تلاش کیا`. **Not gating**, because the shipped corpus supports the wording (see the
`UR-A10` adjudication): `ui.chat.canonical.tool_row.generic_verb.running` ships `کال جاری`,
and six shipped search indicators use `تلاش جاری ہے…`.

**F-04 · the wave's new term calls are not recorded in the guide/glossary**
`job → جاب / جابز`, `network peer → ڈیوائس`, `reset → ری سیٹ` (vs `بحال` restore/resume),
`update → اپ ڈیٹ` (vs `تازہ` refresh)

`i18n/glossary.md` §4: "New terms are added by the wave that first needs them", and footnote 6
is explicit that the `ur` job cell stays `—` "until their waves record endorsed renderings".
The v2 file lists these as *proposals*; the guide still carries none of them. Until
`i18n/style-guides/ur.md` records them, the next translator can legitimately land a second
word for the same concept — the exact failure the glossary exists to prevent. Record the four
calls (with the `اپ ڈیٹ`/`تازہ` and `ری سیٹ`/`بحال` distinctions) before the namespace ships.

**F-05 · width: 45 of 182 labels exceed the en sidecar's own "one to four words" guidance**
Accepted, with measurements, not waived silently.

The sidecar says "One to four words; the verb column is a narrow fixed-width gutter" for every
key in the slice. Measured here with `rich.cells.cell_len`: 36 five-word, 7 six-word, 2
seven-word labels; max **29 cells** (en max 23), so nothing reaches the brief's 32-cell mark,
and the shipped corpus already carries a **31-cell** running label
(`مشترکہ گفتگوؤں کی فہرست بنا رہا`). The longest two — `updated_todos.running`
`کاموں کی فہرست اپ ڈیٹ کر رہا` (7 split words, 6 lexical) and `updated_secure_input.running`
`محفوظ ان پٹ اپ ڈیٹ کر رہا` — cannot shorten without renaming the object or dropping `محفوظ`.
Since the gutter does not truncate, the residual risk is a wide gutter pushing the object, not
lost text: **QA/design should confirm in a rendered row** (widest case + a long path). If a
budget is later pinned, `اپ ڈیٹ` (one lexical item, two split words) is the honest unit to
count — `str.split()` overstates every one of these by one.

### NIT

- **F-06 · `listed_networks.*` = `نیٹ ورکس …`** — first `-س` plural of `نیٹ ورک` in the shipped
  `ur` catalogue (0 shipped occurrences; `پروجیکٹس` 13, `ڈیوائسز` 8, `جابز` 8 exist, so the
  pattern is legitimate). `نیٹ ورک کی فہرست بنائی` would match shipped usage; either reads fine.
- **F-07 · `UR-A5`/`m1` cites "as does glob already"** — I could not reproduce a glob row using
  `فہرست` in the shipped `ur` catalogue: glob has no key in this namespace, and `گلوب` appears
  only in three unrelated files. The substance (twelve `فہرست` list keys) is verified; the
  parenthetical is not.
- **F-08 · `n3` decline evidence is wrong** — `علامتوں, already used for symbols`: `علامت` has
  **0** occurrences in the shipped `ur` catalogue. The decision stands on native grounds
  (`علامت` is the standard Urdu word for symbol/sign, and the lsp context disambiguates), but
  the cited shipped usage does not exist.
- **F-09 · disposition table drift** — `UR-A10` says "retain … the revised
  `جابز کا انتظار جاری`", but v2's `waited_for_jobs.running` is `جابز کا انتظار کر رہا`. The
  prose describes a version that was not shipped; harmless, but the record should not describe
  bytes that do not exist.

## Adjudication of the nine declined findings

Counts re-run here over `src/i18n/catalogues/ur/*.json` (strings containing the term — the
translator's own method; my numbers reproduce theirs exactly).

| ID | Declined because | Re-verified here | Verdict |
|---|---|---|---|
| `UR-A5` | forcing `فہرست` on peers would need a 7-word label; twelve list ops use the family | 12 list keys use `فہرست` ✔; peers via `فہرست` measures 30/32 cells ✔ (so the width argument holds) — but the chosen `دکھائیں` is an imperative (`F-01`) | **Upheld** on uniformity/width; the register defect it left is a separate MAJOR |
| `UR-A10` | `جاری` is a natural running-status predicate; shipped `generic_verb.running` = `کال جاری` | `کال جاری` 1 shipped string ✔; `تلاش جاری` 6 shipped strings (`تلاش جاری ہے…`) ✔; the six are sentence-form indicators, not gutter verbs | **Upheld**; note the drift in `F-09` and the resulting lone status in `F-03` |
| `UR-A11` | the `browser` tool does more than open a page | The tool's action surface includes read/click/type/select/scroll/snapshot/screenshot ✔ — `براؤز کیا` is the honest generic | **Upheld** |
| `UR-A12` | `spawn` starts a runnable session, not a stored object; `سیشن شروع کیا` is already distinct from `بحال` | 9 shipped strings use `سیشن شروع` for starting a session ✔ | **Upheld** |
| `m1` | duplicate of `UR-A5` | as above ✔ | **Upheld** (same reasoning) |
| `n1` | `تعریف` means definition in this context; keep the native term | 9 shipped strings use `تعریف` for definition (`config.definitions`, `config_run_*`) ✔ | **Upheld** |
| `n2` | `کلیدیں` is the standard keyboard-key noun | 18 shipped strings use `کلیدیں` for keys ✔ | **Upheld** |
| `n3` | `علامتوں, already used for symbols` | 0 shipped occurrences of `علامت` — the evidence is wrong | **Upheld on the decision, evidence overturned** (`F-08`) |
| `n4` | network panic performs an emergency shutdown; a descriptive translation is right | 0 shipped occurrences of `ہنگامی` — no shipped precedent either way; every other op verb in this slice is translated, so translating `panic` is consistent ✔ | **Upheld** (no shipped-precedent claim to check) |

## The delta itself

76 keys changed; I read each against its `en` value, `context.role` and `notes`. Verified as
accurate and idiomatic:

- the 26 habitual→progressive conversions (`… فہرست دیتا`→`بنا رہا`, `… کرتا`→`کر رہا`,
  `… دیتا`→`دے رہا`): the defect is gone, and the pairs are now parallel in every case except
  `F-01`; agreement is right where it is visible (`ٹیم اپ ڈیٹ کی` f., `راز اپ ڈیٹ کیا` m.,
  `کاموں کی فہرست اپ ڈیٹ کی` f., `تعریف ڈھونڈ لی` f. / `حوالے ڈھونڈ لیے` m.pl.).
- `reset` vs `resume`: `ری سیٹ` (29 shipped) vs `بحال` (57 shipped, `resumed*`/`resumed_session`)
  is now one concept, one word, and the collision is removed.
- `job` vs `todos`: `جابز` (8 shipped) vs `کاموں کی فہرست` (5 shipped, incl.
  `fold.count.todo`), so the two concepts are no longer both `کاموں …`.
- `update` vs `refresh`: `اپ ڈیٹ` (395 shipped) replaces `تازہ` in update verbs while `تازہ`
  (58 shipped) stays for refresh — a real corpus distinction, not a coinage.
- `peers` → `ڈیوائسز` (8 shipped) drops the human `ساتھی`; `گنوانا` forms are gone (6 → 0).
- `هدایت دی/دے رہا` for steer, `تشخیص کی/کر رہا` for diagnose, `نام کی تبدیلی دکھائی/دکھا رہا`
  for rename-preview, `ڈھونڈ لی/رہا` for found: all concrete, none over-Persianised, none
  Hindi-ised; no `تم/تو`, no `!`, no `براہ کرم`, no padding honorifics.
- `linked_session_to`/`unlinked_session_from` = `سیشن پروجیکٹ سے جوڑا` / `… ہٹایا`: the relation
  is explicit (Urdu is postpositional, so the en note's "keep the trailing preposition" cannot
  be honoured literally) and the appended project id reads as apposition. Meaning preserved;
  the RTL composition is the one thing that needs rendered proof, and QA/design own that —
  not a wording finding.

## Mechanical pass (whole file, 182 values)

All PASS except the intentional F-01 assertion, executed in `audit.log`:

- 182 keys, set **and order** identical to `keys.json`; no key added or dropped.
- No placeholders and no ICU in this namespace (the en source contains no `{…}`), so CLDR
  category checks are N/A here; no braces in any `ur` value.
- No manual bidi controls or other control characters (U+061C, U+200B–200F, U+202A–202E,
  U+2066–2069, U+FEFF all absent); NFC-stable; no leading/trailing/double spaces.
- Latin/other characters limited to `Python` (the two `ran_python` rows); no English-identical
  values, so the operator's "no English in the interface" acceptance is met for this slice.
- No punctuation at all (labels), matching en.
- Shipped `ur` catalogue still has **0** of these 182 keys — the namespace is unintegrated, so
  no repo gate can validate it yet (see `audit.log`).

## Commands actually run (full output in `audit.log`)

| Command | Result |
|---|---|
| `python3` diff of `ur.json` vs `ur.v2.json` | 76 changed keys, listed |
| `~/local-operator/.venv/bin/python checks.py` | 19 PASS, 1 FAIL (the F-01 `دکھائیں` assertion), widths and shipped counts printed |
| `node scripts/i18n/context-parity.mjs` | exit 0 — "every English key is covered, apart from 129 allowed gap(s)" |
| `node scripts/i18n/generate.mjs --check` | exit 0 — `keys.gen.ts` byte-identical to a fresh generation |
| `node scripts/i18n/ledger-check.mjs` | exit 1 — 24 findings, incl. `ur/ui.chat.canonical: missing 182 key(s)` and stale `source_sha256` (ledger `38f767d0…`, file `a385671b…`); pre-existing staging state, not caused by this audit |
| `node scripts/i18n/ledger-assemble.mjs` (write attempt) | refused, exit 2 — see `audit.log`; the landed PR parents this receipt once the catalogue is key-complete |

## Not covered here (by design)

- Rendered appearance: no screenshot was taken. Width is measured, not rendered; the widest
  labels and the `linked_session_to` apposition need QA/design's real row.
- The 106 unchanged keys' style (already approved in round 1); only `searched_the_web.running`
  was revisited, as a contradiction candidate (`F-03`).
- Integration, ledger row and receipts: the catalogue does not yet carry the namespace, so a
  ledger write is impossible without fabricating it.
