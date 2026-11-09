# French S7 independent audit

Verdict: **clean — terminal**. No blocker, major, minor or nit findings.

Reviewer: i18n-auditor / openai/gpt-6.1-sol; session 34bf406336f0. Actual provider-quota fallback disclosed in record.json.

Scope: 0ad5542379a349a98e0a8d602dbd992746fd40a2..31710e01b6b6e1e0aae6ed56d5e4467de6611740, French additions only (7 + 16 + 6 = 29). Main baseline: 41c265cbff6. Lane: bounded hotfix audit, ≤30 min.

## Executed checks
- Parsed and formatted all 29 English/French ICU messages with shared intl-messageformat 12.1.3; recursively compared non-literal ASTs: 29 PASS. This verifies argument names, types, plural arms and number skeletons.
- Checked every addition for bidi controls: 29 PASS.
- Verified literal `$'{'NAME'}'` byte-identical in source; formatter produces `${NAME}`.
- Verified both `::group-off` occurrences; exercised counts 0, 1, 2, 1000, 1000000 (outputs in record.json).
- Read all 29 EN/FR pairs for meaning, technical register, factual notice tone and unintended English: PASS.
- Verified backend claim in base French values: ui.agents.detail.alert.unconfirmed_body, ui.agents.detail.field.effort_helper, ui.notices.aida.unreachable and ui.notices.chat.unread_backend_silent. Exact values retained in record.json.
- Checked existing sous-agent, équipe, conversation and connexion usage; no second rendering introduced. Organisation is not newly named in this delta.
- Computed SHA-256 from actual English and target bytes for each namespace; hashes in record.json and receipt.

No catalogues, ledger, allowance or generator changed. No visual/rendered-page claim; this is a linguistic and ICU execution audit.

## Evidence
`record.json` contains all 29 pairs, formatted outputs, structural-check results, protocol checks, baseline terminology citations and namespace hashes.
