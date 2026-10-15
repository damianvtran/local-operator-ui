# Focus-scoped browser commands: rendered and execution evidence

## Round 3 delta — current evidence (read first)

D-PR9/U10: the address tooltip was removed, not relocated. Its old below-field
panel intersected the native page rect; `capturePage` excludes the native view
and could not show the occlusion. The two `tooltip-address-*` PNGs and the
round-1 tooltip claims below are **historical, not current UI evidence**. The
field retains its Address label and `aria-keyshortcuts`. Pointer-only unit test:
Back opens a tooltip as a positive control, Address does not. New source: 7 PASS;
old url-bar: 6 PASS, 1 FAIL (`no tooltip over the content rect`). Earlier harness
attempts had missing jsdom globals; those are not product failures. The first
negative control focused the field and passed vacuously (the old tooltip was
suppressed on focus); replaced with pointer-only input.

U9: keyboard close parks focus on the route root (`tabindex=-1`), which matches
`:focus-visible`. Current computed `outline-style` is **none**; width remains
2px. A tab-button child still computes **solid 2px**. The global rule was not
changed; only the programmatic rest-stop carries `outline-none!` (same precedent
as onboarding). `keyclose-root-after-*` shows this state, both themes.

D-PR10: New tab right-edge padding 8; native readback panel right=1371.953125,
window=1380, margin **8.046875 CSS px** (was 0.046875). New frames:
`tooltip-new-tab-r3-*`. Reload's transient overlap with an inactive tab title is
unchanged/deferred, not a page-view occlusion. Native readbacks for Reload, New
tab, active close and inactive close all have `intersectsContentRect=false`, in
both themes; Address has `panel=null`. The content rect is read from
`browser-content`, the SAME box `registerBrowserViewRect` and main receive.

Build: `e68286f674181eca50bf06fe2004a51fe51a2b91`, src tree
`ad8138a566c3497a0eb6afeb26007fa5a7042693`, 17.07s, 170 artifacts,
installed lock unchanged. `r3-artifact-identity.json` contains all hashes;
`r3-execution-summary.json` has current delta rows. This commit is amended only
with docs/evidence after that build: src stays byte-identical. Native run rc=0,
one hidden instance, visible=false/focused=false, no HTTP resources, owned pid
reaped. First delta run stopped on a scratch fixture's fixed tab-count assertion
(initial blank + two loaded tabs already made three); corrected to relative
counts, no product change or second compile. Physical OS delivery is still
unverified. Only affected delta frames were re-captured; earlier state frames
retain their named older build identity, not promoted to current pixels.

Targeted neighbours: browser-chrome 73, strip-focus 7, lane-registration 1,
classifier 7 PASS. Full suite is CI only. Implementation began on
anthropic/claude-sonnet-5-5; provider quota forced openai/gpt-6.1-sol for final
validation/evidence; no role/default model settings changed.

## Round 1 remediation status (READ FIRST)

The round-1 remediation changes `src/`, so the frames and rows from the
original `4bb030c49` capture no longer describe the head. What replaces them:

- **Build:** product source `636479aa2`, `src` tree `263097ccfa12`, one leased
  plain-JS compile (13.76 s, installed lock unchanged), explicit port-1 API root;
  hashes in [artifact-identity.json](artifact-identity.json).
- **Frames (30 PNGs, all re-captured on that build except the 8 `*-before-*`
  baselines):** the 8 state `*-after-*` frames, 2 forced-focus frames (now offset
  1px), 2 `lastclose-*` frames (D-PR6), and 10 hover frames covering Reload, New
  tab, the active tab's close, an INACTIVE tab's close and the address field in
  both themes (D-PR2). Hashes: [frame-hashes.json](frame-hashes.json); exact
  pixel diffs against the baselines: [pixel-diff.json](pixel-diff.json).
- **Native rows:** [r1-execution-summary.json](r1-execution-summary.json), one
  hidden instance, `visible=false focused=false` throughout, API root `127.0.0.1:1`,
  renderer HTTP resources empty, owned pid reaped. Labels as before: DOM
  KeyboardEvents and the real application menu callback; the synthetic `focusin`
  is the same documented hidden-rig substitute. NONE of this is physical key
  delivery or OS focus.
- `execution-summary.json` and `native-menu.json` are the ORIGINAL `4bb030c49`
  rows, kept as the before-remediation record. Where this section and the tables
  below disagree, this section wins.

What the remediation run actually measured (all in `r1-execution-summary.json`):

| Finding | Row | Result |
|---|---|---|
| U2 keyboard Cmd+W with focus ON a tab button | `U2 close dispatch`, `U2 after close` | tab button focused before; after the close focus is on the browser route root, chord-focus reports during the close `[true]` (no `false`) |
| U2 second Cmd+W, the app-window case | `U2 second Cmd+W via REAL menu on main` | the real `app-close` menu item on the main window closed the next TAB (2 to 1), the main window stayed |
| U2 rapid double Cmd+W | `rapid double close result` | two DIFFERENT tabs closed in one burst |
| a1-7 last tab | `last tab closed by keyboard` | one fresh `about:blank` tab, new id, caret in the EMPTY address field |
| a1-7 reopen after that | `Cmd+Shift+T after last close` | restores the closed URL |
| U1 draft | `draft after Cmd+2`, `blur navigated?` | draft typed on tab 1 is gone after Cmd+2, field shows tab 2's URL, blur navigates nothing, fixture request delta 0 |
| D-PR1 / R2 selection | `DOM address populated selection` | populated address: `start 0 / end 26 / len 26`, focused. This replaces the empty-field row |
| D-PR3 close scope | `close buttons aria/tooltip scope` | `aria-keyshortcuts="Meta+W"` only on the active tab's close; the inactive one has none |
| D-PR2 tooltips | `tooltip <name> <theme>` | rects and text per hover; every tooltip closed when the pointer left |
| D-PR4 ring | `focus CSS <theme>` | `solid`, `2px`, offset `1px` (was `2px`) |

Measured limits, not hidden:

- **D-PR7 stays unexplained.** The ring's computed colour is `rgb(33, 30, 24)`
  (light) and `rgb(241, 238, 230)` (dark), i.e. the ink tokens, while
  `index.css` says `var(--color-accent)`. The source I read does not explain it;
  contrast is unaffected. Recorded in the readback, not fixed here.
- **The address tooltip moved below the field** after the first re-capture showed
  the default top placement covering the active tab's title. The final frames are
  the corrected placement; the intermediate run's frames were replaced.
- **Frame differences vs the baselines are not 0.** The populated/loading
  differences are the fixture port text and spinner phase plus the title text
  (`New tab` + `QA 3` vs the baseline's), measured above; empty light/dark and
  error light are 0 px, error dark is the same 4 fringe pixels as before.
- Not covered: physical OS chords, Windows/Linux delivery, the main window's own
  reload/close with no browser focus (rig-destructive), a second native pass for
  the R3/R4/R7 main-process fixes (covered by the host and startup unit tests
  only, see the PR thread).

**Correction (design D-PR1, code R2), kept for the record.** The original
`DOM address actual` row was an EMPTY field (`0/0/""`) and could not tell
"selected" from "focused". It is superseded by the populated row above.

## Identity and limits

- Before frames: independent QA browser audit at `2efe5fe3971806a00469fcd1b52110186813b593`. The browser/main/preload/shared trees relevant here have **no diff** between that audit and feature base `8179f2956e5c991accb06a2fcc6f8e9d11b5739a`.
- After frames: renderer captured at compiled source `08cb44c458f19f9a55e93fce2166df9f6ff1dca8`. Final product source is `4bb030c499c7d3e82069eff02a63fb4b6f012a20`, `src` tree `9ab09a840fede19484e1570fba1e4ff3c0c51734`: the subsequent actual-menu-target fix changes only `out/main/index.js`. **All renderer files and preload are byte-identical** (167/168 output artifacts unchanged), proved in [artifact-identity.json](artifact-identity.json), so these frames remain the exact final renderer. The changed main menu path was independently re-executed below, not blindly re-pinned. Later evidence/checker-only commits do not change product source.
- Real Electron 44.3.0, headless, 1380×900 CSS / 2760×1800 native pixels. App `capturePage` photographs **chrome only**, excluding the embedded native page. The page-ground rectangle is not a claim about page rendering.
- Build and runtime API roots explicitly `http://127.0.0.1:1`, backend manager disabled, synthetic OAuth placeholders, telemetry/notifications off, isolated HOME/config/log/profile and empty discovery registry, inherited CMUX/LOP/desktop endpoint/token removed. No working backend or live session used.
- Native listener proof emits Input-shaped objects on the **real** view webContents. DOM proof dispatches KeyboardEvents. Hidden Chromium changes activeElement without delivering normal focusin, so menu proof explicitly dispatches synthetic focusin from that actual DOM target through the real listener/authorized IPC. None of these is physical key delivery or OS focus proof.
- Focus-ring frames force **only** Chromium's supported `CSS.forcePseudoState("focus-visible")`. Existing CSS measured `outline-style: solid`, `outline-width: 2px`, offset `2px`, input box x364/y73/898.28125×32 CSS in both themes. Unforced hidden DOM focus previously measured `outline-style: none`; selection alone was NOT claimed as a ring pass. No `.isFocused()` override, new CSS, window show or activation.

## Before / after

| State | Light before | Light after | Dark before | Dark after |
|---|---|---|---|---|
| One blank tab | [before](empty-before-localoperatorlight.png) | [after](empty-after-localoperatorlight.png) | [before](empty-before-localoperatordark.png) | [after](empty-after-localoperatordark.png) |
| Populated chrome | [before](populated-before-localoperatorlight.png) | [after](populated-after-localoperatorlight.png) | [before](populated-before-localoperatordark.png) | [after](populated-after-localoperatordark.png) |
| Loading | [before](loading-before-localoperatorlight.png) | [after](loading-after-localoperatorlight.png) | [before](loading-before-localoperatordark.png) | [after](loading-after-localoperatordark.png) |
| Error | [before](error-before-localoperatorlight.png) | [after](error-after-localoperatorlight.png) | [before](error-before-localoperatordark.png) | [after](error-after-localoperatordark.png) |

Forced existing focus-visible rendering: [light](focus-forced-after-localoperatorlight.png), [dark](focus-forced-after-localoperatordark.png).

The implementer viewed the populated and forced-focus frames in both themes, plus loading/error dark frames. Independent design review remains required; this is not its sign-off.

### Actual exact-diff results

[Raw pixel counts/bounds](pixel-diff.json), [all 18 frame hashes](frame-hashes.json). Native pixel comparisons are exact RGBA, not a perceptual threshold:

| State | Light differing pixels | Dark differing pixels | Observed bounds / interpretation |
|---|---:|---:|---|
| Empty | 0 | 0 | Entire frames pixel-identical AND PNG SHA256-identical |
| Populated | 1,380 | 1,548 | Fixture port text; dark additionally dynamic QA title. Differences confined to x953–1732, y97–192; tab/toolbar edges do not move |
| Loading | 2,181 | 2,308 | Fixture port/title plus rotating spinner phase; bounds x953–2507, y91–192 |
| Error | 0 | 4 | Light entire frame/hash identical. Dark has four isolated sidebar/icon fringe pixels (x580/y113, x52/y319, x41/y368, x43/y371), channel deltas 1–2. **Not** claimed globally pixel-identical; retained for designer judgment |

Different fixture ephemeral ports/titles and spinner phases are declared differences, not hidden behind an equality claim. Forced-focus frames intentionally add the existing outline. Tooltip text changes are the only intentional paint/copy changes; this slice does not redesign tabs, loading, error, zoom or the start page.

## Execution matrix (implementer, not independent QA)

[Sanitized actual result rows](execution-summary.json), [actual native menu enumeration and provenance](native-menu.json).

Initial native proof product source `956325320df0ab7c97cfcbc9ea75125ede3068e5`; its compiled main and preload are byte-identical to final source above. Final delta changes only the renderer's shared close callback and directly tests both doors.

| Surface | Actual result |
|---|---|
| Full renderer config binding | Executed emitted schema + env + loader + API getter with real Zod: port1; removing explicit binding reproduces localhost:1111 negative control |
| DOM new tab / address / bracket | Count +1; address INPUT focus only (empty-field row, selection NOT evidenced here: see correction above); page history returns `/one`, route remains `#/browser` |
| DOM reload | Fixture request counter +1 |
| Real native-view listener reload | `preventDefault` 1, fixture request counter +1; synthetic listener emission, not OS delivery |
| Native Alt / key-up / wrong-platform modifier | `preventDefault` 0, request delta 0 |
| Native action repeat / composition | Consumed without action: `preventDefault` 1, request delta 0 (cannot fall into menu accelerator) |
| Explicit browser-menu reload | Final main source: actual main-window menu callback, synthetic focusin ownership through authorized IPC; normal AND hard reload each fixture request delta +1, app chrome navigation count 0 |
| Actual other-window menu target | Final main source: existing real hidden mini window normal AND hard reload each mini navigation count +1, browser fixture request delta 0, even with true main chrome focus report. Popup/other-target/close/null rules also covered by real decision-function tests |
| Wrong sender | Real main IPC handler: `This window cannot use the browser controls.` |
| Invalid focus IPC | Real preload/main: `Browser focus must be a boolean.` |
| Last-tab close | Final source: both actual strip button and DOM shortcut leave exactly one fresh user-owned `about:blank` tab |
| Reopen | Final source: explicit Shift+T restores the closed synthetic user URL; bounded user-only/excluded-agent stack also covered in host tests |
| Chat DOM | T unprevented, no browser tab created |
| Safety/teardown | Final facts visible=false/focused=false, renderer HTTP resource list empty, exact final owned PID reaped (`alive=false`); prior attempt PIDs also reaped |

The matrix does not prove OS key-equivalent suppression, actual focus return into an unfocused native page, Windows/Linux native delivery, or an independently reviewed QA verdict. Those limits are explicit rather than represented as passes. Source guards retain normal-launch AND already-focused-window requirements.

Native setup repairs were confined to the scratch instrument: lowercase capture labels; local lexical scope for repeated CDP expressions; explicit synthetic focusin after proving ordinary hidden `.focus()` delivered none. No source focus guard was weakened to make a proof green. The final renderer-close delta passed in one 11.2s native run, with one hidden app instance and exact tree teardown; the prior complete listener/menu matrix passed in 8.8s. A final actual-target menu delta passed in 8.9s on source `4bb030c49`: real main and existing mini windows, both reload kinds, no new popup/window, real window guards retained. All owned native process groups were then queried and none remained.

## Automated coverage and rerun doors

- Shared classifier covers darwin/win32/linux, platform modifiers, Alt/composition/key-up/action-repeat negatives, allowed cycle repeat, ordinal/group/scope, app-vs-browser ownership and two rapid legitimate actions.
- Real renderer-hook tests cover address selection, bracket bubbling, grouped selection/cycle, focus reporting/unmount, chat negatives, native-origin intent return and both shared-close/refusal outcomes.
- Existing browser-host tests add wrong sender/invalid focus/reopen input and memory-only, user-only, capped/scoped reopen tests. Startup fixture now models real EventEmitter wiring and exercises production rollback/retry. Existing strip/navigation/window-mode neighbors passed in the affected run.
- Main and renderer typechecks passed; final close delta reran affected renderer types/hook test; actual-target delta reran main types and all six classifier/router/menu decision tests. No duplicate full local desktop suite: CI supplies terminal whole-suite coverage.
- Run source tests through `node scripts/run-desktop-tests.mjs --test-concurrency=1 <affected files>`, never bare node --test, with isolated HOME/config and the documented machine lease/bounds.
- Collision audit: `node scripts/check-browser-chord-collisions.mjs docs/evidence/browser-focused-chords/native-menu.json` reads the actual `menu actual` enumeration beside the shipped reserved/default registry and classifier; explicit focus aliases accepted, unknown collisions rejected. Existing app Actual Size/Command+O vs canvas-open conflict is recorded for a2, not falsely marked fixed.

No version bump, agent command, origin/permission change, popup rewrite, history/bookmark/download/find/zoom/start-view feature is included. Independent code/QA/design/UX rounds must be gathered before one batched remediation and any merge decision.
