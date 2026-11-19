# Terminal author validation

Feature source frozen at `1014f8ca713390bde6aeb3de902aac8b2e0eb4ef`, normal merge of `0b03782952` (includes requested143552 main). All five feature-source hashes in source-provenance.json match. Source bytes were unchanged by convergence from0dee4071da. Shared dependency link reused; lockfile matches main; installed TypeScript7.0.2 matches^7.0.2. No install, full suite, packaging or static build.

## Actual gates

- `node --max-old-space-size=512 --test --test-concurrency=1 scripts/chat-sidebar-selection.test.mjs scripts/sidebar-tag-picker.test.mjs scripts/sidebar-tag-drag.test.mjs scripts/chat-sidebar-tags.test.mjs scripts/sidebar-pin-order.test.mjs scripts/lane-registration.test.mjs`:85 tests,85 PASS,0 FAIL,0 skipped.
- Same bounded Node flags with `scripts/canvas-tab-close.test.mjs scripts/chat-sidebar-row-menu.test.mjs scripts/chat-sidebar-sections.test.mjs`:25 tests,25 PASS,0 FAIL,0 skipped. Total affected tests110/110.
- `tsc --noEmit -p tsconfig.node.json`:PASS.
- `tsc --noEmit -p tsconfig.app.json`:RESOURCE-BLOCKED, not a code failure or a pass. Actual shared TypeScript7 lib/tsc.js execs its native executable; V8 heap options do not constrain it. A1.5GiB process-group ceiling reaped it before any compiler diagnostics, including the final GOMAXPROCS=2/GOMEMLIMIT=900MiB attempt. No ceiling raised. Manager explicitly authorized publication with CI typecheck authoritative; it MUST be green before merge.
- Changed-source Biome check (helper +four TSX files):PASS.
- `pnpm lint:scripts`:PASS,3 changed script files.
- `pnpm check-i18n`:PASS:generated keys/check-strings/ledger/context parity;334 complete/fresh/independent ledger rows.16 inherited advisory literal findings;196 allowed context gaps in6 unrelated namespaces remain baseline. No new tag context gaps.
- `node --max-old-space-size=512 --test --test-concurrency=1 scripts/evidence-manifest.test.mjs`:53 tests,52 PASS,0 FAIL,1 skipped (citation ancestry unavailable in shallow history). Inventory/count guards passed; ancestry is NOT claimed validated.
- `node scripts/evidence-fold.mjs --no-amend` and `git diff --check`:PASS. The final stamp commit changes evidence only, not tested feature source.

## Executed last live path

Actual mounted Manage duplicate rename:one inline alert stays in its editor, zero registry/assignment writes. Dialog420×560; body379/383; footer visible; no horizontal overflow. Screenshot captured and viewed, alongside prior flow-results/34 PNGs. Own browser closed and Storybook exact process group reaped.

Earlier resource interruptions are not hidden:an initial1GiB Node batch was interrupted; the unfinished lanes were rerun under a512MiB V8 heap and passed. Renderer resource-block remains explicitly deferred to CI, not bypassed by weakening tests/types.

Native keyboard/IME/screen-reader, real-core persistence/races and exhaustive font/display/helper/palette axes remain independent QA scope. No review/QA/design/UX sign-off, merge, release or bump is claimed.

## Audited Urdu final-tree checks

Independent receiptf0a1b2c3d4e5, SHA256b71e4560203cb59b7e17964d0ac1e1a9b97b9af73f731d31a0ef4705e1a6dc40, clean/zero findings. Actual auditor modelopenai/gpt-6.1-sol after anthropic quota exhaustion; only provenance header corrected, by auditor. Author did not alter/approve receipt. Urdu catalogue73 keys, SHA2561ebc41a63a56910daa408deebd50e875828ab7b88bb22b6d36a666dac37d4a5b;54 baseline values untouched.

`ledger-assemble` accepted corrected receipt. `pnpm check-i18n` PASS on the final merged working tree, including byte-identical generated keys, check-strings, ledger-check392 complete/fresh/independent rows and context parity. Existing196 allowed context gaps/16 advisory literals remain unrelated baseline. Count392 is tool-derived:existing Urdu row upserted; prior audits superseded.

Targeted Node rerun used --max-old-space-size=512 --test-concurrency=1 over the same9 affected lanes. Actual81 reported:79PASS,2 file-setup failures (selection dependency import and picker mkdir ENOTDIR on dangling node_modules). Their31 cases did not execute. This does NOT replace the earlier110/110 source-identical checkpoint with a false green final rerun. No test/source weakening, relink, install or extra tree. CI must supply complete fresh tests and the authoritative renderer TypeScript check. Urdu RTL rendered-fit remains independent QA scope.

Final merged evidence inventory rerun:53 tests,52PASS,0FAIL,1shallow-history ancestry skip. Counts/inventory validated on the final converged tree.
