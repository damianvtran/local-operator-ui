# Independent i18n audit — zh-CN · `ui.chat.canonical` · slice S16e-renderer

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT.
Ledger result equivalent: `clean-with-findings` (minor/nit only; no blocker/major on the head audited).

| | |
|---|---|
| Locale | `zh-CN` |
| Namespace (file group) | `ui.chat.canonical` (12 keys) |
| Slice | S16e-renderer, PR damianvtran/local-operator-ui #1884 |
| Draft audited | `…/sessions/3ef6295a5545/scratchpad/s16e/zh-CN/draft-zh-CN-s16e.json` · sha256 `121951c9665e715dcec2b993d85cb3d77d51c00651da275a573aa75ae6bb5688` (**matches the hash in the task**) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `bd8e9054` · sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` (verified equal to the task's stated source hash) |
| Context sidecar | `src/i18n/catalogues/en/ui.chat.canonical.context.json` · sha256 `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| Shipped zh-CN catalogue (terminology authority) | `src/i18n/catalogues/zh-CN/ui.chat.canonical.json` · sha256 `35f8058839549d4a8be28792c279784c75a624b9c076fc98d359bae1fe1db12c` |
| Glossary / style guide | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` / `8f95d89debbd0af848e72e4805e256ef9566632e520a5c6d9b37928cd617142c` |
| Auditor | `i18n-auditor`, instance `f9df9ab87b40`, model **`deepseek/deepseek-flash`** (actual model of this run; no fallback, no role/model pin) |
| Independence | Fresh session; did not translate these values, did not see the draft before forming a per-key view, edited nothing in the repo or the draft, used no translation/MT service. Translator notes were read only after every key was judged. |
| Ordering of reading | style guide → glossary → English source + sidecar → shipped zh-CN catalogue → draft → call sites → (then) translator notes |

## Axis results

| # | Axis | Result |
|---|---|---|
| 1 | Mechanical (placeholders, ICU, keys, JSON) | **PASS** — 12/12 keys; `{material, select, …}` argument name and the exact four options `video/voiceover/sound_effect/other` preserved; no plural introduced (zh-CN needs `other` only); all four branches complete sentences ending 。; no brace leak; no markup/backticks/flags in any value; valid JSON. Both sides parsed with the repo's own `@formatjs/icu-messageformat-parser` and rendered through `IntlMessageFormat("zh-CN")`. Seven negative controls on mutated copies all failed the checker, so the pass is not vacuous. |
| 2 | Accuracy (meaning, promises) | **PASS** — see per-key reading below. The two load-bearing promises hold: `cancel.queued` keeps the flat no-charge promise (不会计费), `cancel.running` keeps "request, not cancellation" (已请求停止 … 生成仍会继续，若产出音频则会计费) and never promises no charge; `settlement.pending` states no amount and no zero; the six class labels stay textually distinct (已拒绝 vs 策略拦截; 未知工具 vs 参数无效 vs 重复ID). |
| 3 | Idiom & register | **PASS** — 你-register not needed (no pronouns, verb-forward per guide); no 请 (English says "please" nowhere); no ！/啦/哦/呀; no sentence-final 。 on the six labels, 。 on every prose sentence; 您 absent. |
| 4 | Terminology | **PASS** — 提供商, 计费/最终计费, 停止 (stop) vs 取消接口 (cancellation endpoint), 批次, and the material nouns 视频/旁白/音效/图像 all match the shipped zh-CN catalogue; `ID` stays Latin uppercase with no CJK/Latin space, matching shipped `智能体ID`/`会话ID`; 速率限制 matches the shipped rendering of "rate limit". |
| 5 | Fit | **PASS** — labels 6–12 cells (all narrower than their English); longest prose value 66 cells (`cancel.running`) against 118 in English; state lines wrap inside the card. No overflow risk, no wide-glyph/combining-mark hazard (all full-width CJK + Latin `ID`). |
| 6 | RTL | n/a (zh-CN). |

Typography verified by codepoint: only 。U+3002, ，U+FF0C, ；U+FF1B and the double em dash —— (U+2014 ×2) appear in prose; no ASCII space in any non-ICU value (the only spaces are the required ICU `select` syntax in `state.cancelled_batch`); no CJK/Latin space (`重复ID` is contiguous); ellipsis absent. Latin runs in the draft are exactly the ICU keywords plus `ID`; **no English is left** and no value is byte-identical to English.

## Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| S16e-zhCN-01 | MINOR (callsite, not the value) | `image_gen.cancel.checking` composed after `image_gen.cancel.running` | rendered: `…若产出音频则会计费。·正在确认结算。` (· = U+0020) | `image-gen-card.tsx:341` joins the two keys with a hard-coded `" "`. For zh-CN that puts a half-width space between a 。 and the next sentence — visibly off in Chinese typography, and the programme already decided this the other way: shipped `ui.chat.sidebar.mark_all_read.scope_joined` is `"{chats} {tokenless}"` in en and **`"{chats}{tokenless}"` in zh-CN**. The values themselves are correct, so the fix does not belong in the draft. | Key the joiner the way `scope_joined` is keyed: `ui.chat.canonical.image_gen.cancel.joiner` — en `" "`, zh-CN `""` (and the other locales their own); or join without a space when the preceding character is a full-width terminator. No wording change requested. |
| S16e-zhCN-02 | NIT | `image_gen.error.audio_rate_limited` | `音频生成当前繁忙。稍后重试。` | "音频生成当前繁忙" personifies the activity: the thing that is busy is a service, and the shipped catalogue's phrasing carries the head noun (`中心繁忙，…`). Understandable as-is; 稍后重试 matches shipped house style (`完整文本暂时不可用。稍后重试。`). | `音频生成服务当前繁忙。稍后重试。` (optional; the current value is not wrong) |

No BLOCKER and no MAJOR, so the draft may be committed as-is; S16e-zhCN-01 should land in the callsite in the same wave because it is user-visible in every stop-with-checking state.

## Per-key reading (accuracy, judged from the English and the sidecar)

| Key | zh-CN | Judgement |
|---|---|---|
| `state.cancelled_batch` | 视频/旁白/音效/图像批次已停止。 | Faithful; same family as shipped `失败…`/`done_batch`; uses 停止 (stopped) and deliberately not 取消 (cancelled) — matches the English's stop≠cancel distinction. |
| `cancel.queued` | 已在调用提供商之前停止，不会计费。 | Promise intact (不会计费 = flat future-negative, no hedge); mirrors shipped `会在调用提供商之前停止。`; comma for the English semicolon is correct Chinese. |
| `cancel.running` | 已请求停止。提供商没有取消接口；生成仍会继续，若产出音频则会计费。 | Request framed as a request; no cancellation endpoint; continuation + charge condition preserved; the pre-stop dialog's extra "best effort" sentence (shipped `sound.stop.warning`) correctly **not** imported. |
| `cancel.checking` | 正在确认结算。 | Complete three-word sentence with its own stop, as the sidecar requires; same 结算 fact as `settlement.pending`. |
| `settlement.pending` | 结算尚未完成——最终计费将在提供商报告后显示。 | No amount, no zero; 最终计费 is the shipped term (`最终计费尚未确认。`); —— correct mainland dash, no surrounding spaces. |
| `error.audio_rate_limited` | 音频生成当前繁忙。稍后重试。 | Two sentences; actionable; promises nothing and names no wait time; "rate limited" deliberately not leaked into the sentence, as the English does. NIT-02 only. |
| `error_class.audio_rate_limited` | 音频速率限制 | Noun-phrase label; 速率限制 is the shipped term. No stop. |
| `error_class.unknown_tool` | 未知工具 | Glossary `tool → 工具`; label register. |
| `error_class.invalid_arguments` | 参数无效 | "Invalid arguments"; distinguishable from 未知工具. |
| `error_class.duplicate_id` | 重复ID | Latin `ID` per shipped pattern and no CJK/Latin space; distinguishable. |
| `error_class.denied` | 已拒绝 | Permission refusal; shipped `已拒绝` in `tool_row.bridge.outcome.refused_bare` / `browser` approval copy. |
| `error_class.gate_failed` | 策略拦截 | Considered and accepted — see below. |

## Considered and accepted (recorded so a later reader does not re-litigate)

- **`gate_failed → 策略拦截`.** "Gate failed" is softened into "policy blocked": the failure verb disappears and 策略 is added. Accepted because (a) Chinese has no shipped noun for this gate (门禁 would read as physical door access), (b) the shipped catalogue already describes policy/safety gates blocking an action as `拦截` (`你可以在这里明确允许一些通常会被拦截的操作`), and (c) it remains distinguishable from `已拒绝` (permission refusal) — the two labels name different actors, and the error sentence below carries the reason. Recorded alternative if the programme ever wants the failure verb back: `策略校验失败`.
- **`audio_rate_limited → 音频速率限制`.** A noun phrase rather than the English participle. Accepted: 速率限制 is the shipped rendering of "rate limit" (`你已达到AI提供商的速率限制`), the label's job is to name a class, and the shorter 音频限流 would trade shipped-term consistency for two cells with no pinned width budget.
- **`cancel.running` reuses the shipped `sound.stop.warning` clause with ； instead of the shipped 。.** Accepted: the English uses a semicolon exactly there, and the change keeps this post-stop state line one sentence pair; both marks are correct Chinese. (The translator's note says the shipped string uses ； there; it actually uses 。. The shipped result is unaffected — no change requested, the note is only imprecise.)
- **`settlement → 结算`, new term** (`cancel.checking`, `settlement.pending`). Consistent across both keys and correctly separated from 费用 (cost) and 计费 (the charge), which the shipped catalogue already distinguishes. The glossary has no row for `settlement` or `gate`; the translator proposed both — **I endorse both proposals**, since glossary §4 says the wave that first needs a term records it.

## Action items for the wave (not translation defects)

1. **S16e-zhCN-01** in the callsite (`image-gen-card.tsx:341` / `runningStopSentence`) — the only user-visible fix this audit asks for. Add a zh-CN regression row to the composition test so a later locale cannot regress it.
2. **Ledger assembly.** `scripts/i18n/ledger-assemble.mjs` refuses a receipt that does not name the bytes on disk, so the row must be assembled against the **committed** `src/i18n/catalogues/zh-CN/ui.chat.canonical.json`. This receipt names the *draft* sha256 `121951c9…`; if the committed file's bytes differ (they will, because the values are inserted into a 467-key file), the receipt must be re-issued — or extended with the committed file's `target` hash — before `ledger-assemble` will accept it. Do not paste `121951c9…` into the ledger as `target_sha256`.
3. Record `结算` (settlement) and `策略拦截` (gate, label) as glossary rows per glossary §4.

## Evidence (this session's own artifacts)

- `receipt.json`, `report.md` (this file), `audit.log` (real command transcript), plus `verify.mjs` / `check2.mjs` / `compose-check.mjs` and the seven `neg-*.json` controls, in
  `/Users/damian/.local-operator/sessions/f9df9ab87b40/scratchpad/s16e-audit-zhCN/`.
  Final `i18n/audits/evidence/zh-CN/ui.chat.canonical/<audit-id>/` bundling is the manager's commit; nothing here was written into the repo.
