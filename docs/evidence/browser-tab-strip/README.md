# Browser page-tab strip — executed evidence

## Identity and scope

Baseline `422df121756df2f5e7348e4289a04256661edb9f` (0.34.44).
- First source: `8fe9b86350a4052463f43e7b23aedcfa7c18f970`, src tree `2f6e8c14e6b69a61a4e101b377b77d61ef8243b3`.
- Corrected source: **`38bfd4a94bd76ed123b10df6c0d93ca07592fcc1`**, src tree **`904257604fafef1ff680ec7b1cb4835406707fea`**.
- Own worktree `~/local-operator-ui/.worktrees/browser-tab-strip`; exact-lock donor node_modules was linked, never copied or installed. Both installed-lock receipts are `fd0310b282d1a63560473655fccd3964102bef2015e43e4915502e0f0a4670ba` before/after.

Two compiles/native cells are disclosed, not one disguised as a pass: the original allocation and **one manager-authorized extra cell for a source-proven duplicate boundary defect**. Each had fresh machine-lease admission, disk >=20GiB, hidden/headless windows, mock keychain, isolated HOME/config/userData/logs and port-one API binding. No window focus/visibility getter was overridden and no product bundle was patched. Carrier observers forward original calls/promises and record actual outcomes.

Build receipts hash **all 170 output artifacts**. First compile 13.44s; corrected 14.35s. Corrected admission: disk 28.38GiB, memory free 56%, 2s pageout/swapout 0. Build/runtime API root is `http://127.0.0.1:1`, backend manager disabled. The exact emitted schema + env object + loader + api fallback getter was executed with installed Zod (no TypeScript compiler API parser or app launch): root1 PASS, null-discovery root1 PASS, synthetic-discovery root2 PASS, removed-binding negative returns default localhost1111. That default was **not** a runtime backend.

Implementer provenance: host initially reported `openai/gpt-6.1-sol`, then `anthropic/claude-sonnet-5-5` during this slice. No agent/model/default/tool setting was changed by the implementer. These are implementer observations, not independent review sign-off.

## Actual runs and limits

| Surface / command | ACTUAL result | Status |
|---|---|---|
| Node/app `tsc --noEmit` with own scratch tsbuildinfo | zero diagnostics | PASS |
| Affected Biome; generated keys; `check-strings.mjs` | 0 errors; keys byte-identical; scanner PASS, existing report-only advisories retained | PASS |
| Old-source boundary tests (`8fe9b86350`) | 3 tests, **0 pass / 3 fail**: agent and handed-source copied `sessionId`; load rejection escaped | Expected FAIL reproduction |
| Corrected host/SSR/order/close-focus/lane batch | **296 pass / 0 fail**, 12.11s test time | PASS |
| Keymap chords/retention/registry/dispatch + window-mode + related source cases | **162 pass / 0 fail** | PASS |
| Panel-rail neighbour, once under 600s bound | **43 pass / 0 fail**, actual 516.7s | PASS |
| Fail-closed `ci-scope.mjs --since <baseline>` | selected lint/types/unit/evidence/audit/package surfaces | Classified, not falsely green |
| Whole desktop suite and 59-theme contrast row | reserved for terminal CI; not duplicated locally | CI pending |
| First native cell | 64 recorded rows, 26 frames; **stopped at duplicate assertion**, node rc1 | PARTIAL, not complete |
| Corrected native cell | 46 rows, 14 fresh frames, node rc0; boundary/failure/reload/IPC complete | PASS |
| Tooltip traversal, last and nonfatal by design | **10 PASS / 0 BLOCKED**, both brand themes | PASS |

The 26 first-cell frames cover 1/3/13 tabs, 860px native window, real held loading, actual refused navigation, agent-owned, handed-over, inactive hover, forced focus-visible/reduced motion, emitted drag state and registered context menu. `source-compatibility.json` proves tab-strip, URL toolbar, order model and styles are byte-identical across the boundary fix; Surface/hook changes only affect the Duplicate outcome/scope callback, not those rendered states. The corrected cell includes fresh current-source normal and typed-failure frames. First-cell frames are retained with their **original** source identity, not relabelled fresh.

[... 2978 characters elided on replay; this call already ran — see its result ...]
## Rendered geometry, not estimates

`attempt1-results.json` contains real CSS rects for each theme/state. Wide 1-tab: **240px** row, **28x28px** close, plus starts at516 after row right508 (**8px gap**). Wide 3-tab widths: 239.67/239.66/239.66px, plus gap8px. Narrow native content window **860x900**: overflowing rows **144px**, close targets28px, scroller scrollWidth1883 vs clientWidth668. Selected tabindex0, others-1. Inactive close opacity0 still reserves its full rect.

Forced focus-visible is labelled: actual DOM caret on tab, computed **2px solid outline**, **-2px offset**, **box-shadow none**, reduced-motion media active. JS key/DragEvent emission exercises real handlers/IPC but is **not physical OS key/drag delivery**. Tooltip input uses Chromium CDP pointer delivery, not an OS pointer claim. Every tooltip rect was tested against the **actual native view bounds matching `registerBrowserViewRect`**, with app zoom1; all ten intersections false. New-tab tooltip right1371.95 is inside 1380px viewport. Reload tooltip occupies chrome (y49..76.4), not the native page.

## Visual comparison

Historical before is from the committed a2 r1 pass: `41cec92350` and baseline422 have identical full src tree `a4c4c0d4ea47d2c14b9043fd3ce01feaa51a95fe`; hashes in `before-provenance.json`. It is **not a fresh b capture**. Before had page zoom150%, after examples100%; that pre-existing indicator/state difference is **not a zoom change in this PR**. Page titles/fixture ports differ. The comparison is the chrome tab width/grammar; geometry claims above come from the actual b rects.

| State | Light | Dark |
|---|---|---|
| Historical before | [before](before-one-tab-localoperatorlight.png) | [before](before-one-tab-localoperatordark.png) |
| One tab | [after](captures/one-tab-localoperatorlight.png) | [after](captures/one-tab-localoperatordark.png) |
| Three tabs | [after](captures/three-tabs-localoperatorlight.png) | [after](captures/three-tabs-localoperatordark.png) |
| 13 tabs / overflow | [after](captures/thirteen-overflow-localoperatorlight.png) | [after](captures/thirteen-overflow-localoperatordark.png) |
| 860px native window | [after](captures/narrow-overflow-localoperatorlight.png) | [after](captures/narrow-overflow-localoperatordark.png) |
| Loading, held real response | [after](captures/real-loading-localoperatorlight.png) | [after](captures/real-loading-localoperatordark.png) |
| Failed | [after](captures/failed-tab-localoperatorlight.png) | [after](captures/failed-tab-localoperatordark.png) |
| Agent-owned | [after](captures/agent-owned-localoperatorlight.png) | [after](captures/agent-owned-localoperatordark.png) |
| Handed-over | [after](captures/handed-over-localoperatorlight.png) | [after](captures/handed-over-localoperatordark.png) |
| Inactive hover | [after](captures/inactive-hover-localoperatorlight.png) | [after](captures/inactive-hover-localoperatordark.png) |
| Focus-visible / reduced motion | [after](captures/focus-visible-reduced-localoperatorlight.png) | [after](captures/focus-visible-reduced-localoperatordark.png) |
| Drag handler progress | [after](captures/drag-listener-progress-localoperatorlight.png) | [after](captures/drag-listener-progress-localoperatordark.png) |
| Context menu (inactive agent tab) | [after](captures/context-menu-localoperatorlight.png) | [after](captures/context-menu-localoperatordark.png) |
| Current-source normal | [fresh](captures/current-source-normal-localoperatorlight.png) | [fresh](captures/current-source-normal-localoperatordark.png) |
| Current-source typed failure | [fresh](captures/typed-navigation-failure-localoperatorlight.png) | [fresh](captures/typed-navigation-failure-localoperatordark.png) |

## Honest remaining gaps

- No physical OS keyboard/drag/clipboard or fused chrome+native-page screenshot proof. `capturePage` excludes the embedded page; the page-ground blankness in chrome frames is not an empty-page claim. Physical drag ghost not captured; DOM drag state/real reorder IPC are captured.
- Real favicons/audio/pinned state are not published by this host; local Globe fallback and no invented state. No renderer fetch or CSP change.
- No print, private browsing, history/download product work, LOH-1 app tabs, lifecycle/recovery or agent capability change. No new fixed chord or saved-binding migration.
- EN-only new keys, not audited locale coverage. Independent code/QA/design/UX rounds have not been claimed by this implementer evidence.

## Reproduction / archived rig

`rig/corrected-cases.mjs` is the decisive matrix; `rig/corrected-carrier.cjs` forwards loadURL/IPC and records raw nonce-free snapshots, never focus overrides. `rig/captured-corrected-native-proof.mjs` is the exact captured framework + cases, with original run paths retained for provenance (replace ROOT/donor/carrier paths when reproducing). The existing repo `scripts/browser-host-proof.mjs`, notification/telemetry helpers and app-tree teardown supply its foundation. No dependency install or browser engine is required beyond the exact-lock Electron donor. `captured-compile.py` has a **generic synthetic non-credential marker** substituted in the archived recipe; runtime/artifact receipts remain exact. Do not point any rig at live HOME/config or localhost1111.

Both owned native trees were reaped before return: first PID16811 and corrected PID45175, `alive:false`; all final windows invisible/unfocused. Generated out/ and run directories are removed after evidence preservation. `cleanup.json` is the observed end-state receipt; no success is inferred from a green suite or from writing this README.

Historical-before caveat: its pre-existing page zoom is 150%; after normal frames are at 100%. The zoom indicator difference is fixture state, **not a removed zoom feature**. Tab/toolbar chrome sizing uses app zoom1 in both; page content is excluded from capturePage.
