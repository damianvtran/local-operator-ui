# PR #1664 frozen-merge audit — zh-CN / ui.chat.pickers

Date: 2026-11-05. Agent: i18n-auditor. Session: 68db5d33c61e. Actual model: openai/gpt-6.1-sol (quota fallback; full identity in record.json).

## Verdict and scope

**PASSED scoped merge-byte audit; no new BLOCKER, MAJOR, MINOR or NIT findings.** This is not a whole-interface or release sign-off.

Operator request: “switching to fr must leave NO English anywhere in the interface ... and the same must hold for every supported language.”

All 752 EN/context/target keys mechanically checked; 31 delta keys freshly read linguistically (20 upstream changed values plus 11 PR additions), 721 keys retained with exact parent-value checks and prior receipts. Target values are exact parent values, no translations authored here.

Frozen local HEAD: `625b865eff2ab4476fdff40144c1368a05878482` (not pushed by this auditor). Manifest admission and all current source/context/target hashes validated against frozen Git blobs and disk before audit and before artifacts.

## Native Simplified Chinese assessment — audit notes, not execution log

The 31 values preserve meaning, approval scope, sign-in field masking and goal-loop safety negations. Default scope means sessions following the default, not only future sessions. Request admission remains once-only. Running-session counts are not rendered as streaming/live-video language. The 11 slash headings are concise native nouns, align with the context of model/effort/approval/account/provider/server lists, and contain no ordinary English UI prose. Intentional LLM `token` follows the binding zh-CN kept-English policy; machine names/selectors remain untouched. No newly unsafe meaning or glossary regression identified.

CJK static width estimates for slash headings are 4–8 cells (effort heading 8); no numeric delta width budgets exist. The longer default-scope segment retains prior optional width feedback, without evidence of overflow. Full-width Chinese prose punctuation is appropriate; the session-panel closing ASCII parenthesis follows a code-generated ASCII opening parenthesis, so is not reported as a translation defect. RTL is not applicable (zh-CN); no manual bidi controls found.

### Fresh linguistic keys (English, actual merged target)

| Key | English | zh-CN |
|---|---|---|
| `ui.chat.pickers.analytics_model.highest_at` | highest {formatdaybucket} at {format}{unit, select, tokens { tokens} other {}} | {formatdaybucket}最高，为{format}{unit, select, tokens { token} other {}} |
| `ui.chat.pickers.analytics_model.total` | {format}{unit, select, tokens { tokens} other {}} total | 总计{format}{unit, select, tokens { token} other {}} |
| `ui.chat.pickers.context_panel.block` | Block | 区块 |
| `ui.chat.pickers.destination_pickers.cold_no_owner_running` | cold (no owner running) | 已休眠（无运行中的所有者） |
| `ui.chat.pickers.destination_pickers.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i` | Default approvals for all sessions that follow it: {string}. This session follows it unless it has its own choice. | 沿用默认设置的所有会话，默认审批为：{string}。除非此会话自行选择，否则它也沿用该设置。 |
| `ui.chat.pickers.destination_pickers.default_for_all_sessions_that_follow_it` | Default for all sessions that follow it | 所有沿用默认设置的会话 |
| `ui.chat.pickers.destination_pickers.masked_cleared_after_storing` | Masked. Cleared after storing. | 已隐藏。存储后清除。 |
| `ui.chat.pickers.destination_pickers.opens_the_provider_s_sign_in_methods_in_settings_browser_and_device_flow` | Opens the provider's sign-in methods in Settings. Browser and device flows run through the backend; keys are entered in a masked field there. | 在设置中打开提供商的登录方式。浏览器和设备流程通过后端运行；密钥在设置中的输入框里输入，内容会被隐藏。 |
| `ui.chat.pickers.destination_pickers.repeats_turns_toward_a_goal_approval_and_question_gates_still_stop_and_w` | Repeats turns toward a goal. Approval and question gates still stop and wait for you; the loop never answers them. | 围绕目标重复执行轮次。审批和提问环节仍会暂停并等待你；循环绝不会代为回答。 |
| `ui.chat.pickers.destination_pickers.request_admitted_once` | {text}<br>Request admitted once{duplicate, select, true { (already admitted)} other {}}. | {text}<br>请求已受理一次{duplicate, select, true {（此前已受理）} other {}}。 |
| `ui.chat.pickers.destination_pickers.this_goal_is_settled_it_stays_in_the_goal_history_dismiss_it_to_clear_th` | This goal is settled. It stays in the goal history — dismiss it to clear the chip, or find it in the canvas's Goals view. | 此目标已结束。它会保留在目标历史中——忽略它可清除目标标记，或在画布的“目标”视图中查找。 |
| `ui.chat.pickers.destination_pickers.write_and_command_tools_prompt_before_running` | write and command tools prompt before running | 写入和命令工具运行前会先询问 |
| `ui.chat.pickers.destination_pickers.your_message_was_admitted_once` | <br>Your message was admitted once: {detail}. | <br>你的消息已受理一次：{detail}。 |
| `ui.chat.pickers.info_model.live_not_answering` | {formatcount} live{separator}{formatcount2} not answering | {formatcount}个运行中{separator}{formatcount2}个未响应 |
| `ui.chat.pickers.info_panel.live` | live | 运行中 |
| `ui.chat.pickers.info_panel.live65c821` | Live | 运行中 |
| `ui.chat.pickers.info_panel.live_total` | {formatcount} live · {formatcount2} total | {formatcount}个运行中 · 共{formatcount2}个 |
| `ui.chat.pickers.session_panel.ok_they_are_a_different_population_and_are_counted_in_neither_rate_above` | ok). They are a different population and are counted in neither rate above. | 正常)。它们属于不同的统计群体，不计入上述任一比率。 |
| `ui.chat.pickers.session_panel.plus_its_subagents_where_the_ledger_could_be_walked` | , plus its subagents where the ledger could be walked | ，以及账本可追溯到的子智能体 |
| `ui.chat.pickers.slash.source.agent` | Agents | 智能体 |
| `ui.chat.pickers.slash.source.approvals` | Approvals | 审批 |
| `ui.chat.pickers.slash.source.effort` | Effort | 推理强度 |
| `ui.chat.pickers.slash.source.mcp` | Servers | 服务器 |
| `ui.chat.pickers.slash.source.model` | Models | 模型 |
| `ui.chat.pickers.slash.source.provider_accounts` | Accounts | 账户 |
| `ui.chat.pickers.slash.source.providers` | Providers | 提供商 |
| `ui.chat.pickers.slash.source.session_tags` | Tags | 标签 |
| `ui.chat.pickers.slash.source.team` | Teams | 团队 |
| `ui.chat.pickers.slash.source.theme` | Themes | 主题 |
| `ui.chat.pickers.slash.source.title_refresh` | Options | 选项 |
| `ui.chat.pickers.usage_view_model.reported_balance` | {count, plural, one {reported balance} other {reported balances}} | {count, plural, other {个已报告余额}} |

## Prior findings retained, not reopened

Four optional NIT observations from the main parent’s two receipts remain historical suggestions, not silently marked fixed and not promoted to new findings. Their exact original wording, IDs where present and source receipt are preserved in record.json. They concern block terminology, ledger traversal wording, default-segment width and a harmless connective. No known unresolved BLOCKER/MAJOR occurs in these current-parent receipts. Historical superseded records are provenance, not fresh-current approval.

## Executed mechanical validation

1. `node --test --test-name-pattern="\[zh-CN\]" scripts/i18n/locale-parity.test.mjs` — 6/6 passed, exit 0; existing repository validator, not full suite.
2. Namespace-specific Node inline checker — all 752 keys: EN/context/target JSON parity, ICU argument names/types, select arms, 30 plural nodes with native zh-CN `other`, 13 select nodes, rich tags (0), backtick code, forbidden bidi controls, both parent deltas and exact-retained sets; packet hashes and frozen HEAD; prior receipt hashes verified. Exit 0.
3. Python duplicate-key rejection, ASCII-delimited command/flag/URL parity, static CJK widths and Chinese-adjacent slash-command control — passed after correcting the probe’s Unicode-boundary error. The earlier failed probe is preserved in audit.log.

Full stdout/stderr is in `audit.log`. These narrative paragraphs are `audit_notes_not_execution_log`, not execution evidence.

## Not executed

- Fresh linguistic audit covers the 31-key union of deltas against both parents, not a fresh linguistic audit of all 752 keys. The other 721 keys retain parent audit provenance after exact value comparison.
- No browser, Electron, pseudo-localization, screenshot, native app, production launch, build, full suite, install, runtime locale-switch or actual overflow validation executed.
- Static CJK cell estimates are not pixel-width proof; none of the 31 context entries has a numeric maxCells/maxChars hint. Slash headings span 4–8 cells.
- No UI-local style/glossary tree or canonical evidence README exists in frozen checkout. Used actual core glossary/style guides and UI docs/I18N.md. No schema or retention contract files created.
- New report does not supersede or recreate any dated record; high-visibility second-pass and runtime/render gates are not waived.
- First custom slash-token regex probe produced false failures due to Unicode word boundaries; actual failed output is retained in audit.log, followed by corrected ASCII-boundary probe and passing Chinese-adjacency negative control.
