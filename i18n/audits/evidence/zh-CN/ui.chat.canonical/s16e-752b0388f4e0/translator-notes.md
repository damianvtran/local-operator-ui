# zh-CN · s16e (renderer) — translator notes

Slice: 12 keys of the generation card's stop / settlement / failure-class copy.
Namespace: `ui.chat.canonical`. Source: `locales/en` mirror at
`src/i18n/catalogues/en/ui.chat.canonical.json` (worktree `i18n-s16e`
@ `bd8e90542506e8bec4a98862b868095409b28329`). Brief:
`s16e-brief.json` sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c`
(verified before reading).

Target locale file under test:
`src/i18n/catalogues/zh-CN/ui.chat.canonical.json`
sha256 `35f8058839549d4a8be28792c279784c75a624b9c076fc98d359bae1fe1db12c` (467 keys).
English catalogue sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17`.

## Inputs used (files + hashes)

| Role | Path | sha256 |
|---|---|---|
| Glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| Style guide (zh-CN) | `~/local-operator/i18n/style-guides/zh-CN.md` | `8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c` |
| UI contract | `~/local-operator-ui/.worktrees/i18n-s16e/docs/I18N.md` | `d58ad473701f098b3c2c24343c3a7e7236f22db22cc871016c4cb75f25f41f5c` |
| Core contract (cited by UI doc) | `~/local-operator/docs/design/i18n.md` | `92eca5a123b65c4dea7e7ec2db9ddd4fec0b04c0fa038d10ba540e30f0d7e096` |
| Core HOWTO (cited by UI doc) | `~/local-operator/docs/I18N.md` | `bb2bb05d1511165b31a6d8b535400cc08ba15e2788042edd22ce675f41bcdcea` |

`docs/design/i18n.md` does not exist in the UI repo (the UI doc links the core
copy); the core copy at the hash above is what I read.
No UI-repo glossary exists (`~/local-operator-ui/i18n/` carries only
allowlist/baseline/ledger/audits); the core glossary is the governing one.

## Register and voice

- 你 throughout; no 您 (style guide §Formality). None of the 12 keys addresses
  the reader as a pronoun in a way that needs it, but `cancel.queued` implies
  "you" — written verb-forward ("不会计费") per the guide's no-pronoun rule.
- No 请 in these 12 keys: the English says "please" nowhere. `error.audio_rate_limited`
  therefore uses a bare 稍后重试, matching the shipped
  `ui.agentMessages.banner.consent_unavailable`: "完整文本暂时不可用。稍后重试。"
- No 啦/哦/呀, no ！. Full stops on full sentences, none on the six class labels.
- Sentence-case has no Chinese analogue; the label/prose distinction is carried by
  punctuation and by the noun-phrase form of the labels (see below).

## Term decisions, with existing-catalogue evidence

| Term | zh-CN | Evidence in the shipped `zh-CN/ui.chat.canonical.json` |
|---|---|---|
| batch | 批次 | `state.done_batch`: `视频批次` / `旁白批次` / `音效批次` / `图像批次`; `state.failed_batch`: `视频批次生成失败。` |
| video / voiceover / sound effect / image (material nouns) | 视频 / 旁白 / 音效 / 图像 | `state.running` and `state.failed` select branches, branch-for-branch |
| stopped (batch) | 已停止 | `sound.batch.item_status` (`{status, select, … cancelled {{label} · 已停止}`); `sound.stop.question`: "停止此次生成？" |
| stop (verb, state) | 已请求停止 / 请求停止 | `sound.stop.request_stop`: 请求停止 (button); `image_gen.control.stop_hint_running`: "请求停止；提供商仍可能执行完毕。" |
| provider | 提供商 | `sound.stop.warning`: "提供商没有取消接口。"; `control.stop_hint_queued`: "会在调用提供商之前停止。" |
| cancellation endpoint | 取消接口 | `sound.stop.warning`: "提供商没有取消接口。" — the same sentence, reused verbatim (see note 1) |
| charge (verb) | 计费 / 会计费 | `sound.stop.warning`: "若产出音频则会计费。"; `sound.cost.estimated_zero`: "最终计费尚未确认。" |
| no charge | 不会计费 | `sound.cost.no_charge`: 未收费。 (state); 计费 is the shipped verb family, so the negative is 不会计费, not 不会收费 |
| settlement | 结算 | paired with 计费: `settlement.pending` says 结算…最终计费…, `cancel.checking` says 正在确认结算。 The catalogue already distinguishes 费用 (cost) from 计费 (the charge) |
| reports (provider) | 报告 | `ui.agents.skills.where.unknown`: "此后端未报告位置。"; `destination_pickers.has_not_reported…`: "尚未报告其推理强度级别。" — 报告, not 上报 |
| busy / retry | 繁忙 / 稍后重试 | `ui.agentMessages.banner.consent_unavailable` (above); `error_block.rate_limit.before`: "…已达到AI提供商的速率限制。请稍后重试…" |
| rate limited | 速率限制 | `ui.chat.error_block.rate_limit.before` / `.after`: "速率限制" (the shipped user-facing term; 限流 is dev shorthand and is not in the catalogue) |
| arguments | 参数 | `slash.arguments_region_label`: 命令参数; `destination_pickers.needs_an_argument`: 需要参数 |
| denied | 已拒绝 | `ui.browser.approval_queue_model.denied` and `browser_approvals_dock.denied`: 已拒绝 |
| unknown | 未知 | `ui.agents.skills.source.unknown`: 未知来源; `appearance.editor.import_base`: "未知的基础主题" |
| id | ID (Latin, no space before it) | `ui.agents.*`: "智能体ID", "人员ID", "输入人员ID（bep_…）" — Latin acronym kept, no CJK/Latin space |

### Judgement calls

1. **`cancel.running` reuses `sound.stop.warning`'s shipped sentences.** The
   English overlap is exact from "The provider has no cancellation endpoint"
   through "…if it produces audio", so the Chinese reuses
   "提供商没有取消接口。生成仍会继续，若产出音频则会计费。" with only the joining
   punctuation changed to ；(the English uses a semicolon there and the catalogue
   already uses ；in `sound.stop.warning`… `stop_hint_running` and
   `cost.estimated_zero`). Deliberate: one fact, one wording, two surfaces.
   The catalogue's extra third sentence ("系统只能尽力停止，不保证取消成功或免于计费。")
   belongs to the pre-stop confirmation dialog and is NOT imported here — this key
   is the post-stop state line and the brief forbids appending more.
2. **"Stop requested." → 已请求停止。** Not 请求停止 (that is the button label in
   `sound.stop.request_stop`); the aspect particle 已 marks it as the recorded
   state, which is what the English past participle does.
3. **"you will not be charged" → 不会计费。** The brief calls this the only place
   the UI may promise no charge; 不会计费 is a flat future-negative, not a hedge,
   so the promise survives. No 你 (guide: drop pronouns).
4. **Em dash in `settlement.pending`.** Chinese uses ——（U+2014 U+2014, no
   surrounding spaces) and the shipped catalogue does exactly that
   ("暂无可显示的内容——本次运行尚未调用工具。"). I kept the em dash rather than
   swapping it for a colon: it is what this catalogue does for the same
   explanatory-dash role. The style guide's punctuation list does not name the
   dash, but it is the locale's own convention as evidenced in-catalogue.
5. **`cancel.checking` → 正在确认结算。** Chose 结算 (the settlement itself) over
   费用 so that it reads as the *same fact* as `settlement.pending`
   (结算尚未完成——). "Checking for settlement" is a state, and 正在…。
   keeps it a complete three-word sentence with its own full stop, as the brief
   requires.
6. **`error_class.*` are noun-phrase labels, no full stop.** Chinese has no case,
   so "Audio rate limited" cannot be mirrored adjectivally; 音频速率限制 is the
   class name ("rate limiting of audio"), which is exactly the label's job — the
   sentence with the instruction sits below it. Same reasoning for 策略拦截.
7. **`gate_failed` → 策略拦截.** "Gate" has no shipped rendering anywhere in the
   catalogue (`send_failure.gate_lock` says 先回答上方的问题。 — the sentence, not
   the noun). 门禁 in Chinese means physical door access control and would
   mislead; 策略拦截 ("policy interception") names the failure class in four
   characters and matches the brief's "a configured policy gate stopped it".
   See glossary proposal below.
8. **`duplicate_id` → 重复ID**, no space, Latin uppercase — the catalogue's
   "智能体ID" pattern and the style guide's no-CJK/Latin-space rule.
9. **`error.audio_rate_limited` → 音频生成当前繁忙。稍后重试。** "right now" is
   当前; kept as two sentences like the English, no promised outcome, no wait
   time. I did not use the catalogue's 速率限制 term here because the English
   deliberately does not say "rate limited" in the sentence — the class label
   above it carries that.

### Nothing judged identical to English

No value is left in English, and no value is a byte-identical copy of the
English. The only Latin runs are the ICU keywords (`material`, `select`,
`video`, `voiceover`, `sound_effect`, `other`) which must stay, and the token
`ID` in `重复ID`, which the existing catalogue also leaves as Latin.

## Width

- Class labels (the wrapping constraint): 音频速率限制 12 cells, 未知工具 8,
  参数无效 8, 重复ID 6, 已拒绝 6, 策略拦截 8. English equivalents are 17 / 11 / 16 /
  12 / 6 / 11 cells. No label is wider than its English.
- State lines wrap inside the card; the longest, `cancel.running`, is 34 CJK-ish
  characters (~68 cells) against English's 118 cells — shorter, so no fit risk.
  `settlement.pending` is 25 characters (~50 cells) vs English 85 cells.
- `state.cancelled_batch` branches: 7 characters each (14 cells) vs English
  19–30 characters. Comfortably inside "two to four words".

## Validation actually run

The brief's full catalogue validator (`pnpm check-i18n`, i.e.
`check-i18n:catalogues|added-strings|coverage`) **could not be run**: the draft
does not live in the repo, my write scope is the 12 values only, the worktree is
read-only to me and carries no `node_modules`, and the memory guard forbids a
package install or a run over the tree. Nothing is claimed from it.

What I did run instead — the repo's own ICU parser, from the primary checkout's
shared `node_modules` (read-only, no install), on one small script
(`check-render-zhCN.cjs`) over my own scratchpad input:

```
parse: 12 keys, structure failures: 0
render material=image         -> 图像批次已停止。
render material=video         -> 视频批次已停止。
render material=voiceover     -> 旁白批次已停止。
render material=sound_effect  -> 音效批次已停止。
ALL CHECKS OK
```

The script parses each English value and each zh-CN value with
`@formatjs/icu-messageformat-parser` (`requiresOtherClause: true`), reduces both
to a structural shape (literal / argument name / select argument + option keys +
option bodies) and requires them to be equal; then renders the one select message
through `IntlMessageFormat('zh-CN')` for all four branches. It also lints: no
double spaces, full stop on every prose sentence, no full stop on the six
class labels, no `...`/`…` ellipsis, no ASCII spaces. Result: 0 failures.
Note that `intl-messageformat` is the repo's runtime parser, not a translation
service — no text was produced by any machine-translation system.

### Structure of the one select key

`state.cancelled_batch` keeps `{material, select, …}` exactly: argument name
`material`, four branches `video` / `voiceover` / `sound_effect` / `other` in the
source order, keywords untranslated, each branch a complete sentence with its
own full stop. Chinese needs no plural categories, and none are used.

## Open questions

- **`gate_failed`**: 策略拦截 is my choice; if the auditor prefers a signed-off
  rendering for "gate" in this programme, the label is a one-character-class
  change (e.g. 策略校验失败) and the reason is recorded above. Nothing else in
  the catalogue constrains it.
- **`audio_rate_limited` label**: 音频速率限制 follows the shipped prose term.
  A shorter 音频限流 would fit better if the card's label column turns out to be
  narrow; I chose term consistency over two cells and noted it here rather than
  guessing at a width budget that the brief did not pin.
- The core glossary §5 records that the zh-CN wave-3 CLI candidate is **HELD**
  (`held/i18n-w3-zh-candidate-4773bb87`, slash audit 50/51 not passed). That is
  the core repo's CLI catalogue, not this UI namespace, and it does not gate this
  slice — flagged here only so the manager sees I read it and am not treating it
  as approval for anything.

## Glossary proposals

- `gate` (a configured policy gate that stops a call) — zh-CN **策略拦截** for the
  failure-class label, **策略校验** in prose. No row exists in
  `i18n/glossary.md` §2 and no shipped UI copy renders the noun.
- `settlement` — zh-CN **结算**, with the charged amount as 计费 and the cost as
  费用. The glossary has no row; the UI catalogue already splits the three.
