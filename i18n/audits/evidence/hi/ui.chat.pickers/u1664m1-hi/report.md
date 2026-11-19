# Hindi merged-byte picker audit — 2026-11-05

## Verdict and boundary

**PASSED for the assigned merge-delta linguistic audit.** Findings: 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT. No translation was authored or changed by this auditor. This is a NEW audit, not a replacement, historical recreation, or superseding of dated parent receipts.

Operator request: “switching to fr must leave NO English anywhere in the interface ... and the same must hold for every supported language.” This report audits only Hindi `ui.chat.pickers` at the frozen local merged bytes. It is NOT whole-interface completion, rendered proof, release approval, or a whole-namespace fresh linguistic pass.

## Identity and binding

- Auditor: `i18n-auditor`, session `bb99e9f9ce2a`, instance `bb99e9f9ce2a-u1664m1-hi`.
- Actual audit model: `openai/gpt-6.1-sol`, authoritative host model-switch announcement. Requested Sonnet and intermediate Opus routes encountered quota fallback; neither is claimed as the semantic audit model.
- Independent of translators of both parent values; no catalogue/source/index edits.
- Head: `625b865eff2ab4476fdff40144c1368a05878482`, verified before work and before record creation.
- Manifest SHA-256: `d2667a6f0c006fed09a9ed06bd17aa7e35d53f8cbe597b81ba3d3201c2928a93`.
- Full English, context and Hindi hashes are bound in `record.json` and `receipt.json`.

## Scope and retention

All 752 English/Hindi/context key sets and valid JSON were checked mechanically. The linguistic focus is the UNION of the two parent deltas: two upstream approval-scope values plus eleven PR-added slash-list headings, thirteen total. The other 739 keys are exact values retained from BOTH parents, not a fresh 739-key linguistic rereading. The receipt enumerates every reviewed and retained key plus both exact parent-retention lists. Nine unique prior receipt blobs were SHA-256 verified; twelve parent/history binding positions (fifteen auditor positions) remain explicitly retained. Prior requested-route-only model metadata is preserved as provenance, not upgraded to known served identity.

The current value is byte-identical to the PR parent on 750 keys and to main on 741 keys. Parent deltas were independently recomputed: PR parent 0 added / 2 changed / 0 removed; main parent 11 added / 0 changed / 0 removed. No new merged translations were invented.

## Linguistic reasoning (audit_notes_not_execution_log)

The two approval-scope sentences correctly restrict the default to sessions following it, retain the session-specific override, preserve `{string}`, and do not broaden authority to all sessions. The prose uses familiar Hindi, consistent nukta, and danda full stops. Direct neighboring approval/session/effort strings were compared for semantic continuity. All eleven headings are concise native product nouns; provider and account remain distinct. The effort heading matches `ui.agents.models.reading.effort_col`; agent, model, team, approval and server labels follow the canonical glossary or existing retained terminology. Bare Hindi nouns do not all require overt plural inflection; the current headings are natural in this list context.

All thirteen reviewed keys contain Devanagari product copy, no native-digit substitution and no bidi/joiner controls. Hindi is LTR; Urdu RTL obligations do not apply. Settled loans remain in Devanagari. This audit used no translation or MT service. No new linguistic defects or overflow risks were found in the thirteen-key scope. Context has no `maxChars`/`maxCells` numeric hints; short single-word headings meet its one-word constraint. Actual font shaping, terminal-cell width, clipping and rendered wrapping remain unexecuted.

## Mechanical execution and surprising-result follow-up

`audit.log` is the ACTUAL captured command output, not these reasoning notes.

1. Repository validator: `node --test '--test-name-pattern=^\[hi\]' scripts/i18n/locale-parity.test.mjs` — exit 0, six tests passed. This reads Hindi catalogues across namespaces; no other locale suite or full suite was run.
2. Supplemental all-752-key ICU parser/type/style/branch/CLDR/retained-byte checker — first exit 1, reporting an overstrict exact-zero branch signature plus an inherited CLDR category omission.
3. Refined checker permits additional exact-number branches but retains named categories, argument names/kinds/styles, and ICU parse checks — exit 1 for the ONE inherited CLDR observation below. Reproduction source is retained in the log. No output has been rewritten into a clean check.
4. Strict JSON duplicate-key and input/receipt-hash verification, retained-byte and literal command/flag comparison, scoped digit/control checks — all assertions passed. No machine-token mismatches. AST inventory: 31 plural nodes, 13 select nodes, zero rich tags, zero backtick messages. Full-context key parity passed.

### O-HI-EXACT-ZERO — resolved validator false positive, not a defect

`ui.chat.pickers.stop.confirm`: the Hindi ICU adds an explicit `=0` branch while preserving `one` and `other`. Hindi cardinal `one` includes zero; the exact-zero arm avoids falsely calling zero sessions “this session.” The refined check accepts the legitimate structure. Target bytes are unchanged in both parents.

### O-HI-CLDR-RETAINED — out of scope, pre-existing mechanical observation

`ui.chat.pickers.session_report_model.totals_meta`, failed-count plural: both source and target have `=0` / `other`, without `one`. The supplemental requirement that EVERY CLDR category be explicit therefore remains non-green. The target is unchanged in BOTH parents, and the source has the same inherited structure. The remaining text is an invariant adjective, so no new merge-induced wrong meaning was demonstrated. Per the manager's scope instruction this observation does not reopen previously approved, unchanged translations or become a new scoped finding. No suggestion to patch it is made here. This report does NOT claim all 752 keys are all-category-CLDR-clean.

## Not executed / not waived

No pseudo-localization, app/browser/Electron launch, screenshots, actual rendered-fit or shaping proof, full test/build/type gate, production launch/install, assembler, ledger write, commit, push, merge or human notification. No second full-namespace high-visibility linguistic pass is implied; existing parent independent audit provenance remains what it originally proved. The canonical evidence README is absent in this frozen UI checkout; retention follows the existing `docs/I18N.md` contract. No shared manifest/README was edited under this disjoint-write brief.

## Findings

None in the assigned changed-key and direct-neighbor scope. Exact key lists, provenance, status and zero severity counts are machine-readable in the companions. The two observations above are explicitly distinguished from new findings, and the supplemental check's inherited failure is not hidden.
