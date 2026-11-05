# Russian merged-byte audit — UI PR #1664

Date: 2026-11-05. Frozen LOCAL, unpushed head `625b865eff2ab4476fdff40144c1368a05878482`. Namespace `ui.chat.pickers`.

Operator request: ‘switching to fr must leave NO English anywhere in the interface ... and the same must hold for every supported language.’

## Verdict
Passed / clean-with-findings: no unresolved BLOCKER or MAJOR. One explicitly retained historical MINOR fit concern. This is namespace merged-byte audit evidence, not proof of a fully English-free rendered UI or release.

## Scope and independence
752/752 keys mechanically checked. Fresh linguistic reading covers the union of both parent deltas: 13 keys (2 upstream corrections + 11 PR additions). The other 739 keys retain parent audit provenance and exact values; no claim of fresh whole-namespace linguistic reading. Parent-specific exact retained IDs and immutable original receipts are retained in record.json. This new dated record does not supersede or reconstruct any original audit.

{
  "agent": "i18n-auditor",
  "session": "227bd1e1af60",
  "instance": "227bd1e1af60-u1664m1-ru",
  "model": "openai/gpt-6.1-sol",
  "independent_from_translator_session": true,
  "actual_model_source": "Host model-switch notice: openai/gpt-6.1-sol after provider quota failure; initial guide read anthropic/claude-sonnet-5-5; intermediate anthropic/claude-opus-5-5 switch before substantive audit. No translation authored by this auditor.",
  "fallback": true
}

## Fresh linguistic reading, English then context then target
Both approval strings accurately describe sessions following the default rather than future sessions. The explicit per-session-choice exception and `{string}` are preserved. Impersonal register, Cyrillic terms одобрения/сессия, sentence case, grammar and punctuation are appropriate. Slash headings correctly name agents, approvals, effort, servers, models, stored accounts, providers, tags, teams, themes and flag options. Prior accepted terminology remains unchanged. The idiomatic two-word account noun is retained from the independently audited PR parent; the sidecar’s one-word preference is not treated as authority to replace a correct established noun.

| Key | English | Russian |
|---|---|---|
| `ui.chat.pickers.destination_pickers.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i` | Default approvals for all sessions that follow it: {string}. This session follows it unless it has its own choice. | Одобрения по умолчанию для всех сессий, которые их используют: {string}. Эта сессия использует их, если у неё нет собственного выбора. |
| `ui.chat.pickers.destination_pickers.default_for_all_sessions_that_follow_it` | Default for all sessions that follow it | Значение по умолчанию для всех сессий, которые его используют |
| `ui.chat.pickers.slash.source.agent` | Agents | Агенты |
| `ui.chat.pickers.slash.source.approvals` | Approvals | Одобрения |
| `ui.chat.pickers.slash.source.effort` | Effort | Усилия |
| `ui.chat.pickers.slash.source.mcp` | Servers | Серверы |
| `ui.chat.pickers.slash.source.model` | Models | Модели |
| `ui.chat.pickers.slash.source.provider_accounts` | Accounts | Учётные записи |
| `ui.chat.pickers.slash.source.providers` | Providers | Провайдеры |
| `ui.chat.pickers.slash.source.session_tags` | Tags | Теги |
| `ui.chat.pickers.slash.source.team` | Teams | Команды |
| `ui.chat.pickers.slash.source.theme` | Themes | Темы |
| `ui.chat.pickers.slash.source.title_refresh` | Options | Параметры |

## Findings
{
  "id": "RU-M1-retained",
  "severity": "MINOR",
  "key": "ui.chat.pickers.destination_pickers.default_for_all_sessions_that_follow_it",
  "current_text": "Значение по умолчанию для всех сессий, которые его используют",
  "reason": "Retains parent auditor 600fc6d81235 M1: long scope label can wrap in narrow picker. Current value measured here is 61 code points (source 39); prior receipt described 62/38. No numeric context budget and no rendered overflow proof. This is a retained nonblocking fit concern, not a newly observed overflow.",
  "suggested_wording": "По умолчанию для всех сессий",
  "disposition": "retained — optional shorter wording omits explicit following-default qualifier; prefer current accurate wording unless rendered evidence requires shortening. No catalogue edit requested by this audit."
}

## Mechanical execution
Repo validator, copied byte-identically into namespace-only scratch fixture with original en/ru catalogues and existing dependencies: `node --max-old-space-size=256 --test "$LOCAL_OPERATOR_SCRATCHPAD/ru-u1664m1-validator/scripts/i18n/locale-parity.test.mjs"`: 8 passed, 0 failed.
Supplement: `node --max-old-space-size=256 "$LOCAL_OPERATOR_SCRATCHPAD/ru-u1664m1-validator/mechanical.mjs"`: PASS, 752 keys, 31 Russian plural nodes, 13 select nodes, no rich-tag nodes. Typed placeholders, styles, select arms, source exact arms, all Russian CLDR categories one/few/many/other, backticks/flags/slash tokens, NFC and manual bidi-control absence checked. JSON syntax and duplicate keys additionally checked while finalizing record.
The first supplemental assertion incorrectly required identical exact-arm sets. Russian stop.confirm legitimately adds =1 to distinguish this session from 21 sessions; this is not a defect. A second overstrict check required English one even where =1 is used. Corrected the audit rig, not product copy; preserve failed outputs and final successful output in audit.log.

## Fit and dimensions not executed
No maxCells/maxChars hints exist for these 13 entries. Source-only character measurements are in execution log; not font or geometry proof. Russian Cyrillic is LTR and normally single-cell; no CJK wide-glyph or RTL sentence-order claim applies. Manual bidi controls absent mechanically. No pseudo-localization, browser, Electron, terminal render, screenshot, real flow, full suite, production launch, install, assembler, ledger write, commit, push or merge. Existing prior high-visibility independent streams remain cited, not invented as a new second pass.

## Evidence interpretation
audit.log contains clearly separated actual command output and audit notes; notes are not execution proof. Public-copy API succeeded for English and Russian catalogues; refused context objects as non-string values. Sidecar metadata was inspected locally without a catalogue bypass. No MT/translation API used. Canonical bundle is uncommitted until manager retains it in Git; no claim it is on main.
