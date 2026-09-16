# The conversation-scoped browser pane

Eleven stories of the pane and its header trigger, in `localOperatorDark` and
`localOperatorLight` — 22 frames from `scripts/capture-evidence.mjs`, the same
tool the rest of this directory comes from.

Source, exactly:

```
pnpm build-storybook
npx http-server storybook-static -p 6031 --silent
node scripts/capture-evidence.mjs http://localhost:6031 \
  --only=browser-pane --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--only` puts the run in append mode, so this set was added beside the committed
one instead of sweeping it; `manifest.json`'s `partialCapture` records that, and
`themes`/`surfaces`/`frames` in the same file are the full-set values the
capturer re-derived. The run says in its own output which head it photographed:
`Captured 22 frames ... at a0c25d3b6`.

## What these frames ARE, and what they are NOT

They are the real components. Every frame renders the shipped `BrowserPane` →
`BrowserSurface`, which means the real `useBrowserChrome`, the real
`ResizeObserver` rect reporter, the real strip, tray, dock and empty states, and
the real scope switch. The caption under each frame is the rectangle the
PRODUCT'S OWN `measure()` reported for the box the frame shows — read off the
stub's `setContentRect` calls, not typed into the story — so each frame carries
its own geometry: the pane reports 640x265..640x320 where the route reports
1240x402, which is the layout claim of this feature as a measurement.

They are NOT a picture of the page. A `WebContentsView` is a native view in the
main process; it cannot appear in a preview iframe, so the area below the URL bar
is the rectangle the page would occupy and nothing more. The frames that DO
contain a real page are the route's, from `scripts/browser-chrome-proof.mjs`.

**They also stub the desktop bridge, and no other browser story does.** The pane
is the first surface in this feature whose states cannot be expressed as props: it
renders `BrowserSurface`, whose only input is the host's projection read through
`window.api.browser`, and without an answer to that bridge every story here would
render "The browser is only available in the desktop app." The alternative — a
live capture — is not available either: the pane lives in the chat route, and that
route is gated on the backend's `session_catalogue` capability, so a backend-less
evidence run never renders the chat header the pane opens from (the driver's own
`chat-dark.png` in `docs/evidence/renderer-driver/` is that screen: "Connecting to
the backend…"). So the fixture is a PROJECTION — the same object main publishes,
of the same shape the contract tests drive — installed before the story renders,
exactly as `scripts/browser-chrome.test.mjs` installs one. The two consequences are
that the copy, the grammar, the states and the rectangle are evidence here, and
that nothing about the pane's live behaviour is.

`--allow-backend` is set because the operator's own daemon is answering on 1111 on
this machine; these stories render from a fixture and no frame in this set talks
to it — the story replaces `window.api` with the stub before the surface mounts.

## The matrix

| Frame | What it shows, and the claim it carries |
|---|---|
| `this-conversation/` | This conversation's two tabs — an agent tab (marked `Agent`, parked, loading) and a user tab handed over (`Shared`) — under the `This conversation` scope, which is what the pane opens on (7.2's default) |
| `all-tabs/` | The same projection after a REAL press on `All tabs`: the other conversation's tab and the restored one appear, and the tray's sentence is unchanged — the switch chooses tabs, not demands (7.2) |
| `scope-empty/` | The scope-empty state: no tab of this conversation is open while three exist, so the copy says so and offers `Show all tabs` rather than "No tabs are open." (7.2) |
| `show-all-tabs/` | `Show all tabs` pressed for real: the way out of the empty state goes somewhere (the two other tabs appear, and the page area says no tab is selected) |
| `one-tab/` | The one-tab state (7.4). Judged in this frame and left unchanged: the lone tab is 20rem wide — the ACTIVE agent row's floor, `min-w-80` — not the 50%-of-strip cap, which at 640 would be wider. What sits to its right is the strip's own `sunken` band with the same bottom rule, so it reads as a strip holding one tab rather than a broken run of cells. A tab sized to its content instead of to the floor is a change to `browser-tab-strip.tsx`'s width policy — a PR 1 surface, reviewed as its own design round — so it is reported and not made here |
| `with-approval/` | A live request for THIS conversation and a live request for another one, in the same projection: the tray's card and its `for this conversation` wording, and the Approvals badge reading **1** while the other conversation's request is live |
| `narrow-minimum/` | The pane at the divider's 480px floor (`chat-content.tsx`'s `minWidth`): the switch, the title and the close all still fit on the header's one line, and the empty state wraps to two |
| `route-for-comparison/` | The OTHER host over the SAME projection, at 1240: four tabs, `3 approvals waiting` with three numbered chips, badge **3**. Spec 7.2's "same component, same model, different input", as two frames with two numbers |
| `trigger-no-approval/`, `trigger-one-approval/`, `trigger-three-approvals/` | The chat header's Globe trigger with no badge, one, and three (5.1's grammar at the count that reaches two digits' worth of width). Captured because the badge's corner offset is a judgement about an ICON control, where unlike the URL bar's labelled control nothing is reserved for it: the first capture of these three showed the badge sitting across the Globe's own corner, and the offset moved outward in response |

## What is not here

- **The pane in a live app.** It needs a backend: the chat route's header (and so
  the trigger the pane opens from) renders only with the `session_catalogue`
  capability, which a backend-less launch does not have. What would settle it: a
  `renderer-driver.mjs --scene browser-pane` run with `--backend <url>`, a
  `LOCAL_OPERATOR_DESKTOP_TOKEN`, a build made with
  `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port>`, and at least one session
  in that backend's catalogue. That rig is named in the PR's "not verified"
  section rather than pointed at the operator's own daemon.
- **The page inside the pane**, which no Storybook frame can hold: see the route
  frames in `docs/evidence/browser-composition/`, and the harness that composes
  them (`scripts/browser-chrome-proof.mjs`).
- **The themes between the two captured ones.** Two per story is this repository's
  narrowed-run convention (the light palettes first, where contrast defects hide);
  a full sweep is the release-time job, and `manifest.json` says this set is a
  narrowed run rather than implying a swept one.
