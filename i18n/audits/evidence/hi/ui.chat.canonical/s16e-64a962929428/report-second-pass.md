# Second independent audit — `hi` · `ui.chat.canonical` · slice S16e-renderer

**Verdict: `passed`** — 0 BLOCKER · 0 MAJOR · 1 MINOR · 1 NIT.
PR `damianvtran/local-operator-ui#1884` (`S16e-renderer`). Second independent pass for a
high-visibility group; the first pass is a different session and was read only **after** my own
per-key judgement was written down (divergences in `divergences.md`).
Slice-wide: **84/84 values read** (12 keys × fr/es/ru/vi/zh-CN/hi/ur); this file is the `hi` row.

| | |
|---|---|
| Locale / namespace | `hi` / `ui.chat.canonical` |
| Keys audited | 12 / 12 — every key in the assigned group |
| Draft audited | `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/hi/draft-hi-s16e.json` · sha256 `41e9e50f80fb89f3d39a822b1fb95461f3d8b4cd9ece1b3ed899c1fec39a9831` (matches the task manifest) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `bd8e9054` · sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` · sha256 `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Brief (`en` + `context`) | `s16e-brief.json` · sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` — its 12 `en` values and 12 `context` objects are byte-equal to the repo catalogue and sidecar (verified, 0 mismatches) |
| Shipped `hi` catalogue (terminology authority) | sha256 `5bad55ca446e6e2e0bc853d503d94280f444cd009402431c65e8ce997528689b` (467 keys; English 479 — the 12-key gap is exactly this slice, 0 of the 12 exist yet) |
| Glossary / style guide | `0eb34437…962f8` / `82292dc8d13fcc93dc752457719264aed3cc20bb65ecfaba0f0e5a31f4cb40d5` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` — read-only: no edit, commit, install, build, browser or renderer run |
| Auditor | `i18n-auditor`, session `cc045047b39e`, model **`deepseek/deepseek-flash`** (session runtime model; **no fallback** used) |
| Independence | Not the translator's instance, not the first-pass auditor's instance; I authored none of these 84 values and edited nothing. No translation/MT service, no back-translation: every judgement is a reading of the English, the sidecar, the shipped `hi` corpus, the glossary and the `hi` style guide. |

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

| Key | English contract | `hi` carries |
|---|---|---|
| `cancel.queued` | the ONLY place that may promise no charge; must not soften into a maybe | «प्रोवाइडर को कॉल किए जाने से पहले रोक दिया गया; कोई शुल्क नहीं लगेगा।» — flat, not a maybe |
| `cancel.running` | stop is a REQUEST; the provider may still bill; must never read as "nothing was charged" | «रोकने का अनुरोध किया गया। प्रोवाइडर के पास रद्द करने का कोई endpoint नहीं है; जनरेशन जारी रहेगा और ऑडियो बनने पर उसका शुल्क लगेगा।» — request + conditional charge |
| `settlement.pending` | states that a charge is outstanding; never an amount, never a zero | «शुल्क की पुष्टि लंबित — प्रोवाइडर के रिपोर्ट करने पर अंतिम शुल्क दिखेगा।» — no amount, no zero |

No value in this slice negates, weakens or converts one of these into a guarantee it should not make;
`cancel.running` and `settlement.pending` never merge into one claim, and `cancel.checking` stays a
separate sentence because the callsite joins it with its own full stop.
The six failure-class labels stay textually distinct from each other and from the prose sentence
rendered under them (no label reuses its own sentence).

## 3. Idiom, register, typography — PASS (1 MINOR, 1 NIT)

Typography: danda । ends every prose value; the ASCII «;» is hi house style (176 shipped values use it), so the clause separator is correct — the only thing checked as wrong would be a half-width full stop after Devanagari, and there is none. No ZWJ/ZWNJ inserted where the orthography does not require them; spaced em dash in `settlement.pending`.

Register checks: formality is the guide's own (आप, polite imperatives («करें», «कोशिश करें»), no कृपया padding, no !, nukta kept (इफ़ेक्ट, फ़ाइल)), no exclamation marks, no padding
honorifics or politeness the English does not have, sentence case throughout, label keys carry no full
stop and prose keys do.

## 4. Terminology — PASS

Every material noun, the batch noun, and the failure-class vocabulary were compared with the shipped
`hi` catalogue rather than assumed: batch/material nouns, denial label, gate vocabulary,
rate-limit vocabulary, charge/settlement vocabulary, and `endpoint` (kept Latin and undeclined exactly
as the shipped `ui.chat.canonical.sound.stop.warning` keeps it; zh-CN keeps its own shipped 接口).
Kept-English in this slice is confined to the glossary's set — `endpoint` where the locale's sibling
copy keeps it, the documented `id`/`ID` token, and the `{material}` syntax. Nothing else Latin was
introduced, which is exactly what the operator's "no English left in the interface" requirement turns
on: the only Latin a `hi` user sees here is glossary-sanctioned.

- «वीडियो का बैच / वॉइसओवर का बैच / साउंड इफ़ेक्ट का बैच / तस्वीरों का बैच» are byte-identical to the shipped `state.done_batch` and `state.failed_batch`.
- «प्रोवाइडर के पास रद्द करने का कोई endpoint नहीं है» / «ऑडियो बनने पर उसका शुल्क लगेगा» mirror the shipped `sound.stop.warning` almost word for word; «अंतिम शुल्क» mirrors `sound.cost.estimated_zero`. `endpoint` stays Latin, exactly as the shipped sibling does.
- «दर सीमा» is shipped (`…पर दर सीमा लगी है`, and the hyphenated noun «दर-सीमा» in usage_reset), so the vocabulary is the product's; «गेट» has one shipped anchor; «अस्वीकृत» matches the shipped mesh-approval denial label; «टूल» follows the glossary's tool → टूल.

## 5. Fit — PASS

These 12 keys carry **no `maxCells`/`maxChars` hint** in the English sidecar — length is prose only
("two to four words", "one short sentence", "keep it short enough not to wrap") — so there is no numeric
budget to violate. Measured widths (approximate terminal cells: wide CJK 2, marks/format 0, U+202F 1 per
the fr guide; measured from the draft bytes, not from a real formatter):

cancelled_batch 174 cells (en 157); cancel.running 116 vs 125 en; labels 6–13 cells, all but «अमान्य आर्ग्युमेंट» (12 vs 17) wider than English by two cells or fewer.

Labels render in the card's wrapping `text-meta` block and state lines wrap inside the card, so the risk
here is wrapping, not clipping. No value reaches a width that would change how the card reads.

## 6. RTL — n/a — hi is LTR; no bidi controls.

No RTL surface in this locale, so there is no bidi risk to report: no manual bidi marks and no mirrored glyphs in the copy.

## 7. Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| HI-2-01 | MINOR | …image_gen.cancel.checking | शुल्क की पुष्टि जाँची जा रही है। | Pleonastic double passive: the object of «जाँची जा रही है» is «पुष्टि», so the line says the confirmation is being examined rather than the charge being confirmed. The shipped construction this borrows from takes a report as its object (ui.chat.pickers.usage_view.checking_for_an_updated_usage_report), so the pattern does not carry over to पुष्टि. The key's contract is a three-word neutral status sentence; this runs to eight words. | «शुल्क की पुष्टि की जा रही है।» (confirmation of the charge is underway; keeps पुष्टि and the charge noun). |
| HI-2-02 | NIT | …image_gen.error_class.audio_rate_limited | ऑडियो दर सीमा | A bare noun compound names the constraint where the other five labels name the state or failure (अस्वीकृत, गेट विफल, अज्ञात टूल, अमान्य आर्ग्युमेंट, डुप्लिकेट id). It is grammatical as a label and the sentence below carries the meaning, but the shipped hi corpus only hyphenates this noun (दर-सीमा / दर-सीमाएँ) or uses it inside a clause (दर सीमा लगी है). | «ऑडियो दर-सीमा» (hyphenated noun, matching the shipped form) if the noun label is kept; a participle form would read as a state but has no shipped precedent to anchor it. |

**Checked and accepted (not findings):** «अभी ऑडियो जनरेशन व्यस्त है» puts the load on the generation exactly as the English does, and «थोड़ी देर में फिर कोशिश करें» promises nothing and names no wait time. «डुप्लिकेट id» keeps Latin `id`; hi prose ships lowercase `id` in 5 values, so this is the locale's own habit, not an English leak. «अमान्य आर्ग्युमेंट» uses the shipped transliteration (8 shipped values).

## 8. Terminal verdict

`passed` for `hi` / `ui.chat.canonical` / S16e-renderer on head `bd8e9054…`:
**0 BLOCKER, 0 MAJOR**, 1 MINOR, 1 NIT. The MINOR is one status line's wording; it does not block the slice.
Verdict is bound to the en source (`b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`) and the draft (`41e9e50f80fb89f3d39a822b1fb95461f3d8b4cd9ece1b3ed899c1fec39a9831`); if either moves, the
delta must be re-judged rather than this row re-pointed. This is a draft-slice receipt, not permission
to claim a full-file audit hash: the coder still owes post-integration byte-compatibility proof and the
`ledger.py append` binding. No rendered, browser, pseudo-localization or native-speaker evidence is
claimed by this pass — none was executed.
