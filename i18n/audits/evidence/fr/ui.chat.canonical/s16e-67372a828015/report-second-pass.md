# Second independent audit — `fr` · `ui.chat.canonical` · slice S16e-renderer

**Verdict: `passed`** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 2 NIT.
PR `damianvtran/local-operator-ui#1884` (`S16e-renderer`). Second independent pass for a
high-visibility group; the first pass is a different session and was read only **after** my own
per-key judgement was written down (divergences in `divergences.md`).
Slice-wide: **84/84 values read** (12 keys × fr/es/ru/vi/zh-CN/hi/ur); this file is the `fr` row.

| | |
|---|---|
| Locale / namespace | `fr` / `ui.chat.canonical` |
| Keys audited | 12 / 12 — every key in the assigned group |
| Draft audited | `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/fr/draft-fr-s16e.json` · sha256 `a46fdb56c6007dd225382a8f94f4972d7a4dfc6aaaab790dca2d7cdf27b4da62` (matches the task manifest) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `bd8e9054` · sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` · sha256 `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Brief (`en` + `context`) | `s16e-brief.json` · sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` — its 12 `en` values and 12 `context` objects are byte-equal to the repo catalogue and sidecar (verified, 0 mismatches) |
| Shipped `fr` catalogue (terminology authority) | sha256 `99f7c0b27d6c75b16935cc58874477cab24da430284576defaacf19e209c88f6` (467 keys; English 479 — the 12-key gap is exactly this slice, 0 of the 12 exist yet) |
| Glossary / style guide | `0eb34437…962f8` / `ae1519ab7617d19aa826918d607de1d018595094166edbc18aa58f6a8f0a4226` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` — read-only: no edit, commit, install, build, browser or renderer run |
| Auditor | `i18n-auditor`, session `cc045047b39e`, model **`deepseek/deepseek-flash`** (session runtime model; **no fallback** used) |
| Independence | Not the translator's instance, not the first-pass auditor's instance; I authored none of these 84 values and edited nothing. No translation/MT service, no back-translation: every judgement is a reading of the English, the sidecar, the shipped `fr` corpus, the glossary and the `fr` style guide. |

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

| Key | English contract | `fr` carries |
|---|---|---|
| `cancel.queued` | the ONLY place that may promise no charge; must not soften into a maybe | «Arrêtée avant l’appel au fournisseur ; vous ne serez pas facturé.» — flat, not a maybe |
| `cancel.running` | stop is a REQUEST; the provider may still bill; must never read as "nothing was charged" | «Arrêt demandé. Le fournisseur ne dispose d’aucun endpoint d’annulation ; la génération continue et sera facturée si elle produit un audio.» — request + conditional charge |
| `settlement.pending` | states that a charge is outstanding; never an amount, never a zero | «Règlement en attente — les frais finaux apparaîtront dès que le fournisseur les aura communiqués.» — no amount, no zero |

No value in this slice negates, weakens or converts one of these into a guarantee it should not make;
`cancel.running` and `settlement.pending` never merge into one claim, and `cancel.checking` stays a
separate sentence because the callsite joins it with its own full stop.
The six failure-class labels stay textually distinct from each other and from the prose sentence
rendered under them (no label reuses its own sentence).

## 3. Idiom, register, typography — PASS (see §7)

Typography verified at codepoint level: U+202F (espace fine insécable) precedes every «;», apostrophes are U+2019 (no ASCII '), there is no U+00A0 anywhere, the em dash in `settlement.pending` is space-padded, and no value has a double space. Status fragments use past participles («Arrêt demandé», «Arrêtée avant l’appel au fournisseur») per the fr guide, with the terse past-participle status convention the guide records.

Register checks: formality is the guide's own (vous, lowercase mid-sentence; imperatives («Patientez», «réessayez»), no «Veuillez»), no exclamation marks, no padding
honorifics or politeness the English does not have, sentence case throughout, label keys carry no full
stop and prose keys do.

## 4. Terminology — PASS (see §7)

Every material noun, the batch noun, and the failure-class vocabulary were compared with the shipped
`fr` catalogue rather than assumed: batch/material nouns, denial label, gate vocabulary,
rate-limit vocabulary, charge/settlement vocabulary, and `endpoint` (kept Latin and undeclined exactly
as the shipped `ui.chat.canonical.sound.stop.warning` keeps it; zh-CN keeps its own shipped 接口).
Kept-English in this slice is confined to the glossary's set — `endpoint` where the locale's sibling
copy keeps it, the documented `id`/`ID` token, and the `{material}` syntax. Nothing else Latin was
introduced, which is exactly what the operator's "no English left in the interface" requirement turns
on: the only Latin a `fr` user sees here is glossary-sanctioned.

- «lot» + material and «voix off / effets sonores» are byte-identical to the shipped `state.done_batch` and `state.failed_batch`, so the stopped line reads as the same family.
- «endpoint d’annulation» and «sera facturée si elle produit un audio» are near-verbatim from the shipped `sound.stop.warning` — the same billing fact gets one wording.
- «Refusé» matches the shipped browser-approval denial label; «Outil inconnu» uses the glossary's tool → outil; «frais finaux» matches `sound.cost.estimated_zero`.

## 5. Fit — PASS

These 12 keys carry **no `maxCells`/`maxChars` hint** in the English sidecar — length is prose only
("two to four words", "one short sentence", "keep it short enough not to wrap") — so there is no numeric
budget to violate. Measured widths (approximate terminal cells: wide CJK 2, marks/format 0, U+202F 1 per
the fr guide; measured from the draft bytes, not from a real formatter):

cancelled_batch 158 cells (en 157); cancel.running 138 (en 125); settlement.pending 97 (en 79); labels 6–19 cells, all but `gate_failed` (17 vs 11) within one or two cells of English.

Labels render in the card's wrapping `text-meta` block and state lines wrap inside the card, so the risk
here is wrapping, not clipping. No value reaches a width that would change how the card reads.

## 6. RTL — n/a — fr is LTR; no bidi controls, no mirrored glyphs.

No RTL surface in this locale, so there is no bidi risk to report: no manual bidi marks and no mirrored glyphs in the copy.

## 7. Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| FR-2-01 | NIT | …image_gen.error_class.audio_rate_limited | Débit audio limité | A third construction on the rate-limit concept. The shipped fr corpus writes it as «limite de débit» (9 values, e.g. ui.chat.error_block.rate_limit.before) and «{host} limité en débit» (ui.code_review.host.cooling). Noun-first «Débit audio limité» reads first as an audio-bitrate cap in a card whose subject is audio. Not misleading — the sentence below («La génération audio est très sollicitée en ce moment.») names the condition — and the class stays distinct from the other five. | «Audio limité en débit» (21 cells, keeps the corpus construction and its own word «débit»), or keep as is and let the sentence below disambiguate. |
| FR-2-02 | NIT | …image_gen.settlement.pending + …image_gen.cancel.checking | Règlement en attente — … / Vérification du règlement. | «règlement» has 0 occurrences in the shipped fr catalogue (467 keys) and no glossary row, so it is a new programme term introduced silently; it is also the homonym of «règlement» = rules, which is the weaker reading of «Vérification du règlement.» in isolation. The corpus states the same pending-charge fact with «frais finaux non confirmés» (ui.chat.canonical.sound.cost.estimated_zero). Both keys use «règlement» consistently, so nothing collides inside the slice. | Either record settlement → «règlement» as a glossary row (then both keys stand), or align to the corpus family: «Frais finaux en attente — les frais finaux apparaîtront dès que le fournisseur les aura communiqués.» / «Vérification des frais.» |

**Checked and accepted (not findings):** «La génération audio est très sollicitée en ce moment.» is the fr guide's vous register with no promise and no wait time; «Arrêtée» is the guide's past-participle status convention (referent «la génération», feminine); «ID en double» uses the corpus's own casing (28 uppercase `ID`, 0 lowercase in prose).

## 8. Terminal verdict

`passed` for `fr` / `ui.chat.canonical` / S16e-renderer on head `bd8e9054…`:
**0 BLOCKER, 0 MAJOR**, 0 MINOR, 2 NIT. Both findings are NIT and none gates: the slice can ship as drafted, with the two wording notes recorded for the next wave.
Verdict is bound to the en source (`b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`) and the draft (`a46fdb56c6007dd225382a8f94f4972d7a4dfc6aaaab790dca2d7cdf27b4da62`); if either moves, the
delta must be re-judged rather than this row re-pointed. This is a draft-slice receipt, not permission
to claim a full-file audit hash: the coder still owes post-integration byte-compatibility proof and the
`ledger.py append` binding. No rendered, browser, pseudo-localization or native-speaker evidence is
claimed by this pass — none was executed.
