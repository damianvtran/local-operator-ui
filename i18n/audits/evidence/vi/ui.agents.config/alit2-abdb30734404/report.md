# Audit report — vi / ui.agents.config / alit2-abdb30734404

- Locale `vi`, file group `ui.agents.config`: 3 keys under audit, 31 keys in the file.
- Head audited `a9e536bf89` (branch `i18n-agents-literals-2`); English source at `73af0b6855`.
- Verdict **clean** — blocker 0, major 0, minor 0, nit 0.
- Receipt of record `i18n/receipts/vi-agents-literals-audit-abdb30734404.json` (sha256 `0468afdef18df4ce6c8762b3a243db5da8a359470277409329d8385cf4e5a529`).

## Method
Read the vi style guide, the shared glossary and docs/I18N.md first; bound the bytes by sha256 before reading any content; then the machine checks (repo validators, key set and order, placeholder multisets, ICU parse, NFC, punctuation), then accuracy, idiom/register, terminology against the locale's shipped siblings, and fit. A second pass over the high-visibility subset (the publish titles and the ask onboarding copy) reversed the direction (vi to en) as a sense and safety check.

## Findings and observations

### vi-i4 — INFO — `ui.agents.config.placeholder.docked`

**Observation.** Placeholders fit their slots: docked 38 cells vs the English 44, hero 20 vs 23, about 16 vs 14 around a data name that can be long. Nothing was lengthened, so no new wrap or clip is introduced: the docked box's own sidecar records that the 44-character English already wraps readably (301.1709 px unwrapped in a 304 px content area, scrollHeight == clientHeight == 55).

**Evidence.** byte and character counts of the three values; the docked sidecar's own measured note (EN unwrapped 301.1709 px in a 304 px content area) is the boundary this change stays inside. No rendered app check was run here; fit beyond character counts belongs to QA.

## Notes versus execution
This report and the receipt's info/finding text are reasoned notes. The commands actually run and their verbatim output are in `audit.log` beside this file; no command output is asserted here.
