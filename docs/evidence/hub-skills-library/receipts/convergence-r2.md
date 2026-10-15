# DIRTY convergence after the unified remediation

Coder/model: `anthropic/claude-sonnet-5-5`. Baseline `f114b314c9675ca903d551f236c6c94e6a2e49a8`; actual fetched main `b179da8e2198beffa37195d84111206ea60ea6f0`, common base `51a2eccfb`. GitHub reported the pushed baseline DIRTY/CONFLICTING before this authorized SHA-preserving merge. No rebase, version change, installation, app build, native capture or merge-to-main occurred.

## Resolution and exact scope

Actual overlap was **only** `package.json`, `src/i18n/keys.gen.ts`, `docs/evidence/manifest.json`; only package.json conflicted. Its resolution is exact upstream plus our two independently added Hub test tokens, preserving upstream's consolidated native-access test registration/removals. `convergence-r2-package.json` records the three-way token proof. Generated keys auto-merged and match a fresh generation. The configured evidence-fold driver unions manifest records; the final canonical fold derives counts over this merged tree.

All original and remediation commits remain parents/ancestors, not reconstructed patches. Range and task-delta receipts distinguish metadata union/context changes from unchanged authored changes. Incoming #1093/#1090/#1024 history is not described as this task's authored delta.

## Captured dependencies: specific retention, not blanket source identity

- `convergence-r2-painted.json`:143 named feature/primitives/layout/CSS/theme/input dependency files are **byte-identical** to f114.
- `convergence-r2-literal-closure.json`:1157-file conservative literal-import overapproximation rooted at app, MAIN, preload and the143-file set; exact before/after hashes for every file.28 changed runtime/meta paths **within that1157-file graph** are explicitly listed. The complete convergence changes33 `src/` files; the five outside the graph are `src/preload/index.d.ts`, `browser-url-bar.stories.tsx`, `supplement.stories.tsx`, `session-model-access.stories.tsx`, and `supplement-closeout.generated.html` (declaration/story/generated surfaces, not a claim that only28 source files changed). Two unresolved import-like strings are vendor comments (`errors.ts`7/18 and `ax-compact.ts`19), not imports; those files are unchanged. Third-party dependencies are external to this source graph and the shared lock remains unchanged.
- `convergence-r2-semantic.json`:13 guard/transport/fixture files byte-identical, four executable/preload-property proofs pass, six default action IDs/chords and empty-binding hydration remain identical. Custom saved browser chords intentionally change upstream to dormant downgrade data; captures use isolated fresh profiles/default bindings, so no custom-binding behavior is claimed unchanged.
- MAIN's new browser focus helper makes **zero** focus calls for an unfocused window; captures recorded headless/unfocused and Agents/Agent-hub routes, not a focused browser or menu chord. Backend-status and desktop-request preload properties are exact; admitted backend service/transport and Hub request contract are unchanged.
- Native-access changes affect chat/session status. The Agents config composer has no active frontend/run or draft_preview capability in the fixture and passes undefined status; actual old/new pure functions return the same null access reading for undefined/unmodeled/draft contexts. Agent-hub is not ChatPage/canonical transcript (source route table checked). No borrowed-access behavior outside these captured contexts is retained by assertion.
- Hub English catalogues are exact; no existing English chat value changed (one new Highlights resolution key), no old generated key was lost, and French catalogues are unchanged. The typed session-contract additions erase to identical executable JS. Existing74 PNG bytes are all unchanged (`convergence-r2-capture-facts.json`).

These are source/pure-function compatibility proofs, **not a new native run**. Original R-I zero-wrapper and R-J fixture-count limitations, and the R-L failed label attempt, remain historical.

## Actual targeted execution and explicit gap

One serial18-file bounded convergence/direct-neighbor gate ran: **278 PASS,0 FAIL,1 CANCELLED;120s bound**. Hub, browser chords, keymap/default/custom retention and session status passed. The final inherited `supplement-file-actions.test.mjs` reached actual correct preview/open/reveal and tilde-resolution outputs, then remained pending; group teardown cancelled it. Its existing `SUPPLEMENT_ACTION_CONTROL=1` upstream-source control also hit a30s bound with the same pending-event-loop cancellation. Test and canonical surfaces are byte-identical to current main. Raw logs retain both attempts. No unrelated product/harness fix was made and this is **not called an all-green local gate**; CI/independent QA must cover that inherited test. Both process groups were reaped and the two generated test modules were retained in session scratch, not committed as source.

Normal pre-push lint/type checking and remote/GitHub verification are separately reported after this merge commit. Full runtime coverage remains CI's responsibility; no duplicate full suite was run.
