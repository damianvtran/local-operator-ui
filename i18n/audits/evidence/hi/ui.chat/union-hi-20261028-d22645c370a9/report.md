# Union audit — `hi` / `ui.chat` — report

* **Audit id:** `union-hi-20261028-d22645c370a9`
* **Locale / namespace:** `hi` / `ui.chat` (one catalogue, 142 keys)
* **Target bytes:** PR #1449, branch `i18n-wave-a`, head `c5e19ecec883b45e281d696f06dac86bcb0d90f3`
  (merge of `e5f7c8daeaf3` with `origin/main` `1d631be71fb7`)
* **Audit date:** 2026-10-28
* **Auditor:** `i18n-auditor`, session `d22645c370a9`, route `radient/auto` (no fallback, no model switch, no session incident — see `record.json`)
* **Verdict:** **passed** — `clean-with-findings`, 0 blocker, 0 major, 3 minor, 3 nit

## Why this audit exists

Wave A (18 keys: `checkpoint.*`, `header_identity.*`, `region.*`) and wave B (9 keys:
`session_status.*`) were each audited on their own whole-file bytes and both passed
(receipts `wa-hi-3acece16f468` and `8f4aa3fba6ed`). The union file the merge produces has
never been read as a whole, so `node scripts/i18n/ledger-check.mjs` fails its row for stale
hashes. This audit binds the union bytes and asks what the two separate passes could not:
does the merge of the two deltas hold together.

## What was audited

A **delta audit over unchanged-by-proof bytes** plus a whole-file consistency read:

1. **Delta proof (parsed JSON, not text).** Union = 142 keys = 115 base + 18 wave A + 9
   wave B, zero shared key names. Every value is byte-identical to the earlier audit that
   read it: the 18 wave-A keys against `a81c00cdda` (the head receipt `wa-hi-3acece16f468`
   bound; the same file bytes also sit at `80ee119bbd`), the 9 wave-B keys against
   `a5356ce91c` = `origin/main` `1d631be71f` (receipt `8f4aa3fba6ed`), and all 115 base
   keys against `1d631be71f` and the pre-wave file `6216167f44`. A raw-line check re-read
   the stored text of all 142 keys: **0 value mismatches, 0 raw-text mismatches**, in both
   `hi` and `en`. Key order in the union is exactly `origin/main`'s 124 keys followed by
   wave A's 18, so the merge moved no base line; `hi` and `en` key sets/order are identical.
2. **Whole-file read** of all 142 keys — mechanical gates, then accuracy, idiom, register,
   terminology, fit and Hindi typography, with a second pass over the error, approval and
   secret copy (high-visibility group).
3. **Cross-wave consistency** between the A family (`region.conversation` vs
   `region.composer`, `checkpoint.*`, `header_identity.*`) and the B family
   (`session_status.*`), plus their base-key neighbours.

## Gates run (actual, in the read-only `git archive` export of `c5e19ecec8`)

| Gate | Result |
|---|---|
| `node scripts/i18n/ledger-check.mjs` | **fails exactly 7 rows / 21 findings**, all `*/ui.chat` stale-source + stale-target + receipt-vs-bytes. Expected: the union bytes have no receipt yet. This audit is the missing one for `hi`. |
| `node scripts/i18n/generate.mjs --check` | `src/i18n/keys.gen.ts is byte-identical to a fresh generation` |
| `node scripts/i18n/context-parity.mjs` | `ok` — every English key covered apart from 131 allowed gaps in 4 namespaces; all 27 wave keys carry sidecar entries |
| `node scripts/i18n/check-coverage.mjs` | `ok` — 7 gated languages over 99 namespaces; 0 allowed keys remain |
| `node --test scripts/i18n/locale-parity.test.mjs` | 44/44 pass (hi included: every key, no unknown key, placeholder parity, not an English stub) |
| `node scripts/i18n/check-duplicates.mjs` | `ok` — 889 files, 0 duplicate keys |
| Independent mechanical sweep (this audit, `@formatjs/icu-messageformat-parser` + `intl-messageformat`) | 142/142 keys parsed; **166 real renders**; 0 unresolved problems |

Mechanical detail: placeholder name/type parity for all 142 keys; ICU select/plural tree
parity vs `en` (3 selects with identical option sets: `agents`/`teams`/`other` twice and
`agents`/`teams`/`skills`/`other` once; 1 plural with `one`/`other`, offset 0); `hi`
plurals use only the CLDR categories `one`/`other` with `other` present, and 0 and 1 both
select `one` as the style guide requires; NFC on every value; no bidi or zero-width
characters; no NBSP/space variants; no stray double spaces; no backtick, flag, URL or
token drift; no key added or dropped; valid JSON.

The sweep's 10 flagged items were each resolved as expected or intentional:

* 6 × `ICU structure differs` are **placeholder order only** — the four checkpoint keys
  (`{total} में से टर्न {turn}`), `loop_progress_of_turns` (`{total} में से {completed}`)
  and `not_signed_in` (`{label} में साइन-इन नहीं है`). Hindi cannot keep the English
  left-to-right order without stranding the verb; every render (166, across select options
  and plural counts) composes, and the same adaptation was accepted for wave A (HI-WA-2).
* 1 × trailing stop added (`mermaid.unexpected_error`): hi writes a full sentence with
  danda where en has no stop; idiomatic Hindi, recorded as a nit only for source parity.
* 2 × whitespace: the leading space in `invalid_key.after` and the trailing space in
  `hint.prefix` are the joins their components require (checked against the JSX); en has
  the same split shape.

## Findings

### Minor

* **UHI-M1 — `ui.chat.error_block.link.providers` — «प्रोवाइडर्स सेक्शन»**
  The destination label is singular everywhere else in the hi corpus:
  `ui.settings.model.provider_callout.providers_link` renders the same settings section as
  «प्रोवाइडर», and «प्रोवाइडर्स» occurs in no other hi catalogue (checked across 99). A link
  that names the section by a different word than the section's own label is a cross-file
  term split. **Suggested:** «प्रोवाइडर सेक्शन».
* **UHI-M2 — `ui.chat.question_dock.hint.approval` — «ऊपर के बटन से स्वीकृति दें या
  अस्वीकार करें…»**
  The approval card prints the client-owned labels `APPROVAL_OPTIONS` verbatim
  (`src/renderer/src/features/chat/approval-words.ts`: `Approve` / `Deny`, submitted by
  label and never localized), so the hint tells the reader to press two Hindi actions that
  do not appear on the buttons. The es audit (UES-O2) settled the programme convention:
  name the controls the reader actually sees. Understandable from context, so minor rather
  than a meaning blocker. **Suggested:** «ऊपर Approve या Deny चुनें, या yes, no, 1, या 2
  टाइप करके भेजें, या टर्न रोकने के लिए संदेश बॉक्स में Escape दबाएँ।»
* **UHI-M3 — `ui.chat.error_block.schema.before` — «…निर्देश नहीं निभा पाता।»**
  «निर्देश निभाना» is not a Hindi collocation: निभाना takes a duty, promise or role, while
  instructions take «पालन». The sentence is understandable but reads translated, and it is
  error copy. **Suggested:** «…मॉडल एजेंटिक AI के लिए ज़रूरी जटिल निर्देशों का पालन नहीं
  कर पाता।»

### Nit

* **UHI-N1 — `ui.chat.mermaid.loading` — «डायग्राम लोड हो रहा है...»** The only ASCII
  three-dot ellipsis in the file; the other six ellipsis occurrences (four values) use
  U+2026. **Suggested:** «डायग्राम लोड हो रहा है…».
* **UHI-N2 — `ui.chat.usage.unlimited` — «भुगतान वाला असीमित कोटा»** Literal "-having"
  calque of "paid"; «सशुल्क असीमित कोटा» is the product-copy register. Meaning survives.
* **UHI-N3 — `ui.chat.error_block.rate_limit.after` / `all_after`** With the before half
  and the settings link the sentence carries two purpose clauses joined by a dash ("open
  settings to get Radient Pass — to get models without rate limits"). Understandable but
  loose for error copy. **Suggested pair:** before «…या बिना रेट सीमा वाले AI मॉडल कम दाम
  पर पाने के लिए» / after «में Radient Pass लें।»

## Checked and not counted

* **Wave A's HI-WA-1 («एजेंट सौंपें») is reviewed and not carried.** The corpus uses
  सौंपना as its assign verb for sessions, instructions and agents (21 key-values, 20 distinct, including
  «टीम या एजेंट बाद में सौंपें।» and «पहले से {label} को सौंपा गया।»); replacing these four
  chip values with «असाइन» would create a new term split. The wave-A receipt keeps the
  historical finding; this audit does not re-raise it.
* **`hub_update.update_all_label` count referent.** A first read suggested the
  agents/teams/skills branches («सभी {count} एजेंट अपडेट करें») misstate the count because
  they drop the noun "updates". Checked in code instead of assuming:
  `hubAvailableCount()` (`src/renderer/src/shared/api/local-operator/hub-updates.ts:379`)
  counts items of the kind whose mark is available, one update per item, so `{count}` does
  equal the number of agents/teams/skills being updated. Not a defect.
* **Placeholder reordering** (6 keys) is the locale-correct adaptation, not an omission;
  every placeholder survives with the same name and type and every render composes.
* **`invalid_key.after` / `hint.prefix` whitespace** are required joins, not stray spaces.
* No value is identical to English (0/142), so no locale-parity exemption is used; Latin
  runs are only tokens also present in the source (Radient, Radient Pass, Radient
  Automatic, AI, API, SVG, Mermaid, Enter, Esc, yes/no/1/2).
* Cross-wave terminology agrees: सत्र, एजेंट, उप-एजेंट, टीम, मॉडल, टर्न, संदेश, बातचीत,
  जवाब, संदर्भ, and «संदेश कंपोज़र» matches the base «कंपोज़र» values in this file (the two
  «कम्पोज़र» spellings live outside `ui.chat`, as the wave-A INFO recorded).
* Fit: the only two `maxCells` hints are met (6 ≤ 18 for `choose_model`, 7 ≤ 16 for
  `last_reading`); no short label expands enough to threaten a button/tab.

## Limits

Catalogue-level audit: strings, ICU structure and rendering only; no Electron render, no
screenshot, no design sign-off. Base and wave-B keys are carried by the delta proof rather
than re-derived from a second source. High-visibility copy was read twice in this session;
no second independent session was run (the es union audit made the same continuity
statement).

The execution record — commands and their actual output — is `audit.log`; the byte-level
certificate the ledger derives a row from is `receipt.json`. The export was deleted after
the bundle was written; `git show c5e19ecec8:<path>` reproduces every byte proved here.
