# S6d evidence: approvals corner popup by default, grants kept reachable

Everything here was captured **headless** (`--window-mode=headless`, scratch HOME/config/log, private
`--user-data-dir`, mock keychain, `CMUX_*`/`LOP_*` stripped, every process group reaped by exact pid).
No window was ever shown. Frames are CDP `Page.captureScreenshot` of the renderer or of the card
child's own document.

## Commands (all from the repo root, after a build with placeholder `VITE_*` values)

```sh
VITE_GOOGLE_CLIENT_ID=x VITE_GOOGLE_CLIENT_SECRET=x VITE_MICROSOFT_CLIENT_ID=x VITE_MICROSOFT_TENANT_ID=x \
  node_modules/.bin/electron-vite build
# the card document + controller rig; --controller <old copy> reproduces "before"
node scripts/browser-approvals-s6b-probe.mjs --out <dir> --width <264|900> --theme <dark|light> --frames
# the app rig: product (default), kill switch, and origin/main with its old S6A opt-in
node scripts/browser-approvals-s6d-capture.mjs --out <dir>
node scripts/browser-approvals-s6d-capture.mjs --out <dir> --kill
node scripts/browser-approvals-s6d-capture.mjs --out <dir> --before --app-root <origin/main build>
```

## D1: the stale/unavailable error line no longer covers "Don't allow"

`probe/before-*.json` is the same rig driven against `origin/main`'s controller
(`--controller`); `probe/after-*.json` is this head. Geometry is in the card's border-box
coordinates: `overdraw` is how far the sticky footer's top edge cuts into the lowest decision
button, `bodyOverflow` is how much of the body is scrolled out of the card.

| controller | cell | stale error | unavailable error | normal |
| --- | --- | --- | --- | --- |
| before | 264-dark | FAIL (overdraw 15.17, body overflow 21, card 398, innerHeight 414) | FAIL (overdraw 15.17, body overflow 21, card 398, innerHeight 414) | PASS |
| before | 264-light | FAIL (overdraw 15.17, body overflow 21, card 398, innerHeight 414) | FAIL (overdraw 15.17, body overflow 21, card 398, innerHeight 414) | PASS |
| before | 900-dark | FAIL (overdraw 15.17, body overflow 21, card 349, innerHeight 365) | FAIL (overdraw 15.17, body overflow 21, card 349, innerHeight 365) | PASS |
| before | 900-light | FAIL (overdraw 15.17, body overflow 21, card 349, innerHeight 365) | FAIL (overdraw 15.17, body overflow 21, card 349, innerHeight 365) | PASS |
| after | 264-dark | PASS (overdraw 0, body overflow 0, card 419.16, innerHeight 436) | PASS (overdraw 0, body overflow 0, card 419.16, innerHeight 436) | PASS |
| after | 264-light | PASS (overdraw 0, body overflow 0, card 419.16, innerHeight 436) | PASS (overdraw 0, body overflow 0, card 419.16, innerHeight 436) | PASS |
| after | 900-dark | PASS (overdraw 0, body overflow 0, card 370.17, innerHeight 387) | PASS (overdraw 0, body overflow 0, card 370.17, innerHeight 387) | PASS |
| after | 900-light | PASS (overdraw 0, body overflow 0, card 370.17, innerHeight 387) | PASS (overdraw 0, body overflow 0, card 370.17, innerHeight 387) | PASS |

Frames: `card/before-*-stale-error.png` (the lowest decision button is cut by the footer) against
`card/after-*-stale-error.png` (all four decisions above the error line and the footer).
`card/after-*-normal-request.png`, `card/after-*-unavailable-error.png` and
`card/after-*-review-all-list.png` complete the card views. The card's copy is French in these
frames because the rig pushes `locale: "fr"` on purpose, to prove the localized, longer strings fit.

Mechanism, measured: for the host-supplied error (`setModel`) the controller already re-applied the
model and measured, and the stale/unavailable lines pushed by `dropAction` / `showActionError` were
only pushed, never measured. Both were still FAIL before, because a height `setBounds` did not reach
the child's `window.innerHeight` in this rig (view 436 DIP, `innerHeight` 414 across eight reads over
2 s, and again for +10/+30/+60/+200 DIP nudges), so the card's own `max-height` kept clamping it. The fix
re-measures in the same `setTimeout(0)` task as the model apply for the two error pushes, and a height
growth whose viewport did not follow rebuilds the child at the new bounds.

## App frames (renderer capture)

`app/after/` is this head, card on (product default). `app/before/` is `origin/main` with its old
`..._OVERLAY_S6A=1` opt-in. `app/kill-switch/` is this head with `..._OVERLAY_DISABLE=1`.
Widths: `w1160` (the row measures 900), `w800` (the app window's real minimum, `WINDOW_MIN_WIDTH` in
`src/main/window-mode.ts`; the 600 floor in `index.ts` belongs to the auth popup), `w600` (a rig-lowered
stress width), `w264` (a rig
override of that minimum, standing for a 264px browser pane row; the toolbar folds into the menu).

| file | what it shows |
| --- | --- |
| `app/after/*-toolbar-badge.png` | the toolbar Approvals control with the live pending badge (2), light and dark, 1160/600/264 (at 264 the control is folded into the page menu and the badge rides the menu trigger) |
| `app/after/*-approvals-populated.png` | the Approvals dialog with two grants, one denial, This site and Browsing data |
| `app/after/*-approvals-empty.png` | the Approvals dialog with nothing approved |
| `app/after/*-page-with-pending.png` | two requests pending: the page is not displaced and no band exists |
| `app/after/actions-after-revoke-all.png` | the dialog after Revoke all, showing the empty Approved list and This site |
| `app/before/*` | origin/main, card enabled by env: the same two-pending state, and the toolbar with no dialog to open |
| `app/kill-switch/*` | the DOM band and the dock, pushing the page down, which is what the card replaces |

In THIS rig's tab state (a blank or just-opened tab) a headless window does not present the native page
view, so the card child did not auto-present and **no renderer frame here contains the native card**. That
is a property of this rig's page state, not of headless Electron: the round-1 UX review observed the card
present headless once the tab was on a real page (page view visible, card child at its corner bounds), so
"never presents headless" is NOT claimed. What is still not captured is the composite over a live page.
The card's own frames are in `card/`.

## Absence and presence of the dock route (real built renderer)

`probe/capture-default.json`, `probe/capture-kill.json`, `probe/capture-before-origin-main.json`:
`afterEmptyOpen` / `pendingSelectors` per cell. With the card on, `dataDockLayout`, `dockTitle` and
`consentBar` are all `0` in every cell, with two requests pending, and the page content width is
unchanged by the pending requests (`contentBeforePending` equals `contentAfterPending`). With the kill
switch the same selectors read `1` (dock open) and `consentBar: 1` (pending). The source-level
assertion of the same fact is `scripts/browser-approvals-route.test.mjs`.

## Dialog actions against the real host (side effects)

Real host, real `persist:local-operator-browser` partition, grants read from the projection and cookies
from the partition (`probe/capture-default.json`, `actions`):

- grants at start: `deny:https://denied.example, origin:http://127.0.0.1:45873, session:https://second.example, session:https://third.example`
- Forget this site (active tab origin): grants `deny:https://denied.example, session:https://second.example, session:https://third.example`; cookies `['s6d_probe@127.0.0.1']` -> `[]`
- Revoke (first row): grants `deny:https://denied.example, session:https://third.example`
- Clear cookies and site data: cookies `['s6d_probe2@127.0.0.1']` -> `[]`, grants unchanged `deny:https://denied.example, session:https://third.example`
- Revoke all: grants `[]`

## BLOCKED, stated not implied

These are NOT measured and this PR claims no parity on them. Enabling the card by default needs an
attended check of all three, or an explicit owner-named limitation in the release notes.

- **Native composite / transparency** of the card over a live sibling page (no Screen Recording; a
  headless window presents no page view).
- **The 8 DIP ring's native hit routing** (probe row `I3-ring-click` is `BLOCKED`).
- **VoiceOver** across the card's second document.
- Also not measured: the Approvals dialog's 264px rendering inside a real 264px pane. At a 264px
  window the dialog (a viewport-level `BaseDialog` with a 320px floor) is clipped; the app's real
  minimum window width is 800 (`WINDOW_MIN_WIDTH`), where it fits (`app/after/w800-*`). The 600 and 264
  frames are rig overrides of that minimum, not shipped states.
- Not captured as renderer frames: the native card over the page (above) and the card's explicit-open
  focus handoff inside a focused window (the probe asserts it through the host's gated helper).

## Round 1 remediation frames and probe rows

Re-captured at this head (`electron-vite build` of the head, then the same rigs as above).

| file | what it shows |
| --- | --- |
| `card/after-{264,900}-{dark,light}-hover-dont-allow.png` | Q1: the two-line "Don't allow" gloss showing while hovered; the four decisions sit where the normal frame has them and the footer clears the last one |
| `card/after-{264,900}-{dark,light}-long-requester-stale-error.png` | D-2: a 98-character conversation title under the stale line; the headline is clipped with an ellipsis (full text in the tooltip) and all four decisions are above the footer |
| `app/after/w800-*-approvals-{populated,empty}.png` | D-5: the dialog at the real minimum window width; opens on the dialog itself with no ring on a destructive button (D-1) |
| `probe/q1-control-reservation-disabled-900-dark.json` | the negative control: the same probe with the gloss reservation switched off, FAIL (overdraw 9.17 / 8.57, buttons moved, 8 and 4 hover/focus clicks missing their button) |

Probe rows added to `browser-approvals-s6b-probe.mjs`, all PASS in the four cells (264/900 x dark/light):
`Q1-hover-focus-keeps-decisions-in-place-normal`, `...-stale` (no decision moves on hover or focus of any of
the five buttons, overdraw 0, `elementFromPoint` at the pre-hover centre is still that button) and
`D2-long-requester-keeps-decisions-visible` (overdraw 0, body overflow 0, card 452.77 at 264 / 403.17 at 900).
`capture-default.json` carries `focusOnOpen` per cell: the dialog element (`role: dialog`), inside the dialog,
in all eight cells.
