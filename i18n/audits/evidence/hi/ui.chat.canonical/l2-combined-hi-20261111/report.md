# Independent i18n audit — `hi` / `ui.chat.canonical` — PR #1861 (rebased candidate)

## Record

```
locale:                hi
namespace:             ui.chat.canonical (file group: one namespace file)
audit_id:              l2-combined-hi-20261111
auditor agent:         i18n-auditor (independent; did not translate these files, edited nothing)
auditor session:       7bfe4bf0bb78
ACTUAL served model:   deepseek/deepseek-flash  (session runtime model header; no fallback observed)
actual_model_source:   harness session model declaration ("Model: deepseek/deepseek-flash"), 2026-11-11
independent_from_translator_session: yes (translator sessions for this namespace were
                       openai/gpt-6.1-sol per i18n/ledger.json; not mine)
date:                  2026-11-11
candidate commit:      659ef7e44b7c  (worktree ~/local-operator-ui/.worktrees/i18n-l2-file-sizes,
                       read only via `git show`; worktree HEAD is fbecdf64fc69, NOT checked out to the candidate)
key_count:             442 (en) / 442 (hi)
input_hashes:          en      path=src/i18n/catalogues/en/ui.chat.canonical.json
                               sha256=38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3
                       context path=src/i18n/catalogues/en/ui.chat.canonical.context.json
                               sha256=c258ab485de698eec85e81ffed506866e3b1e8caf29cb3ff434901388065b390
                       hi      path=src/i18n/catalogues/hi/ui.chat.canonical.json
                               sha256=da636c7580e96efed0b3db710f577d8ced1c2321fc747b95675028ae529bbb4f
verdict:               clean-with-findings   → ledger status `passed` (no BLOCKER, no MAJOR)
severity counts:       BLOCKER 0 · MAJOR 0 · MINOR 2 · NIT 3
unresolved_blocker_major_count: 0
ledger row:            NOT written — this audit is read-only by instruction (no repo writes,
                       no generator, no validator run against a candidate that is not checked out).
                       The ledger/record commit is left to the manager or ledger owner; the exact
                       row data is in "Ledger hand-off" below.
```

## Scope and method

Subject: the **combined** `ui.chat.canonical` bytes after PR #1861 was rebased onto main past
#1862. `git diff origin/main 659ef7e44b7c` on the catalogue directory shows the only added keys are

```
+ ui.chat.canonical.tool.never_sent_composed   "never sent · {size} composed"
+ ui.chat.canonical.tool.never_sent_empty      "never sent · nothing composed"
```

(#1862's 182 `tool_row.verb.*` keys are already in `origin/main`.) The file-size work itself is in
`src/i18n/format.ts` (`formatByteQuantity` / `formatBytes` → `Intl.NumberFormat{style:"unit"}`).

Method: mechanical pass over **all 442 keys** in Python (hashlib/json/unicodedata), then a full
semantic read of every EN/HI pair (not a sample — the file is small enough), with extra depth on the
two added keys and their neighbours.

**Validator disclosure (what I actually ran):** the repo validators (`pnpm check-i18n` →
`generate` freshness, `check-strings`, `check-added-strings`, `context-parity`, `check-coverage`,
`ledger-check`) were **not** run: the shared worktree is checked out at `fbecdf64fc69`, not at the
candidate, and my brief forbids checkout, installs, tests and the repo generator. Instead I
re-derived the invariants those checks cover for this file (key set, key order, ICU signature,
plural arms, markup/backticks, NFC, JSON validity, hashes) directly over `git show` output. That is
reproduction, not the repo command — treated as such below.

**Unit-symbol question — verified vs inferred:** *verified from repo bytes* that the formatter asks
CLDR (`Intl.NumberFormat` `style:"unit"`, `unitDisplay:"narrow"`, non-English tags only) and that
`scripts/i18n/file-size.test.mjs` at the candidate asserts the hi outputs
`["0 बाइट","1 बाइट","1 kB","1 kB","1.5 kB","1 MB","2.5 GB"]` — i.e. hi takes CLDR's Devanagari
`बाइट` for the byte and the international `kB/MB/GB` above it, with a plain space separator
(no NBSP/NNBSP in the hi row). *Inferred, not executed here:* that the Node/ICU runtime the app
ships actually returns those strings at render time — I did not run `Intl` in this audit (no node
run permitted under the memory guard). So the symbols are consistent with the app's formatter **as
the fixture pins it**, not independently measured by me.

RTL checks do not apply (hi is LTR). No Devanagari digits appear in any value (policy: Latin digits
in v1) — checked, zero hits.

## 1. Mechanical

| Check | Result | Evidence |
|---|---|---|
| Key set identical (no added/dropped) | PASS | 442 = 442, sets equal, `extra_in_hi=[]`, `missing_in_hi=[]` |
| Every key exactly once (duplicate JSON keys) | PASS | `object_pairs_hook` duplicate scan: none in en/hi/context |
| Key **order** matches English | **deviation** (NIT-3 below) | first divergence at index 27; 222/442 positions differ (see NIT-3) |
| ICU placeholder names + types identical per key | PASS | top-level signature compared per key; only difference is argument *order* in `lightbox.show_image` (names/types unchanged, see observation O1) |
| CLDR plural categories valid and complete for hi | PASS | every plural has `other`; every EN `one` has a hi `one`; no hi `few`/`many`; `=N` exact arms kept |
| ICU structure valid | PASS | quote/brace scan clean; no unclosed or stray braces in the two added keys (`braces: ['{','}']`, one `{size}`) |
| Markup / Rich tags identical | PASS | tag multiset equal on all 442 keys |
| Backtick code spans identical | PASS | code-span lists equal on all 442 keys |
| Latin tokens not present in the English source | PASS after review | only allowed names added: `Canvas`, `Operator`, `Bridge`, `DM`, `Python`, `endpoint`, `diff`, plus ICU keyword `one`. Each is a product/tool name or a settled kept-English term; `Canvas` capitalises EN's lowercase "canvas" (observation O2) |
| Empty values | PASS | none |
| NFC | PASS | all values already NFC |
| Stray/edge spaces, double spaces | PASS | the only edge-space values are the two literal separator tokens (below) |
| Trailing punctuation class matches source | PASS | 0 mismatches; danda `।` used in the 31 prose keys where EN ends a sentence, none on status lines |
| Invisible characters (ZWJ/ZWNJ/NBSP/NNBSP/ALM) | PASS | zero in all 442 hi values |
| English-identical values | PASS — 6 named exceptions | see below |
| Valid JSON | PASS | both files parse; raw byte hashes above |

English-identical values, each justified:

1. `tool_row.bridge.detail.headline.target` = `{verb} {target}` — placeholders only, nothing to translate.
2. `tool_row.bridge.summary.count` = `({count, number, ::group-off})` — punctuation + one placeholder.
3. `fold.count.named` = `{count, number, ::group-off} {name}` — placeholders + one space.
4. `fold.sentence.join` = `{first}, {second}` — concatenation glue; the comma is locale-neutral in hi prose too.
5. `fold.unit_separator` = `" · "` — literal separator token consumed by the fold builder.
6. `supplement.withheld.reason_separator` = `", "` — literal separator token.

None of the six is a user-facing sentence; none hides untranslated copy.

## 2. Accuracy / 3. Idiom / 4. Terminology / 5. Fit — the file-size keys (focus)

**`ui.chat.canonical.tool.never_sent_composed`** — EN `never sent · {size} composed`
HI `नहीं भेजा गया · {size} लिखा गया`

- Meaning: passive "not sent" is the same frame the shipped `send_failure.*` family uses
  (`आपका संदेश नहीं भेजा गया।`), and it is distinct from `tool_row.outcome.never_ran`
  (`कभी नहीं चला`), which is the harness-refusal verdict — the source distinguishes them in the
  same way, so the pair does not collide.
- `{size} लिखा गया` = "…was written"; the verb matches the neighbouring tool-row verb
  `tool_row.verb.wrote` (`लिख रहा है` / `लिखा`), so "composed" is expressed with the same verb as
  "wrote" rather than a new one. Neutral/passive agreement (लिखा) avoids gendering `{size}`.
- Reads correctly with every hi formatter output the app can inject: `12 बाइट लिखा गया`,
  `1.5 kB लिखा गया`, `2.5 GB लिखा गया`. The `{size}` run stays LTR byte-identical (Latin digits,
  ASCII `.` per the hi grouping/decimal decision, Latin `kB/MB/GB` per CLDR), and no bidi problem
  exists in an LTR locale.
- `{size}` appears exactly once; U+00B7 appears exactly once, surrounded by plain U+0020; no
  trailing punctuation (the sidecar's tone rule); NFC.
- Register: terse, impersonal, no `आप` needed for a status line — correct per the hi guide.

**`ui.chat.canonical.tool.never_sent_empty`** — EN `never sent · nothing composed`
HI `नहीं भेजा गया · कुछ नहीं लिखा गया`

- Same frame, only the detail clause changes: exactly the parallelism the sidecar demands
  ("Keep the two lines parallel in wording"). `कुछ नहीं लिखा गया` = "nothing was written".
- Correctly names the empty case instead of printing `0 B`, which is what the source asks for.

**Fit:** 23 / 22 base cells (Devanagari counted with marks at zero width: 31 / 33 code points) against
28 / 29 for English — shorter than source, no `maxCells` hint exists in this namespace's sidecar
(grep count 0), and the row truncates with an ellipsis when narrow. No overflow risk.

**Neighbour consistency:** both lines sit in the same family as `tool_row.outcome.never_ran`
(`कभी नहीं चला`) and `transcript.not_delivered` (`पहुँचा नहीं`); three distinct phrasings for three
distinct concepts, which is the source's own division. No finding.

## Findings

### MINOR-1 — `tool_row.verb.linked_session_to.{running,settled}`, `tool_row.verb.unlinked_session_from.{running,settled}` compose wrongly with the appended object

- Current: `सत्र प्रोजेक्ट से जोड़ रहा है` / `सत्र प्रोजेक्ट से जोड़ा` / `सत्र प्रोजेक्ट से अलग कर रहा है` / `सत्र प्रोजेक्ट से अलग किया`
- English: `Linking session to` / `Linked session to` / `Unlinking session from` / `Unlinked session from`
- Problem: the sidecar for these four keys says the row's object "follows on the same line" and the
  phrase "must keep the trailing preposition". Hindi has no trailing preposition: putting `से`
  **before** an object that is appended after the string yields
  `सत्र प्रोजेक्ट से जोड़ रहा है <project-name>` — the noun `प्रोजेक्ट` (absent from the English) is
  duplicated by the appended project name, and the Latin proper noun lands after the phrase has
  already been closed by `से` + verb.
- Proposal: end on the verb and drop the inserted noun — `सत्र जोड़ रहा है` / `सत्र जोड़ा` /
  `सत्र अलग कर रहा है` / `सत्र अलग किया` (object then appends as the row's monospace target), or a
  colon form `सत्र जोड़ रहा है:` if the design wants an explicit slot.
- Severity reasoning: no wrong or unsafe meaning, and **no call site yet** — these keys exist only in
  `keys.gen.ts` at the candidate (`git grep linked_session_to` finds no component use), so nothing
  ships broken today. MINOR, not MAJOR. Note `ur` carries the same shape
  (`سیشن پروجیکٹ سے جوڑ رہا`), so this is a batch-level composition decision to settle once, not a
  hi-only slip.

### MINOR-2 — `fold.count.list_variables` renames "variable lookup" to "variable list"

- Current: `{count, plural, one {{count, number, ::group-off} वेरिएबल सूची} other {{count, number, ::group-off} वेरिएबल सूची}}`
- English: `… variable lookup / variable lookups`
- Problem: the fold counts **operations**; `वेरिएबल सूची` reads as "variable list", so the count
  appears to count lists. It also breaks internal consistency: the sibling
  `fold.count.lsp` renders "code lookup" as `कोड लुकअप` (kept-English `लुकअप`), so the same head noun
  is translated one way one key away.
- Proposal: `वेरिएबल लुकअप` in both arms (matches `कोड लुकअप`), or `वेरिएबल देखे` if the fold prefers a
  verb form. MINOR: the phrase is comprehensible and the surface is a collapsed summary line.

### NIT-1 — `notice.interrupted` vs `transcript.interrupted` / `tool_row.outcome.interrupted`

`notice.interrupted` = `बीच में रोका गया`; the other two keys carrying the same English word
("interrupted") are `रोका गया`. The elaboration is not wrong, but three surfaces of one word should
agree: either use `रोका गया` everywhere, or adopt `बीच में रोका गया` everywhere deliberately.

### NIT-2 — `tool_row.diff.withheld` / `tool_row.diff.more` / `tool_row.diff.truncated` use Latin `diff`

`इस बदलाव का diff उपलब्ध नहीं है` keeps "diff" Latin mid-sentence while the English capitalises
"Diff". This is defensible (the glossary's wave-2 kept-English set covers the git family
`merge/pull/push/commit`, and `diff` is the tool's own name), but the glossary has **no row** for
`diff`, so the next wave cannot tell policy from drift. Ask for a glossary row rather than changing
the string.

### NIT-3 — key order does not match the English file

222 of 442 positions differ from the English order (first divergence at index 27, inside the
`transcript.*` block; further drift in `fold.count.*` / `fold.sentence.*`). Context: `vi`, `ur` and
`zh-CN` match English order exactly, `fr`/`es`/`ru` differ at 9 positions (240–248), so order drift is
neither universal nor enforced: the repo's validators compare key **sets** (`check-coverage`,
`context-parity`), not order, and no order check exists in `scripts/i18n/`. Recorded so nobody reads
this PR as the cause; it predates the rebase and has no runtime effect. Not a defect to fix in #1861.

## Observations (not findings)

- **O1 `lightbox.show_image` reorders `{index}` and `{count}`** — EN `Show image {index} of {count}`,
  HI `कुल {count} में से तस्वीर {index} दिखाएँ`. Named placeholders are order-independent and Hindi
  requires the total first ("out of N, image M"). Mechanically safe and correct copy. Flagged only
  because glossary §3 says "never rename **or reorder**" — worth rewording that row to "never rename,
  never change a type" so a future auditor is not forced to file this as a finding.
- **O2 `supplement.file_actions.open_in_canvas`** — EN "Open in canvas", HI `Canvas में खोलें`
  capitalises the feature name. Defensible as a product-surface name (there is a whole `ui.canvas`
  namespace), and pre-existing, so no finding; noted because it is the one place the hi file differs
  from EN's casing on a common noun.
- **O3 plural arms added by hi** — `fold.images_aria`, `fold.more_images`, `image_gen.batch_summary`,
  `lightbox.filmstrip_aria` carry EN's `=1 … other` plus a hi `one` arm. This is **correct and
  necessary**: hi's `one` covers 0, so without it a count of 0 would render the plural
  (`0 तस्वीरें`), which the hi guide explicitly forbids (`0 फ़ाइल` is singular). No action.
- **O4 (adjacent surface, pre-existing, NOT this PR)** — `src/renderer/src/features/chat/canonical/
  canonical-transcript.tsx:2329-2336` still returns raw English template literals
  `composing` / `queued` (with a now-localized size beside them: `composing · 1.5 kB`). This is
  outside `ui.chat.canonical` (no key exists, so no translation defect is possible here), and it is
  **not** in this PR's diff (`git diff origin/main 659ef7e44b7c -- …canonical-transcript.tsx` shows
  only the `never_sent_*` call). For the manager: it is exactly the operator's "no English left"
  acceptance on the same row family as these new keys, so it should be routed to a keying slice
  rather than lost.

## Ledger hand-off (manager / ledger owner to commit)

```json
{
  "locale": "hi",
  "namespace": "ui.chat.canonical",
  "source_sha256": "38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3",
  "target_sha256": "da636c7580e96efed0b3db710f577d8ced1c2321fc747b95675028ae529bbb4f",
  "auditors": [{
    "agent": "i18n-auditor",
    "model": "deepseek/deepseek-flash",
    "date": "2026-11-11",
    "result": "passed",
    "instance": "l2-combined-hi-20261111",
    "findings": { "blocker": 0, "major": 0, "minor": 2, "nit": 3 },
    "scope": "combined ui.chat.canonical (442 keys) at 659ef7e44b7c, focused on tool.never_sent_composed / tool.never_sent_empty",
    "note": "Independent fresh audit of the post-rebase combined bytes; MINOR/NIT only."
  }],
  "status": "audited"
}
```

The record path for the tracked copy is
`i18n/audits/evidence/hi/ui.chat.canonical/l2-combined-hi-20261111/` (`record.json` + this report as
`report.md`); this audit wrote nothing into the repository, so the manager must land it (a copy of
this file and of `mech1861hi.json` is in session scratchpad).

## Files this audit produced (session scratchpad)

- `audit-1861-hi.md` (this report)
- `mech1861hi.py` / `latin1861hi.py` — the mechanical checks actually executed
- `pairs1861hi.txt` — the EN/HI pair dump used for the semantic read
