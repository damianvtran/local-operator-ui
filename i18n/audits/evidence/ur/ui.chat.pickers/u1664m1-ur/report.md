# Urdu merged-byte delta audit — PR #1664

Date: 2026-11-05. Frozen local merge: `625b865eff2ab4476fdff40144c1368a05878482` (not pushed).
Auditor: `i18n-auditor`, session `9a864ad9f4fa`, actual model `openai/gpt-6.1-sol` (quota fallback from requested `anthropic/claude-sonnet-5-5`; preceding fallback notification named `anthropic/claude-opus-5-5`). Independent of both parent translators; authored no translation.

## Verdict and scope

**Passed for the 13-key merge-delta linguistic scope; no in-scope BLOCKER, MAJOR, MINOR or NIT. Terminal for this scoped audit.** This is not a fresh linguistic approval of all 752 keys or a claim that every interface surface is localized. All 752 English/context/Urdu keys received mechanical validation; the 739 keys outside the union retain prior key/byte audit provenance, recorded explicitly in record.json. Strict all-category CLDR checking has one inherited exception below, so the full namespace is NOT claimed mechanically exception-free.

Operator intent: “switching to fr must leave NO English anywhere in the interface ... and the same must hold for every supported language.” This audit binds only `ui.chat.pickers` Urdu bytes and does not prove that whole-interface intent or rendered RTL.

## Fresh linguistic review (13 keys)

Both parent deltas were re-derived. Against PR parent: 2 changed values, no added/removed keys, 750 exact retained values. Against main parent: 11 added keys, no changed/removed keys, 741 exact retained values.

| Key suffix | Current Urdu | Assessment |
|---|---|---|
| destination_pickers.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i | ان تمام سیشنز کے لیے ڈیفالٹ منظوریاں جو اسے استعمال کرتے ہیں: {string}۔ یہ سیشن بھی اسے استعمال کرتا ہے، جب تک اس کی اپنی پسند نہ ہو۔ | Accurately restricts default approvals to following sessions and preserves per-session override. No all-existing-sessions scope regression. |
| destination_pickers.default_for_all_sessions_that_follow_it | ان تمام سیشنز کے لیے ڈیفالٹ جو اسے استعمال کرتے ہیں | “Use it” naturally conveys following this default, not an unconditional global rewrite. |
| slash.source.agent | ایجنٹس | Native software loanword plural, consistent with agent term. |
| slash.source.approvals | منظوریاں | Glossary plural; policy list, not a confirmation action. |
| slash.source.effort | کوشش | Correct concise heading for the reasoning-effort list. |
| slash.source.mcp | سرورز | Correctly names servers, not subcommands or untranslated MCP prose. |
| slash.source.model | ماڈلز | Correct plural model heading. |
| slash.source.provider_accounts | اکاؤنٹس | Correct account/provider distinction for logout. |
| slash.source.providers | فراہم کنندگان | Idiomatic provider plural; two orthographic words are one noun phrase, not an overflow defect. |
| slash.source.session_tags | ٹیگز | Standard localized software term for the tag list. |
| slash.source.team | ٹیمیں | Natural plural. |
| slash.source.theme | تھیمز | Natural software loanword plural. |
| slash.source.title_refresh | اختیارات | Correctly options, not titles or an action. |

All 13 EN/context/UR triples were read. No suggested replacement is necessary. The polite register, settled terminology and Urdu punctuation comply with the external core guide. Existing glossary exceptions were not reopened.

## Mechanical execution and qualification

- Admission verified manifest and packet hashes, exact frozen HEAD, immutable Git blobs and full on-disk EN/context/UR SHA-256.
- Executed `node scripts/i18n/context-parity.mjs`: exit 0; global output reports 131 already allowed gaps in four OTHER namespaces. Scoped `namespaceGap("ui.chat.pickers")` has zero uncovered/orphaned keys.
- Executed two bounded stdin Node checks (full source in audit.log), using the repository `messageArguments` and `namespaceGap` validators plus FormatJS AST inspection: 752/752 key parity, ICU parsing, name/type/style/branch structure parity, 31 plural nodes, 13 select nodes, zero Rich tags, zero backtick spans, zero manual bidi controls. Second traversal completes every AST; first traversal stopped within one key at strict CLDR assertion.
- **UR-RETAINED-CLDR-1 (pre-existing, not reopened):** `ui.chat.pickers.session_report_model.totals_meta` uses `{failed, plural, =0 {} other { ({failed, number, ::group-off} ناکام)}}`. The strict all-CLDR-category probe flags missing `one`. English has the same =0/other conditional and this exact Urdu value is identical in BOTH parents. `ناکام` is invariant in this predicate; no new unsafe meaning or changed-message regression is present. A future strict-category cleanup could add a `one` arm with the same predicate. This audit neither edits it nor calls the entire namespace CLDR-clean.
- Verified all 15 prior receipt references against their hashes and all parent retained-key lists against actual Git values. Historical results/models are attributed to those receipts, not newly endorsed as fresh full readings.

## RTL, tokens and fit

Fresh Urdu is stored in logical sentence order. The two explanatory strings preserve scope and the `{string}` placeholder; its dynamic value may be Latin and therefore remains a renderer isolation responsibility. Urdu full stops remain after the interpolated value; no manual LRM/RLM/FSI/PDI or override controls were inserted. The 11 fresh headings have no embedded Latin tokens, arrows, paths or commands to reorder/mirror. Whole-file AST/controls checks preserve placeholder names and formatting styles; retained technical-token provenance is not a fresh all-key linguistic rereading.

No delta context defines `maxCells` or `maxChars`. The headings are brief noun labels; the longer default-scope descriptions are explanatory copy rather than fixed-width buttons. No observed copy-level fit defect. Urdu combining marks and shaping/font fallback make raw codepoint length insufficient for rendered fit, which remains unverified.

## Explicitly not executed

No browser/Electron/native app, pseudo-localization, rendered RTL/mirroring, screenshots, font/fallback/geometry measurement, runtime formatter execution, production launch, install, build, typecheck, full suite or ledger assembler. No ledger/catalogue/source/generated edits, commits, pushes, merges or human notifications. This independent pass does not claim completion of a separate second-pass or rendering gate.

`audit.log` separates actual command execution from reasoning notes. Files are a new 2026-11-05 merge-audit bundle, not a replacement or recreation of prior dated records. No UI evidence README exists at the canonical root in this frozen snapshot; the existing HOWTO retention contract and receipt parser were read.
