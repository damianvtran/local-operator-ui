# Second independent audit — `es` · `ui.chat.canonical` · slice S16e-renderer

**Verdict: `passed`** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 0 NIT.
PR `damianvtran/local-operator-ui#1884` (`S16e-renderer`). Second independent pass for a
high-visibility group; the first pass is a different session and was read only **after** my own
per-key judgement was written down (divergences in `divergences.md`).
Slice-wide: **84/84 values read** (12 keys × fr/es/ru/vi/zh-CN/hi/ur); this file is the `es` row.

| | |
|---|---|
| Locale / namespace | `es` / `ui.chat.canonical` |
| Keys audited | 12 / 12 — every key in the assigned group |
| Draft audited | `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/es/draft-es-s16e.json` · sha256 `b9290ae76d05774eeca47b3bea438ac6df0be03c7907efaa3cb93a5d6082a50c` (matches the task manifest) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `bd8e9054` · sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` · sha256 `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Brief (`en` + `context`) | `s16e-brief.json` · sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` — its 12 `en` values and 12 `context` objects are byte-equal to the repo catalogue and sidecar (verified, 0 mismatches) |
| Shipped `es` catalogue (terminology authority) | sha256 `547b85e9670eec79f82211f50325092bf75c13eda4504995cce1a1d5ab25e272` (467 keys; English 479 — the 12-key gap is exactly this slice, 0 of the 12 exist yet) |
| Glossary / style guide | `0eb34437…962f8` / `77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` — read-only: no edit, commit, install, build, browser or renderer run |
| Auditor | `i18n-auditor`, session `cc045047b39e`, model **`deepseek/deepseek-flash`** (session runtime model; **no fallback** used) |
| Independence | Not the translator's instance, not the first-pass auditor's instance; I authored none of these 84 values and edited nothing. No translation/MT service, no back-translation: every judgement is a reading of the English, the sidecar, the shipped `es` corpus, the glossary and the `es` style guide. |

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

| Key | English contract | `es` carries |
|---|---|---|
| `cancel.queued` | the ONLY place that may promise no charge; must not soften into a maybe | «Se detuvo antes de llamar al proveedor; no se te cobrará.» — flat, not a maybe |
| `cancel.running` | stop is a REQUEST; the provider may still bill; must never read as "nothing was charged" | «Detención solicitada. El proveedor no tiene un endpoint de cancelación; la generación continúa y se cobrará si produce audio.» — request + conditional charge |
| `settlement.pending` | states that a charge is outstanding; never an amount, never a zero | «Cobro final pendiente — aparecerá en cuanto el proveedor lo comunique.» — no amount, no zero |

No value in this slice negates, weakens or converts one of these into a guarantee it should not make;
`cancel.running` and `settlement.pending` never merge into one claim, and `cancel.checking` stays a
separate sentence because the callsite joins it with its own full stop.
The six failure-class labels stay textually distinct from each other and from the prose sentence
rendered under them (no label reuses its own sentence).

## 3. Idiom, register, typography — PASS

Typography: no space before `: ; ? !` (the Spanish rule), half-width punctuation inside prose, spaced em dash in `settlement.pending`, no double spaces, no ¿…? needed because no value is a whole-string question.

Register checks: formality is the guide's own (tú («Espera», «vuelve a intentarlo»), neutral Spanish, no vosotros, no !), no exclamation marks, no padding
honorifics or politeness the English does not have, sentence case throughout, label keys carry no full
stop and prose keys do.

## 4. Terminology — PASS

Every material noun, the batch noun, and the failure-class vocabulary were compared with the shipped
`es` catalogue rather than assumed: batch/material nouns, denial label, gate vocabulary,
rate-limit vocabulary, charge/settlement vocabulary, and `endpoint` (kept Latin and undeclined exactly
as the shipped `ui.chat.canonical.sound.stop.warning` keeps it; zh-CN keeps its own shipped 接口).
Kept-English in this slice is confined to the glossary's set — `endpoint` where the locale's sibling
copy keeps it, the documented `id`/`ID` token, and the `{material}` syntax. Nothing else Latin was
introduced, which is exactly what the operator's "no English left in the interface" requirement turns
on: the only Latin a `es` user sees here is glossary-sanctioned.

- «lote de vídeos / locuciones / efectos de sonido» and «imágenes» are byte-identical to the shipped `state.done_batch` and `state.failed_batch`.
- «se cobrará si produce audio» / «endpoint de cancelación» mirror the shipped `sound.stop.warning`; «cobro final» mirrors `sound.cost.estimated_zero`.
- «Denegado» matches the shipped approval-denial label; «Herramienta desconocida» uses the glossary's tool → herramienta.

## 5. Fit — PASS

These 12 keys carry **no `maxCells`/`maxChars` hint** in the English sidecar — length is prose only
("two to four words", "one short sentence", "keep it short enough not to wrap") — so there is no numeric
budget to violate. Measured widths (approximate terminal cells: wide CJK 2, marks/format 0, U+202F 1 per
the fr guide; measured from the draft bytes, not from a real formatter):

cancelled_batch 195 cells (en 157, the widest growth in the slice: +24%, driven by «Se detuvo el lote de efectos de sonido.»); cancel.running 125 = 125 en; labels 8–23 cells, widest «Herramienta desconocida» 23 vs 12.

Labels render in the card's wrapping `text-meta` block and state lines wrap inside the card, so the risk
here is wrapping, not clipping. No value reaches a width that would change how the card reads.

## 6. RTL — n/a — es is LTR; no bidi controls.

No RTL surface in this locale, so there is no bidi risk to report: no manual bidi marks and no mirrored glyphs in the copy.

## 7. Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| _(none)_ | — | — | — | No finding at any severity. | — |

**Checked and accepted (not findings):** `gate_failed` «Bloqueo por política» names the reason where English names the mechanism — no es catalogue renders «gate» as a noun, «bloqueo» is the shipped blocking word, and the label stays distinct from «Denegado». `audio_rate_limited` «Audio saturado» agrees with the sentence under it («está saturada ahora mismo»). Both were considered as findings and rejected as too weak to record.

## 8. Terminal verdict

`passed` for `es` / `ui.chat.canonical` / S16e-renderer on head `bd8e9054…`:
**0 BLOCKER, 0 MAJOR**, 0 MINOR, 0 NIT. No finding at any severity; nothing to remediate.
Verdict is bound to the en source (`b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`) and the draft (`b9290ae76d05774eeca47b3bea438ac6df0be03c7907efaa3cb93a5d6082a50c`); if either moves, the
delta must be re-judged rather than this row re-pointed. This is a draft-slice receipt, not permission
to claim a full-file audit hash: the coder still owes post-integration byte-compatibility proof and the
`ledger.py append` binding. No rendered, browser, pseudo-localization or native-speaker evidence is
claimed by this pass — none was executed.
