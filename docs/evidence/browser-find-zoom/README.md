# Browser find / isolated page zoom — implementation evidence

**Scoped results, not an overall native PASS.** Independent code/QA/design/UX rounds are still required. All three final-source native cells aborted in the rig; completed rows survive in their JSON receipts. The third completed every agent-boundary row before its later visual-continuation abort.

## Frozen identities and environment

- Tested/compiled source: `c75cddf13dc3241d65e14f0ab3f60e1e1baf574a`; `src` tree `53f3f0471b74edd898af77094e98d484698047a0`.
- Integration base after narrow convergence: `b179da8e2198beffa37195d84111206ea60ea6f0`. [Range-diff](a2-convergence-range-diff.txt): both authored commits `=`; [proof](a2-convergence.json): 29 owned files byte-identical, 1,428 identical added/removed lines, no upstream overlap. Subsequent final formatting/test assertion commit is included in the frozen source above.
- [Final build receipt](build-final.json): ONE final-source compile, 14.03s, 170 artifacts. Main/preload/renderer hashes were re-verified before each final native cell; no recompile for retries. Installed/repo lock SHA-256 remained `fd0310b282d1a63560473655fccd3964102bef2015e43e4915502e0f0a4670ba`.
- [Superseded build](build-superseded.json): earlier source `8f6cb4bf62e4` / tree `28cb8c0cc9fc`, before the pending/deadline/editor/focus corrections. Not final-source evidence. Its old commit maps to the byte-identical rebased feature commit in the convergence receipt.
- Build was plain-JS `electron-vite build` (`build:npm` equivalent), not a packaged/bytecode/installer test. Carrier reports Electron 44.3.0, not a released app-version claim.
- Own worktree, exact-lock shared dependencies, no installs. Machine lease for every heavy cell, serial bounded runner, 20GiB disk floor, fresh memory/2s swap-outflow checks. Isolated HOME/config/user-data, synthetic OAuth/session IDs, backend manager/notifications/telemetry off. API root `http://127.0.0.1:1` in both build and runtime; runtime `hello` confirmed it. No inherited CMUX/LOP context, no live sessions.
- Absolute carrier/app path, `--window-mode=headless --use-mock-keychain`; preflight reports `visible:false`, `focused:false`. DOM focus/listener emission is labelled synthetic, not physical OS input. Each receipt records the owned PID dead after exact-tree teardown. Generated `out/` and native run profiles are reaped after copying these artifacts.

## Native find fidelity — NOT verified

**Native Chromium match counts, active ordinal, highlight and real-page next/previous were NOT observed.** Three detailed [superseded observations](native-find-unverified-observations.json), including a backgroundThrottling=false scheduling control, called the original native `findInPage`, which returned a request ID but produced no `found-in-page` event. This is an observed limit, not a diagnosed cause. No visible window/focus-guard bypass was used.

Count-state frames below are explicitly **synthetic found-in-page result**: the real main listener receives an emitted final result with the original native request ID. They prove renderer/layout/state handling, not Chromium's search algorithm. Enter/Shift+Enter issue native requests; their shown ordinal results are synthetic too.

The neutral deadline is source + real-timer unit tested: pending search is bounded at5s, stops/invalidates the request, and says “No result reported”, not “No matches”. **The native neutral-state frame and actual5s UI observation are missing**: the third rig reordered tooltips but omitted re-opening the find editor before `typeFind('silent-native')`. Do not treat that attempted row as run.

Attended smoke still owed: Cmd+F on a real page, type, verify count/highlight, Enter/Shift+Enter, Escape; also the physical OS-focus chord matrix. Hidden DOM/native listener emission cannot answer these lines. Print is excluded because its native OS dialog requires a separate decision.

## Actual automated commands/results

Final targeted argument vector (inside isolated env, serial600s runner and lease):

```sh
node scripts/run-desktop-tests.mjs --test-concurrency=1 \
  scripts/browser-page-controls.test.mjs scripts/browser-find-row.test.mjs \
  scripts/browser-chord.test.mjs scripts/browser-chord-renderer.test.mjs \
  scripts/window-mode.test.mjs scripts/thread-search-model.test.mjs
```

Node/app `tsc --noEmit -p tsconfig.{node,app}.json` and affected-file Biome checks preceded it and exited0. The43-test panel command was `node scripts/run-desktop-tests.mjs --test-concurrency=1 scripts/panel-rail.test.mjs`, separately bounded600s.

Commands ran in isolated HOME/config through `scripts/run-desktop-tests.mjs --test-concurrency=1`, inside `run_bounded.py --timeout600 --grace5` and the machine lease. CI supplies terminal whole-suite coverage; no duplicate full local suite ran.

| Surface / command | Actual result | Scope / receipt |
|---|---|---|
| Final `tsc --noEmit -p tsconfig.node.json`, app config, changed-file Biome; desktop files `browser-page-controls`, `browser-find-row`, `browser-chord`, `browser-chord-renderer`, `window-mode`, `thread-search-model` | 95 PASS,0FAIL;20.0s including types/format | [log](a2-final-delta-neighbours.log). Native-event fences, neutral timeout/late event/retry, real input events during unacknowledged IPC, native-page focus return, zoom-without-caret-transfer, platform/IME/repeat negatives and no-raise guards |
| `browser-host.test.mjs` |203PASS,0FAIL | [log](a2-host-final.log): owner/frame/URL/primitive/stale-target controls, reset-before-capability ordering and driver read/screenshot geometry. Later pending/focus/editor delta covered above |
| `browser-page-controls browser-chord keymap-chords keymap-retention keymap-registry keymap-dispatch lane-registration` |30PASS,0FAIL | [log](a2-core-final.log). All15 dormant mappings including new0; actual v3/v4 store hydration/save/reload and frozen8057f32 downgrade reader; Reset/Clear/rebind |
| Combined affected/neighbour run |600s bound fired;363PASS/0 assertion failures, incomplete | [aborted log](a2-final-targeted.log). Not a suite pass; remaining/interrupted files handled separately |
| Interrupted `panel-rail.test.mjs` alone |43PASS,0FAIL;596.8s inside600s | [log](a2-cell-scripts_panel-rail_test_mjs.log), with diagnostic caveat below; window/search subsequently included in final95 |
| `node scripts/contrast-contract.mjs` |34,265 assertions,59 themes;PASS | [log](a2-contrast.log); includes new find-row role pairing |
| `node scripts/check-browser-chord-collisions.mjs native-visual-partial.json` |BLOCKED: no actual menu enumeration | All cells aborted before the late `menu actual` row. Checker was extended but actual new-menu graph has NOT passed; independent QA must collect actual menu JSON. No fabricated source/menu receipt |

**Panel diagnostic caveat:** the43 passing assertions emitted8 jsdom `HTMLInputElement is not defined` diagnostics. The unchanged panel harness omits that global; the stack points to Radix FocusScope `isSelectableInput`. This script and exact dependency lock are also on the integration base; the older a1 dependency run did not emit them. Do not call this a clean focus-flow proof. The new find-row test installs the global and its final input/focus assertions pass. Raw diagnostics are retained, not suppressed.

The source/sample sweep covered all `scripts/**/*.test.mjs` and TS/TSX under `src`: primary/ctrl/control/meta/cmd/command F,+,=,-,0, aliases/glyphs, old Actual Size/O assumptions. Thread search and hotkey-converter references are intentional, not stale panel samples; registry expectations were updated. a1's panel sample remains guarded `primary+shift+u`.

## Completed real native / agent-boundary rows

See [security receipt](native-security-partial.json), whose `SECURITY BOUNDARY COMPLETE` is reached before the later abort. These use actual loopback RPC and native WebContents, not fake views:

| Action | Actual response / side effect |
|---|---|
| Human zoomed user tab before handover | native factor1.5; same-origin sibling1.0; isolated mode |
| `window.api.browser.handOver(first,'a2-native')` | native factor1.0 after transfer; unit additionally asserts reset BEFORE nonce/capability mint |
| Zoom chord on handed-over tab | scoped DOM KeyboardEvent route, factor1.0 and truthful chrome notice; not OS key delivery |
| Agent `styles('#target')` | one match, CSS rect x8,y137.94,width120,height40 |
| Agent `hit_test` at that CSS center | top element id `target` |
| Agent `read('#target')` after pending human find | text `Target`, keys `[text,url,title]`, factor1.0/isolated; find cleared |
| Agent `screenshot` after pending human find |33,867 PNG bytes, keys `[data,url,title]`, factor1.0/isolated; find cleared; [actual page PNG](agent-screenshot-after-handover.png) |
| Independently created agent-owned tab | opens inactive; after human activation native factor1.0; zoom CHORD refuses honestly with notice; its actual screenshot stays100% |

Native highlight removal itself remains unverified because no real native highlight was observed. The find-clear/native-stop path and serial-lane fencing are tested; the actual captured page was viewed and contains no highlight. No agent find/zoom capability was added.

[Visual receipt](native-visual-partial.json) additionally records real per-tab150%/100%, native-listener zoom-out exactly one step to125%, stale-tab IPC refusal, and the Find tooltip rectangle y41.5..68.9 disjoint from native content starting y151. **Zoom-reset/Next tooltip rects, native malformed/sender checks and actual menu callbacks were not reached**; corresponding sender/primitive source tests passed, but do not infer native coverage.

## Before / after frames

Chrome frames are2760x1800, viewport1380x900 at DPR2. `capturePage` excludes native WebContentsView pixels; the blank page region is not an empty-page claim. The agent PNG above is a separate real page capture. [Frame hashes / origins](frames.json).

Historical merged-a1 baseline, not a fresh native base boot: [light](../browser-focused-chords/populated-after-localoperatorlight.png), [dark](../browser-focused-chords/populated-after-localoperatordark.png). It predates the new Find button/zoom control/row; titles, fixture port and active-tab scenario also differ. No pixel-identical comparison is claimed.

| Final-source state | Light | Dark |
|---|---|---|
| Find closed / zoom100% | [frame](find-closed-zoom100-localoperatorlight.png) | [frame](find-closed-zoom100-localoperatordark.png) |
| Find open, empty | [frame](find-open-localoperatorlight.png) | [frame](find-open-localoperatordark.png) |
| Actual pending native query (no callback) | [frame](find-pending-localoperatorlight.png) | [frame](find-pending-localoperatordark.png) |
| Many matches — **synthetic found-in-page result** | [synthetic found-in-page result](find-many-synthetic-localoperatorlight.png) | [synthetic found-in-page result](find-many-synthetic-localoperatordark.png) |
| No matches — **synthetic found-in-page result** | [synthetic found-in-page result](find-no-match-synthetic-localoperatorlight.png) | [synthetic found-in-page result](find-no-match-synthetic-localoperatordark.png) |
| Native page zoom150% | [frame](zoom150-localoperatorlight.png) | [frame](zoom150-localoperatordark.png) |
| Agent-owned zoom-chord notice (DOM route, not OS key) | [frame](agent-zoom-notice-localoperatorlight.png) | [frame](agent-zoom-notice-localoperatordark.png) |
| No result reported | **NOT CAPTURED** | **NOT CAPTURED** |

Implementation author inspected the merged-a1 light baseline, final-source pending light, zoom150 dark, agent-notice light and actual agent-page PNG. Design review is independent; this is not its sign-off.

## Rig attempts and replay provenance

1. [Final cell1](native-label-abort.json): **aborted on rig label validation, not product**. Full synthetic caption+theme exceeded the dev driver's64-character label cap. Not counted as a native pass.
2. [Approved label-only retry](native-visual-partial.json): aborted at tooltip-dismiss wait after moving to(5,5), the draggable titlebar region. Completed visual/native zoom rows retained; no overall pass.
3. [Third/final security-first cell](native-security-partial.json): completed every security row, then aborted at `typeFind('silent-native')` because the reordered rig omitted re-opening the editor. No fourth cell. Tooltip traversal was moved last/nonfatal but not reached.

Every `evidence()` row was flushed to JSON immediately. [Executed audit function](native-cases.mjs.txt) is a transcript fragment using the shared a1 scratch launcher, **not a standalone launcher or an automatically executable CI test**. Full local invocation was `AUDIT_OUT=<scratch>/a2-security-final ... run_bounded.py --timeout300 --grace5 -- node <scratch>/a2-native-final-proof.mjs`; identities were reverified first. The actual launcher/carrier and logs remain in session291e40a1ea40 scratch for independent QA. Follow the repo's native approval/isolation rules before reproducing, never launch a normal/focused window to fill these gaps.
