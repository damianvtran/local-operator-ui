# Second independent audit — `ru` · `ui.chat.canonical` · slice S16e-renderer

**Verdict: `passed`** — 0 BLOCKER · 0 MAJOR · 0 MINOR · 0 NIT.
PR `damianvtran/local-operator-ui#1884` (`S16e-renderer`). Second independent pass for a
high-visibility group; the first pass is a different session and was read only **after** my own
per-key judgement was written down (divergences in `divergences.md`).
Slice-wide: **84/84 values read** (12 keys × fr/es/ru/vi/zh-CN/hi/ur); this file is the `ru` row.

| | |
|---|---|
| Locale / namespace | `ru` / `ui.chat.canonical` |
| Keys audited | 12 / 12 — every key in the assigned group |
| Draft audited | `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/ru/draft-ru-s16e.json` · sha256 `ccc4674d071cc725e48f54c2becd2ac38eaa9004dbcdde8890ecaeedcf9c6060` (matches the task manifest) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `bd8e9054` · sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` · sha256 `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Brief (`en` + `context`) | `s16e-brief.json` · sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` — its 12 `en` values and 12 `context` objects are byte-equal to the repo catalogue and sidecar (verified, 0 mismatches) |
| Shipped `ru` catalogue (terminology authority) | sha256 `fddef0897968450fb0157457dda37f7472fa467b4df1aea68af16bbe260f10f1` (467 keys; English 479 — the 12-key gap is exactly this slice, 0 of the 12 exist yet) |
| Glossary / style guide | `0eb34437…962f8` / `f20e1cafaf70578c17ce072c71725628808d228e4be5604329f8da30386f1fb5` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` — read-only: no edit, commit, install, build, browser or renderer run |
| Auditor | `i18n-auditor`, session `cc045047b39e`, model **`deepseek/deepseek-flash`** (session runtime model; **no fallback** used) |
| Independence | Not the translator's instance, not the first-pass auditor's instance; I authored none of these 84 values and edited nothing. No translation/MT service, no back-translation: every judgement is a reading of the English, the sidecar, the shipped `ru` corpus, the glossary and the `ru` style guide. |

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

| Key | English contract | `ru` carries |
|---|---|---|
| `cancel.queued` | the ONLY place that may promise no charge; must not soften into a maybe | «Остановлено до обращения к провайдеру; плата не взимается.» — flat, not a maybe |
| `cancel.running` | stop is a REQUEST; the provider may still bill; must never read as "nothing was charged" | «Запрошена остановка. У провайдера нет endpoint для отмены; генерация продолжится, и если она создаст аудио, за него будет взиматься плата.» — request + conditional charge |
| `settlement.pending` | states that a charge is outstanding; never an amount, never a zero | «Расчёт ещё не завершён — итоговая плата появится, как только провайдер сообщит о ней.» — no amount, no zero |

No value in this slice negates, weakens or converts one of these into a guarantee it should not make;
`cancel.running` and `settlement.pending` never merge into one claim, and `cancel.checking` stays a
separate sentence because the callsite joins it with its own full stop.
The six failure-class labels stay textually distinct from each other and from the prose sentence
rendered under them (no label reuses its own sentence).

## 3. Idiom, register, typography — PASS

Typography: no space before `: ; ! ?`, spaced em dash in `settlement.pending`, no invisible characters (codepoint scan found none), no ellipsis or «ёлочки» needed in this slice.

Register checks: formality is the guide's own (вы, impersonal where Russian prefers it («Остановлено до обращения к провайдеру», «Запрошена остановка»), no «Пожалуйста», no !), no exclamation marks, no padding
honorifics or politeness the English does not have, sentence case throughout, label keys carry no full
stop and prose keys do.

## 4. Terminology — PASS

Every material noun, the batch noun, and the failure-class vocabulary were compared with the shipped
`ru` catalogue rather than assumed: batch/material nouns, denial label, gate vocabulary,
rate-limit vocabulary, charge/settlement vocabulary, and `endpoint` (kept Latin and undeclined exactly
as the shipped `ui.chat.canonical.sound.stop.warning` keeps it; zh-CN keeps its own shipped 接口).
Kept-English in this slice is confined to the glossary's set — `endpoint` where the locale's sibling
copy keeps it, the documented `id`/`ID` token, and the `{material}` syntax. Nothing else Latin was
introduced, which is exactly what the operator's "no English left in the interface" requirement turns
on: the only Latin a `ru` user sees here is glossary-sanctioned.

- «Набор» + genitive material is byte-identical to the shipped `state.done_batch` and `state.failed_batch`; the short passive «остановлен» agrees with «набор» in all four branches, so no branch can flip the participle's gender.
- «endpoint» is Latin and undeclined, exactly as the shipped `sound.stop.warning`; «будет взиматься плата» / «итоговая плата» match `sound.cost.no_charge` and `sound.cost.estimated_zero`.
- «Запрещено» matches the shipped ru browser-approval denial label; «Неизвестный инструмент» uses the glossary's tool → инструмент; uppercase `ID` is an established ru habit (28 shipped values across 14 catalogues).

## 5. Fit — PASS

These 12 keys carry **no `maxCells`/`maxChars` hint** in the English sidecar — length is prose only
("two to four words", "one short sentence", "keep it short enough not to wrap") — so there is no numeric
budget to violate. Measured widths (approximate terminal cells: wide CJK 2, marks/format 0, U+202F 1 per
the fr guide; measured from the draft bytes, not from a real formatter):

cancelled_batch 178 cells (en 157); cancel.running 138 (en 125); labels 9–22 cells, widest «Неизвестный инструмент» 22 vs 12 — the ru guide expects 20–30% growth, so this matches the documented behaviour rather than departing from it.

Labels render in the card's wrapping `text-meta` block and state lines wrap inside the card, so the risk
here is wrapping, not clipping. No value reaches a width that would change how the card reads.

## 6. RTL — n/a — ru is LTR; no bidi controls.

No RTL surface in this locale, so there is no bidi risk to report: no manual bidi marks and no mirrored glyphs in the copy.

## 7. Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| _(none)_ | — | — | — | No finding at any severity. | — |

**Checked and accepted (not findings):** «Генерация аудио сейчас перегружена» attributes busyness to the process exactly as the English does («Audio generation is busy»), so it is faithful rather than a register slip. «Лимит аудио» uses the corpus's own rate-limit word («достигнут лимит продолжений», «Вы исчерпали лимит запросов»). «Проверка не пройдена» — I checked it against `code_review.attention.checks` («проверки не проходят») and found the two senses compatible: a policy gate failing *is* a check that did not pass, so treating the collision as a defect would be wrong. «Расчёт» has no shipped precedent, but it is the standard billing word with no homonym trap, used consistently across the two keys that need it.

## 8. Terminal verdict

`passed` for `ru` / `ui.chat.canonical` / S16e-renderer on head `bd8e9054…`:
**0 BLOCKER, 0 MAJOR**, 0 MINOR, 0 NIT. No finding at any severity; nothing to remediate.
Verdict is bound to the en source (`b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`) and the draft (`ccc4674d071cc725e48f54c2becd2ac38eaa9004dbcdde8890ecaeedcf9c6060`); if either moves, the
delta must be re-judged rather than this row re-pointed. This is a draft-slice receipt, not permission
to claim a full-file audit hash: the coder still owes post-integration byte-compatibility proof and the
`ledger.py append` binding. No rendered, browser, pseudo-localization or native-speaker evidence is
claimed by this pass — none was executed.
