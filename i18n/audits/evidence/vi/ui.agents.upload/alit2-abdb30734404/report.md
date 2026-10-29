# Audit report — vi / ui.agents.upload / alit2-abdb30734404

- Locale `vi`, file group `ui.agents.upload`: 6 keys under audit, 29 keys in the file.
- Head audited `a9e536bf89` (branch `i18n-agents-literals-2`); English source at `73af0b6855`.
- Verdict **clean-with-findings** — blocker 0, major 0, minor 0, nit 1.
- Receipt of record `i18n/receipts/vi-agents-literals-audit-abdb30734404.json` (sha256 `0468afdef18df4ce6c8762b3a243db5da8a359470277409329d8385cf4e5a529`).

## Method
Read the vi style guide, the shared glossary and docs/I18N.md first; bound the bytes by sha256 before reading any content; then the machine checks (repo validators, key set and order, placeholder multisets, ICU parse, NFC, punctuation), then accuracy, idiom/register, terminology against the locale's shipped siblings, and fit. A second pass over the high-visibility subset (the publish titles and the ask onboarding copy) reversed the direction (vi to en) as a sense and safety check.

## Findings and observations

### vi-i7 — INFO — `ui.agents.upload.title.publish_org`

**Observation.** RULING (asked): 'đến {destination}' is natural and correct for publishing to an organisation, and the contrast with the public variant's 'lên' is the right one. 'lên' is the platform preposition (publish onto a surface such as the hub); a named recipient organisation takes 'đến'.

**Evidence.** shipped vi ui.agents.upload.target.label = 'Xuất bản đến' (the destination selector's own label, pre-existing); shipped vi ui.agents.upload.sign_in.needed = '…xuất bản tác nhân lên Trung tâm tác nhân'; ui.hub.pages.header.title = 'Trung tâm tác nhân'. Rendered: 'Xuất bản “Research assistant” đến Acme Corporation?' and with a 59-character Vietnamese organisation name ('Công ty Cổ phần Thương mại Dịch vụ Xuất nhập khẩu Bình Minh', 94 characters of sentence) it still reads as one sentence, because the destination is the last element before the question mark.

### vi-i8 — INFO — `ui.agents.upload.title.republished`

**Observation.** Surface and listing vocabulary is the locale's shipped wording, not a second name: 'mục đăng' for listing and 'Trung tâm tác nhân' for the Agent Hub. The receipt forms ('Đã …', no question mark) are past-tense and do not read as fresh publications.

**Evidence.** 7 pre-existing vi keys use 'mục đăng' (ui.agents.publication.action.publish_as_new, action.update_listing, agent_not_found.headline, name_taken.owned_body, not_owner.body, not_owner.headline, ui.agents.upload.action.open_listing); 5 pre-existing keys use 'Trung tâm tác nhân' (ui.hub.pages.header.title, ui.shell.sidebar_navigation.agent_hub, ui.command_palette…agent_hub, ui.agents.upload.sign_in.needed, ui.agents.dialogs.create.hub_link).

### vi-n2 — NIT — `ui.agents.upload.title.update_listing`

**Current.** Cập nhật mục đăng của “{name}” trên Trung tâm tác nhân? (55 chars) / Đã cập nhật mục đăng của “{name}” trên Trung tâm tác nhân (57 chars)

**Problem.** The sidecars budget 'about 50' and 'about 55' English characters for one dialog-header line; the two Vietnamese templates sit 5 and 2 characters over that figure with the {name} token still to expand. publish_public's sidecar says the header wraps under the close control, so this is a wrap rather than a demonstrated clip — recorded because the budget is stated, not because truncation was observed.

**Proposed fix.** If the header truncates rather than wraps, dropping 'của' brings both under budget and stays idiomatic: 'Cập nhật mục đăng “{name}” trên Trung tâm tác nhân?' (51) and 'Đã cập nhật mục đăng “{name}” trên Trung tâm tác nhân' (53). No change required if it wraps; verify in the dialog.

## Notes versus execution
This report and the receipt's info/finding text are reasoned notes. The commands actually run and their verbatim output are in `audit.log` beside this file; no command output is asserted here.
