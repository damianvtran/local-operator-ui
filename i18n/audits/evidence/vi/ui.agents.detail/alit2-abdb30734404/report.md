# Audit report — vi / ui.agents.detail / alit2-abdb30734404

- Locale `vi`, file group `ui.agents.detail`: 3 keys under audit, 50 keys in the file.
- Head audited `a9e536bf89` (branch `i18n-agents-literals-2`); English source at `73af0b6855`.
- Verdict **clean** — blocker 0, major 0, minor 0, nit 0.
- Receipt of record `i18n/receipts/vi-agents-literals-audit-abdb30734404.json` (sha256 `0468afdef18df4ce6c8762b3a243db5da8a359470277409329d8385cf4e5a529`).

## Method
Read the vi style guide, the shared glossary and docs/I18N.md first; bound the bytes by sha256 before reading any content; then the machine checks (repo validators, key set and order, placeholder multisets, ICU parse, NFC, punctuation), then accuracy, idiom/register, terminology against the locale's shipped siblings, and fit. A second pass over the high-visibility subset (the publish titles and the ask onboarding copy) reversed the direction (vi to en) as a sense and safety check.

## Findings and observations

### vi-i5 — INFO — `ui.agents.detail.meta.delegates`

**Observation.** RULING (asked): 'Ủy quyền' is accepted as the Delegates fact. Vietnamese does not inflect, so the noun gloss is shared with the delegation section; in the dot-separated fact line it reads as the capability, not as a command, and it is deliberately shorter than the editable switch's full sentence.

**Evidence.** shipped vi ui.agents.detail.delegate.label and delegate.aria = 'Có thể ủy quyền cho tác nhân con'; detail.section.delegation = 'Ủy quyền và cấp năng lực'. The meta line renders sourceLabel + this key + a hard-coded 'Specialist' (src/renderer/src/features/agents/components/agent-detail.tsx:170-176), so the key lands in a translated sentence slot as a bare fact. Spelling 'ủy' (tone on the first vowel, NFC) is the guide's wave-2 call.

### vi-i6 — INFO — `ui.agents.detail.read.show_all`

**Observation.** The expander pair is clearly opposed and terse: 'Hiện tất cả' / 'Thu gọn'. 'Hiện tất cả' matches the shipped short form for showing everything; 'Thu gọn' is the shipped collapse verb.

**Evidence.** shipped vi ui.browser.browser_surface.show_all_tabs = 'Hiện tất cả tab'; ui.shell.sidebar_navigation.collapse_sidebar = 'Thu gọn thanh bên'; ui.settings.configuration…collapse_all = 'Thu gọn tất cả'. Widths are 11 and 7 cells against an 8- and 9-character English pair; the sidecar's '48x17.4 px box measured at native' is read as the measured box of the English label itself, since a fixed 48 px clamp would also cut 'Show less'. The hint's own rule ('one short word or two') is met; if QA finds the box is a fixed 48 px clamp rather than measured text, the 11-cell 'Hiện tất cả' becomes a fit question.

### vi-i14 — INFO — `ui.agents.detail.meta.delegates`

**Observation.** Out-of-audit observation (not a finding against this change): in the same metadata line the 'Specialist' fact is a hard-coded English literal, so the vi line reads 'Nguồn · Ủy quyền · Specialist' - the very concept this repository translates as 'Chuyên gia' in ui.hub.teams.kind.specialist. Pre-existing code, untouched by a9e536bf89, and a catalogue auditor cannot fix it.

**Evidence.** src/renderer/src/features/agents/components/agent-detail.tsx:174 (that file's last commit is 73af0b6855, the keying commit; a9e536bf89 touches no file under src/renderer). Flagged for the manager as a code-level follow-up outside this lane.

## Notes versus execution
This report and the receipt's info/finding text are reasoned notes. The commands actually run and their verbatim output are in `audit.log` beside this file; no command output is asserted here.
