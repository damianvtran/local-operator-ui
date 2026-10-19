# Sidebar tags V2-2 — implementation evidence

## Job and adopted contract

Assign up to eight vocabulary tags to a conversation without changing its title; maintain the shared vocabulary separately. Existing V2-1 APIs, optimistic assignment/rollback, grouping and move mode remain the authority. No new backend, chips on sidebar rows, dependency or release bump.

The picker uses a 420px-capped, viewport-bounded 560px preferred-height shell. Header/footer stay out of its single scrolling body. Search is always present; selected chips preserve assignment order and isolate user-authored names; zero/one/multiple selection has Untagged/static primary/radios. The input keeps native Space/Home/End. Arrows/Enter target real active-descendant options; empty/unmatched Enter never creates. One roving option Tab stop; option Space/Home/End; composition-safe empty Backspace and chip Delete. Query/active reset after a toggle. First Escape collapses options, second cancels; clicking input reopens.

Registry capacity32 is not assignment capacity8. Ninth toggles and Create at8 are blocked; at32 only creation is blocked. Names are trimmed, 1–24 Unicode code points (same counting as the server), literal Untagged reserved; no normalization. Client duplicate convenience does not replace server uniqueness.

Create is explicit and durable, selects the new server ID, and discloses Saved for all conversations before activation. It refreshes before replacement and after an uncertain error; an existing collision requires explicit selection rather than silently reusing or merging it. Pending Create visibly says Saving tag… and locks dismissal until completion/failure (the adopted bounded alternative), then Cancel still writes no assignment. Manage Add/Rename/Reorder/Delete remain staged until Apply. Filter disables reorder with an explanation; names have their own first line, metadata/actions the next; authoritative counts refresh before deletion confirmation. Validation remains beside the focused editor; network failures are visible without scrolling to the end. No silent merge/rename writes.

Picker assignment pins optional row revision when present; conflict refreshes with no generic Retry/overwrite, and remote refusal is distinct. Absence does not fabricate protection. Registry API has no CAS: refreshing reduces stale replacements, but this does not claim an atomic cross-client registry merge.

## Actual execution, not native/production claims

All 34 PNGs were captured with one harness-owned background browser tab, actual React components and a synthetic contract-shaped desktop bridge, not a separate browser engine. `flow-results.json` records executed request/focus outcomes. The Storybook keyboard plays use userEvent/DOM events, **not OS-native keyboard, composition or assistive technology proof**.

Executed flows: Create/Cancel persistence (one registry write, zero assignment writes); cap8/remove/Create/Apply with preserved order/primary; filtered rename/reorder prohibition and Cancel; picker↔Manage draft/query/primary/scroll/focus; full staged add/rename/reorder/delete; failed Apply retry; loading completion does not steal moved focus; Clear one atomic assignment and row focus; pending durable Create dismissal guard; 409 no-overwrite; remote refusal; last of32 options fully visible with focus gutter, including short height.

The before contact sheet is supplied by the adopted designer preflight at74fcf12c2e, not a new capture or a repinned review. Current captures were iterative working-tree captures; source provenance explicitly does not pretend they were a clean frozen-head full sweep. Error/loading/empty/localized/Unicode frames were recaptured after their visual corrections; unchanged ready-state class output was retained for sidebar-entry frames. Contact JPGs are derived dialog crops, not additional independent test runs. Original full PNGs remain beside them.

## Measured geometry

`geometry.json`, `locale-geometry.json` and responsive receipts come from actual DOM rectangles, client/scroll dimensions and footer bounds. Same-origin Storybook frame metadata exposes child measurements because this host cannot scope CSS/ref queries into the iframe; it does not alter layout.

| Case | Actual dialog | Body client/scroll height | Footer / horizontal overflow |
|---|---|---|---|
| Default picker, 1280×720 viewport |420×560|398 /452|visible / none|
|32-category picker|420×560|398 /1496|visible / none|
|32-category Manage|420×560|379 /2479|visible / none|
|Picker in320×568 iframe|288×536|350 /1516|visible / none|
|Manage in320×568 iframe|288×536|311 /2568|visible / none|
|Picker in568×320 iframe|420×288|126 /1496|visible / none|
|Manage in568×320 iframe|420×288|107 /2479|visible / none|

Option heights in the regular fixture are36px. All seven localized Create/no-match states have a visible footer and no horizontal overflow. Entry widths220/260/320 are covered in both light and dark; dialog width is viewport-based, not sidebar-based. The below-app-floor short iframe is a defensive layout test, not proof that Electron permits that native window size. Long legal CJK, supplementary characters and mixed RTL/combining labels are real fixture values; chip truncation retains full accessible labels/title, list labels wrap.

## Audits and validation

See [audit-table.md](audit-table.md) for exact independent receipt instances, actual models, results and SHA256. All eight current catalogues73 keys (54 preserved +19 new); seven target-language rows independently audited, including Urdu added during final main convergence. ES/FR million-count, HI grammar, RU terminology/primary and VI terminology/grouping fixes were re-audited. ZH3nits accepted unchanged. Prior receipts retained as cited historical rounds, not duplicate current approvals.

Terminal affected Node lanes:110/110 passing across two bounded serial invocations, zero skips. Node TypeScript, source/script lint, `check-i18n`/ledger334 and generated keys passed. **Current merged-head renderer TypeScript is RESOURCE-BLOCKED at a1.5GiB process-group ceiling, with zero diagnostics; manager authorized publication with CI typecheck authoritative and required before merge.** It is not a local pass. Earlier pre-convergence checkpoints passed both projects. See validation-results.md for exact commands and recovery provenance. No full local suite.

Exactly two authorized `biome-ignore lint/a11y/useSemanticElements` comments apply to custom listbox/option roles, with the adopted APG-extension rationale: native select/option cannot implement chips, individual roving option focus, active-descendant and explicit inline Create. No Biome configuration or other accessibility rule disabled; roles/labels/keyboard behavior are tested.

Residual independent gates: native OS keys/IME and screen reader, exhaustive font/display/helper axes and59-theme rendering, real-core persistence/concurrent registry replacement and transport ambiguity. Synthetic bridge results do not substitute for them. No design/UX/QA sign-off is claimed before independent rounds on the PR.

Evidence guard at the earlier checkpoint:53 tests,52 pass,1 shallow-history ancestry skip. Inventory/count assertions passed; citation ancestry is not claimed validated on this shallow clone.

### Final Urdu convergence

Urdu19-key delta is independently source/ICU-audited clean (f0a1b2c3d4e5); all54 baseline value bytes retained. Final `pnpm check-i18n` PASS, ledger392 rows (existing Urdu row updated, not duplicated). The34 captured PNGs cover the original seven locales; **Urdu rendered RTL/glyph/overflow validation remains QA scope**, not a claimed frame. Final affected-lane rerun after dependency cleanup:79PASS,2 file-setup failures (selection and picker lanes require the now-dangling shared tree; their31 cases did not run). Earlier110PASS checkpoint retained because feature-source bytes are unchanged. No install/relink or test weakening; complete fresh suite/typecheck remains mandatory in CI.
