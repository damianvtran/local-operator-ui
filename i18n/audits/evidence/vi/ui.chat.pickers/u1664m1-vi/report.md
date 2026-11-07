# Vietnamese merged-byte audit — UI PR #1664

**Audit notes, not an execution log** (`audit_notes_not_execution_log`). Actual commands and responses are retained separately in `audit.log`.

- Date: 2026-11-05; locale `vi`; namespace `ui.chat.pickers`; 752 keys.
- Frozen local merge: `625b865eff2ab4476fdff40144c1368a05878482` (not pushed, not a claim of merged-to-main).
- Auditor: `i18n-auditor`, session `84f34f75ad89`, instance `84f34f75ad89-u1664m1-vi`.
- Actual served model: `openai/gpt-6.1-sol`, quota fallback announced after requested Sonnet and an intermediate Opus fallback notice. No translation/MT service used. Neither parent was authored by this auditor.

## Request and acceptance boundary

> Operator request: switching to fr must leave NO English anywhere in the interface ... and the same must hold for every supported language.

This receipt binds the exact merged Vietnamese picker namespace bytes only. It does not certify the entire interface or English-free runtime values. Fresh linguistic focus is the union of target deltas against both parents: **45 keys = 34 changed upstream values + 11 PR-added headings**. All 752 source and target messages were also read/scanned; all 752 receive mechanical parity/ICU checks. This supplemental whole-file scan does not claim a new complete 752-key linguistic audit or erase parent findings. The 707 keys unchanged against both parents retain their explicitly listed prior provenance in record.json. No catalogues, source, ledger, existing receipts or generated assets were changed.

## Inputs and admitted provenance

- source: `src/i18n/catalogues/en/ui.chat.pickers.json` — SHA-256 `ecc10fb18100d4d462f36214c83507a48c7f0f8173cb72f37bf5964a05abb58c`.
- context: `src/i18n/catalogues/en/ui.chat.pickers.context.json` — SHA-256 `a03f45c9158177d2282d89c088fec46c949f42952959ac84d6a8b72e0582d981`.
- target: `src/i18n/catalogues/vi/ui.chat.pickers.json` — SHA-256 `262fe49cc21c91392e70fe2b8b2a5dfb27b1c594b92115a53353c3a78cb0a7cf`.

All input raw hashes, Git blob bytes and HEAD matched the packet before review. Manifest SHA-256: `d2667a6f0c006fed09a9ed06bd17aa7e35d53f8cbe597b81ba3d3201c2928a93`. Parent target deltas and complete retained-key arrays were independently derived, not accepted from the packet summary. English/context are identical to the PR parent; both add exactly 11 keys and change/remove zero keys against main. All 17 parent receipt references in 12 binding entries were hash-verified; these include duplicate historical references across parents. Historical rows are not rewritten or retargeted.

Style inputs: core `i18n/style-guides/vi.md` and `i18n/glossary.md`, read from the current core checkout and raw hashes retained in record.json. The frozen UI snapshot has no dedicated native glossary/style tree. UI `docs/I18N.md` retained-record and receipt contracts were read. `i18n/audits/evidence/README.md` is absent in this frozen UI checkout; no new contract file was invented.

## Mechanical results — actual execution

- `node scripts/i18n/context-parity.mjs`: exit 0. Repository-wide output reports 131 allowed gaps in 4 namespaces; this is not a claim those gaps were audited. Scoped `namespaceGap` for ui.chat.pickers has 752 matching context keys, no orphan/missing entries.
- Bounded custom validator, using the repository generator `messageArguments`, repository `namespaceGap`, and installed `@formatjs/icu-messageformat-parser`: exit 0; 1,504 EN/VI messages parsed; 752-key parity; no placeholder-name/type, select-option, number/date/time-format, Rich/HTML tag, backtick-code, slash-command, flag or NFC mismatch. Exact custom source and actual stdout/stderr are retained in audit.log.
- 31 Vietnamese plural AST nodes checked: required CLDR `other` present everywhere. Two pre-existing unused `one` categories remain at info_model.count_noun and table_pager.range; they are unchanged against both parents and previously disclosed in the main audit. Exact `=1`/`=0` arms are retained; they are valid ICU numeric selectors, not missing CLDR categories. No new plural regression in the 45-key delta.
- Independent duplicate-key rejecting JSON load: all three JSON inputs valid with no duplicate keys.
- No explicit maxCells/maxChars fields exist in this namespace sidecar. Reviewed the delta’s role/tone/length/context notes. Vi headings are short native noun phrases; multi-syllable Vietnamese words are not a violation of an English one-word hint. No proven new overflow identified; this is source-level fit reasoning, not rendered measurement.

## Linguistic conclusions

- Vietnamese diacritics and all target values are NFC. Sentence case, bạn-compatible direct product register, Latin digits and native punctuation remain consistent in the delta.
- Approval default wording preserves inheritance by sessions without their own choice (not “subsequent sessions”). Stop acknowledgement remains distinct from completed exit. Fork boundaries and exactly-once delivery remain intact; unchanged default vs per-conversation scope is preserved.
- Eleven picker headings use native glossary terms; reasoning effort also matches `ui.agents.models.reading.effort_col` in the actual Vietnamese models catalogue. Provider/account headings stay semantically distinct; MCP heading names servers, not subcommands.
- Retain previously accepted glossary exceptions, including technical token/runtime usage and the already-disclosed usage-term variation; do not turn unchanged history into new merge-blocking findings.

## Findings — 0 BLOCKER, 0 MAJOR, 0 MINOR, 5 retained NIT

These optional wording findings were already present in parent audits and were verified against current bytes. They are retained rather than silently erased, not five newly discovered defects. No new blocking/major delta finding.

### V-N1 — NIT
- Key: `ui.chat.pickers.info_model.mobile_relay`
- Current: Chuyển tiếp di động
- Problem: Glossary-correct relay label; adding the service noun would remove a slight verb-phrase reading. Optional, not a semantic defect.
- Suggested wording: Dịch vụ chuyển tiếp di động
- Disposition: retained, non-gating.
- Prior provenance: `i18n/receipts/c124ae957985.json`, `i18n/receipts/i18n-auditor-vi-pickers-3e4aeb5-9344cb74ab66.json`.

### V-N2 — NIT
- Key: `ui.chat.pickers.destination_pickers.choose_the_model_this_conversation_starts_on_and_keeps_running_on_your_d`
- Current: Chọn mô hình mà cuộc trò chuyện này bắt đầu và tiếp tục chạy với mô hình đó. Mặc định không thay đổi.
- Problem: Relative construction repeats the model noun; meaning and unchanged-default boundary are correct. Optional tightening.
- Suggested wording: Chọn mô hình để cuộc trò chuyện này bắt đầu và tiếp tục chạy. Mặc định không thay đổi.
- Disposition: retained, non-gating.
- Prior provenance: `i18n/receipts/i18n-auditor-vi-pickers-3e4aeb5-9344cb74ab66.json`.

### V-N3 — NIT
- Key: `ui.chat.pickers.destination_pickers.delivered_exactly_once_to_the_new_conversation`
- Current: Được gửi đúng một lần tới cuộc trò chuyện mới.
- Problem: Passive delivery wording is slightly calque-like, but accurately preserves exactly-once delivery. Optional tightening only.
- Suggested wording: Chỉ gửi đúng một lần tới cuộc trò chuyện mới.
- Disposition: retained, non-gating.
- Prior provenance: `i18n/receipts/i18n-auditor-vi-pickers-3e4aeb5-9344cb74ab66.json`.

### V-N4 — NIT
- Key: `ui.chat.pickers.destination_pickers.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i`
- Current: Phê duyệt mặc định cho mọi phiên không có lựa chọn riêng: {string}. Phiên này cũng theo giá trị đó trừ khi có lựa chọn riêng.
- Problem: Own-choice phrase repeats; inheritance rather than future-session chronology is now correct and must remain so. Optional tightening.
- Suggested wording: Phê duyệt mặc định cho mọi phiên không có lựa chọn riêng: {string}. Phiên này cũng dùng mặc định đó nếu chưa tự chọn.
- Disposition: retained, non-gating.
- Prior provenance: `i18n/receipts/i18n-auditor-vi-pickers-3e4aeb5-9344cb74ab66.json`.

### V-N5 — NIT
- Key: `ui.chat.pickers.analytics_panel.no_call_in_this_window_has_a_published_price`
- Current: Không có cuộc gọi nào trong khoảng này có giá đã công bố
- Problem: The shortened time-range noun is understandable with the visible range selector and meets the terse guide. The fuller time-range phrase would be clearer where space permits; this is prior optional wording, not wrong meaning.
- Suggested wording: Trong khoảng thời gian này (replace the shortened range phrase where fit permits)
- Disposition: retained, non-gating.
- Prior provenance: `i18n/receipts/c124ae957985.json`.
- Same optional range clarification applies to 16 delta values; exact key IDs retained in receipt.json.

## Fresh linguistic delta key coverage

- `ui.chat.pickers.analytics_model.no_call_in_this_window_has_a_measured_generation_time_yet_so_the_rate_re`
- `ui.chat.pickers.analytics_panel.no_call_in_this_window_has_a_published_price`
- `ui.chat.pickers.analytics_panel.no_daily_rows_for_this_window`
- `ui.chat.pickers.analytics_panel.no_per_model_rows_in_this_window`
- `ui.chat.pickers.analytics_panel.no_per_provider_rows_in_this_window`
- `ui.chat.pickers.analytics_panel.no_per_session_rows_in_this_window`
- `ui.chat.pickers.analytics_panel.no_priced_calls_in_this_window`
- `ui.chat.pickers.analytics_panel.of_in_this_window`
- `ui.chat.pickers.analytics_panel.of_in_this_windowf655cc`
- `ui.chat.pickers.analytics_panel.of_the_output_tokens_this_ledger_read_recorded_in_this_window`
- `ui.chat.pickers.analytics_panel.the_ledger_records_a_model_on_every_provider_call_so_this_window_has_non`
- `ui.chat.pickers.analytics_panel.usage_by_provider_in_this_window`
- `ui.chat.pickers.analytics_panel.usage_by_session_in_this_window`
- `ui.chat.pickers.analytics_panel.window`
- `ui.chat.pickers.analytics_session_state.all_sessions_in_this_window_have_a_parent`
- `ui.chat.pickers.analytics_session_state.clear_the_search_to_see`
- `ui.chat.pickers.analytics_session_state.no_top_level_sessions_in_this_window`
- `ui.chat.pickers.analytics_session_state.the_one_session_in_this_window_has_a_parent`
- `ui.chat.pickers.destination_pickers.choose_the_model_this_conversation_starts_on_and_keeps_running_on_your_d`
- `ui.chat.pickers.destination_pickers.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i`
- `ui.chat.pickers.destination_pickers.default_for_all_sessions_that_follow_it`
- `ui.chat.pickers.destination_pickers.delivered_exactly_once_to_the_new_conversation`
- `ui.chat.pickers.destination_pickers.effort_levels_supports_this_sets_the_level_this_conversation_starts_on_a`
- `ui.chat.pickers.destination_pickers.stop_requested_acknowledged_not_a_completed_exit`
- `ui.chat.pickers.destination_pickers.the_fork_starts_before_the_message_you_chose_a_cut_cannot_separate_a_too`
- `ui.chat.pickers.destination_pickers.this_conversation_starts_on_and_keeps_running_on_it_choosing_another_cha`
- `ui.chat.pickers.destination_pickers.this_goal_is_settled_it_stays_in_the_goal_history_dismiss_it_to_clear_th`
- `ui.chat.pickers.destination_pickers.your_first_message_starts_the_chat_with_this_profile`
- `ui.chat.pickers.destination_pickers.your_first_message_starts_the_chat_with_this_team`
- `ui.chat.pickers.info_model.mobile_relay`
- `ui.chat.pickers.model_catalogue_listing.the_provider_listing_failed_the_rows_below_are_refresh_from_providers_tr`
- `ui.chat.pickers.slash.source.agent`
- `ui.chat.pickers.slash.source.approvals`
- `ui.chat.pickers.slash.source.effort`
- `ui.chat.pickers.slash.source.mcp`
- `ui.chat.pickers.slash.source.model`
- `ui.chat.pickers.slash.source.provider_accounts`
- `ui.chat.pickers.slash.source.providers`
- `ui.chat.pickers.slash.source.session_tags`
- `ui.chat.pickers.slash.source.team`
- `ui.chat.pickers.slash.source.theme`
- `ui.chat.pickers.slash.source.title_refresh`
- `ui.chat.pickers.usage_view.loading_provider_usage`
- `ui.chat.pickers.usage_view_model.credits`
- `ui.chat.pickers.usage_view_model.report`

## Not executed / not claimed

No pseudo-localization, browser/Electron launch, app install, build, native frame, screenshot, geometry measurement, actual locale-switch flow, production launch, full suite, new second independent merged-byte pass, ledger assembly, commit, push, merge, release, or human notification was executed. RTL is not applicable to Vietnamese; no RTL or bidi rendering proof is claimed. Static source scan found no bidi controls. No CJK glyph-width claim applies. The whole-interface English-free requirement and separate visual/security gates remain with integration/QA.

## Verdict

**passed / clean-with-findings**, terminal for this bounded merge audit. Unresolved BLOCKER/MAJOR count: 0. Five prior optional nits are recorded with their sources; 707 retained keys and parent receipt chains are explicit. New evidence dated 2026-11-05; not a historical recreation, replacement, or supersession of originals.
