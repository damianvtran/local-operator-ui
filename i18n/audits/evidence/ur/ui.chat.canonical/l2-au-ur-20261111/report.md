# Urdu (`ur`) audit — slice L2, file-size status lines

**Audit ID:** `l2-au-ur-20261111`
**Locale:** `ur` (RTL) · **Namespace:** `ui.chat.canonical` · **Keys:** 2
**Translator:** `openai/gpt-6.1-sol` (per the slice brief; I did not translate)
**Auditor:** `i18n-auditor`, session `fcba1aa9e0c1`, team `lopdev`
**Actual served model:** `deepseek/deepseek-flash` (session tail-anchor `selector = deepseek/deepseek-flash`, matching the harness-declared model; no fallback notice in this session)
**Date:** 2026-11-11

## Verdict: clean

| blocker | major | minor | nit |
|---|---|---|---|
| 0 | 0 | 0 | 1 |

No BLOCKER or MAJOR remains. The two strings are accurate, idiomatic, consistent with
the shipped Urdu chat catalogue, and mechanically sound: no English, exactly one
`{size}` in the first key, one U+00B7 separator each, no manual bidi controls.

## What I audited

| Key | en | ur |
|---|---|---|
| `ui.chat.canonical.tool.never_sent_composed` | `never sent · {size} composed` | `نہیں بھیجا گیا · {size} لکھا گیا` |
| `ui.chat.canonical.tool.never_sent_empty` | `never sent · nothing composed` | `نہیں بھیجا گیا · کچھ نہیں لکھا گیا` |

Read against: `keys.json` (en + context/notes), both style guides (`en.md`, `ur.md`),
`i18n/glossary.md`, the shipped `ur` catalogue for consistency, and the consuming code
(`canonical-transcript.tsx` `toolRecordSummary`, `src/i18n/bidi.ts`).

## 1. Mechanical — PASS

- **Key set** equals the source exactly: no keys added, dropped or renamed.
- **Placeholder:** `{size}` appears exactly once in `never_sent_composed` and not at
  all in `never_sent_empty`, matching the source (`placeholders: {}`); name and case
  identical, no renaming or reordering.
- **ICU:** both values parse with `@formatjs/icu-messageformat-parser`
  (`requiresOtherClause: true`); the first is `[literal, argument:size, literal]`,
  the second a single literal. No plural/select is involved, so no CLDR category set
  to check.
- **No ICU structure drift:** 1 `{` / 1 `}` in key 1, 0 in key 2.
- **JSON:** valid UTF-8, no BOM, LF endings, trailing newline, no duplicate keys.
- **Repo validator rules applied to the prep bytes** (`scripts/i18n/ur-activation.test.mjs`
  `MANUAL_BIDI` = U+200E/200F/2066–2069, `FORBIDDEN_SCRIPT` =
  `[\u0964\u0900-\u097f\u0643\u064a\u0629\u0649]`): both keys **false / false** — no
  manual bidi controls, no Devanagari, no danda, no Arabic-only yeh/kaf/teh-marbuta.
  The shipped-bundle hygiene test itself also passes on the current tree (3/3), which
  confirms the gate the values will meet on merge.
- **Script inventory** (codepoint-level): U+06CC Farsi yeh, U+06A9 keheh, U+06C1 heh
  goal, U+06BE heh doachashmee, U+06AF gaf, U+0686 tcheh — correct Urdu orthography
  throughout ("نہیں", "بھیجا", "لکھا", "کچھ"). No Arabic-variant letters, no tatweel,
  no non-UTF-8 spaces (only U+0020).
- **Nothing English-identical:** neither value equals its English source (no
  untranslated carry-over).

## 2. Accuracy — PASS

- *never sent* → **نہیں بھیجا گیا** ("was not sent"): correctly reports that the call
  never reached a tool. It does not overclaim a failure and does not name a sender —
  which matches the context note ("the harness refused it or the turn ended first").
  "بھیجا" (sent) is the right verb choice here precisely because the catalogue keeps
  "پہنچا دیا گیا" for *delivered* (`send_failure.late_delivery`), so the sent/delivered
  distinction the English draws survives.
- *composed* → **لکھا گیا** ("was written"): the amount of the request the model had
  written, not music and not "prepared". Agentless passive mirrors the English, which
  also does not name the writer.
- *nothing composed* → **کچھ نہیں لکھا گیا** ("nothing was written"): complete
  negation, no polarity inversion, no addition. Not rendered as `0 B`, which the call
  site explicitly avoids (it would claim a measurement).
- No omission, no addition, no scope shift; both are safe for a status line (nothing
  destructive or permission-bearing to mistranslate).

## 3. Idiom and register — PASS

- Terse fragment, no trailing punctuation, no exclamation — matches the en tone
  contract and the `ur` guide ("terse; natural Urdu").
- No address form is needed (the user is not being asked to act), so the آپ rule is
  not engaged and the copy does not slip into تم/تو.
- Language is everyday educated Urdu: no Hindi-ised forms, no over-Persianising
  (`لکھا گیا` is the ordinary verb, not a literary substitute).
- **Parallelism of the pair is exact**: both open with the same `نہیں بھیجا گیا ·`
  status, both close on `لکھا گیا`, and the only difference is the quantity
  (`{size}`) versus `کچھ نہیں`. This is the pairing the en notes demand.
- Matches the established shipped pattern for status · detail rows in this same
  namespace: `ناکام · {code}`, `مسترد · {code}` — status first, spaced U+00B7, detail
  after.
- Punctuation: no Urdu full stop needed (fragments take none, per en contract and
  shipped ur siblings); no `۔`/`,` misplacement; separator spacing is U+0020 on both
  sides, same as the shipped rows.

## 4. Terminology — PASS

Neither key uses a glossary §2 term except through the shape of the status line; no
product name, tool name, path, flag or identifier appears, so §1 kept-English is not
engaged. "بھیجا" is consistent with the shipped uses of the same verb
(`ui.chat.ask_answer.not_sent`, `send_failure.*`). Nothing to correct against
`i18n/glossary.md`.

## 5. Fit — PASS (one informational NIT)

Measured cells (one cell per non-combining character, per the `ur` width rule), with
`{size}` spliced as a representative CLDR `ur` value `12.4 kB` (7 cells):

| Key | en cells | ur cells | delta |
|---|---|---|---|
| `never_sent_composed` (`never sent · 12.4 kB composed` → `نہیں بھیجا گیا · 12.4 kB لکھا گیا`) | 29 | 32 | +3 |
| `never_sent_empty` | 29 | 34 | +5 |

The sidecar records only a prose `length` hint ("short; shares one row with the tool
name and truncates with an ellipsis when narrow") and **no `maxCells`**, so there is no
budget to breach, and the row truncates with an ellipsis by design. The growth is
within normal Urdu expansion for the same information; no shortening is required.
Wide-glyph/combining risk: none — the script is Arabic-script non-combining with no
mark stacks, and FSI/PDI cost 0 cells.

## 6. RTL and bidi — PASS (measured, not assumed)

- **No manual bidi controls in the values** (asserted above): the `ur` guide forbids
  them because `translate()` double-applies them; correct here.
- **`{size}` is isolated by the runtime, and that isolation is load-bearing.**
  `needsIsolation("12.4 kB")` is true (Latin letter present, no RTL char, no control)
  and `plainArgumentNames` classifies `size` as a plain splice, so `bidi.ts` wraps the
  value in FSI…PDI. Measured with `fribidi --rtl`:
  - raw (no isolation): `… ﺎﮭﮑﻟ kB 12.4 · …` — the size token **reverses to
    `kB 12.4`**, i.e. the defect the layer exists to prevent;
  - with the runtime isolation the app applies: `… ﺎﮭﮑﻟ ⁩12.4 kB⁨ · …` — the size
    stays `12.4 kB` intact.
  So the composed line reads right-to-left as
  `نہیں بھیجا گیا` → `·` → `12.4 kB` → `لکھا گیا`: status first, detail after, the
  Latin quantity intact, the separator on the correct side. No hazard.
- **No mirrored-wrongly glyphs:** the copy contains no arrows, brackets, sigils or
  key chords. The only neutral is the middle dot, which resolves to the RTL side
  correctly (verified in the same `fribidi` run).
- **Digits policy:** `{size}` arrives pre-formatted; `ur` keeps Latin digits and the
  Latin unit symbol from CLDR (`12.4 kB`, U+0020 separator, per the `_no_unit_keys`
  note) — the copy adds no digits of its own, so nothing to conflate.

## Findings

### NIT-1 — `ui.chat.canonical.tool.never_sent_empty` (and `_composed`) — width growth, informational

**Current:** `نہیں بھیجا گیا · کچھ نہیں لکھا گیا` — 34 cells against en's 29.
**Problem:** none functionally; recorded because the pair is the widest of the two new
lines and the row truncates. No `maxCells` is declared, so this is not a budget breach.
**Suggested:** keep as-is; no change requested. There is nothing to shorten without
breaking the pair's parallelism or dropping the `کچھ`/quantity contrast, and no budget
to shorten against.

## Second pass (independence check on my own verdict)

Re-read both values a second time, against the en meaning, before recording: the
composed line still reads "12.4 kB was written" and the empty line "nothing was
written", the two are still parallel, and neither can be read as "was not written" or
as a delivery failure. I found no reason to revise the pass. Agreeing with the
translator is a plausible failure mode, so the specific things I tried to break were:
polarity (`نہیں` placement — negates the sending, not the writing, which is the en
meaning), quantity-vs-nothing parallelism, the sent/delivered distinction against
`send_failure.late_delivery`, and the bidi position of the separator — all held.

## Out of scope, but the acceptance criterion will hit it (reported, not gated)

Operator acceptance is "switching to `fr` must leave NO English anywhere in the
interface … same for every supported language". The **same function** that renders
these two keys still hardcodes English for its two sibling branches:

```
src/renderer/src/features/chat/canonical/canonical-transcript.tsx:2322
  return `composing${record.argumentBytes ? ` · ${formatBytes(...)}` : ""}`;
src/renderer/src/features/chat/canonical/canonical-transcript.tsx:2327
  return `queued${record.argumentBytes ? ` · ${formatBytes(...)}` : ""}`;
```

Both lines are **pre-existing on `origin/main`** (present in
`git show origin/main:…canonical-transcript.tsx`), so this is not a regression of the
L2 change and does not gate it — but "composing · 12.4 kB" and "queued · 12.4 kB" will
render as English in every locale, in the same row as the two keys audited here. It
needs two more catalogue keys (and then its own translated/audited pass); it is a
copy change, not a translation defect, so it is recorded here rather than as a finding
against the ur values.

## Commands actually run (all executed in this session)

```
# inputs
cat _l2-prep/keys.json ; cat _l2-prep/ur.json
cat i18n/style-guides/ur.md ; cat i18n/style-guides/en.md ; cat i18n/glossary.md
cat src/i18n/catalogues/ur/ui.chat.canonical.json
sed -n '2280,2345p' src/renderer/src/features/chat/canonical/canonical-transcript.tsx
sed -n '1,200p' src/i18n/bidi.ts
python3 (json.load ur.json; json.load en context sidecar) -> en context entries + shipped ur dot rows

# mechanical (python3)
json validity/bytes; key-set equality; {size} occurrence counts; empties; en-identical;
U+00B7 count and U+0020 spacing; bidi-control codepoint scan; latin-run scan;
brace counts; per-value + per-file sha256; BOM/CRLF/newline; codepoint inventory
+ Arabic-variant letter scan + zero-width/odd-space scan; per-key cell counts

# repo validator rules, applied to the prep bytes (node)
node --input-type=module -e '…MANUAL_BIDI / FORBIDDEN_SCRIPT test over ur.json…'
  -> both keys: manual-bidi false, forbidden-script false
node --test scripts/i18n/ur-activation.test.mjs
  -> 3 pass / 0 fail (incl. "the bundled Urdu catalogue carries no manual bidi
     controls or forbidden script")
node --input-type=module -e '…parse() each value with requiresOtherClause…'
  -> both PARSE OK; argument literal "size"; Intl ur kB sample "12.4 kB"

# RTL measurement (real bidi algorithm)
fribidi --rtl --nobreak  on: raw composed (size spliced), composed with runtime
  FSI/PDI isolation, empty key, and a no-dot control
  -> raw reverses to "kB 12.4"; isolated keeps "12.4 kB" intact

# provenance / pre-existing check
git log --oneline -1 (479c2673fab feat(i18n): localize file sizes through one Intl-backed helper)
git diff --stat origin/main...HEAD
git show origin/main:<canonical-transcript.tsx> | grep -n 'return `composing|return `queued'
  -> present on main (pre-existing)
~/.local-operator/sessions/fcba1aa9e0c1/tail-anchor.v1.json -> selector deepseek/deepseek-flash
```

No translation/MT service was used; no dictionary lookup, no back-translation. All
judgements above are from reading, plus the measured mechanical and bidi evidence.

## Ledger / record

- Record written to `i18n/audits/evidence/ur/ui.chat.canonical/l2-au-ur-20261111/record.json`
  (with `audit.log`), binding to the hashes below.
- **No ledger row was written, and none can be yet:** `scripts/i18n/ledger-assemble.mjs`
  requires a catalogue file containing the audited keys as its `--file` (it derives
  `target_sha256` from it) plus a receipt. The two `ur` values are not in the shipped
  catalogue on this branch (`ABSENT in ur`, verified by grep), so the ledger row
  belongs to the wave that lands them — it should cite this record.

Input hashes (sha256):

| Input | sha256 |
|---|---|
| `_l2-prep/keys.json` (en + context) | `a8cd6e7d8adbc43a55bf2b812ba32eafa9f32931830e45f84b12d8ceb60ec71b` |
| `_l2-prep/ur.json` (audited bytes) | `8fd740fb10c8d3c7aeae7323e312219c5b716806afde22bbd735a94296c6d69f` |
| `src/i18n/catalogues/en/ui.chat.canonical.json` | `27ae7327daa34be60b619be551c840e057d61c3d69dc801269e4f389edc0f031` |
| `src/i18n/catalogues/en/ui.chat.canonical.context.json` | `c0aff0d8bd80304e063b55f80875e3f8b5f50ad201e9b51770f570eb8dd253e4` |
| `src/i18n/catalogues/ur/ui.chat.canonical.json` (consistency ref) | `e9c5c4e97476439567dd3efa26f14e9257fcfc581b8526d89bb5d05a4e3c9e11` |
| `~/local-operator/i18n/style-guides/ur.md` | `c0eecf7f7b5e89956b7de9ab7a9eb647ff1a7ef701ccf2a7f0264d5eea15ca60` |
| `~/local-operator/i18n/style-guides/en.md` | `c967c91037be79a7b184b3288b8c0326a261e4adae95b7db06d83e96f8ea6ec7` |
| `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| `src/renderer/src/features/chat/canonical/canonical-transcript.tsx` | `5b0386a44678f64696011fbfb26d100938417b689e4bf5f796b3b482d83a7d44` |
| `src/i18n/bidi.ts` | `ced8c95bda235f672d391c92c528c5819669b053e13e5e2a6fceae9761ded674` |

Scope note: this audit covers the two values only (slice L2). It is not a
re-audit of `ui.chat.canonical` for `ur` and does not certify the namespace.
