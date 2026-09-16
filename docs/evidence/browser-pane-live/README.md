# The pane in the app: opened by a press, with live requests, against an isolated backend

Twelve frames from `scripts/renderer-driver.mjs`'s `browser-pane` scene — the
scene §10.3 of `docs/design/browser-approval-ux.md` names — photographed through
the app's own `capturePage()` in the headless window mode, with the pane opened
by a hit-tested press on the chat header's Globe trigger.

Where the sibling set (`../browser-pane/`) is Storybook and stubs the desktop
bridge, THIS set is the app: a real Electron renderer, a real backend, real IPC,
and the pane mounted in the chat's right slot by the product's own store. What it
cannot show is a page inside the pane's rectangle — the `WebContentsView` is a
native view, so the same limit applies in both sets — and an agent's own decision
to browse. See *What is not here*.

## The run, exactly

The backend is one this run owns: a scratch config dir, a scratch token, its own
port, and a worktree of the Python repo's `origin/main` (the daemon that publishes
the `run/serve` rendezvous record the app's discovery requires):

```
# 1. the isolated backend, on a port this run picked and verified free
cd /tmp/bp-live-r1/lo-main       # git worktree of local-operator origin/main
LOCAL_OPERATOR_CONFIG_DIR=/tmp/bp-live-r1/backend/config \
LOCAL_OPERATOR_HOME=/tmp/bp-live-r1/backend/home \
LOCAL_OPERATOR_DESKTOP_TOKEN=<minted for this run, 0600> \
  ~/local-operator/.venv/bin/python -c "from local_operator.cli import main; main()" serve --port 7461

# 2. one conversation in its catalogue, so the chat route has a header at all
curl -X POST http://127.0.0.1:7461/v1/desktop/sessions \
  -H "Authorization: Bearer <the same token>" -H "Content-Type: application/json" \
  -d '{"request_id": "<uuid4>", "cwd": "/tmp/bp-live-r1/backend/home"}'   # -> session 3d282c4e9686

# 3. a build that points AT that backend (the URL is inlined at build time)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:7461 pnpm build

# 4. the scene
LOCAL_OPERATOR_DESKTOP_TOKEN=<the same token> node scripts/renderer-driver.mjs \
  --scene browser-pane --backend http://127.0.0.1:7461 \
  --backend-records /tmp/bp-live-r1/backend/config/run/serve --seed-onboarding-complete \
  --out /tmp/bp-live-r1/frames
```

Output, verbatim (`[PASS]` lines, with the run's own numbers where they are the
claim):

```
[PASS] the app holds a connection to this run's backend (http://127.0.0.1:7461)
[PASS] the app holds NO connection to the operator's own backend (http://localhost:1111)
[PASS] with a backend the chat route renders its header, and the trigger with it
[PASS] the press opens the pane, in the store the slot reads
[PASS] the pane occupies the right slot
        {"x":740,"y":0,"width":640,"height":868}
[PASS] the pane takes its width OUT of the column rather than covering it: the slot ends at
        the window's right edge and the column keeps the rest
[PASS] the page area inside the pane is a real rectangle, not a zero-width one
        {"x":741,"y":86,"width":639,"height":782}
[PASS] the handover mounts one host: the route's surface is there and the pane's slot is gone
        {"route":{"x":220,"width":1160,"height":868},"content":{"x":220,"width":1160,"height":791},"paneSlot":null}
[PASS] and the page still has a rectangle after the handover
[PASS] the pane is still open after the round trip, and its page has bounds again
[PASS] three requests are live, two from this conversation and one from another
        (raised through the app's OWN loopback browser RPC: request_access with requester
         session:3d282c4e9686 twice and session:other-conversation-live once)
[PASS] on This conversation the tray shows this conversation's two requests
        {"count":"2 approvals for this conversation","chips":["1","2"],"resolved":[]}
[PASS] on All tabs the tray still shows this conversation's two requests, not the three the
        app holds
[PASS] narrowing the switch does not report the other conversation's live request as withdrawn
        {"resolved":[],"pending":["https://mine.example.com","https://mine-two.example.com","https://theirs.example.net"]}
[PASS] four tabs fit the pane's own width WHOLE, so the state D1 filed is not reachable there
        {"rows":4,"whole":4,"scroller":{"clientWidth":595,"scrollWidth":595},"control":null}
[PASS] past that, the pinned control appears and its own text is the count of tabs that are not shown
        {"rows":6,"whole":4,"scroller":{"clientWidth":567,"scrollWidth":797},"control":{"text":"+2","label":"All tabs, 2 not shown"}}
[PASS] and the count is the number the boxes say, not the tab count
        {"rows":6,"whole":4,"offScreen":2}
[PASS] on the route the control is present exactly when a tab is off screen
[PASS] All tabs survives a conversation switch, so the pane does not make the user choose again
        {"before":"All tabs","after":"All tabs"}
[PASS] opening the pane from its own focused control leaves the caret on the document, which is
        the state the check below is about
        {"paneOpen":true,"tag":"BODY"}
[PASS] closing the pane puts the caret back on the control that opened it
        {"tag":"BUTTON","tour":"browser-pane-trigger","paneOpen":false}
[PASS] the badge counts this conversation's two requests while the app holds three
        badge 2 with 3 pending
[PASS] no process from this run outlived its boot
ALL CHECKS PASSED
```

The same scene run WITHOUT `--backend` is the gate's half, and it passed too: the
chat route is then the offline surface, the trigger has no header to sit in, and
the run says so instead of photographing a spinner (not committed here because it
is a frame of a screen this feature does not change).

## What each frame shows

| Frame | What it shows, and the claim it carries |
|---|---|
| `browser-pane-open.png` | The press's result, in the app: a real conversation (this run's own backend session, `3d282c4e9686`) with the browser pane open in the right slot. The pane's own geometry in this run — `{"slot":{"x":740,"width":640,"height":868},"content":{"x":741,"y":86,"width":639,"height":782},"window":{"width":1380,"height":868}}` — is the narrowing claim as two numbers: the slot is the window's right 640px and ends at its edge, the conversation keeps the 520px between the rail and the slot, and the page area inside the pane is 639x782 rather than zero. The chat header's cluster carries all three of the slot's controls |
| `browser-pane-scope-all.png` | The scope switch after a real press on `All tabs`: the same surface, the wider list — with this conversation's two requests in the tray above it, which is what §7.2 means by the switch choosing tabs and not demands |
| `browser-pane-dock.png` | The pane's dock, opened from the URL bar's Approvals control — the state §7.4 and D7 are about, at the pane's real width in the real app |
| `browser-pane-requests-scope-conversation.png` | The tray with the switch on `This conversation`: `2 approvals for this conversation`, two chips, nothing in the resolved list. The app holds THREE pending at this instant (one belongs to another conversation) |
| `browser-pane-requests-scope-all.png` | The same instant with the switch on `All tabs`: **the same two chips and the same sentence.** This is the frame QA round 1 (Q1) and UX round 1 (U1) could not get: before the fix this pair read `3 approvals for this conversation` with the third chip naming another conversation, and pressing back printed `Withdrawn by the agent` over a request that was still pending — the scene asserts the count, the chips, the resolved list and the app's own pending list at each step, in both directions |
| `browser-pane-strip-four.png` | Four tabs of this conversation in the pane's own strip at its 640 default: `rows 4, whole 4`, `clientWidth 595 = scrollWidth 595`, **no pinned control** — D1's remainder, which was that a whole tab was off screen here with nothing saying so |
| `browser-pane-strip-overflow.png` | Two more tabs, and the honest half: `rows 6, whole 4`, `clientWidth 567, scrollWidth 797`, and the pinned control reading `+2` with the label `All tabs, 2 not shown` — the count is the number of rows whose boxes are not inside the scroller, not the tab count |
| `browser-pane-lens-after-switch.png` | `All tabs` after a conversation switch and back (UX round 1, U3): the pane stays open, its content follows the session, and the lens the user chose is still chosen — the reason it lives in the window's slot state rather than in the pane |
| `browser-pane-closed-focus.png` | The pane closed by its own control, with the caret back on the header's Globe (UX round 1, U2). The scene walks the state that loses it first — the trigger given real focus, the pane opened from there, `document.activeElement` left on `<body>` — and asserts that lost state before it asserts the return |
| `browser-route-strip.png` | The route's own strip with the same tabs: the control is present here too, because at this window the route cannot hold them all either. The claim is the invariant the scene asserts on both hosts — the control is on screen exactly when a tab is not |
| `browser-pane-handover-route.png` | The host handover, first half: navigating to `/browser` with the pane open mounts the ROUTE's surface and unmounts the pane — one host, one rectangle reporter (the pane's slot tag is absent from the document, and the route's own geometry in this run is `{"route":{"x":220,"width":1160},"content":{"x":220,"width":1160},"paneSlot":null}`) |
| `browser-pane-handover-back.png` | The handover's other half: back to `/chat`, the pane is still open (the slot belongs to the window) and its page area has bounds again. This is the direction where a stale null rectangle from the unmounting host would leave the page invisible on a surface that looks correctly laid out |

## What is not here

- **An agent's own turn, and the Python `browser` tool's path from the daemon to
  the host.** A real agent turn needs a provider credential and a model; what this
  run drives instead is the intake the tool uses — the app's own loopback browser
  RPC (`<config>/run/ui-browser/host.json`, the same envelope and `x-bridge-key`
  the Python session client sends) — so the tabs, the requests, the badge and the
  tray are the product's own code paths with only the DECISION synthesised. The
  requester of the second conversation is a name (`session:other-conversation-live`)
  rather than a second live session; the approval store keys on that string, which
  is the field the tray reads.
- **The pane's page.** No frame in either set can contain it (a native view is not
  in the renderer's pixels); the frames that do contain a real page are
  `../browser-composition/` for the route.
- **The pane's error and paused states.** They are the surface's own, shared with
  the route and photographed in `../browser-pane/`; nothing in this run can make
  the pane's own page fail.
