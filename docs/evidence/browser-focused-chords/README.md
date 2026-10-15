# Focus-scoped browser commands: rendered and execution evidence

## Round 1 remediation status (READ FIRST)

Everything below this section was captured at product source `4bb030c49` and
describes THAT build. The round-1 remediation commit changes `src/` (renderer
hook, address bar, tab strip, keymap registry, host/ipc/index, menu labels), so
**no frame or native row below is evidence for the remediated head**. They are
kept as the before-remediation record, not re-labelled. Re-capture is HELD, not
skipped: the operator's disk alert forbids new compiles, so the remediated head
has source plus targeted jsdom/node tests only (`browser-chord-renderer`,
`browser-chord`, `browser-host`, `browser-startup`, `keymap-*`,
`lane-registration`, both `tsc` projects) and **no native proof yet**. Still owed
on the remediated head: keyboard Cmd+W from a focused tab button then a second
chord, rapid double Cmd+W, last-tab, a populated-address Cmd+L selection row,
hover frames (Reload, +, active close, address), an after-last-close frame, and
the eight state frames. Do not read the tables below as covering those.

**Correction (design D-PR1, code R2).** The row `DOM address actual` in
`execution-summary.json` is an EMPTY field (`start 0 / end 0 / value ""`), which
cannot tell "selected" from "focused". The "selection 0..26" figure in the matrix
below did not come from that row. Selection is currently proven by the jsdom
hook test on a populated input (`selectionStart 0 / selectionEnd 24`) and by the
independent QA report's native row (`0..26 of 26`); a committed implementer-side
native row is still owed on the remediated head.

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
