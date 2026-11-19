# Union audit — `ur` / `ui.chat` — report

* **Audit id:** `union-ur-20261028-fc773f54ac28`
* **Locale / namespace:** `ur` (RTL) / `ui.chat` (one catalogue, 142 keys)
* **Target bytes:** PR #1449, branch `i18n-wave-a`, head `c5e19ecec883b45e281d696f06dac86bcb0d90f3`
  (merge of `e5f7c8daeaf3` with `origin/main` `1d631be71fb7`)
* **Audit date:** 2026-10-28
* **Auditor:** `i18n-auditor`, session `fc773f54ac28`, route `radient/auto` (no fallback, no model switch, no session incident — see `record.json`)
* **Verdict:** **passed** — `clean-with-findings`, 0 blocker, 0 major, 1 minor, 0 nit

## Why this audit exists

Wave A (18 keys: `checkpoint.*`, `header_identity.*`, `region.*`) and wave B (9 keys:
`session_status.*`) were each audited on their own whole-file bytes and both passed
(receipts `59ea19dc68ac` and `c89cee263ac2`). The union file the merge produces has never
been read as a whole, so `node scripts/i18n/ledger-check.mjs` fails its row for stale
hashes. This audit binds the union bytes and asks the question the two separate passes
could not: does the merge of the two deltas hold together as one Urdu text.

## What was audited

A **delta audit over unchanged-by-proof bytes** plus a whole-file consistency read:

1. **Delta proof (parsed JSON and raw lines).** Union = 142 keys = 115 base + 18 wave A +
   9 wave B, with zero shared key names. Every value is byte-identical to the earlier
   audit that read it: the 18 wave-A keys against `80ee119bbd` (the bytes receipt
   `59ea19dc68ac` bound), the 9 wave-B keys against `a5356ce91c` = `1d631be71f` (the bytes
   receipt `c89cee263ac2` bound), and all 115 base keys against both `81f286ee5c`
   (pre-wave) and `origin/main`. A line-level check re-read the raw JSON text of all 142
   keys: **0 value mismatches, 0 raw-text mismatches** (8 lines differ only by the JSON
   member separator — each is the *last* member of its old snapshot file, which carries no
   trailing comma). Key order in the union is exactly `origin/main`'s 124 keys followed by
   wave A's 18, so the merge moved no base line; en and ur key sets and order are
   identical to each other.
2. **Whole-file read** of all 142 keys — mechanical gates, then accuracy, idiom, register,
   terminology, fit and Urdu typography/RTL, with a second pass over the error, approval,
   secret and session-status copy read from the Urdu alone.
3. **Cross-wave consistency** between the A family (`region.conversation` vs
   `region.composer`, `checkpoint.*`, `header_identity.*`) and the B family
   (`session_status.*`): term, register and terminal-stop collisions.

## Gates run (actual, in the read-only `git archive` export of `c5e19ecec8`)

| Gate | Result |
|---|---|
| `node scripts/i18n/ledger-check.mjs` | **fails exactly 7 rows / 21 findings**, all `*/ui.chat` stale-source + stale-target + receipt-vs-bytes. Expected: the union bytes have no receipt yet. This audit is the missing `ur` one. |
| `node scripts/i18n/generate.mjs --check` | `src/i18n/keys.gen.ts is byte-identical to a fresh generation` |
| `node scripts/i18n/context-parity.mjs` | `ok` — every English key covered apart from 131 allowed gaps in 4 namespaces; all 27 wave keys carry a sidecar entry |
| `node scripts/i18n/check-coverage.mjs` | `ok` — 7 gated languages over 99 namespaces; 0 allowed keys remain |
| `node --test scripts/i18n/locale-parity.test.mjs` | 44/44 pass (ur included: every key, no unknown key, placeholder parity, not an English stub) |
| `node --test scripts/i18n/ur-activation.test.mjs` | 3/3 pass, including *the bundled Urdu catalogue carries no manual bidi controls or forbidden script* |
| `node scripts/i18n/check-duplicates.mjs` | `ok` — 889 files, 0 duplicate keys (the merge hazard specifically) |
| Independent mechanical sweep (this audit, `@formatjs/icu-messageformat-parser` + `intl-messageformat`) | 142/142 keys parsed; **158 real renders**; 0 render failures; 0 arg/type diffs. One typography item flagged — the ASCII ellipsis that mirrors the English source (UUR-O3) — and nothing else. |
| RTL/bidi reordering (GNU FriBidi 1.0.16 run analysis over the 158 rendered strings) | 0 catalogue defects; 2 argument-boundary hazards recorded as observations |

Mechanical detail: placeholder name/type parity for all 142 keys (arg-shape equality),
ICU select/plural block parity vs `en` (0 diffs), `ur` plural categories limited to
`one`/`other` with `other` present everywhere, no markup/tag drift, no backtick/code/flag
drift, NFC on every value, no bidi controls or zero-width characters, no NBSP, no stray
whitespace (the one intentional trailing space in `question_dock.hint.prefix` survives),
no key added or dropped, valid JSON, terminal-stop parity 0 mismatches, no `!`, no ASCII
prose comma or period.

## Renders (real `intl-messageformat`, locale `ur`)

```
ui.chat.composer.status.loop_progress_turns {"count":1} => "1 باری"
ui.chat.composer.status.loop_progress_turns {"count":2} => "2 باریاں"
ui.chat.composer.status.loop_progress_of_turns {"completed":1,"total":10} => "10 میں سے 1 باریاں"   <- UUR-1
ui.chat.checkpoint.turn {"turn":3,"total":7} => "7 میں سے باری 3"
ui.chat.checkpoint.jump_user {"turn":3,"total":7,"clock":"15:42"} => "15:42، 7 میں سے باری 3 میں آپ کے پیغام پر جائیں"
ui.chat.header_identity.loading {"kind":"teams"} => "ٹیمیں لوڈ ہو رہی ہیں…"
ui.chat.hub_update.update_all {"count":1234} => "سب اپ ڈیٹ کریں (1234)"
ui.chat.hub_update.update_all_label {"kind":"agents","count":3} => "ہب سے 3 ایجنٹوں کی اپ ڈیٹس سب اپ ڈیٹ کریں"
ui.chat.question_dock.hint.prefix {"index":2,"total":5} => "5 میں سے سوال 2۔ "
ui.chat.provider_error.headline.out_of_credits {"status":" (HTTP 402)","body":"Top up to continue."} => "کریڈٹس ختم (HTTP 402): Top up to continue."
ui.chat.session_status.not_signed_in {"label":"Radient"} => "Radient میں سائن ان نہیں ہے"
ui.chat.session_status.not_signed_in_description {"label":"Radient"} => "یہ سیشن Radient کو کام کرنے والے سائن ان کے بغیر چلا رہا ہے، اس لیے جب تک آپ اسے منسلک نہیں کرتے، یہ جواب نہیں دے سکتا۔"
```

`::group-off` is honoured (`1234`, not `1,234`) and `::number` grouping elsewhere renders
`1,234,567`, as the formatter decides. Urdu plural categories resolve `1 -> one`,
`0` and `2+ -> other`, which is the locale's CLDR rule and matches the file's two arms.

## Findings

### UUR-1 — MINOR — `ui.chat.composer.status.loop_progress_of_turns`

* Source: `{completed, number, ::group-off} of {total, number, ::group-off} turns`
* Current: `{total, number, ::group-off} میں سے {completed, number, ::group-off} باریاں`
* Problem: the counted noun is fixed as the plural **باریاں**, but Urdu agrees a counted
  noun with the number in front of it — `1 باری`, `2 باریاں`. The chip prints the noun
  straight after `{completed}`, so the first completed turn of any running loop reads
  **«10 میں سے 1 باریاں»** (a real render, not an inference from the template). English
  stays correct at every value because its noun agrees with *of {total}*. The English
  argument is a `number` and `locale-parity` pins the type, so a plural arm cannot be
  added here — the fix is a wording that never puts a count-noun plural straight after a
  small number. Meaning is never in doubt and nothing unsafe follows, so this is minor,
  not major.
* Suggested: `{total, number, ::group-off} میں سے باری {completed, number, ::group-off}` —
  the classifier form the same file already uses in `ui.chat.checkpoint.turn` and
  `checkpoint.jump_*` (*باری {turn}*), grammatical at every count and still carrying both
  numbers. Alternative if the count noun must stay: `{total, number} باریوں میں سے
  {completed, number}`, which agrees with the total instead (correct for the `total >= 2`
  a running loop reaches).
* Where it appears: the loop chip's progress clause, built by `loopProgress()` in
  `src/renderer/src/features/chat/components/composer-status-row.tsx:1108-1117`.

No blocker, no major, no nit.

## Observations (not findings)

* **UUR-O1 — `{digits}` range flips under RTL.** `question_dock.hint.options` builds
  `digits = "1-3"` (`question-dock.tsx:225-227`) and interpolates it. Under `dir="rtl"` the
  hyphen is a neutral between two numbers, takes the paragraph direction and splits the
  range: FriBidi renders `Enter یا 1-3 جواب دیتا ہے` as `… ﺏﺍﻮﺟ 3-1 ﺎﯾ Enter`, i.e. the reader
  sees **3-1**. The Urdu text is a faithful rendering of the English and there is no
  catalogue wording that avoids it; the fix belongs at the call site with FSI/PDI around
  the value, which the repo already does for exactly this reason in
  `hub-skills-library.tsx:631`. Reported for the renderer lane; it does not change this
  catalogue's verdict.
* **UUR-O2 — pass-through `{body}`'s final period lands at the far left.**
  `provider_error.headline.out_of_credits` ends with the provider's own English sentence;
  its trailing neutral `.` (level 1) is placed at visual index 0, so the line shows
  `.Top up to continue :(HTTP 402) کریڈٹس ختم`. Cosmetic, argument-boundary, identical in
  every locale that passes an LTR body through RTL text; same call-site remedy as O1.
* **UUR-O3 — the one ASCII ellipsis mirrors the source.** `mermaid.loading` uses `...`
  where the file's other four ellipsis values use `…` — and the English source uses `...`
  there too. Faithful copy, not a translation slip; change the English source if the
  programme wants one convention.
* **UUR-O4 — vocabulary checks out against the corpus.** `راز` for *secret* is house style
  (4 ur files: راز کا خانہ, راز کی درخواست), so `secret_answer_label` and `secret_value_label`
  are consistent. `جابز` for *job* appears in 3 ur files, but the core glossary's ur cell is
  `—` and its footnote 6 says the wave that translates it records the endorsed rendering —
  `style-guides/ur.md` records no `job` call. Documentation gap for the glossary/guide
  owners, not a defect here. `حصہ` for a settings section matches the corpus (`سیکشن`
  appears in no ur file).
* **UUR-O5 — kept-English literals are the words the UI uses.** `yes/no/1/2` stay Latin
  because a typed approval answer resolves through the shipped English lists;
  `Approve/Deny` are `APPROVAL_OPTIONS`' own labels (`approval-words.ts:49-50`) printed on
  the buttons; `Enter/Esc/Up/Down` are keys. `فائل کا راستہ نقل کریں` quoted inside
  `highlights.file_resolution_failed` is byte-identical to the real control label
  `ui.common.file_actions.copy_file_path`.
* **UUR-O6 — no English fallback, no exemption needed.** 0 of 142 values equal their
  English source; `چیٹ` and `خام` are Urdu-script renderings, so unlike `es` this file needs
  no `locale-parity` identical-value exemption.

## Register, terminology, typography, RTL

* Formality: **آپ** throughout; no `تم`/`تو` as address (the two `تو` hits are the
  conjunction in «اگر … نہیں ہے تو …»). Respectful imperatives for controls
  (`منتخب کریں`, `ہٹائیں`, `کھولیں`, `بدلیں`, `مقرر کریں`, `بڑھائیں`, `گھٹائیں`, `گھسیٹیں`);
  `براہ کرم` exactly where the English says *Please* (one key); no `!` anywhere.
* Terminology concordance over the whole file is 1:1 for every repeated term: session→سیشن
  (5/5), agent→ایجنٹ (14), team→ٹیم (8), model→ماڈل (15), turn→باری (9),
  conversation→گفتگو (8), composer→کمپوزر (3), message box→پیغام کا خانہ (2),
  job→جابز (1), wake→بیداری (1), monitor→نگرانی (1), goal→ہدف (7), loop→لوپ (3),
  transcript→ٹرانسکرپٹ (1), hub→ہب (2), raw→خام (1), skill→مہارت (3),
  approval→منظوری (1), context→کانٹیکسٹ (2), run details→رن کی تفصیلات (5),
  settings→ترتیبات (2), provider→فراہم کنندہ/فراہم کنندگان (7), secret→راز (4).
  The three "missing form" candidates the concordance script prints are the split
  before/after pairs, where the English term moved to the sibling key and reads correctly
  in the joined sentence (`error_block.provider/model.*`, `schema.after*`).
* Cross-wave: the wave-B `session_status` wording is identical to its base twins
  (`ماڈل منتخب کریں`, `وہ ماڈل منتخب کریں جس پر یہ گفتگو چلے گی` twice,
  `ابھی کوئی ماڈل متعین نہیں ہوا` twice, `ابھی کوئی پیمائش نہیں ہوئی۔ گفتگو چلنے کے ساتھ
  ساتھ ونڈو بھرتی جاتی ہے۔` twice); wave A's `checkpoint.*` uses the file's own `باری`
  classifier, consistent with the base loop chip. No term or register collision between
  the A and B families was found.
* Typography: Urdu `۔` full stop, `،` comma, `؛` semicolon, `“ ”` quotes, `·` separators;
  no Hindi danda, no straight quotes, no ASCII `...` beyond the source-mirrored one; colon
  used as in the source (`ہدف:`, `لوپ:`, `سوال:`, `آپ:`).
* RTL: storage is logical order; the file carries **no** manual bidi control character
  (the repo's own ur gate agrees). FriBidi run analysis over 158 rendered strings —
  327 runs, 142 LTR islands, 30 terminal stops, 5 bracketed strings — shows every LTR
  island contiguous and internally un-reversed, every run laid right-to-left in visual
  order, every terminal stop at visual index 0, and brackets mirrored. The two
  argument-boundary hazards above are the only bidi effects, and neither is in the
  catalogue text.

## Fit

Only two keys carry a width hint: `session_status.choose_model` 15 ≤ 18 cells,
`session_status.last_reading` 11 ≤ 16 (Arabic script ≈ 1 cell per character, combining
marks 0). No key overruns a hint. The shortest controls stay short (`ہٹائیں`, `مکمل`,
`دکھائیں`, `بھیجیں`, `چیٹ`, `خام`); the longest values are prose blocks
(`error_block.schema.after` 269 cells) which have a full-width column.

## Limitations

* Catalogue-level audit: it proves the strings, their ICU structure, their rendering and
  their bidi reordering. It does not render the Electron UI; visual proof for this change
  belongs to the design/QA lanes. No screenshot is claimed.
* The ur file at this head is `origin/main`'s 124 keys plus wave A's 18 appended (proved
  above), so the delta proof — not a fresh re-derivation — carries the base and wave-B
  keys. The whole-file mechanical and narrative checks were nonetheless re-run over all
  142 keys.
* No translation or MT service was used to compare or back-translate anything.

## Records

* receipt: `i18n/receipts/union-ur-20261028-fc773f54ac28.json`
* evidence: `i18n/audits/evidence/ur/ui.chat/union-ur-20261028-fc773f54ac28/`
  (`record.json`, this report, `audit.log`, `receipt.json`)
