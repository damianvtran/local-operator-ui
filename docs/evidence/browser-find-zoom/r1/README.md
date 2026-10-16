# Round 1 remediation — real native find results

**The missing initial results were a PRODUCT BUG, not a demonstrated hidden-Electron limitation. That earlier diagnosis is withdrawn.** Electron44.3's misleading `findNext` means Chromium `new_session`: true starts; false continues. Code commit `41cec92350f5e70e5fd442271ef9b360612a82ee` fixes that polarity and the focus/recovery interactions. Native/compiled `src` tree: `a4c4c0d4ea47d2c14b9043fd3ce01feaa51a95fe`.

**Scope is partial native success, not an overall cell PASS.** The one native cell completed the decisive native find task, fallback/retry, new frames and focus interactions, then aborted at `timeout focus tooltip find`. No retry was run. Tooltip native geometry and the later agent sample were not reached; disposition below is explicit.

## Decisive native proof (no synthetic result events)

Plain-text fixture body: `hello alpha hello beta hello gamma`. [Original native receipt](native-results.json), rows `REAL initial` through `REAL previous3`, records the **unchanged original call arguments, actual returned IDs and real Electron events**:

| Operation | Request ID | Native options | Actual final result |
|---|---:|---|---|
| First query `hello` | 1 | `{forward:true,findNext:true}` | matches3, ordinal1 |
| Next | 2 | `{forward:true,findNext:false}` | matches3, ordinal2 |
| Next | 3 | `{forward:true,findNext:false}` | matches3, ordinal3 |
| Forward wrap | 4 | `{forward:true,findNext:false}` | matches3, ordinal1 |
| Previous/backward wrap | 5 | `{forward:false,findNext:false}` | matches3, ordinal3 |
| Retry after bounded silence | 8 | `{forward:true,findNext:true}` | matches3, ordinal1 |
| Changed query `zznooccurrence` | 9 | `{forward:true,findNext:true}` | matches0, ordinal0 |

Every row has `finalUpdate:true`, matching request ID, selection rectangle and main-projected count. **Counts, next, previous and wrap ARE natively verified** in the hidden app. The input/chord delivery is DOM emulation, not physical OS keyboard delivery. These normal search rows have no notification withholding or manufactured counts.

The old fake expectation was independently wrong too. The corrected unit models Electron44.3's `new_session` semantics rather than the option name. [In-memory old-code control](r1-mutant-control.json) leaves the first query at ordinal0/pending; corrected code receives1/3. This control is simulation, not the native proof above.

## Current rendered evidence

All16 current PNG hashes and source/fidelity labels are in [frames.json](frames.json). Chrome capture excludes the native page; these are not composites and do not prove painted native highlights.

| State | Light | Dark | Fidelity |
|---|---|---|---|
| Real native three-match result | [light](r1-count-real-localoperatorlight.png) | [dark](r1-count-real-localoperatordark.png) | Real request8 callback,1 of3 |
| Real native no matches | [light](r1-no-matches-localoperatorlight.png) | [dark](r1-no-matches-localoperatordark.png) | Real request9 callback,0 matches |
| Searching | [light](r1-pending-held-localoperatorlight.png) | [dark](r1-pending-held-localoperatordark.png) | Actual native reply temporarily withheld; explicitly fault-injected delivery timing |
| Neutral failure + recovery instruction | [light](r1-no-result-localoperatorlight.png) | [dark](r1-no-result-localoperatordark.png) | Production5000ms deadline; withheld real callback, NOT natural native silence |
| Narrow320CSSpx, recovery copy,150% indicator | [light](r1-no-result-narrow-localoperatorlight.png) | [dark](r1-no-result-narrow-localoperatordark.png) | Rig-constrained surface width, not physical OS-window resize |
| Closed find | [light](r1-find-closed-localoperatorlight.png) | [dark](r1-find-closed-localoperatordark.png) | Current chrome/150% indicator |
| Empty open find | [light](r1-find-open-localoperatorlight.png) | [dark](r1-find-open-localoperatordark.png) | Current mounted row |
| Existing focus-visible treatment | [light](r1-focus-forced-reduce-localoperatorlight.png) | [dark](r1-focus-forced-reduce-localoperatordark.png) | Forced existing pseudo-class, emulated reduced-motion; not an OS focus claim |

I viewed current real-count dark, narrow recovery light and forced-outline light frames. The remaining theme counterparts are provided for independent design review.

### Timeout/recovery and narrow readbacks

The earlier independent QA already measured real5307ms silence on the broken source; its original light/dark frames are adopted below. Because recovery copy and enabled controls changed here, one current-source notification-delivery fault also exercised the production deadline: **5032ms**, `pending=false`, `unreported=true`, actual text **“No result reported. Press Enter to search again.”** No result values were fabricated. Holding real notifications is **fault injection**, not evidence that ordinary correctly polarized searches are silent.

Releasing the original timed-out native callback leaves it fenced. Clicking the now-enabled Next control starts a NEW session (request8/true) and receives real1/3. A short held-notification row also shows pending→real result after forwarding the original native event.

At the320CSSpx stress width: row `scrollWidth=clientWidth=320`, input **196×32CSSpx**, all three controls **28×28CSSpx** within row x260..580; controls' rightmost edge572. `150%` indicator present. Recovery text yields a second row; row height68.5CSSpx. No new-row horizontal overflow, no close-target displacement. This is a constrained browser surface, not a full-shell resize/OS fidelity claim.

### Focus and keyboard readbacks

- Main message with page origin (explicit message simulation), then DOM repeatF and toolbar repeat, then Escape from Next: actual `browser-focus-page` handler delta **1**, old address **not restored**. The real window-mode focus guard remains intact; actual OS page focus is not claimed.
- Escape from Previous and Close also closes the row; no stranded Close tooltip. All three buttons plus input/composition negatives have unit coverage.
- Existing forced focus-visible treatment: **2px solid outline**, **1px offset**, `boxShadow=none`; reduced-motion media `true`, inherited transition/animation duration **1e-05s**, row animation name `none`. Computed color readback was on the dark theme; light/dark frames show the actual theme treatments.

## Tooltip disposition — SOURCE asserted, NOT natively measured

The native cell stopped at the first focus-trigger tooltip wait (`timeout focus tooltip find`), so **zoom-reset/Next/Previous/Close native panel rectangles were NOT reached**. This is not a proved tooltip product defect or a native-geometry pass. No further native cell was run.

The executable guard in `scripts/browser-find-row.test.mjs` asserts all three row triggers plus toolbar Find/reset use explicit top placement; both inline chrome regions precede the native viewport; the row stays in flow; neither row nor URL bar uses hide-on-hover suppression. [Guard/row execution](r1-source-guard.log): **2PASS/0FAIL**. This is **source/layout structure only**: it cannot prove Radix's final panel placement or actual rectangle non-intersection. Independent design/QA decide that remaining minor evidence gap.

## Retained agent-boundary proof — not re-executed here

The late agent sample was **not reached** after the tooltip rig abort. We retain **independent QA round1 at5b3e3bf425** (not implementer production) for:
- same-origin tab isolation150%/100%; native handover reset to100%;
- handed-over AND independently agent-owned zoom refusal/notice at100%;
- real RPC read=`Target`, styles120×40CSSpx, center hit-test target, screenshot nonempty at native factor1; pending find cleared;
- owner-window/main-frame/input negatives.

[Exact byte/source compatibility](agent-source-compatibility.json) compares5b3e3bf425 to41cec92350. Eleven surrounding files (host/registry/ownership/index/actions/page+context/CDP/RPC/protocol/IPC/window-raise) are byte-identical. `PageControls.zoom` and `PageControls.prepareAgent` bodies are byte-identical too. [Full product-source delta](source-delta.patch) lists **exactly four changed files**:
1. `src/main/browser/page-controls.ts`: find-option polarity and explanatory comments only; zoom/agent preparation unchanged.
2. `browser-find-row.tsx`: row-wide Escape, recovery copy/enabled actions, responsive layout.
3. `browser-surface.tsx`: shared Find opener callback wiring.
4. `use-browser-chords.ts`: first-origin preservation/shared open-or-focus.

Handover, agent read/capture, geometry math, ownership/permissions, page preload and agent protocol paths are untouched. This is a **proved source-compatibility retention**, not a fresh native actor sample or proof of painted-highlight clearing on the corrected search session.

## Independent QA adoption (not produced by the implementer)

Source: qa-tester session12bd9949bf0f, original source53f3f047 at5b3e3bf425. [Original receipt](qa-independent-pr1101-results.json), [build identity](qa-independent-pr1101-build-identity.json), [collision log](qa-independent-pr1101-collisions.log). Its natural5307ms fallback on the inverted-query code is historical, not a limitation of the corrected build.

- [Neutral light](qa-independent-no-result-localoperatorlight.png), SHA256 `b9d3c5ecf3fff1f2b6ecf77da7e89186007e568fa0ac403913f4b80b0e448486`.
- [Neutral dark](qa-independent-no-result-localoperatordark.png), SHA256 `28d9bc45da1153f8f5a9c5f8048b51cc0ed323bbf456f68f9adf3ddc4ab873b1`.
- [Adoption metadata](qa-adoption.json) retains exact original paths/source labels. No edit in QA's scratch.

## Build, isolation and actual checks

- Final frozen-source delta: [14PASS/0FAIL](r1-final-delta.log),12.77s. Includes correct API-session model, repeat page/chrome origin, toolbar re-focus/select, Escape all buttons and IME negative. Additional source guard + row rerun2PASS (one row case overlaps the14;15 unique cases, not16).
- [Types node](r1-types-node.log) and [types app](r1-types-app.log): exit0, empty logs. [Affected Biome](r1-lint.log):0 errors/18 warnings.
- Panel cleanup ran ONCE under600s: [43 completed assertions PASS,0 failures,1 test-file cancellation,rc124](r1-panel.log). Missing-HTMLInputElement diagnostics **0**. **Not a clean file PASS**, not re-run/extended; terminal CI supplies the full gate.
- ONE plain-JS/no-bytecode compile: [build identity](r1-build-identity.json), [log](r1-build.log), **rc0/13.68s/170 artifacts**, installed lock unchanged. All170 hashes reverified before native. Same source tree on final evidence head.
- First setup verifier failed because installed TypeScript7.0.2 exports version metadata, not the compiler AST API; [aborted setup log](r1-build-cell.log). **No native launch occurred then.** Manager authorized a rig-only extractor correction on SAME artifacts, no source edit/recompile. [Exact emitted-schema/env/loader/API-getter proof](r1-binding-proof.json) executes with installed Zod, confirms bound API1/manager-disabled; removing the binding yields defaultlocalhost1111. No app module import, parser or extra product build.
- Native admission: disk24.92GiB, memory56% free, two-second page/swap outflow0. Scratch HOME/config/log/userData/discovery/cwd, minimal env, synthetic OAuth, port1 build+runtime, notifications/telemetry off, mock keychain, absolute carrier path, no focus-guard overrides. Hello API root exactly `http://127.0.0.1:1`; own main window hidden/unfocused at setup; unkeyed RPC401.
- [Current actual-menu collision check](r1-collisions-normalized.log): PASS. Captured18 real native menu items before find. [Mechanical receipt adapter](r1-menu-checker-receipt.json) wraps the unchanged observed array in the checker's required `actual.menus` field; original receipt untouched. The first raw-shape checker failure is preserved separately, not a collision finding. Native menu inventory is not OS accelerator delivery.
- ONE native cell [log](r1-native-cell.log):23.0s, **rc1 at tooltip focus wait**, completed rows persisted as they ran. **No whole-cell PASS**. Teardown ownedPID29471 `alive=false`; [cleanup receipt](cleanup.json) records exact surviving-process check/output removal.

## Remaining limits / deliberate non-work

**Unverified:** painted native highlights, physical OS key/accelerator delivery, native tooltip rectangles, late corrected-source agent sample (retained independent prior rows via compatibility, above), final-window/resource observation after the late aborted phase. Initial isolation and exact teardown are observed; no whole-lifetime packet/focus trace is claimed.

No print/a3, new agent commands, new permission/origin scope, page preload, dependency install, version bump, reviewer requests or user/live-config mutation. No fourth/further native attempt after the round1 abort.

Model provenance: implementation began on openai/gpt-6.1-sol; host session-state changed the current runtime to anthropic/claude-sonnet-5-5 during this turn. No manual model/role/default setting change.
