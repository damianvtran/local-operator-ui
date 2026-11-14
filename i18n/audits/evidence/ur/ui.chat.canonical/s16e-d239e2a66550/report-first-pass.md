# s16e — independent audit of `ur` (Urdu, RTL), namespace `ui.chat.canonical`

- **Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 2 MINOR, 2 NIT.
- Slice: S16e (PR damianvtran/local-operator-ui #1884), 12 keys — the generation card's stop, settlement and failure-class copy.
- Draft audited: `~/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/ur/draft-ur-s16e.json`,
  sha256 `e9666a75e6d318448b530290d99ab3c88b8a29901e3fa8beeb5c3411f7fa4051` (matches the manager's manifest; verified again after copying byte-identically into the auditor's scratchpad).
- English source: `src/i18n/catalogues/en/ui.chat.canonical.json` sha256
  `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` — matches the hash the task gave me.
- Auditor: `i18n-auditor`, session `047163c943ad`, instance `047163c943ad-s16e-ur`, actual model
  `deepseek/deepseek-flash` (no fallback, no model switch — disclosed: the translator's notes name the same
  model family, so independence here is a different run that did not translate, not a different model).
- Read-only: no file in the worktree was edited; `git status --porcelain` was clean before and after.

## Findings

| id | sev | key | current | problem | suggested |
|---|---|---|---|---|---|
| UR-S16E-01 | MINOR | `error_class.duplicate_id` | `مکرر id` | The one lowercase Latin `id` in ur prose. The shipped ur catalogue writes the identifier token as `ID` in prose (25 values: «ایجنٹ ID», «سیشن ID», `ui.agents.settings.general.id` = «ID»); every lowercase `id` in the shipped catalogue is an ICU placeholder `{id}`, i.e. machine syntax, not copy. This draft mirrors English casing («Duplicate id») and so introduces a second token form. Secondary: «مکرر» is unattested in the shipped catalogue and reads adverbially out of context («again»), though it is correct Urdu officialese for "repeated". | `مکرر ID`; if the label should be self-explaining on its own, `پہلے سے موجود ID` (id already exists). |
| UR-S16E-02 | MINOR | `error_class.audio_rate_limited` | `آڈیو کی شرح محدود` | Meaning is intact and the class stays distinct from the other five labels, so this does not block. What it does is put a second construction on one concept: the product's settled rate-limit noun is «شرح کی حد» (`ui.chat.error_block.rate_limit.*`, `ui.chat.usage_reset.*` — 11 shipped values), while this label uses the adjective form «شرح محدود», which parses as "audio's rate [is] limited". The translator's own open question #2 asks for this call; their rejected alternative «آڈیو کی شرح کی حد» is indeed clunky (double کی), but there is a clean third form. | `آڈیو پر شرح کی حد` (rate limit on audio) — keeps the shipped noun and avoids the double-possessive. `آڈیو کی شرح محدود` is acceptable if the wave prefers the adjective form; then record it as the label form in the glossary so later waves do not oscillate. |
| UR-S16E-03 | NIT | `cancel.queued` | `فراہم کنندہ کو کال کیے جانے سے پہلے روک دیا گیا؛ …` | Not a defect: «فراہم کنندہ کال» is established user-facing vocabulary in the shipped catalogue (16 standalone «کال» values, e.g. «لیجر ہر فراہم کنندہ کال پر ماڈل درج کرتا ہے», «ٹول کال»), so the phone-call misreading I first suspected does not hold — I recorded it and dropped it. The residual point is only that the sibling for the same fact, `control.stop_hint_queued`, says «درخواست بھیجے جانے سے پہلے». | Optional harmonisation: `فراہم کنندہ کو درخواست بھیجے جانے سے پہلے روک دیا گیا؛ آپ سے کوئی چارج نہیں لیا جائے گا۔` |
| UR-S16E-04 | NIT | `cancel.running` | `… آڈیو بننے پر چارج لگے گا۔` | One surface family, two nouns for the charged amount: the shipped `sound.stop.warning` renders the identical English clause («will be charged if it produces audio») with «لاگت لگے گی». The draft's «چارج» is the better word — it matches English "charged", shipped «حتمی چارج» and shipped «کوئی چارج نہیں», while «لاگت» is the shipped word for a *cost amount*. | No change to this draft. Harmonise the shipped `sound.stop.warning` (لاگت → چارج) in a later wave and record charge/cost as a glossary pair. |

Nothing in this list blocks. UR-S16E-01 and -02 are one-token construction/consistency calls; -03 and -04
are cross-string harmonisation notes where the draft is defensible (and in -04 the shipped sibling is the
outlier).

## The two questions the task asked me to judge

**`endpoint` left Latin in `cancel.running` — correct, not a finding.** glossary §"Wave-2 kept-English set
(all locales)" lists `endpoint` (Latin, undeclined), and the shipped ur catalogue already does it twice
(`ui.agentMessages.settings.consent.no_record` «اس endpoint پر …», and `ui.chat.canonical.sound.stop.warning`
«… منسوخی کا endpoint نہیں ہے» — the very sibling sentence this key reuses). Bidi: the Latin island sits
between Urdu words with no punctuation inside or immediately after it, so it renders in place; the render
layer isolates the whole string and the style guide forbids hand-inserted controls, which the draft honours
(0 control characters measured).

**`id` in `duplicate_id` — legible, but a token-form MINOR (UR-S16E-01).** As a trailing LTR token in an RTL
string it is placed at the visual left by the bidi algorithm, i.e. after «مکرر» in reading order, so the label
reads correctly and needs no isolation (and no control may be added). The finding is casing, not bidi: the
locale's prose token is `ID`. The one bidi hazard worth knowing — Urdu punctuation appended directly after a
trailing Latin run — does not occur in this value.

## Second independent pass (high-visibility group: the six failure-class labels + the error sentence)

The manager asked for a second pass on high-visibility groups, so I re-read the error group from scratch
before writing anything down. It changed two of my own first-pass severities, in the direction of the
translator:

- `error_class.audio_rate_limited` label: I first graded the calque **MAJOR**; on the second pass the
  label is comprehensible, the class is distinct and the term root («شرح») is the product's — so **MINOR**
  with a concrete alternative.
- `cancel.queued` «کال کیے جانے سے پہلے»: I first graded **MINOR** on a "phone call" reading; the shipped
  catalogue's own «فراہم کنندہ کال» / «ٹول کال» killed that argument, so **NIT**.
- «مسترد» (denied) and «گیٹ ناکام» (gate failed) re-checked as distinct classes and as the shipped words
  (66 «مسترد» values incl. `ui.browser.approval_queue_model.denied`; «گیٹ» in `ui.chat.pickers.goal.placeholder`).
- «غلط آرگیومنٹس» re-checked against shipped `آرگیومنٹس` (`ui.chat.pickers.slash.phase.arguments`) — the
  transliteration is the established term, not a calque; my first-pass NIT on it was wrong and is withdrawn.

## Mechanical (executed, not asserted)

`@formatjs/icu-messageformat-parser` from the primary checkout's `node_modules`, one short node run, no
installs or builds. Draft: **PASS** — valid JSON, 12/12 keys, no extras, all values parse, argument
name/kind identical to English, `{material}` select keywords exactly `video|voiceover|sound_effect|other` on
both sides with a complete sentence per branch (each ending ۔), braces balanced, values NFC-stable, no bidi
controls, no leading/trailing whitespace. No plural argument exists in this slice, so ur's `one`/`other`
categories are not engaged.

The repo's own catalogue validator cannot judge these bytes: the draft is a 12-key slice outside
`src/i18n/catalogues/`, so `check-strings`/`ledger-check`/`context-parity` have no catalogue to read, and
`ledger-assemble` refuses (correctly) to bind a receipt to bytes other than the namespace file on disk.

**Negative controls** (my scratchpad, four of them, all fail as required): dropped `voiceover` branch →
FAIL on keyword set; renamed argument `material`→`materials` → FAIL on argument shape; unbalanced brace →
FAIL on parse + balance; injected U+200F → FAIL on bidi. A fifth control (an English value copied in
byte-identical) passes mechanical checks *by design* — that is why the checker also prints every Latin token
outside ICU syntax for human adjudication; the limitation is stated, not hidden.

**Honesty note on the checker:** its first version had the parser's `TYPE` constants off by one and reported
PASS for the dropped-branch control. The controls caught the checker, not the copy; the constants were fixed
and every result above is from the corrected run. Without the controls this audit would have been vacuous.

## Per-axis

- **Accuracy — pass.** The promises are exactly the English ones: `cancel.queued` keeps the single
  no-charge promise, flat and unhedged; `cancel.running` promises nothing (a stop *request*, no cancellation
  endpoint, generation continues, charge conditional on audio being produced); `settlement.pending` states no
  amount and no zero; `error.audio_rate_limited` promises no success and names no wait time; the six labels
  stay mutually distinguishable.
- **Terminology — pass with the two MINORs above.** Every material noun in `cancelled_batch` is byte-identical
  to the shipped `done_batch`/`failed_batch` branch noun, so the three batch lines read as one family, which
  is the sidecar's explicit requirement.
- **Idiom/register — pass.** آپ throughout, respectful imperative for the one instruction, no exclamation, no
  «براہ کرم» the English does not have. Letter forms are consistently Urdu (U+06CC/06A9/06C1/06D2; zero
  Arabic-form ي/ك/ه), no ZWNJ, no Hindi danda, punctuation is the Urdu set (۔ ، ؛ —), and both ؛ and — are
  live in the shipped catalogue.
- **Fit — pass.** No `maxCells`/`maxChars` hint exists for these keys (prose length hints only). Labels 5–17
  chars vs 6–18 English, none long enough to wrap; sentence keys 22–119 vs 24–125, all documented as wrapping
  in the card; the widest rendered state line is 28 chars.
- **RTL/bidi — pass.** No manual controls; both Latin islands judged individually (see above); no digits, so
  the digits policy does not arise; no direction glyphs in the copy.

## What I did not do

- I did not translate, edit, patch or re-key anything; the only repository write is none (the worktree stayed
  clean; one transient log file a driver `cd` slipped into it was removed by exact path and the worktree
  re-verified clean).
- I did not run `ledger-assemble`: it writes `i18n/ledger.json`, requires the namespace catalogue on disk, and
  this auditor is read-only. The row belongs to the manager once the slice lands — see `receipt.json`
  `.ledger`.
- I did not read the translator's notes until I had formed and written my own view of all 12 keys; where they
  changed my mind (UR-S16E-02's alternative, UR-S16E-03's «کال») the change is disclosed above.

## Artifacts

`receipt.json`, `report.md`, `audit.log` (real transcript of the 12 command runs), plus the checker, the two
fact/evidence queries and the negative-control fixtures, all in this scratchpad.
