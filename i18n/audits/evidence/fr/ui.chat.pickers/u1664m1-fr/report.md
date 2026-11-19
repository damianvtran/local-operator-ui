# PR #1664 — French merged-byte audit

- Audit date: 2026-11-05. New audit, not a replacement or recreation.
- Frozen local head: `625b865eff2ab4476fdff40144c1368a05878482` (not pushed by this auditor).
- Namespace: `ui.chat.pickers`; locale: `fr`; 752 English/context/French keys.
- Auditor: `i18n-auditor`, session `f94d5f6de05b`, instance `f94d5f6de05b-u1664m1-fr`, actual served model `openai/gpt-6.1-sol` per host switch notices. Requested Sonnet, intermediate Opus, quota fallback to GPT before substantive audit. This session authored neither parent. No translation service used.

## Verdict and exact scope

**Passed for the 13-key merge delta; clean, zero new BLOCKER/MAJOR/MINOR/NIT.** This is not a fresh linguistic pass over all 752 keys, not global French-completeness clearance, and not rendered-fit sign-off. Fresh linguistic review covers the union of 2 upstream-changed approval-scope values and 11 PR-added slash headings. The other 739 keys retain their parent-audit provenance, with explicit exact-value compatibility proofs in `record.json`.

Operator request: “switching to fr must leave NO English anywhere in the interface ... and the same must hold for every supported language.” This audit covers only the assigned namespace and locale. Technical identifiers and valid French cognates are not English leakage.

## Read order and method

Read UI HOWTO, core French style guide and glossary, then English/context/French for each of the 13 delta keys using the audited public-copy tool for English/French. Context was read as metadata; that tool rejects object-valued context sidecars. No dedicated UI glossary/style tree was invented. Current guidance file hashes are retained. Native reasoning covered accuracy, approval scope, vouvoiement/concise register, glossary terms, French punctuation, and compact heading fit.

## Individually reviewed merged values

| Key | Current French text | Assessment |
|---|---|---|
| `ui.chat.pickers.destination_pickers.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i` | Approbations par défaut de toutes les sessions qui suivent ce réglage : {string}. Cette session le suit, sauf si elle a son propre choix. | Preserves the default-following restriction, dynamic approval value, and this-session override exception. No unsafe expansion of permission scope. Correct U+202F before colon; placeholder unchanged. |
| `ui.chat.pickers.destination_pickers.default_for_all_sessions_that_follow_it` | Valeur par défaut de toutes les sessions qui suivent ce réglage | Restricts the default to sessions following this setting, not every session unconditionally. Retains upstream wording and the historical non-blocking N1 preference without reopening it. |
| `ui.chat.pickers.slash.source.agent` | Agents | Native French cognate; appropriate plural noun, not untranslated prose. |
| `ui.chat.pickers.slash.source.approvals` | Approbations | Glossary-conforming plural for approval policies. |
| `ui.chat.pickers.slash.source.effort` | Effort | Native French noun; concise reasoning-level heading. |
| `ui.chat.pickers.slash.source.mcp` | Serveurs | Names servers across both MCP selection stages, rather than verbs. |
| `ui.chat.pickers.slash.source.model` | Modèles | Glossary-conforming plural, with French accent. |
| `ui.chat.pickers.slash.source.provider_accounts` | Comptes | Names stored provider accounts rather than providers or a sign-out action. |
| `ui.chat.pickers.slash.source.providers` | Fournisseurs | Names sign-in providers, distinct from accounts. |
| `ui.chat.pickers.slash.source.session_tags` | Étiquettes | French label for tags; compact plural noun. |
| `ui.chat.pickers.slash.source.team` | Équipes | Glossary-conforming plural for teams. |
| `ui.chat.pickers.slash.source.theme` | Thèmes | Idiomatic plural for colour themes; accented. |
| `ui.chat.pickers.slash.source.title_refresh` | Options | Native French cognate for flag options; does not mislabel the list as titles. |

## Mechanical validation actually executed

Executed a bounded inline Node validator from the worktree using existing dependencies, repository `messageArguments`, `namespaceGap`, `parseReceipt`, and the FormatJS parser; command descriptions and actual output are in `audit.log`. No full check-i18n command or full test suite ran.

- Frozen HEAD, manifest SHA, and full EN/context/FR SHA-256 verified against packet and immutable Git blobs before auditing.
- All three JSON files: valid, duplicate-member checked, 752 exact matching keys.
- All 752 EN/FR messages parsed. Repository argument names/types agree throughout. Unique nonliteral AST signatures, select keys, numeric skeletons, explicit plural selectors and offsets agree; locale-specific extra French plural branches are allowed. All code-span/flag/markup token scans agree (there are zero backtick-bearing keys and zero Rich-tag AST nodes in this namespace). This does not replace semantic review of identifiers in unreviewed prose.
- Whole-namespace CLDR scan: no delta-key problem. One **pre-existing, out-of-scope** omission exists in `ui.chat.pickers.session_report_model.totals_meta`: the `failed` plural has only `=0` and `other`, omitting French `one`/`many` (`one` also absent from the English source). Confirmed identical in both source and target at BOTH parents. It is explicitly not claimed mechanically clean and not reopened as a merge-induced finding. Current text: `{calls, plural, one {{calls, number, ::group-off} requête} many {{calls, number, ::group-off} de requêtes} other {{calls, number, ::group-off} requêtes}}{failed, plural, =0 {} other { ({failed, number, ::group-off} échouées)}}{scope, select, descendants { · coût incluant les sous-agents} other {}}`. No change requested in this delta audit.
- Initial raw AST multiset differences were investigated: additional French plural branches repeat arguments. Deduplicated nonliteral signatures match in every pair; the actual follow-up output is retained.
- Parent comparisons measured: PR parent 750 exact retained target values, 2 changed; main parent 741 exact retained target values, 11 added. Union 13, outside union 739. English/context retain all 752 keys from PR parent and 741 keys from main parent.
- Packet has **12 prior ledger bindings and 9 unique prior receipt files**, derived directly rather than the packet README table's 15 summary. Every unique prior receipt SHA-256 was verified.

## Retained evidence and second-pass boundaries

`record.json` preserves original parent bindings, receipt identities/hashes, original severity counts, and exact matched EN/context/FR key lists wherever locally available historical Git snapshots match receipt-bound file hashes. A match proves bytes, not that a historical reader read every matching key. No old status/hash/receipt is rewritten.

- Original first/second passes `2ade56e55a2a` and `b4cb606f745a` retain their 34-key scope and historical findings.
- The 11 headings were explicitly reviewed by prior independent instance `116e76eaea2c`; their values match the PR parent. This session is an additional independent read of those exact messages. The historical receipt reports underlying model UNKNOWN on route radient/auto; this limitation is not repaired or concealed.
- Approval-scope parent receipts `47a0b369196c` and `6cfeec091166` bind the main-parent EN/FR bytes, preserved exactly for the two merged messages. Their minimal receipt format lacks per-key scope/context hashes, so no full-namespace reading is inferred from them. Historical N1 is a non-gating wording preference, retained rather than newly counted.
- No second independent fresh full-752-key linguistic pass is claimed. Broader historical coverage remains exactly the scope its original records establish; this delta audit cannot fill missing historical key-level evidence.

## Fit and dimensions not executed

The 11 headings satisfy the one-word context hints. The 13 contexts have no numeric maxCells/maxChars budget; the two explanatory approval messages are longer French prose, not evidence of rendered overflow. No browser/Electron/native launch, screenshots, pixel geometry, pseudo-localization, production install, full suite or terminal-width render was executed. RTL/CJK-specific checks are not applicable to French; manual bidi-control scan found none. French rendered evidence remains a separate, unwaived gate.

## Findings

No new in-scope findings. The retained CLDR observation and historical N1 above are pre-existing, not silently converted to passed full-namespace mechanics and not counted as new delta findings.

## Artifact state

Only the four files in this unique canonical audit directory were written. These are local retained records awaiting the manager's tracked commit; this auditor did not run ledger assembly, edit catalogues/ledger, commit, push, merge, or tag humans. No claim they are already on main. `audit.log` is actual execution output; this report is `audit_notes_not_execution_log`.
