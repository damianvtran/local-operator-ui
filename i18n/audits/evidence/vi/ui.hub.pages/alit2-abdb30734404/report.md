# Audit report — vi / ui.hub.pages / alit2-abdb30734404

- Locale `vi`, file group `ui.hub.pages`: 2 keys under audit, 37 keys in the file.
- Head audited `a9e536bf89` (branch `i18n-agents-literals-2`); English source at `73af0b6855`.
- Verdict **clean** — blocker 0, major 0, minor 0, nit 0.
- Receipt of record `i18n/receipts/vi-agents-literals-audit-abdb30734404.json` (sha256 `0468afdef18df4ce6c8762b3a243db5da8a359470277409329d8385cf4e5a529`).

## Method
Read the vi style guide, the shared glossary and docs/I18N.md first; bound the bytes by sha256 before reading any content; then the machine checks (repo validators, key set and order, placeholder multisets, ICU parse, NFC, punctuation), then accuracy, idiom/register, terminology against the locale's shipped siblings, and fit. A second pass over the high-visibility subset (the publish titles and the ask onboarding copy) reversed the direction (vi to en) as a sense and safety check.

## Findings and observations

### vi-i9 — INFO — `ui.hub.pages.card.get`

**Observation.** RULING (asked): 'Tải' is accepted for 'Get'. It is the shipped hub verb for downloading, it is three cells like the English budget, and it agrees with the download icon and with the button's separate accessible name.

**Evidence.** shipped vi ui.hub.pages.header.subtitle ('Khám phá và tải tác nhân, nhóm và kỹ năng…'), ui.hub.pages.sort.most_downloaded ('Tải nhiều nhất'), ui.agents.dialogs.create.hub_link ('…để tải tác nhân có sẵn'), ui.hub.teams.pull ('Tải về'). The literal 'Lấy' would contradict the icon and the download sense.

### vi-i10 — INFO — `ui.hub.pages.card.updated`

**Observation.** RULING (asked): 'cập nhật {when}' joins naturally. Every shared age message ends in 'trước', so the fragment needs neither a second 'ago' nor a preposition, and the verb stays in the lower-case fragment register the sidecar asks for.

**Evidence.** rendered with the shipped vi age strings: 'cập nhật 3 ngày trước', 'cập nhật 5 phút trước', 'tạo 3 ngày trước'. ui.hub.comments.age.* all render '{count} <unit> trước'; fallback '{duration} trước'.

## Notes versus execution
This report and the receipt's info/finding text are reasoned notes. The commands actually run and their verbatim output are in `audit.log` beside this file; no command output is asserted here.
