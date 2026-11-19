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

**Round-2 remediation recapture (2026-11-18).** The whole set was taken again on the
round-2 head, in both palettes, because two changes reach every frame: the pinned
band below the list now carries its own ground instead of a heavier hairline (design
round 2, D1 part 3), and the sheet gained a bounded height with a scrolling body (UX
round 2, U10). Four frames are new: `sheet-narrow-420x400-*` (the sheet in a 420x400
window), `sheet-keyboard-focus-*` (the sheet after one Tab, so the focus ring is on
the first control INSIDE it), and the recaptured `sheet-open-after-pick-*`, which
remains the one frame driven end to end: chip press, then a real press on the
`Radient — ready` row, then the sheet that opens over the chat (UX round 1, U1).

**Round-3 remediation recapture (2026-11-19).** The sheet set was taken again in both
palettes, because three changes reach every one of its frames: the tier notice took the
rows' own `py-1.5` (design round 3, D10), the footer gained the `Separator` its scroll
edge was missing (D11), and the refusal and its remedy left the scrolling body for the
pinned region beside the primary (agent review round 3, MAJOR-1). Four frames are new:
`sheet-refused-420x400-*` and `sheet-refused-600x500-*`, each taken AFTER a real press on
`Start run` against a story bridge that answers the family's own refusal envelope - the
panel in the frame is the panel a refused press produces, with the refusal, its
`Add credits` remedy and the primary all inside the clip while the body is scrolled to
its very top. `sheet-open-after-pick-*` was re-driven through the pointer door (a real
press on the chip, then a real press on the `Radient - ready` row); it is the surface the
pointer-door focus measurement was taken on, and it is a still - a frame at rest cannot say
where the caret is. The claim itself is the DOM read taken in the same pass: after the press
the focused element is the sheet's own panel, one Tab lands on `View runs` inside it, and no
Tab reaches the page behind the modal (UX round 3, U6).

Measurements quoted in the PR are taken from these PNG files, not from the palette:
the band's ground against the panel's in each theme, the panel's height and its body's
scroll extent at 420x400, and `document.activeElement` after the row press.

Reproduce: `pnpm storybook` (port 6006), then drive
`/iframe.html?id=<story>&args=theme:<palette>;locale:en&viewMode=story` at the size in
the table below and screenshot the viewport.

## What each set shows

| Frames | State | What it shows |
|---|---|---|
| `row-flag-off-*` | A | The family's switch off (`{enabled:false}`): no group, no rule, today's picker |
| `row-checking-*` | loading | `checking…` while the read is outstanding - no spinner that implies presence |
| `row-signed-out-*` | B | `sign in to use`: an on-ramp, selectable, and it starts the sign-in |
| `row-ready-*` | C | The group NAMED (`Run on Radient`), `ready` in the status slot, the pinned sentence naming its own subject (design round 1, D1), and the pinned band BELOW a rule that is a ground, not a heavier hairline (design round 2, D1 part 3) |
| `row-running-*` | D | `1 run · 4m 13s · held $5.09`: the aggregate, from the server's `started_at` and `hold_usd` |
| `row-capacity-*` | E | `capacity unavailable · retry` on the row's REASON LINE, not in the status slot (D2) |
| `row-needs-network-*` | F | `needs a network` with the commands this app can name printed under it as MONO runs carrying their own quotes, not only in the accessible name (D2, U3, D6, U7) |
| `row-not-offered-*` | G | `not offered by this deployment` with its own quiet reason line and no hover ground |
| `sheet-open-after-pick-*` | — | The second level reached THROUGH the row: the sheet opens over the chat after a real press (U1 / Q-001) |
| `sheet-ready-*` | — | Network line as a statement on its own line (D3), `What kind of run` (D6), Cloud run live, Dedicated + Spot disabled in a quieter voice with the reason inline (D4), the one buyable tier stated rather than check-marked (round 1's D10), the tier notice on the rows' own rhythm (round 3's D10), the prompt summary, the directory, the submit, and the footer's own rule above it (round 3's D11) |
| `sheet-ambiguous-network-*` | — | Two networks and no default, the options marked as controls by their own resting ground (D4), the binding sentence naming its own subject (round 2, D2), and `Change` absent because there is nothing to change from (D7); the stand-down line under the actions |
| `sheet-no-prompt-*` | — | An empty composer: the prompt's slot says it is empty (round 2, D3), and the submit stands down with its own reason |
| `sheet-narrow-420x400-*` | — | The same sheet in a 420x400 window: capped to the window with a scrolling body, the title and `Start run` still reachable (round 2, U10), and a rule at the body's cut so the slice reads as a scroll rather than as corruption (round 3, D11). The body is 163px here, not round 2's 180: the footer's `Separator` and its gap are the 17px |
| `sheet-refused-420x400-*` | — | A pressed `Start run` the route refused, in a 420x400 window: the refusal and its `Add credits` remedy are PINNED above the primary (round 3, MAJOR-1) while the body is scrolled to its top, so the press visibly answers without the user finding anything |
| `sheet-refused-600x500-*` | — | The same refusal at the window's own floor (600x500), where the body is 160px against 380px of content - the size at which round 3's MAJOR-1 was raised |
| `sheet-keyboard-focus-*` | — | The sheet after ONE Tab: the ring is on `View runs`, inside the dialog, so the keyboard enters it (round 2, U6) |
| `card-running-*` | — | A run spending: status, elapsed from the server's start, the hold one ink step above the clock (D3), the binding sentence on its own line, Cancel |
| `card-finished-*` | — | Settled: the charge instead of the hold, Forget instead of Cancel |
| `card-failed-*` | — | The provider's failure state, `Failed` in `danger` rather than the banner's warning hue (D8) |
| `runs-populated-*` | — | The list: three rows, two live, Cancel only where a run can still spend, the facts separated by the same painted middots the card uses (round 2, D7), and NO panel-level accent ring (D5) |
| `runs-record-only-*` | — | Signed out: the banner says these are this device's last known rows |
| `runs-empty-*` | — | Nothing run yet |

## What these frames cannot claim

- **No live daemon.** Every frame answers from the story bridge. The real load, the
  refusal codes the route actually returns and the provider's own latency are QA's rig,
  not these stills. The two `sheet-refused-*` frames are the one place a refusal is
  DRAWN: the press is real and the envelope is this family's shape, but the sentence
  and the code in it are the story's, so they say where the refusal lands and nothing
  about what a given route will say.
- **No focus-dependent claim beyond the one frame that is about focus.**
  `sheet-keyboard-focus-*` is taken after a real Tab key, so its ring is the app's
  own `:focus-visible`; every other frame shows a surface at rest. A frame still
  cannot say what the ring looks like on `Start run` (no state here leaves it
  focused), and the runs dialog's PANEL-level ring is gone in code (D5), which is
  visible here only because these frames are element clips.
- **`Logs` / `Results` are absent on purpose.** The two artifact routes land in a
  follow-up release, the probe answers 404 in these stories, and the card draws the
  controls only when the server answers them.
- **No price and no cap anywhere**, because the API publishes neither: the only money
  on screen is the hold or charge the server reports.
- **One frame per state, in two palettes**, regardless of the locale tree: these are the
  English strings. Translation fit is the i18n audit's evidence, not this set's.
