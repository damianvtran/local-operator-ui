# Independent delta audit — `es` — slice L2 (file sizes, chat tool row) — round 2

- **Auditor:** `i18n-auditor` (subagent, team `lopdev`), session `3fcd4635c3cc`,
  **actual served model `deepseek/deepseek-flash`** (harness session header; no
  provider fallback used or declared for this run).
- **Independent of the translator:** yes. Translations authored by
  `i18n-translator`, session `d489baef5da9`, served model `openai/gpt-6.1-sol`.
  This auditor did not translate, cannot edit, and used no translation/MT
  service and no back-translation.
- **Date:** 2026-11-11. **Head:** `479c2673fab` on `feat/i18n-l2-file-sizes`
  (worktree `~/local-operator-ui/.worktrees/i18n-l2-file-sizes`).
- **Keys audited (2 of 2 in the group, no sampling):**
  `ui.chat.canonical.tool.never_sent_composed`,
  `ui.chat.canonical.tool.never_sent_empty`.
- **Audited pair:** `~/local-operator-ui/.worktrees/_l2-prep/es.v2.json`
  sha256 `ed6a86779fa26d6678f4b1d7622fde385dd2994085909c2b0aed2219eccf531b`
  (supersedes the audited-then-revised `es.json`
  `8b2dd7bcb015b2301adf0da0fb539c87d27397e17253098fe61fa3c5be75cc64`).
- **Inputs:** en + context sidecar `_l2-prep/keys.json` (sha256 `a8cd6e7d8adbc43a55bf2b812ba32eafa9f32931830e45f84b12d8ceb60ec71b`); en
  catalogue `27ae7327…`, en context catalogue `c0aff0d8…`; shipped es copy
  `7735932b…`; revision note `_l2-prep/es.v2-changes.md` `3906b667…`; style
  guide `~/local-operator/i18n/style-guides/es.md` `77b92272…`; glossary
  `~/local-operator/i18n/glossary.md` `0eb34437…`.

## Verdict

**clean-with-findings** — counts `{blocker: 0, major: 0, minor: 0, nit: 1}`.
Ledger status for this pair: **`passed`** (no BLOCKER or MAJOR remains).

The F1 fix works, and it works for the right reason: `redactado:` is now a label
on the written content, so no participle ever agrees with the displayed quantity,
and the line is grammatical for **every** value the formatter can produce. The
colon form is also the shorter of the two candidates the round-1 audit offered
(33 cells against 42), so it fits the one-row status line better than the audit's
own suggestion. The pair is shippable as written; the single NIT requests no change.

## Findings

### N1 — NIT — `ui.chat.canonical.tool.never_sent_composed` (+ sibling)

- Current: `nunca enviado · redactado: {size}` / `nunca enviado · nada redactado`
- Problem: both are correct Spanish and the pair is parallel, but `redactado` is
  the heavier verb — in Spanish `redactar` is what you do to a document, a report,
  a contract; the thing being measured here is a machine-composed JSON argument
  payload. `escrito` is the plainer word for "written" and is 2 cells shorter in
  both halves (`nunca enviado · escrito: 1,5 MB`, `nunca enviado · nada escrito`),
  which is worth something on a line that truncates.
- Suggested: `nunca enviado · escrito: {size}` + `nunca enviado · nada escrito`.
- **No change required.** `redactado` is defensible (the source note defines
  *composed* as "written by the model", and `redactar un mensaje` is ordinary
  Spanish), the translator recorded the reasoning, and the shorter alternative
  is a preference, not a defect. Recorded so the choice stays deliberate.

## Round-1 findings re-checked

**F1 (`{size} redactados` agreement) — FIXED, and fixed correctly.**
Measured against the shipped ladder (`src/i18n/format.ts` `formatBytes`: SI 1000,
`maximumFractionDigits` 1 below 10 else 0; es CLDR narrow unit label; replayed in
node v24.22.1 — audit.log §2), the reachable renderings are:

| bytes | rendered (es) | v2 line | v1 line (round 1) |
|---|---|---|---|
| 1 | `1 B` | `nunca enviado · redactado: 1 B` | `… 1 B redactados` |
| 340 | `340 B` | `nunca enviado · redactado: 340 B` | `… 340 B redactados` |
| 1000–1049 | `1 kB` | `nunca enviado · redactado: 1 kB` | `… 1 kB redactados` ← the defect |
| 1100 | `1,1 kB` | `nunca enviado · redactado: 1,1 kB` | `… 1,1 kB redactados` |
| 1 500 000 | `1,5 MB` | `nunca enviado · redactado: 1,5 MB` | `… 1,5 MB redactados` |

Two corrections to the round-1 framing, both from running the code rather than
assuming it:

- The example `12,4 kB` in the brief is **not** produced by this ladder:
  `digits = value < 10 ? 1 : 0` means 12 400 bytes renders `12 kB` — above 10 the
  ladder prints whole units, so a one-decimal `12,4 kB` cannot come out of it.
  Decimal-comma values do occur, just one scale lower (`1,1 kB`, `1,5 MB`), and
  they read correctly in v2.
- `0 B` is **unreachable** in this key: the call site
  (`canonical-transcript.tsx:2320`) branches on `record.argumentBytes` truthiness,
  so zero bytes takes `never_sent_empty`. The pair covers the empty case by
  design instead of printing a measurement it does not have — v2 preserves that.

Because the participle is a label in v2, it is grammatical for values that do not
yet exist as well as these: nothing in the string refers to a number's gender or
number.

**F2 (`nada redactado`) — retained, auditor agrees.** The translator's reason is
sound: `sin redactar` reads as an unfinished draft, which is the opposite of the
terminal state this line records; `sin texto redactado` costs length for no
clarity. With F1 fixed, `nada redactado` is also the natural partner of
`redactado: …` — both halves name the same thing.

**F3 (`nunca enviado`) — retained, auditor agrees.** `no enviado` / `sin enviar`
would blur "never reached a tool" into "not sent yet", which the en sidecar
explicitly separates. The masculine-singular participle is the shipped fragment
register of this namespace (`rechazado · {code}`, `falló · {code}`,
`No entregado`, `interrumpido`, `completado`), so the form is consistent.

## Idiom, register and terminology

- **Colon label with a bare participle** is established Spanish UI usage for a
  measured state (`Descargado: 340 MB`, `Usado: 2,4 GB`), and this namespace
  already ships the same shape: `Origen: {name}`, `Modelo: {name}`,
  `Intentos: {count, number, ::group-off}`, `Diff truncado: # líneas…`. The
  colon is therefore a convention here, not a new invention.
- **Spacing** follows the es guide ("no space before `:`"): no space before the
  colon, one after — verified mechanically.
- **Middle-dot style** is preserved: exactly one U+00B7, single spaces either
  side, lowercase after the separator, matching the shipped `falló · {code}` /
  `rechazado · {code}` and the en "terse lower-case status line".
- **Parallel wording** holds: the shared anchor is `redactado`, with the measured
  case as label+value and the empty case as a quantified phrase. That mirrors the
  en pair's own asymmetry (`{size} composed` / `nothing composed`) rather than
  fighting it.
- **Terminology / glossary:** no §2 term appears in either string; no kept-English
  token; `B / kB / MB / GB` are CLDR `Intl` unit labels (es keeps the
  international symbol per the `_no_unit_keys` note), so they are not English
  residue. No glossary proposal needed.
- **Operator acceptance ("no English after switching to es"):** both lines are
  fully Spanish; the size text is locale-rendered by code (comma decimal, es unit
  labels) and inserted verbatim.
- **Register:** terse, lowercase, no trailing stop, no `¡`/`¿` (neither is a
  question/exclamation) — matches the guide's fragment rules.

## Fit (width)

Cells by `rich.cells` semantics (wide glyphs = 2; `{size}` counted as 6):

| | en | es | growth |
|---|---|---|---|
| composed template | 28 | 33 | +17.9 % |
| composed rendered (`1,5 MB`) | 28 | 33 | +17.9 % |
| empty template | 29 | 30 | +3.4 % |
| (audit-F1 alternative `{size} de texto redactado`) | 29 | 42 | +44.8 % |

Inside the guide's 15–25 % es growth envelope; the sidecar carries **no**
`maxCells`/`maxChars` (checked in both `keys.json` and the en
`.context.json`), only the prose hint that the row truncates with an ellipsis.

Truncation trade-off, measured rather than assumed: the summary cell is
`min-w-0 truncate` in `components/trace/tool-row.tsx`, so clipping happens at the
end of the string. v2 moves the measured quantity to the last position, which
means a clipped row shows `nunca enviado · redactado: …` and loses the number —
whereas the longer alternative would clip sooner but keep the number visible. I
endorse the chosen form anyway: it is 9 cells shorter (so it clips later, and
often not at all), the label alone still carries the state, and the row expands
for the detail. Recorded, not raised.

## RTL

N/A for `es`.

## Second independent pass

Performed on both keys after the mechanical pass: participle agreement re-derived
against every reachable value, the label:value idiom checked against shipped es
patterns in the same namespace, pair parallelism re-read as a pair, truncation
order traced into `tool-row.tsx`, and the call site re-read to confirm which key
each state takes. It moved F1 from "probably fixed" to "fixed and proven" and
produced no additional finding beyond N1.

## Mechanical verification (all passed)

| Check | Result |
|---|---|
| JSON valid, UTF-8, no BOM, newline-terminated | PASS (both files) |
| Key set identical to source (2/2), nothing added/dropped | PASS |
| `{size}` exactly once in `never_sent_composed`; absent in `never_sent_empty`; names/types identical to en (`{ size: string }` in `keys.gen.ts`) | PASS |
| ICU plural/select structure | none present; neither key needs one, so no CLDR category obligation |
| Markup / Rich tags / backticks / commands / flags / identifiers | none in source, none added |
| Middle dot: exactly one U+00B7 per value, spaces either side, no ASCII `.` separator | PASS |
| Whitespace: no leading/trailing, no NBSP/zero-width/bidi controls, NFC | PASS |
| Punctuation: no trailing stop, lowercase initial, no space before `:`, one space after | PASS |
| English-identical values / empty values | none |
| Width | see table above; no numeric budget in the sidecar |
| Locale-wide gates in the worktree (read-only): `context-parity` ok (129 allowed gaps), `check-duplicates` ok (1428 files, 0 duplicates) | PASS |
| `ledger-check` | red **only** in the wave's in-flight state (en source has the two new keys, no locale catalogue has them yet) — not a finding of this audit |

## Commands actually run

Full captured stdout/stderr of the executed commands is in
`i18n/audits/evidence/es/ui.chat.canonical/l2-a2-es-3fcd4635c3cc/audit.log`
(provenance, hashes, node size proof, python3 mechanical run, repo gates, ledger
probe). Summary:

```
# inputs, hashes, revision note, values
shasum -a 256 <en catalogue / en context / es catalogue / keys.json / es.json / es.v2.json / es.v2-changes.md / es.md / glossary.md>
cat _l2-prep/es.v2.json _l2-prep/es.v2-changes.md _l2-prep/keys.json

# rendered-size proof: shipped formatBytes ladder replayed for es
node -e '<SI ladder + Intl narrow unit label + es separator>'

# mechanical checks (python3, over both keys): key set, placeholder multiset,
# ICU scan, braces, markup, U+00B7 count/spacing, controls/NBSP/bidi, NFC,
# trailing punctuation, colon spacing, cells, en-identical, JSON hygiene
python3 $LOCAL_OPERATOR_SCRATCHPAD/mechanical-es-l2.py    # -> mechanical.json

# repo gates (read-only)
node scripts/i18n/context-parity.mjs
node scripts/i18n/check-duplicates.mjs
node scripts/i18n/ledger-check.mjs

# audit-ledger recording attempt (expected refusal; ledger bytes unchanged)
node scripts/i18n/ledger-assemble.mjs --locale es --file src/i18n/catalogues/es/ui.chat.canonical.json \
  --auditor-instance 3fcd4635c3cc --auditor-model deepseek/deepseek-flash --result clean-with-findings \
  --receipt i18n/audits/evidence/es/ui.chat.canonical/l2-a2-es-3fcd4635c3cc/receipt.json \
  --translator-agent i18n-translator --translator-model openai/gpt-6.1-sol
  -> ledger-assemble: refused - es/ui.chat.canonical is not key-complete against English
     (2 missing, 0 extra) - an incomplete locale cannot be recorded   [exit 2]
shasum -a 256 i18n/ledger.json   # 8f3c573b… before and after — no row written
```

## Ledger recording

`ledger-assemble.mjs` cannot write the row today: it derives `target_sha256` from
the catalogue on disk and refuses an incomplete locale, and the es catalogue has
258 keys against en's 260. The probe refused (exit 2, verbatim in audit.log §5),
ledger bytes unchanged. At landing, run the same command against the catalogue
that carries the values, and first check the two values against
`receipt.key_values_sha256` — a mismatch means the audited bytes are not the
landed bytes. Full record, artifact hashes and the exact landing command:
`i18n/audits/evidence/es/ui.chat.canonical/l2-a2-es-3fcd4635c3cc/record.json`.

## Out-of-scope observation (reported, not a finding)

`canonical-transcript.tsx:2326` and `:2331` (HEAD `479c2673fab`) still return
hardcoded English template strings `composing${…}` and `queued${…}` from the same
`toolRecordSummary` function that now keys this pair — so the same tool row renders
localized size text beside an English status word. Pre-existing at base
`fd3e8eb757e` (verified by `git show`), so it is not part of this pair and cannot
be fixed by editing es: it needs two new keys and a code change. Flagged because
the operator acceptance is "no English anywhere after switching to es", and this
surface is the one the wave touches.

## Artifacts

Tracked evidence root (this worktree, not yet committed):
`i18n/audits/evidence/es/ui.chat.canonical/l2-a2-es-3fcd4635c3cc/`
— `record.json`, `audit.log`, `mechanical.json`, `receipt.json`.

Inputs hashed in `record.json`; `mechanical.json` carries per-key value hashes
(`…composed` `faf93734…`, `…empty` `53c2092c…`) and the full check table.
