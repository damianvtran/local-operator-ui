# Audit report — vi / ui.hub.teams / alit2-abdb30734404

- Locale `vi`, file group `ui.hub.teams`: 2 keys under audit, 49 keys in the file.
- Head audited `a9e536bf89` (branch `i18n-agents-literals-2`); English source at `73af0b6855`.
- Verdict **clean** — blocker 0, major 0, minor 0, nit 0.
- Receipt of record `i18n/receipts/vi-agents-literals-audit-abdb30734404.json` (sha256 `0468afdef18df4ce6c8762b3a243db5da8a359470277409329d8385cf4e5a529`).

## Method
Read the vi style guide, the shared glossary and docs/I18N.md first; bound the bytes by sha256 before reading any content; then the machine checks (repo validators, key set and order, placeholder multisets, ICU parse, NFC, punctuation), then accuracy, idiom/register, terminology against the locale's shipped siblings, and fit. A second pass over the high-visibility subset (the publish titles and the ask onboarding copy) reversed the direction (vi to en) as a sense and safety check.

## Findings and observations

### vi-i11 — INFO — `ui.hub.teams.recency.updated`

**Observation.** The two recency arms differ only in their verb, both stay lower-case fragments, and neither can be read as an imperative beside the age phrase. The creation arm says creation and never claims an update.

**Evidence.** vi ui.hub.teams.recency.created = 'tạo {when}', recency.updated = 'cập nhật {when}'; rendered 'tạo 3 ngày trước' / 'cập nhật 3 ngày trước'. This matches the same shape and wording as ui.hub.pages.card.updated, so the two hub surfaces agree.

## Notes versus execution
This report and the receipt's info/finding text are reasoned notes. The commands actually run and their verbatim output are in `audit.log` beside this file; no command output is asserted here.
