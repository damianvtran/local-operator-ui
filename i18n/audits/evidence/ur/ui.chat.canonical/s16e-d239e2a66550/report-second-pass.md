# Second independent audit — `ur` · `ui.chat.canonical` · slice S16e-renderer

**Verdict: `passed`** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 3 NIT.
PR `damianvtran/local-operator-ui#1884` (`S16e-renderer`). Second independent pass for a
high-visibility group; the first pass is a different session and was read only **after** my own
per-key judgement was written down (divergences in `divergences.md`).
Slice-wide: **84/84 values read** (12 keys × fr/es/ru/vi/zh-CN/hi/ur); this file is the `ur` row.

| | |
|---|---|
| Locale / namespace | `ur` / `ui.chat.canonical` |
| Keys audited | 12 / 12 — every key in the assigned group |
| Draft audited | `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/ur/draft-ur-s16e.json` · sha256 `e9666a75e6d318448b530290d99ab3c88b8a29901e3fa8beeb5c3411f7fa4051` (matches the task manifest) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `bd8e9054` · sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` · sha256 `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Brief (`en` + `context`) | `s16e-brief.json` · sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` — its 12 `en` values and 12 `context` objects are byte-equal to the repo catalogue and sidecar (verified, 0 mismatches) |
| Shipped `ur` catalogue (terminology authority) | sha256 `fd1116ccb5e847eb7f28c4cf5d1084efad95edf52d638d1a6144e065ce7d98a7` (467 keys; English 479 — the 12-key gap is exactly this slice, 0 of the 12 exist yet) |
| Glossary / style guide | `0eb34437…962f8` / `c0eecf7f7b5e89956b7de9ab7a9eb647ff1a7ef701ccf2a7f0264d5eea15ca60` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` — read-only: no edit, commit, install, build, browser or renderer run |
| Auditor | `i18n-auditor`, session `cc045047b39e`, model **`deepseek/deepseek-flash`** (session runtime model; **no fallback** used) |
| Independence | Not the translator's instance, not the first-pass auditor's instance; I authored none of these 84 values and edited nothing. No translation/MT service, no back-translation: every judgement is a reading of the English, the sidecar, the shipped `ur` corpus, the glossary and the `ur` style guide. |

## 1. Mechanical — PASS

Run with the repository's own parser (`@formatjs/icu-messageformat-parser` 3.5.21, read-only from
`~/local-operator-ui/node_modules` — the same dependency `scripts/i18n/generate.mjs` imports), and with a
codepoint scanner. Real transcripts: `mech.log`, `typo.log`.

- 12/12 keys present, none added, none dropped; valid JSON; tab-indented with a trailing newline.
- `state.cancelled_batch` is the only structured value in the slice. Its argument name `material` and its
  option set `video / voiceover / sound_effect / other` are identical to English — no renamed, missing or
  extra branch. The callsite maps the wire's `sound-effect` onto `sound_effect`, so the option name is
  machine surface and must not be translated: it is not.
- No plural/`selectordinal` argument exists in these 12 keys, so CLDR plural categories are **n/a** here
  (the four option keys are branch names, not CLDR categories). The English `other` branch is present.
- No markup/Rich tags, no backticks, no commands, no flags, no identifiers other than the kept-English
  tokens discussed in §4; no brace leak, no double spaces, no leading/trailing whitespace.
- **Negative controls 5/5 behaved as designed** (so the pass is not vacuous): unbalanced brace throws;
  a select missing `other` is caught; a renamed/extra branch changes the option set; a dropped
  placeholder is caught; a valid nested plural parses. Logged in `mech.log`.

## 2. Accuracy and the load-bearing promises — PASS

The three values that can get a user's money wrong were read against the sidecar's own rules:

| Key | English contract | `ur` carries |
|---|---|---|
| `cancel.queued` | the ONLY place that may promise no charge; must not soften into a maybe | «فراہم کنندہ کو کال کیے جانے سے پہلے روک دیا گیا؛ آپ سے کوئی چارج نہیں لیا جائے گا۔» — flat, not a maybe |
| `cancel.running` | stop is a REQUEST; the provider may still bill; must never read as "nothing was charged" | «روکنے کی درخواست دی گئی۔ فراہم کنندہ کے پاس منسوخی کا endpoint نہیں ہے؛ تخلیق جاری رہے گی اور آڈیو بننے پر چارج لگے گا۔» — request + conditional charge |
| `settlement.pending` | states that a charge is outstanding; never an amount, never a zero | «تصفیہ زیر التوا ہے — حتمی چارج فراہم کنندہ کی رپورٹ آنے پر دکھائی دے گا۔» — no amount, no zero |

No value in this slice negates, weakens or converts one of these into a guarantee it should not make;
`cancel.running` and `settlement.pending` never merge into one claim, and `cancel.checking` stays a
separate sentence because the callsite joins it with its own full stop.
The six failure-class labels stay textually distinct from each other and from the prose sentence
rendered under them (no label reuses its own sentence).

## 3. Idiom, register, typography — PASS (see §7)

Typography: Urdu ۔ ، ؛ only (no Hindi danda, no Arabic-only signs), Latin digits, spaced em dash in `settlement.pending`, no double spaces. Codepoint scan confirms **zero manual bidi control characters** — the render layer owns FSI/PDI isolation, so inserting them here would double-apply.

Register checks: formality is the guide's own (آپ, respectful imperatives («کوشش کریں»), no براہ کرم padding, no !), no exclamation marks, no padding
honorifics or politeness the English does not have, sentence case throughout, label keys carry no full
stop and prose keys do.

## 4. Terminology — PASS (see §7)

Every material noun, the batch noun, and the failure-class vocabulary were compared with the shipped
`ur` catalogue rather than assumed: batch/material nouns, denial label, gate vocabulary,
rate-limit vocabulary, charge/settlement vocabulary, and `endpoint` (kept Latin and undeclined exactly
as the shipped `ui.chat.canonical.sound.stop.warning` keeps it; zh-CN keeps its own shipped 接口).
Kept-English in this slice is confined to the glossary's set — `endpoint` where the locale's sibling
copy keeps it, the documented `id`/`ID` token, and the `{material}` syntax. Nothing else Latin was
introduced, which is exactly what the operator's "no English left in the interface" requirement turns
on: the only Latin a `ur` user sees here is glossary-sanctioned.

- «ویڈیوز کا مجموعہ / وائس اوورز کا مجموعہ / صوتی اثرات کا مجموعہ / تصاویر کا مجموعہ» are byte-identical to the shipped `state.done_batch` and `state.failed_batch`.
- «فراہم کنندہ کے پاس منسوخی کا endpoint نہیں ہے» mirrors the shipped `sound.stop.warning` word for word; «حتمی چارج» matches `sound.cost.estimated_zero`; «endpoint» stays Latin as the shipped sibling keeps it.
- «گیٹ» has a shipped anchor (`تمام گیٹس کامیاب ہونے پر`); «مسترد» matches the shipped mesh-approval denial label; «ٹول» follows the glossary's tool → ٹول.

## 5. Fit — PASS

These 12 keys carry **no `maxCells`/`maxChars` hint** in the English sidecar — length is prose only
("two to four words", "one short sentence", "keep it short enough not to wrap") — so there is no numeric
budget to violate. Measured widths (approximate terminal cells: wide CJK 2, marks/format 0, U+202F 1 per
the fr guide; measured from the draft bytes, not from a real formatter):

cancelled_batch 190 cells (en 157, +21% — the widest select in the slice); cancel.queued 82 vs 64; labels 5–17 cells, all but two narrower than English.

Labels render in the card's wrapping `text-meta` block and state lines wrap inside the card, so the risk
here is wrapping, not clipping. No value reaches a width that would change how the card reads.

## 6. RTL — PASS

Storage is logical order and no value carries a manual bidi mark. The two Latin islands in this slice — `endpoint` in `cancel.running` and `id` in `error_class.duplicate_id` — sit between Urdu words in logical order, so under the render layer's per-string FSI/PDI the LTR run resolves left-to-right while the sentence reads right-to-left; nothing in the copy reorders them, and no arrow or glyph hint appears that could mirror wrongly. Sentence order is RTL-correct in every value (verb-final clauses, ۔ and ؛ in the right places, no sentence-final Latin punctuation). The TUI's best-effort stance is a documented, degraded rendering condition, not a defect to compensate for in the copy.

## 7. Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| UR-2-01 | NIT | …image_gen.error_class.duplicate_id | مکرر id | The only lowercase Latin id in ur prose in this slice. Shipped ur writes the token as ID in prose (25 values: «ایجنٹ ID», «سیشن ID»); every lowercase id in the shipped catalogue is an ICU {id} placeholder, i.e. machine syntax. English is lowercase «Duplicate id», so mirroring it is defensible, but it introduces a second token form in a locale that has one. | «مکرر ID» — keeps the English word order and adopts the locale's prose token form. |
| UR-2-02 | NIT | …image_gen.error_class.audio_rate_limited | آڈیو کی شرح محدود | A second construction on the product's rate-limit concept: the settled noun is «شرح کی حد» (11 shipped values across error_block.rate_limit.*, code_review.host.cooling, usage_reset.chip_label), while this label uses the adjective form «شرح محدود» («audio's rate [is] limited»). Meaning is intact and the class is distinct, so this is a consistency call, not an error. | «آڈیو پر شرح کی حد» (keeps the shipped noun, avoids the double possessive the translator rejected); «آڈیو کی شرح محدود» is acceptable if the wave prefers the state form and records it. |
| UR-2-03 | NIT | …image_gen.cancel.running | … آڈیو بننے پر چارج لگے گا۔ | One surface family, two nouns for the charged amount: the shipped ui.chat.canonical.sound.stop.warning renders this identical English clause with «لاگت لگے گی», while this draft uses «چارج». The draft is the better word (it matches shipped «کوئی چارج نہیں» and «حتمی چارج»), so no change is owed to the draft — the drift is on the shipped side. | No change to this draft. Harmonise the shipped sound.stop.warning (لاگت → چارج) in a later wave and record charge vs cost as a glossary pair so the next wave cannot re-litigate it. |

**Checked and accepted (not findings):** «تخلیق» for generation is the shipped audio-lane word («تخلیق جاری رہے گی» in `sound.stop.warning`), so it is not a new term. «کال کیے جانے سے پہلے» in `cancel.queued` sits beside the sibling `stop_hint_queued` «درخواست بھیجے جانے سے پہلے»; both are shipped vocabulary, so harmonising them is optional.

## 8. Terminal verdict

`passed` for `ur` / `ui.chat.canonical` / S16e-renderer on head `bd8e9054…`:
**0 BLOCKER, 0 MAJOR**, 0 MINOR, 3 NIT. All three findings are NIT; the draft can ship as it stands, with the token-form and vocabulary notes recorded for the next wave.
Verdict is bound to the en source (`b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`) and the draft (`e9666a75e6d318448b530290d99ab3c88b8a29901e3fa8beeb5c3411f7fa4051`); if either moves, the
delta must be re-judged rather than this row re-pointed. This is a draft-slice receipt, not permission
to claim a full-file audit hash: the coder still owes post-integration byte-compatibility proof and the
`ledger.py append` binding. No rendered, browser, pseudo-localization or native-speaker evidence is
claimed by this pass — none was executed.
