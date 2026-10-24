# S6c — enabled-path proof and real-app documents

App head: `7f20a501a3` (built `out/` from this tree). Proof head:
`b9277670dc` (the proof rig executes the composite attempt; app code unchanged
since `7f20a5`).
Command:

```bash
node scripts/browser-approvals-s6c-proof.mjs \
  --out docs/pr-evidence/browser-approvals-s6c --frames
```

The rig boots the **built app**, not a fixture. It removes
`LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_DISABLE`, so this is the default
launch; it uses a scratch HOME/config/log/profile, strips inherited
`CMUX_*`/`LOP_*`, turns notifications and telemetry off, uses a mock keychain,
and reaps the app's process group before returning. `--window-mode=inactive` is
required: a headless window does not present the page view, so the card cannot
auto-present there. The window is visible but never focused.

## Enabled-path matrix

| Row | Status | Actual |
| --- | --- | --- |
| A1 enabled auto-present | PASS | `approvalsCard {available:true, open:false, visible:true}`; no shield explicit open. |
| D1 dock route absent | PASS | `[data-tour-tag="browser-approvals-dock"]` false, consent band false, card visible, route `#/browser`. |
| A2 page focus unchanged | PASS | page `activeElement=name`, focus/blur 0→0, card `document.hasFocus=false`. |
| A3 typing continues | PASS | page input `"aa"` after the card was up; `activeElement` still `name`. |
| A4 bounds and presentation | PASS | page view `540x794`, `visible:true` before and after; page viewport `540x794` unchanged; window focused false; `focusedContents=null` before and after. |
| R1 shield route | PASS | shield click opens the native card (`open:true`, `visible:true`), `aria-expanded=true`; second click closes. |
| R2 page-menu route | PASS | the page menu's Approvals item opens the card while dock false. |
| I4 Escape leaves pending | PASS | `https://pending.example` still in `pendingConsent`; card open false. |
| I6 Close leaves pending | PASS | same pending entry after explicit open + close. |
| P1 built app | PASS | `out/renderer/browser-approvals-overlay.html` exists. |
| F native composite | **BLOCKED** | This run executed `screencapture -x -o -l 45130` against the visible, unfocused window: `could not create image from window` (macOS Screen Recording unavailable on this host). The documents above are not a composite. |

Machine-readable: [s6c-proof.json](s6c-proof.json).

## Real-app documents

The app frames are the real enabled build's `/browser` route; the card frames are
the app's own card child (a second `WebContentsView`) captured over CDP. They are
**documents, not a composite**: the live page is a native child, so an app-DOM
capture shows the route/dock absence and a card capture shows the card, but the
card-over-page composite is the BLOCKED row above.

| State | App route | Card child |
| --- | --- | --- |
| 264 dark | [app-264-dark.png](frames/app-264-dark.png) | [card-264-dark.png](frames/card-264-dark.png) |
| 264 light | [app-264-light.png](frames/app-264-light.png) | [card-264-light.png](frames/card-264-light.png) |
| 900 dark | [app-900-dark.png](frames/app-900-dark.png) | [card-900-dark.png](frames/card-900-dark.png) |
| 900 light | [app-900-light.png](frames/app-900-light.png) | [card-900-light.png](frames/card-900-light.png) |

The 264 and 900 are **content widths** measured by the renderer's
`[data-tour-tag="browser-content"]`. The product window minimum is 600 (340
content in this route); the rig reaches 264 by `BrowserWindow.setContentSize`
through the main-process inspector. That is a test-only window minimum bypass for
the narrow state; the page/card are the same enabled build and the same layout.

## Kill-switch tests

The switch is tested, not only documented:

- `scripts/approvals-overlay.test.mjs` — default-on (`{}`), `"0"` and `"true"`
  stay on, exactly `"1"` is off.
- `scripts/browser-startup.test.mjs` — *the approvals card is default-on: an
  ordinary launch builds its child*: the host adds one
  `browser-approvals-overlay.html` view and projects `available:true`; stopping
  removes it.
- `scripts/browser-startup.test.mjs` — *the disable switch makes an ordinary
  launch create no card child at all*: with `…_DISABLE=1`, zero card views, and
  `available:false`.

## Limitations, not claims

- **VoiceOver across the card's second document is BLOCKED.** This slice does
  not claim parity with the DOM picker. Owner-named limitation: **damiantran**;
  an attended VoiceOver pass is required before the default-on path ships.
- **Native composite, transparency and 8 px ring hit routing are BLOCKED** (no
  Screen Recording; the ring row was already BLOCKED in S6b). Non-darwin paints
  the opaque-square fallback.
- The dock's grant/revocation list is part of the route this slice removes; the
  native card's Review all is pending-only. Re-homing grants is **not** in this
  slice and must be decided before the enabled path ships.
