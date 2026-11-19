# Audit report — vi / ui.agents.pages / alit2-abdb30734404

- Locale `vi`, file group `ui.agents.pages`: 8 keys under audit, 30 keys in the file.
- Head audited `a9e536bf89` (branch `i18n-agents-literals-2`); English source at `73af0b6855`.
- Verdict **clean-with-findings** — blocker 0, major 0, minor 0, nit 1.
- Receipt of record `i18n/receipts/vi-agents-literals-audit-abdb30734404.json` (sha256 `0468afdef18df4ce6c8762b3a243db5da8a359470277409329d8385cf4e5a529`).

## Method
Read the vi style guide, the shared glossary and docs/I18N.md first; bound the bytes by sha256 before reading any content; then the machine checks (repo validators, key set and order, placeholder multisets, ICU parse, NFC, punctuation), then accuracy, idiom/register, terminology against the locale's shipped siblings, and fit. A second pass over the high-visibility subset (the publish titles and the ask onboarding copy) reversed the direction (vi to en) as a sense and safety check.

## Findings and observations

### vi-i1 — INFO — `ui.agents.pages.ask.body_agent`

**Observation.** RULING (asked): 'trực tiếp' is accepted; it is not an embellishment of the English. The product's own shipped sentence for this capability carries 'directly' in English and 'trực tiếp' in Vietnamese, and the paragraph reuses that sentence's two clauses.

**Evidence.** en ui.agents.detail.kind.role = 'You can chat with it directly'; shipped vi ui.agents.detail.kind.role = 'Bạn có thể trò chuyện trực tiếp với nó'; shipped vi ui.agents.detail.kind.specialist = 'Các tác nhân khác có thể gọi đến nó'. 'trực tiếp với nó' reads as direct conversation with the agent, not the 'live/in person' sense.

### vi-i2 — INFO — `ui.agents.pages.add_manual.agent`

**Observation.** RULING (asked): 'Tự thêm' is accepted for 'manually' / 'by hand'. The locale's 'thủ công' marks manual operation instead of automation, which is a different contrast from this button (make it yourself instead of asking in words).

**Evidence.** shipped vi ui.agents.pages.empty.agents and empty.teams already render 'Ask for one below, or add one by hand' as 'Hãy yêu cầu bên dưới hoặc tự thêm.'. All 4 shipped 'thủ công' strings contrast with automation (actions.copy_failed, updates.update_notification.the_server_needs_updating_by_hand, subscriptions.subscribe_description, subscriptions.manual_available). 16 cells also fits the 288 px ghost button better than the 22-cell 'Thêm tác nhân thủ công'.

### vi-i3 — INFO — `ui.agents.pages.ask.heading_agent`

**Observation.** RULING: 'Yêu cầu một tác nhân' / 'Yêu cầu một nhóm' use the verb this pane already ships for the action, stay at three Vietnamese words, and stay headings rather than sentences.

**Evidence.** shipped vi ui.agents.pages.empty.agents/teams ('Hãy yêu cầu bên dưới…'), ui.agents.config.composer.label ('Yêu cầu thay đổi tác nhân hoặc nhóm'). The sibling pair differs only in its object, as its sidecar requires.

### vi-n1 — NIT — `ui.agents.pages.ask.body_agent`

**Current.** Tác nhân là một bộ chỉ dẫn tái sử dụng: bạn có thể trò chuyện trực tiếp với nó, hoặc để tác nhân khác gọi đến. Mô tả điều bạn muốn và một lần chạy cấu hình sẽ thiết lập nó.

**Problem.** The second clause elides the object pronoun ('để tác nhân khác gọi đến') where the shipped sibling keeps it ('Các tác nhân khác có thể gọi đến nó'). It is grammatical here because the preceding 'với nó' supplies the referent and no reader is misled; only the parallelism with the shipped sentence is lost.

**Proposed fix.** …hoặc để tác nhân khác gọi đến nó. No slot budget is affected (the paragraph wraps at the 810 px measure); optional polish, not gating.

## Notes versus execution
This report and the receipt's info/finding text are reasoned notes. The commands actually run and their verbatim output are in `audit.log` beside this file; no command output is asserted here.
