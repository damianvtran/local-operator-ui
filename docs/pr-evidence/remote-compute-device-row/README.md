# Remote compute in the chat's device picker — GUI v1 frames

Every frame is a Storybook story from `src/renderer/src/features/remote-compute/remote-compute.stories.tsx`,
captured in a private headless Chrome over raw CDP (mock keychain, `deviceScaleFactor: 1`), in `localOperatorDark` (`-dark`) and
`localOperatorLight` (`-light`). The components are the shipped ones: the header is
`ChatHeader`, the control is `ChatDeviceSlot`, and the Radient group is
`RemoteComputePicker` reading `remote_compute.read` over the story bridge. The
invented part is the wire DATA, whose field names are the API's.

The picker frames are opened by a real pointer press on the chip (`Input.dispatchMouseEvent`
at the chip's rect), because Radix's trigger opens on pointerdown and the header owns
that state; the sheet, card and list frames pass the same wire-shaped values the
picker would, to components that are themselves the shipped ones.

**Round-1 remediation recapture (2026-11-18).** The whole set was taken again on the
remediated head. These frames are **element clips**, not viewport stills, so the
surfaces each finding is about fill the frame; the previous set photographed a
1040px band with the menu or dialog inside it. Compare ink and structure, not pixel
coordinates, against anything measured on the earlier set. `sheet-open-after-pick-*` is
new and is the one frame driven end to end: chip press, then a real press on the
`Radient — ready` row, then the sheet that opens over the chat (UX round 1, U1).

Reproduce: `pnpm storybook` (port 6006), then drive
`/iframe.html?id=<story>&args=theme:<palette>;locale:en&viewMode=story` at the size in
the table below and screenshot the viewport.

## What each set shows

| Frames | State | What it shows |
|---|---|---|
| `row-flag-off-*` | A | The family's switch off (`{enabled:false}`): no group, no rule, today's picker |
| `row-checking-*` | loading | `checking…` while the read is outstanding - no spinner that implies presence |
| `row-signed-out-*` | B | `sign in to use`: an on-ramp, selectable, and it starts the sign-in |
| `row-ready-*` | C | The group NAMED (`Run on Radient`), `ready` in the status slot, and the pinned sentence naming its own subject (design round 1, D1) |
| `row-running-*` | D | `1 run · 4m 13s · held $5.09`: the aggregate, from the server's `started_at` and `hold_usd` |
| `row-capacity-*` | E | `capacity unavailable · retry` on the row's REASON LINE, not in the status slot (D2) |
| `row-needs-network-*` | F | `needs a network` with the commands this app can name printed under it, not only in the accessible name (D2, U3) |
| `row-not-offered-*` | G | `not offered by this deployment` with its own quiet reason line and no hover ground |
| `sheet-open-after-pick-*` | — | The second level reached THROUGH the row: the sheet opens over the chat after a real press (U1 / Q-001) |
| `sheet-ready-*` | — | Network line as a statement on its own line (D3), `What kind of run` (D6), Cloud run live, Dedicated + Spot disabled in a quieter voice with the reason inline (D4), the one buyable tier stated rather than check-marked (D10), the prompt summary, the directory, the submit |
| `sheet-ambiguous-network-*` | — | Two networks and no default: the decision is stated once, beside the disabled primary, and `Change` is absent because there is nothing to change from (D7); the stand-down line under the actions |
| `sheet-no-prompt-*` | — | An empty composer: the submit stands down with its own reason |
| `card-running-*` | — | A run spending: status, elapsed from the server's start, the hold one ink step above the clock (D3), the binding sentence on its own line, Cancel |
| `card-finished-*` | — | Settled: the charge instead of the hold, Forget instead of Cancel |
| `card-failed-*` | — | The provider's failure state, `Failed` in `danger` rather than the banner's warning hue (D8) |
| `runs-populated-*` | — | The list: three rows, two live, Cancel only where a run can still spend, and NO panel-level accent ring (D5) |
| `runs-record-only-*` | — | Signed out: the banner says these are this device's last known rows |
| `runs-empty-*` | — | Nothing run yet |

## What these frames cannot claim

- **No live daemon.** Every frame is presentational and answers from the story
  bridge. The real load, refusal codes (`run_limit`, `insufficient_credits`, …) and
  the provider's own latency are QA's rig, not these stills.
- **No focus-dependent claim.** The capture runs with focus emulation on and the
  dialogs take the focus themselves rather than a control, so a frame does not show
  what a focus ring looks like on `Start run`. The runs dialog's PANEL-level ring is
  gone in code (D5), which is a rendering fact this set can show only because these
  frames are element clips: a ring on the panel would be inside the crop.
- **`Logs` / `Results` are absent on purpose.** The two artifact routes land in a
  follow-up release, the probe answers 404 in these stories, and the card draws the
  controls only when the server answers them.
- **No price and no cap anywhere**, because the API publishes neither: the only money
  on screen is the hold or charge the server reports.
- **One frame per state, in two palettes**, regardless of the locale tree: these are the
  English strings. Translation fit is the i18n audit's evidence, not this set's.
