# Browser chrome — native determination (S4b)

**Will the popout paint above the page, and can a click reach it?**

- **Measured commit:** `c5503204ed0bc88e20dadb624de949788dc52b80` — *feat(browser): S4b product chrome — strip-only rest, popout address row, relocated page menu (#1305)*, the commit that merged S4b.
- **Source equivalence:** the S4b branch tip `8f9fe72ec7` and `c5503204ed` have identical trees (`git diff --quiet 8f9fe72ec7 c5503204ed` → 0; both trees `64104d143d20…`). This run built a fresh app from `c5503204ed`; it did not reuse the S4b worktree's `out/`.
- **Since the run:** `origin/main` moved to `b40e62fffdd6` (#1315). That commit touches only `scripts/trace-fold-model.test.mjs`, `scripts/turn-collapse-behaviour.test.mjs`, and two chat canonical files — no browser or address-overlay path — so this determination is still the S4b chrome's state on current main.
- **Build identity:** fresh `pnpm build` in `.worktrees/browser-native-determination`; `build-identity.json` records `checkedOut` (the docs/scripts head the probe ran at), `productSourceCommit` `c5503204ed` (the app's product source; `productSourceClean: true`), Electron `44.3.0`, Chrome `152.0.7977.78`, app `0.39.4`, and the artifact hashes (`main/index.js` `9a0e2c54…`, `main/index.jsc` `269d88d0…`, `renderer/index.html` `a0e2b36e…`, `overlay-list.html` `9c8bf7a5…`). The S4b artifact's **renderer** hash differs (`ba906a7e…` vs `a0e2b36e…`); its main and list hashes match, and it records no bytecode hash, so this run built fresh rather than reusing that artifact.
- **Probe:** `scripts/browser-native-determination.mjs`; machine facts in `docs/evidence/browser-chrome-native-determination/` (`facts.json`, `matrix.md`, `events.jsonl`, `teardown.json`; `app.log` is written locally but is git-ignored); pixels in that directory's `frames/` (git-ignored, regenerable).
- **Question:** does the S4b popout — the field row over the tab strip and its native suggestion list — paint over the driven page, and would a click reach it?

## Verdict

**Paint: yes.** The two surfaces have different answers and both are favourable:

1. **The field row** (`260,32 → 1380,69` DIP) is in the strip band. The page's native rect starts at `y = 69` in every measured state. No visible child view contains any point of the field row, so it cannot be occluded by the page: the owner renderer's own surface paints it, and the page is below it only in the sense that the page begins where the strip ends. Measured: the popout ↔ page intersection area is **0**.
2. **The suggestion list** (`260,69 → 1380,138` DIP, 69 DIP tall at this run's single row) starts at the page's top edge, is the **last** visible child (`children[2]` of `[hidden helper, page, list]`), and therefore paints over the page's top 69 DIP by AppKit's back-to-front subview order. That paint order is an **inference**, not a pixel measurement; the geometry, order, visibility and each surface's own pixels are measured.

**Click: yes, by geometry; the routing itself is an inference from AppKit's hit-test rule.** A click in the field row is outside the page's bounds and lands in the owner renderer (where the measured `elementFromPoint` at the address input's centre is the `browser-address` input). A click on the list is inside the list's bounds, and the list is the last visible subview, so AppKit's `hitTest` — which starts at the last subview and walks backwards — reaches it first. A click on the page below the list reaches the page. No OS-level click was synthesized: that needs Accessibility permission, which this repository forbids for rigs.

**Confidence:** high for the field row (a zero-area overlap is not an inference), high for the list's bounds/order/visibility, and **medium-high for the actual compositing and hit routing** because the last step is AppKit's documented rule applied to measured inputs, not an executed compositor or OS click. No material risk was found; **no default-off or revert is recommended**.

## What was measured, and how

The app was launched from the fresh build in `headless` mode (window created, never shown, not focusable) with:

- `--inspect=0` — the Electron **main-process** inspector. `require` is `undefined` in that context on Electron 44.3.0; `process.mainModule.require("electron")` is the working route, and `process.mainModule` does not exist for the first ~1 s, so every early poll fails soft.
- `--remote-debugging-port=0` — the owner renderer and the page's own CDP targets.
- The repository's isolation, with **absolute** paths under `RUN`: scratch `HOME`, `LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_LOG_DIR`, `--user-data-dir`, cwd, and a dead-backend `.env`; notifications and telemetry off; `CMUX_*`/`LOP_*` stripped; `--use-mock-keychain`. `OUT` is `resolve(...)`d, every scratch path is asserted absolute before launch, and `B2` waits for the logger's `Log path:` line and the browser host's `profile` line (the latter lands up to ~1.2 s after logger init), then reads the app's own `userData`/`sessionData`/env paths — all under the run, with no "not an absolute path" fallback. `app.getPath("logs")` is Electron's default (`~/Library/Logs/Local Operator`), recorded but outside `RUN` and not gated: the app's logger override is the writer. `B3` snapshots the operator's real logs/config/browser profile before and after and searches the real log files for this run's fixture URL and launcher-pid token: **0 hits**. The real profile directory's mtime is recorded but not gated — the operator's own app may write it concurrently — so the scratch profile is proved by the app's own `[browser] host … profile <run>/profile/Partitions/…` line rather than by that mtime.
- The committed evidence is one self-contained run (~21 s), the fourth of four consecutive runs; all four passed B2/B3 with the profile-line wait at 0–110 ms (the old single-read check had observed −65 ms to +265 ms on this machine — `b2-determinism.json`). It was followed by `app.quit()` through the main process; the process group was empty and the app exited with code 0 (`teardown.json`). No visible window, no Screen Recording, no Accessibility.

The probe reads:

- `window.contentView.children` — Electron's `View.children`, documented as the child views and the JS surface of the native subview list; the native `NSView.subviews` array itself is not exposed without an Objective-C bridge.
- Each child's `getBounds()`, `getVisible()`, `webContents.id`, URL and type.
- `window.webContents` identity and the absence of that id from `children`.
- The owner renderer's DOM rects (strip, content, popout, address input) on the same stable layout (page rect unchanged before/open/after).
- Each view's own `webContents.capturePage()`, with the repository's blank-frame test (`<8` distinct colours or `<32` pixels off the ground pixel) and retries; a hidden window's first capture can be blank and can throw `UnknownVizError` (the repo's own measured rule).
- Targeted `sendInputEvent` per view, with main-process `before-mouse-event`/`before-input-event` counters, renderer DOM counters, and one real row commit.
- Focus readings before and after programmatic focus moves.

## Evidence table

Status vocabulary: **PASS** = the measured predicate held; **MEASURED** = a reading, not a pass/fail claim; **INFERRED** = derived from a documented rule over measured inputs; **BLOCKED** = not measured here.

| Row | Claim | Status | Actual (abridged) |
| --- | --- | --- | --- |
| B1 | the launched app is the built tree at the recorded product commit | PASS | `checkedOut 54d6882654…`, `productSourceCommit c5503204ed…`, `productSourceClean:true`, product chrome armed; Electron 44.3.0; app 0.39.4 |
| B2 | every path the app writes through resolves inside the scratch run; the logger took the absolute `LOG_DIR` | PASS | `userData`/`sessionData`/env HOME/config/log under `RUN`; `Log path: …/run/…/logs`; no fallback line; browser profile `…/run/…/profile/Partitions/local-operator-browser`; the line is waited for, not read once (4-run wait 0–110 ms). `app.getPath("logs")` is Electron's default (`~/Library/Logs/Local Operator`), recorded but outside `RUN` and **not gated**: the app's logger override is the writer |
| B3 | this run wrote nothing into the operator's real log, config or browser profile | PASS | real logs/config/profile snapshotted before/after; fixture-URL hits **0**, launcher-pid hits **0**; config and logs unchanged; real profile mtime recorded but not gated (the operator's app may write it), and B2's scratch profile line is the profile proof |
| W1 | the window is headless | PASS | `visible:false`, `focused:false`, `focusable:false`, content `1380×900`; `[window-mode] state: visible=false` |
| N1 | the owner's webContents is not in `contentView.children`; contentView is a plain `View` at content size | PASS | contentView ctor `View`, bounds `0,0,1380,900`; owner wc id `1`, `ownerInChildren:false`; children count 2 |
| N2 | at rest the page view's native rect equals the reported content rect; no visible list child is present | PASS | page `260,69,1120,831`, visible, order 1; no **visible** list child (a hidden one may exist); popout absent |
| N3 | at open the popout DOM rect and page native rect are measured on the same stable layout | PASS | popout `260,32,1120,37`; strip identical; content/page `260,69,1120,831`; page moved `false` |
| N4 | the suggestion list is a native child, visible, last, with native bounds | PASS | wc 5, `260,69,1120,69`, visible, order 2 of 3; span check matches the v2 geometry from DOM strip + page rect |
| N5 | popout ∩ page = 0; list ∩ page > 0 | PASS | popout overlap area `0`; list overlap `1120×69 = 77,280`; band 0 px |
| N6 | each view's own `capturePage()` is non-blank | PASS | owner `2760×1800` (1092 colours at rest / 1187 at open), page `2240×1662` (311), list `2240×138` (460); all first attempt |
| N7 | a composite from those captures at measured bounds/order is written and labelled constructed | PASS | `frames/composite-rest.png`, `frames/composite-open.png`; layers owner → page → list; scale 2 |
| N8 | targeted mouse/key delivery is counted by each view's own main observer | PASS | owner `3 mouse / 2 key`, page `3 / 2`, list `3 / 1`; owner and page DOM counters `1/1/1`; field point maps to the `browser-address` input |
| N9 | negative control: a click sent to the owner at a page-covered point still lands in the owner | PASS | owner counters `3/2`, page counters `0/0` — `sendInputEvent` bypasses sibling hit testing |
| N8b | a targeted click on the list's first row commits through the controller | PASS | filtered to one row; row URL `…/seed-1`; click at `560,48` list-local (`560,117` absolute); page URL equals the row URL; popout gone, list hidden |
| N10 | focus readings before/after programmatic focus moves | MEASURED | every `isFocused` false, `getFocusedWebContents()` null, window focused false — the headless window is not key |
| D1 | Escape lowers the popout and hides the list | PASS | popout gone, list hidden, page `260,69,1120,831` unchanged |
| D2 | a page focus event lowers the popout | PASS | `page.webContents.focus()` → popout gone, list hidden, page unchanged |
| D3 | a main-frame navigation lowers the popout | PASS | navigation → popout gone, list hidden, page unchanged |
| D4 | opening another tab lowers the popout | PASS | new tab → popout gone, list hidden; the presented page is null (the new tab is on its start page) |
| D4b | after a later page view is added, the reopened list is last | PASS | list order 3, last visible 3, page order 2 — the controller re-added the list last |
| T1 | the launch is reaped and the app exits | PASS | `app.quit()` → exit code 0, group members after quit `[]` |
| I1 | paint order follows AppKit's `addSubview` rule (a subview is displayed above its siblings) | INFERRED | `addSubview(_:)` rule applied to measured `children` order `[hidden helper, page, list]`; no composited-window capture exists in-process |
| I2 | click target follows AppKit's last-subview-first `hitTest` rule | INFERRED | rule applied to measured order/rects and the three probe points |
| BL1 | native OS click routing, real IME, AX, Windows/Linux | BLOCKED | not measured here; see residual unknowns |

## Measured vs inferred

| Fact | How it was established | Status |
| --- | --- | --- |
| The page is a native `WebContentsView` at `260,69,1120,831`; the list is another at `260,69,1120,69` | `contentView.children[i].getBounds()` and `getVisible()` through the main inspector | measured |
| The list is the last visible child; the page is the child before it | `children` array index and `visible` flags | measured |
| The owner renderer is not a child of `contentView`; `contentView` is a plain `View` at `0,0,1380,900` | `children` ids do not contain `window.webContents.id`; ctor and bounds | measured |
| Popout field row is `260,32,1120,37`; page top is `69`; the band is 0 px | owner DOM `getBoundingClientRect()` + native page rect, sequential CDP reads on a stable layout | measured |
| Popout ∩ page = 0; list ∩ page = 1120×69 | rectangle intersection | measured |
| Each surface's own pixels are non-blank | `webContents.capturePage()` per view, repo blank test | measured |
| The owner's own capture contains the popout and does **not** contain the page or list pixels | `frames/owner-open.png` vs `frames/page-open.png` / `frames/list-open.png` | measured |
| Targeted input reaches each surface and causes a real commit on the list | `sendInputEvent` + main counters + DOM counters + navigation to `…/seed-1` | measured (targeted, not native-routed) |
| `sendInputEvent` is not native hit routing | the N9 control: owner received a click at a point the page covers; page counters stayed at 0 | measured |
| The list draws above the page | AppKit `NSView.addSubview(_:)`: a subview is "displayed above its siblings"; order measured as `[hidden helper, page, list]` | **inferred** |
| A click on the list reaches the list | AppKit: `hitTest` returns the farthest descendant containing the point and hit testing starts at the last subview and walks backwards (Apple, `NSView.hitTest(_:)`); list is last and contains the point | **inferred** |
| A click in the field row reaches the owner renderer | same `hitTest` rule; no visible child contains the point, and the measured owner DOM target at the address input's centre is `input[data-tour-tag="browser-address"]` | **inferred** (route), measured target (DOM) |

Apple's text: `addSubview(_:)` adds a view "so it's displayed above its siblings"; for hit testing, "When performing hit-test operations on a view, you should start at the last view in this array and work backwards." `hitTest` is "used primarily by an NSWindow object to determine which view should receive a mouse-down event" and "ignores hidden views." Electron's `View.addChildView` documents that re-adding an existing child reorders it "such that it becomes the topmost view" — which is the controller's `raiseChild` and what D4b measures.

## Paint analysis

```
window content (DIP)                        1380 × 900
contentView                                  0,0 → 1380,900     plain View
  children[0]  hidden helper               0,0 → 1280,720     visible false (about:blank)
  children[1]  page (wc 4)               260,69 → 1380,900     visible true
  children[2]  address list (wc 5)       260,69 → 1380,138     visible true, 69 tall
owner DOM:
  tab strip                              260,32 → 1380,69
  popout field row                       260,32 → 1380,69
  address input                          396,36 → 1340,64
  content rect (page)                    260,69 → 1380,900
```

- The field row occupies the same band as the tab strip and **ends exactly where the page begins**. Its intersection with the page view is empty (`area 0`), so no z-order argument is needed for it: the page has no pixels in that band.
- The list begins at the page's top and overlaps its first 69 DIP. It is the last visible subview, so by back-to-front subview order it is drawn after the page and covers that strip of page pixels. This is the inference the task asked to label as such; the measured inputs are complete, but no in-process API returns the composited window.
- The hidden helper view (`about:blank`, `0,0,1280,720`, `visible:false`) is `children[0]` — before the page in the array — and paints nothing in every measured state. Its size is the registry's `BACKGROUND_VIEWPORT`, consistent with a browser tab view created at host start, but its creator was not traced. It does not affect the strip problem because it is invisible.
- The owner capture at open (`frames/owner-open.png`) shows the popout field row and a blank content area; the page and list are absent from it. That is direct evidence that the composite (`frames/composite-open.png`) is a construction from three surfaces, not one screenshot. The composite is labelled as constructed in `facts.json` (`kind: constructed composite — NOT an OS screenshot`).

## Click analysis

Three points were chosen and the rule applied to the measured tree:

| Point (content DIP) | Which views contain it | Predicted target |
| --- | --- | --- |
| `868,50` — centre of the address input | owner only; page and list start at `y=69` | owner renderer → `input[data-tour-tag="browser-address"]` |
| `340,79` — list header; `560,117` — first row (`99..134.5` absolute) | owner, page, list; list is last visible | native list child |
| `460,269` — page content | owner, page; below the list (`list` ends at `y=138`) | page view |

Supporting measurements: at the address input's centre the owner DOM's `elementFromPoint` is the `browser-address` input; the owner's `before-mouse-event` counter and its DOM `mousedown`/`keydown` counters increment when that point is targeted. The list's `before-mouse-event` counters increment, and a targeted click on its first row commits: the page navigated to `http://127.0.0.1:…/seed-1` and both the popout and the list went away (`N8b`). The page's DOM counters increment when the page is targeted.

The limit is explicit: `sendInputEvent` addresses one webContents. The N9 control sends the same click to the owner at `460,269` — a point the page view covers — and the owner still receives it (`3` mouse events) while the page counters stay `0`. That is why the counters cannot be quoted as routing proof; they prove each surface handles input once reached. The routing answer is the AppKit rule over the measured order and rectangles.

## Dismissal matrix

Every row was measured by opening the popout (native list visible, order 2), performing the trigger, and reading the same three facts.

| Trigger | Popout lowered | Native list hidden | Page bounds unchanged |
| --- | --- | --- | --- |
| Escape (owner renderer key) | yes | yes | yes |
| `page.webContents.focus()` — the page view's own focus event | yes | yes | yes |
| main-frame navigation | yes | yes | yes |
| opening another tab | yes | yes | n/a (the presented page is the new tab's start page) |

The page-focus row is the native-focus path: the window is not key in `headless`, so `isFocused()`/`getFocusedWebContents()` stay false/null, but `webContents.focus()` still emits the view's `focus` event and the overlay's `dismissForTab(tabId, "page_focus")` runs. That is a measured dismissal, not a click-originated focus change.

After the new tab, the overlay list was hidden; the new tab's page view is a later child, but D4 does not record the list's order at that moment. Re-opening the popout after navigating that new tab re-added the list at order 3, above the new page at order 2 — `D4b` measures exactly the `raiseChild` behaviour the controller documents. This is the failure the "re-add last before show" comment exists to prevent, and the probe reproduces the ordering that proves it works.

## Focus ownership

All readings are false/null in `headless`: `window.isFocused() === false`, `BrowserWindow.getFocusedWindow() === null`, `webContents.getFocusedWebContents() === null`, and every view's `isFocused() === false`, before and after `owner.webContents.focus()` and `page.webContents.focus()`. The headless window is created unfocusable and is never key, so **native focus ownership is not measurable here**; the page-focus dismissal above is the one native-focus fact that did fire. This is a residual, not a contradiction: the app's own overlay health facts use the same reads and document the same headless limitation.

## Residual unknowns

1. **Silent non-composite (F7).** If macOS silently failed to composite the native list, every in-process reading would still look correct: `getVisible()` true, bounds correct, `capturePage()` returns the child's own pixels. No in-process API can see the composited window. We saw no indication of it — the child was created, raised, shown, and its capture is non-blank — but the only way to close this is a visible-mode run or an OS-level screenshot on the operator's screen, neither of which this rig does. It is the main residual.
2. **No OS-level click.** Real hit routing would need Accessibility permission (or a native event source). The AppKit rule over measured inputs is the strongest available answer; the targeted-input and commit tests show the surfaces are alive and correctly positioned.
3. **No real macOS IME session.** The field is the owner's DOM input; composition, candidate windows and the IME's own overlay were not exercised.
4. **No VoiceOver/AX.** The list is deliberately `aria-hidden` and has no accessible roles; AX behaviour was not measured.
5. **Windows and Linux unmeasured.** The controller has platform-specific paths; this run is darwin arm64 only.
6. **`NSView.subviews` vs Electron `View.children`.** The probe reads Electron's documented child-view array, which is what the app itself reads (`contentView.children`). A native Objective-C bridge could read `NSView.subviews` directly; this rig cannot.
7. **The hidden helper view.** A `WebContentsView` at `0,0,1280,720`, `about:blank`, `visible:false` is present in `children` in every state. It paints nothing; its size matches the registry’s `BACKGROUND_VIEWPORT`, consistent with a browser tab view created at host start, but its creator was not traced. It does not affect the geometry above because it is invisible.
8. **Notice/list height.** The first open showed a 69-DIP list (one row); when the live URL happened to match no suggestion, the child document rendered its empty notice inside a 69-DIP view. The notice-height behaviour is adjacent to this question and was not audited.

## Risk recommendation

**No material risk found; do not default-off or revert on this evidence.** The field row cannot be occluded by the page (zero overlap), the native list is last and raised before every show, a targeted click on a row commits and navigates, and the three dismissal triggers that have a presented page (Escape, page focus, navigation) leave the page rect unchanged; the new-tab trigger presents the new tab’s start page, so it has no page rect to preserve. The remaining uncertainty is the compositor observation itself (F7) and the unexecuted OS click, both stated above; neither gives a mechanism by which the popout would be invisible or unclickable in the measured configuration.

If the release gate requires the compositor observation to be closed before shipping, the correct next step is an operator-visible `inactive` run with a window capture — not a default-off, because the geometry and order already rule out the occlusion the default-off would be protecting against.

## Reproduction

```sh
cd ~/local-operator-ui
git fetch origin docs/browser-native-determination-s4b
git worktree add .worktrees/browser-native-determination \
  -b docs/browser-native-determination-s4b origin/docs/browser-native-determination-s4b
cd .worktrees/browser-native-determination
ln -s ../../node_modules node_modules
npx dotenv-cli -e ../../.env -- pnpm build
node scripts/browser-native-determination.mjs \
  --out "$PWD/docs/evidence/browser-chrome-native-determination"
```

The probe prints one line per row, writes `facts.json`/`matrix.md`/`build-identity.json`/
`teardown.json`/`isolation.json`/`app.log` and the `frames/` pixels, and reaps the app by exact pid. The probe and this document live on the PR head; the product source they build is still `c5503204ed` (`productSourceCommit` in `build-identity.json`). The
pixels are git-ignored (`docs/evidence/**/*.png`); the facts and this document are tracked.
