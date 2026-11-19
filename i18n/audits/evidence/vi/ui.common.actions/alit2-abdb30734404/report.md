# Audit report — vi / ui.common.actions / alit2-abdb30734404

- Locale `vi`, file group `ui.common.actions`: 1 keys under audit, 51 keys in the file.
- Head audited `a9e536bf89` (branch `i18n-agents-literals-2`); English source at `73af0b6855`.
- Verdict **clean** — blocker 0, major 0, minor 0, nit 0.
- Receipt of record `i18n/receipts/vi-agents-literals-audit-abdb30734404.json` (sha256 `0468afdef18df4ce6c8762b3a243db5da8a359470277409329d8385cf4e5a529`).

## Method
Read the vi style guide, the shared glossary and docs/I18N.md first; bound the bytes by sha256 before reading any content; then the machine checks (repo validators, key set and order, placeholder multisets, ICU parse, NFC, punctuation), then accuracy, idiom/register, terminology against the locale's shipped siblings, and fit. A second pass over the high-visibility subset (the publish titles and the ask onboarding copy) reversed the direction (vi to en) as a sense and safety check.

## Findings and observations

### vi-i12 — INFO — `ui.common.actions.retrying`

**Observation.** RULING: 'Đang thử lại…' is accepted. It is the natural progressive of retry_again ('Thử lại') and is byte-identical to the shipped in-flight arm of the same retry pair.

**Evidence.** shipped vi ui.agents.navigation.updates.action.retrying = 'Đang thử lại…' with updates.action.retry = 'Thử lại'. The pre-existing ui.hub.teams.public.trying = 'Đang thử…' belongs to a different pair on the public teams list and is outside this change.

### vi-i13 — INFO — `ui.common.actions.retrying`

**Observation.** Machine observation, pre-existing: this file's key ORDER differs from en at 28 positions, while its key SET is equal and every pre-existing value is byte-equal to the parent commit. The divergence is identical at 73af0b6855, so this change did not introduce it; the new key sits at index 6 in both files.

**Evidence.** list(en) vs list(vi): sets equal; first divergence at index 7 (en date_time_picker.select_date vs vi confirmation_modal.cancel); the same comparison restricted to the 50 shared keys at 73af0b6855 is also non-equal. locale-parity.test.mjs passes 44/44, so ordering is not a gate.

## Notes versus execution
This report and the receipt's info/finding text are reasoned notes. The commands actually run and their verbatim output are in `audit.log` beside this file; no command output is asserted here.
