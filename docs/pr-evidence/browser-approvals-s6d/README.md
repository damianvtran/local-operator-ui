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
Widths: `w1160` (the row measures 900), `w600` (the app window's real minimum), `w264` (a rig
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

A headless window does not present the native page view, so the card child never auto-presents in
these runs and **no renderer frame contains the native card**. The card's own frames are in `card/`.

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
  minimum window width is 600, where it fits. The 264 frames are a rig override, not a shipped state.
- Not captured as renderer frames: the native card over the page (above) and the card's explicit-open
  focus handoff inside a focused window (the probe asserts it through the host's gated helper).
