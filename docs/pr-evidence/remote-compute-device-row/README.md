# Remote compute in the chat's device picker — GUI v1 frames

Every frame is a Storybook story from `src/renderer/src/features/remote-compute/remote-compute.stories.tsx`,
captured in a private headless Chrome over raw CDP (mock keychain, pinned evidence
timezone, `deviceScaleFactor: 1`), in `localOperatorDark` (`-dark`) and
`localOperatorLight` (`-light`). The components are the shipped ones: the header is
`ChatHeader`, the control is `ChatDeviceSlot`, and the Radient group is
`RemoteComputePicker` reading `remote_compute.read` over the story bridge. The
invented part is the wire DATA, whose field names are the API's.

The picker frames are opened by a real pointer press on the chip (`Input.dispatchMouseEvent`
at the chip's rect), because Radix's trigger opens on pointerdown and the header owns
that state; the sheet, card and list frames pass the same wire-shaped values the
picker would, to components that are themselves the shipped ones.

Reproduce: `pnpm storybook` (port 6006), then drive
`/iframe.html?id=<story>&args=theme:<palette>;locale:en&viewMode=story` at the size in
the table below and screenshot the viewport.

## What each set shows

| Frames | State | What it shows |
|---|---|---|
| `row-flag-off-*` | A | The family's switch off (`{enabled:false}`): no group, no rule, today's picker |
| `row-checking-*` | loading | `checking…` while the read is outstanding - no spinner that implies presence |
| `row-signed-out-*` | B | `sign in to use`: an on-ramp, selectable, and it starts the sign-in |
| `row-ready-*` | C | `ready`: readiness and nothing else - no price, no countdown |
| `row-running-*` | D | `1 run · 4m 13s · held $5.09`: the aggregate, from the server's `started_at` and `hold_usd` |
| `row-capacity-*` | E | `capacity unavailable · retry`: capacity, not "offline" |
| `row-needs-network-*` | F | `needs a network · create one`: no binding, so the row cannot start a run |
| `row-not-offered-*` | G | `not offered by this deployment`: the deployment's switch, drawn disabled with its reason |
| `sheet-ready-*` | — | Network line as a statement, Cloud run live, Dedicated + Spot disabled, the prompt summary, the directory, the submit |
| `sheet-ambiguous-network-*` | — | Two networks and no default: both tiers stand down, `choose a network` on the row, the stand-down line under the actions |
| `sheet-no-prompt-*` | — | An empty composer: the submit stands down with its own reason |
| `card-running-*` | — | A run spending: status, elapsed from the server's start, the hold, the binding line, Cancel |
| `card-finished-*` | — | Settled: the charge instead of the hold, Forget instead of Cancel |
| `card-failed-*` | — | The provider's failure state |
| `runs-populated-*` | — | The list: three rows, two live, Cancel only where a run can still spend |
| `runs-record-only-*` | — | Signed out: the banner says these are this device's last known rows |
| `runs-empty-*` | — | Nothing run yet |

## What these frames cannot claim

- **No live daemon.** Every frame is presentational and answers from the story
  bridge. The real load, refusal codes (`run_limit`, `insufficient_credits`, …) and
  the provider's own latency are QA's rig, not these stills.
- **No focus-dependent claim.** The capture runs with focus emulation on, and both
  dialogs take the focus themselves rather than a control; a frame therefore does
  not show what a focus ring looks like on `Start run`.
- **`Logs` / `Results` are absent on purpose.** The two artifact routes land in a
  follow-up release, the probe answers 404 in these stories, and the card draws the
  controls only when the server answers them.
- **No price and no cap anywhere**, because the API publishes neither: the only money
  on screen is the hold or charge the server reports.
