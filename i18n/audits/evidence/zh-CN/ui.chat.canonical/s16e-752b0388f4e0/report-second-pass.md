# Second independent audit — `zh-CN` · `ui.chat.canonical` · slice S16e-renderer

**Verdict: `passed`** — 0 BLOCKER · 0 MAJOR · 1 MINOR · 0 NIT.
PR `damianvtran/local-operator-ui#1884` (`S16e-renderer`). Second independent pass for a
high-visibility group; the first pass is a different session and was read only **after** my own
per-key judgement was written down (divergences in `divergences.md`).
Slice-wide: **84/84 values read** (12 keys × fr/es/ru/vi/zh-CN/hi/ur); this file is the `zh-CN` row.

| | |
|---|---|
| Locale / namespace | `zh-CN` / `ui.chat.canonical` |
| Keys audited | 12 / 12 — every key in the assigned group |
| Draft audited | `/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e/zh-CN/draft-zh-CN-s16e.json` · sha256 `121951c9665e715dcec2b993d85cb3d77d51c00651da275a573aa75ae6bb5688` (matches the task manifest) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `bd8e9054` · sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` · sha256 `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Brief (`en` + `context`) | `s16e-brief.json` · sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` — its 12 `en` values and 12 `context` objects are byte-equal to the repo catalogue and sidecar (verified, 0 mismatches) |
| Shipped `zh-CN` catalogue (terminology authority) | sha256 `35f8058839549d4a8be28792c279784c75a624b9c076fc98d359bae1fe1db12c` (467 keys; English 479 — the 12-key gap is exactly this slice, 0 of the 12 exist yet) |
| Glossary / style guide | `0eb34437…962f8` / `8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` — read-only: no edit, commit, install, build, browser or renderer run |
| Auditor | `i18n-auditor`, session `cc045047b39e`, model **`deepseek/deepseek-flash`** (session runtime model; **no fallback** used) |
| Independence | Not the translator's instance, not the first-pass auditor's instance; I authored none of these 84 values and edited nothing. No translation/MT service, no back-translation: every judgement is a reading of the English, the sidecar, the shipped `zh-CN` corpus, the glossary and the `zh-CN` style guide. |

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

| Key | English contract | `zh-CN` carries |
|---|---|---|
| `cancel.queued` | the ONLY place that may promise no charge; must not soften into a maybe | «已在调用提供商之前停止，不会计费。» — flat, not a maybe |
| `cancel.running` | stop is a REQUEST; the provider may still bill; must never read as "nothing was charged" | «已请求停止。提供商没有取消接口；生成仍会继续，若产出音频则会计费。» — request + conditional charge |
| `settlement.pending` | states that a charge is outstanding; never an amount, never a zero | «结算尚未完成——最终计费将在提供商报告后显示。» — no amount, no zero |

No value in this slice negates, weakens or converts one of these into a guarantee it should not make;
`cancel.running` and `settlement.pending` never merge into one claim, and `cancel.checking` stays a
separate sentence because the callsite joins it with its own full stop.
The six failure-class labels stay textually distinct from each other and from the prose sentence
rendered under them (no label reuses its own sentence).

## 3. Idiom, register, typography — PASS

Typography: full-width ，。； inside prose; the `settlement.pending` dash is the Chinese two-mark «——» with no spaces; no half-width punctuation after Chinese text; no space between Chinese and Latin (`重复ID`); every label carries no 。 and every prose value carries one, per the key contracts (no sentence-final 。 on the six labels; complete sentences keep it).

Register checks: formality is the guide's own (你/您 not needed — verb-forward, pronouns dropped; no 请, no ！, no 啦/哦/呀), no exclamation marks, no padding
honorifics or politeness the English does not have, sentence case throughout, label keys carry no full
stop and prose keys do.

## 4. Terminology — PASS

Every material noun, the batch noun, and the failure-class vocabulary were compared with the shipped
`zh-CN` catalogue rather than assumed: batch/material nouns, denial label, gate vocabulary,
rate-limit vocabulary, charge/settlement vocabulary, and `endpoint` (kept Latin and undeclined exactly
as the shipped `ui.chat.canonical.sound.stop.warning` keeps it; zh-CN keeps its own shipped 接口).
Kept-English in this slice is confined to the glossary's set — `endpoint` where the locale's sibling
copy keeps it, the documented `id`/`ID` token, and the `{material}` syntax. Nothing else Latin was
introduced, which is exactly what the operator's "no English left in the interface" requirement turns
on: the only Latin a `zh-CN` user sees here is glossary-sanctioned.

- «视频批次 / 旁白批次 / 音效批次 / 图像批次» are byte-identical to the shipped `state.done_batch` and `state.failed_batch`, and the stopped form «已停止» matches the shipped cancelled state.
- «提供商没有取消接口» / «若产出音频则会计费» mirror the shipped `sound.stop.warning`; «最终计费» mirrors `sound.cost.estimated_zero`; 接口 is this locale's shipped word for the cancellation endpoint, so keeping it (rather than Latin `endpoint`) is correct here.
- «速率限制» matches the shipped rate-limit rendering (11 values, e.g. `error_block.rate_limit.before`); «已拒绝» matches the shipped denial label; `ID` stays Latin uppercase with no CJK/Latin space, matching shipped `智能体ID`.

## 5. Fit — PASS

These 12 keys carry **no `maxCells`/`maxChars` hint** in the English sidecar — length is prose only
("two to four words", "one short sentence", "keep it short enough not to wrap") — so there is no numeric
budget to violate. Measured widths (approximate terminal cells: wide CJK 2, marks/format 0, U+202F 1 per
the fr guide; measured from the draft bytes, not from a real formatter):

every value is narrower than English: cancelled_batch 130 vs 157; cancel.running 66 vs 125; labels 6–12 cells (widest «音频速率限制» 12). No overflow risk anywhere in the slice.

Labels render in the card's wrapping `text-meta` block and state lines wrap inside the card, so the risk
here is wrapping, not clipping. No value reaches a width that would change how the card reads.

## 6. RTL — n/a — zh-CN is LTR; no bidi controls.

No RTL surface in this locale, so there is no bidi risk to report: no manual bidi marks and no mirrored glyphs in the copy.

## 7. Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| ZH-2-01 | MINOR | composition of …image_gen.cancel.running + …cancel.checking (callsite, not a draft value) | … 若产出音频则会计费。 正在确认结算。  (the two values joined by one ASCII space) | Independently verified at src/renderer/src/features/chat/canonical/image-gen-card.tsx:341, where runningStopSentence composes `${running} ${t(...cancel.checking)}` with a hard-coded ASCII space. In zh-CN both values end in the full-width 。 so the joined line carries a half-width space between two Chinese sentences, which is visibly off in Chinese typography and repeats in every stop-with-settlement state. The two VALUES themselves are correct; nothing in the zh-CN draft needs rewording. The programme already solved this shape once: ui.chat.sidebar.mark_all_read.scope_joined is "{chats} {tokenless}" in en and "{chats}{tokenless}" in zh-CN. | Key the joiner rather than hard-coding a space (en " ", zh-CN ""), mirroring scope_joined, and pass it through the same t() binding so a language switch repaints it. Not a draft change and not in this audit's edit scope; recorded because it is user-visible. |

**Checked and accepted (not findings):** «稍后重试» compresses «Wait a moment and try again» into the imperative terse form the zh guide asks for, keeping the two-sentence shape and promising nothing. «策略拦截» names the policy gate's action rather than a literal «gate failed»: no zh catalogue renders «gate» as a noun, the label stays distinct from «已拒绝», and it is the clearer of the two.

## 8. Terminal verdict

`passed` for `zh-CN` / `ui.chat.canonical` / S16e-renderer on head `bd8e9054…`:
**0 BLOCKER, 0 MAJOR**, 1 MINOR, 0 NIT. No finding at any severity; nothing to remediate.
Verdict is bound to the en source (`b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`) and the draft (`121951c9665e715dcec2b993d85cb3d77d51c00651da275a573aa75ae6bb5688`); if either moves, the
delta must be re-judged rather than this row re-pointed. This is a draft-slice receipt, not permission
to claim a full-file audit hash: the coder still owes post-integration byte-compatibility proof and the
`ledger.py append` binding. No rendered, browser, pseudo-localization or native-speaker evidence is
claimed by this pass — none was executed.
