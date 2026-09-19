# The pane in the app: opened by a press, with live requests, against an isolated backend

Fourteen frames from `scripts/renderer-driver.mjs`'s `browser-pane` scene — the
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
cd /tmp/bp-live-r4/lo-main       # git worktree of local-operator origin/main
LOCAL_OPERATOR_CONFIG_DIR=/tmp/bp-live-r4/backend/config \
LOCAL_OPERATOR_HOME=/tmp/bp-live-r4/backend/home \
LOCAL_OPERATOR_DESKTOP_TOKEN=<minted for this run, 0600> \
  ~/local-operator/.venv/bin/python -c "from local_operator.cli import main; main()" serve --port 7461

# 2. one conversation in its catalogue, so the chat route has a header at all
curl -X POST http://127.0.0.1:7461/v1/desktop/sessions \
  -H "Authorization: Bearer <the same token>" -H "Content-Type: application/json" \
  -d '{"request_id": "<uuid4>", "cwd": "/tmp/bp-live-r4/backend/home"}'   # -> session c62d98acf685

# 3. a build that points AT that backend (the URL is inlined at build time)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:7461 pnpm build

# 4. the scene
LOCAL_OPERATOR_DESKTOP_TOKEN=<the same token> node scripts/renderer-driver.mjs \
  --scene browser-pane --backend http://127.0.0.1:7461 \
  --backend-records /tmp/bp-live-r4/backend/config/run/serve --seed-onboarding-complete \
  --out /tmp/bp-live-r4/frames
```

Output, verbatim (`[PASS]` lines, with the run's own numbers where they are the
claim):

**THIS BLOCK IS THIS HEAD'S RUN, AND IT REPLACES THE PRE-RULING ONE** (review
round 2, D13, discharged). The block that stood here was the run taken before
`4ac08e9e5` raised the narrow ladder's rungs and before `fc5ff5c54` took the plus
out of the count chip, and it printed `whole 4, control null` for the pane's own
four-tab state — a reading no longer true of the tree. The transcript below and
the frames beside it were RE-TAKEN TOGETHER in one run on this head
(2026-09-17), so the two halves now describe the same run rather than a run and a
correction to it. What that changes, in the run's own numbers: the four-tab state
OVERFLOWS at the pane's own width (`whole 2` of four rows, the pinned control
reading `2`), the six-tab state's control reads `4` where the pre-ruling run
printed `+2`, and the route's strip control reads `3`. The rungs it measures are
the ones the D1 ruling accepted — every title keeps the 85px floor
(`narrowestTitle: 105` in all three states) — which is the check this head added
(`every title in the pane's own strip keeps the 85px floor`).

```
[PASS] the harness is driving the Electron this branch pins
        installed 44.3.0 at .../electron/dist/Electron.app/Contents/MacOS/Electron, pinned 44.3.0
[PASS] the scratch backend port is dead
        127.0.0.1:54212 listening=false
[PASS] the armed launch said so on stdout
        [dev-driver] ARMED; frames are written to /tmp/bp-live-r4/frames
[PASS] the app's logs went to this run's scratch tree, not the operator's
        [2026-09-17 05:09:47.779] [info]  Log path: /var/folders/qd/.../T/lo-renderer-driver-65895/logs
[PASS] the renderer was built against the backend this run started
        the renderer reports http://127.0.0.1:7461, --backend is http://127.0.0.1:7461 — build with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:7461
[PASS] the app holds a connection to this run's backend (http://127.0.0.1:7461)
        Electron 65900 ... 127.0.0.1:54271->127.0.0.1:7461 (ESTABLISHED)  (four sockets listed)
[PASS] the app holds NO connection to the operator's own backend (http://localhost:1111)
        no connection
[PASS] the renderer reports this run's frames directory
        /tmp/bp-live-r4/frames (expected /tmp/bp-live-r4/frames)
[PASS] with a backend the chat route renders its header, and the trigger with it
[PASS] the press opens the pane, in the store the slot reads
        browserPaneOpen=true after a press on the trigger
[PASS] the pane occupies the right slot
        {"x":740,"y":0,"width":640,"height":868}
[PASS] the pane takes its width OUT of the column rather than covering it: the slot ends at the window's right edge and the column keeps the rest
        slot {"x":740,"y":0,"width":640,"height":868} in a 1380px window
[PASS] the page area inside the pane is a real rectangle, not a zero-width one
        {"x":741,"y":118,"width":639,"height":750}
[PASS] the handover mounts one host: the route's surface is there and the pane's slot is gone
        {"route":{"x":220,"width":1160,"height":868},"content":{"x":220,"width":1160,"height":790},"paneSlot":null}
[PASS] and the page still has a rectangle after the handover
        {"x":220,"width":1160,"height":790}
[PASS] the pane is still open after the round trip, and its page has bounds again
        paneOpen=true content={"x":741,"width":639}
[PASS] three requests are live, two from this conversation and one from another
        (raised through the app's OWN loopback browser RPC: request_access with requester
         session:c62d98acf685 twice and session:other-conversation-live once. The log prints each
         result's origin, state, entry_id and broad scope as one block; abbreviated here, as the
         earlier revision of this block abbreviated it, because the claim is the COUNT and the
         requesters.)
[PASS] on This conversation the tray shows this conversation's two requests
        {"count":"2 approvals for this conversation","chips":["1","2"],"resolved":[],"side":"This conversation","badge":null}
[PASS] on All tabs the tray still shows this conversation's two requests, not the three the app holds
        {"scoped":{"count":"2 approvals for this conversation","chips":["1","2"],"resolved":[],"side":"This conversation","badge":null},"widened":{"count":"2 approvals for this conversation","chips":["1","2"],"resolved":[],"side":"All tabs","badge":null}}
[PASS] narrowing the switch does not report the other conversation's live request as withdrawn
        {"tray":{"count":"2 approvals for this conversation","chips":["1","2"],"resolved":[],"side":"This conversation","badge":null},"pending":["https://mine.example.com","https://mine-two.example.com","https://theirs.example.net"]}
[PASS] the track's ring PAINTS: a solid outline of the control role, on an element the primitive does not own
        {"style":"solid","width":"1px","color":"rgb(131, 124, 109)","listInline":"outline: none;","listStyle":"none"}
[PASS] and the primitive's own suppression stays on the LIST, where it is meant, rather than on the track
[PASS] the strip's height does not step when the first tab arrives (D9): at most 2px between the empty row and one tab
        {"empty":{"height":36,"rows":0},"oneTab":{"height":36,"rows":1}}
[PASS] and the empty strip is a real row rather than a collapsed one
        {"height":36,"rows":0}
[PASS] every title in the pane's own strip keeps the 85px floor the ruling was written for (D1)
        measured at the pane's own width: four titles, "New tab" at width 105 each
[PASS] four tabs overflow the pane's OWN width now, and the pinned control is what makes them reachable (D1's accepted cost)
        {"rows":4,"whole":2,"titles":[four at {"text":"New tab","width":105}],"narrowestTitle":105,"scroller":{"clientWidth":558,"scrollWidth":771},"control":{"text":"2","label":"All tabs, 2 not shown"}}
[PASS] past that, the pinned control appears and its own text is the count of tabs that are not shown
        {"six":{"rows":6,"whole":2,"narrowestTitle":105,"scroller":{"clientWidth":558,"scrollWidth":1157},"control":{"text":"4","label":"All tabs, 4 not shown"}},"control":{"text":"4","label":"All tabs, 4 not shown"}}
[PASS] and the count is the number the boxes say, not the tab count
        {"six":{...as above...},"offScreen":4}
[PASS] on the route the control is present exactly when a tab is off screen
        {"rows":7,"whole":3,"narrowestTitle":105,"scroller":{"clientWidth":1079,"scrollWidth":1639},"control":{"text":"3","label":"All tabs, 3 not shown"}}
[PASS] All tabs survives a conversation switch, so the pane does not make the user choose again
        {"before":"All tabs","after":"All tabs"}
[PASS] opening the pane from its own focused control leaves the caret on the document, which is the state the check below is about
        {"paneOpen":true,"tag":"BODY"}
[PASS] closing the pane puts the caret back on the control that opened it
        {"tag":"BUTTON","tour":"browser-pane-trigger","paneOpen":false}
[PASS] the badge counts this conversation's two requests while the app holds three
        badge 2 with 3 pending — this conversation raised two of the three
[PASS] a tab the user opens in a conversation is attributed to it, and the strip in that scope shows it (R1)
        conversation c62d98acf685; created {"tabId":8,"sessionId":"c62d98acf685","owner":"user"}; strip [2,3,4,5,6,7,8]
[PASS] and the control said where the tab would land
        aria-label "New tab in this conversation"
[PASS] no process from this run outlived its boot
        0 processes matching lo-renderer-driver-65895
ALL CHECKS PASSED
```

The same scene run WITHOUT `--backend` is the gate's half, and it passed too: the
chat route is then the offline surface, the trigger has no header to sit in, and
the run says so instead of photographing a spinner (not committed here because it
is a frame of a screen this feature does not change).

## What each frame shows

| Frame | What it shows, and the claim it carries |
|---|---|
| `browser-pane-open.png` | The press's result, in the app: a real conversation (this run's own backend session, `c62d98acf685`) with the browser pane open in the right slot. The pane's own geometry in this run — `{"slot":{"x":740,"width":640,"height":868},"content":{"x":741,"y":118,"width":639,"height":750},"window":{"width":1380,"height":868}}` — is the narrowing claim as two numbers: the slot is the window's right 640px and ends at its edge, the conversation keeps the 520px between the rail and the slot, and the page area inside the pane is 639x750 rather than zero. The chat header's cluster carries all three of the slot's controls |
| `browser-pane-scope-all.png` | The scope switch after a real press on `All tabs`: the same surface, the wider list — with this conversation's two requests in the tray above it, which is what §7.2 means by the switch choosing tabs and not demands |
| `browser-pane-dock.png` | The pane's dock, opened from the URL bar's Approvals control — the state §7.4 and D7 are about, at the pane's real width in the real app |
| `browser-pane-requests-scope-conversation.png` | The tray with the switch on `This conversation`: `2 approvals for this conversation`, two chips, nothing in the resolved list. The app holds THREE pending at this instant (one belongs to another conversation) |
| `browser-pane-requests-scope-all.png` | The same instant with the switch on `All tabs`: **the same two chips and the same sentence.** This is the frame QA round 1 (Q1) and UX round 1 (U1) could not get: before the fix this pair read `3 approvals for this conversation` with the third chip naming another conversation, and pressing back printed `Withdrawn by the agent` over a request that was still pending — the scene asserts the count, the chips, the resolved list and the app's own pending list at each step, in both directions |
| `browser-pane-strip-one.png` | One tab, and the same strip box as the frame before it: `{"empty":{"height":36,"rows":0},"oneTab":{"height":36,"rows":1}}` — a zero-pixel step where design round 2 (D9) measured 32 (the page's rect moved from `y 450 h 418` to `y 482 h 386`). The pair is also a story pair, `scope-empty` and `one-tab`, both captured at 640x460 with `reported content rect: 640x316 at 0,118` in each |
| `browser-pane-strip-four.png` | Four tabs of this conversation in the pane's own strip at its 640 default, and ON THIS HEAD THEY DO NOT FIT: the pinned control is drawn and its chip reads `2`, TWO of the four titles are whole, and the third row is clipped at its right edge with the fourth outside the scroller entirely — `{"rows":4,"whole":2,"narrowestTitle":105,"scroller":{"clientWidth":558,"scrollWidth":771},"control":{"text":"2","label":"All tabs, 2 not shown"}}`. The pre-ruling block this file used to carry printed `whole 4, control null` for this same state, because it was taken on the rungs before `4ac08e9e5` raised them; the count is what the measurement has always meant — a row lying half outside is counted as not shown — so the chip counts the clipped third row and the hidden fourth. D1's remainder, answered twice over: the state D1 filed is reachable at the pane's own width, and it now says so. The same run asserts the floor the ruling set, measuring every title at 105px against the 85px promise |
| `browser-pane-strip-overflow.png` | Two more tabs, the same six rows the transcript describes and a wider overflow: two rows are whole, the third is clipped, three are outside, and the chip reads `4` where the pre-ruling run printed `+2` — `{"rows":6,"whole":2,"narrowestTitle":105,"scroller":{"clientWidth":558,"scrollWidth":1157},"control":{"text":"4","label":"All tabs, 4 not shown"}}`. The number is the chip's own text with the count it counts — rows whose boxes are not fully inside the scroller, not the tab count — and it carries no plus. Its accessible name on this head is `All tabs, N not shown` (design round 2, D10): the frames can carry the number, not the sentence, which is why the sentence is asserted in the scene and in `browser-chrome.test.mjs` rather than read off a picture |
| `browser-pane-lens-after-switch.png` | `All tabs` after a conversation switch and back (UX round 1, U3): the pane stays open, its content follows the session, and the lens the user chose is still chosen — the reason it lives in the window's slot state rather than in the pane |
| `browser-pane-closed-focus.png` | The pane closed by its own control, with the caret back on the header's Globe (UX round 1, U2). The scene walks the state that loses it first — the trigger given real focus, the pane opened from there, `document.activeElement` left on `<body>` — and asserts that lost state before it asserts the return |
| `browser-route-strip.png` | The route's own strip with the same tabs: the control is present here too, because at this window the route cannot hold them all either. The claim is the invariant the scene asserts on both hosts — the control is on screen exactly when a tab is not. This run's reading at the route's own width: seven rows, three whole, `{"narrowestTitle":105,"scroller":{"clientWidth":1079,"scrollWidth":1639},"control":{"text":"3","label":"All tabs, 3 not shown"}}` |
| `browser-pane-handover-route.png` | The host handover, first half: navigating to `/browser` with the pane open mounts the ROUTE's surface and unmounts the pane — one host, one rectangle reporter (the pane's slot tag is absent from the document, and the route's own geometry in this run is `{"route":{"x":220,"width":1160,"height":868},"content":{"x":220,"width":1160,"height":790},"paneSlot":null}`) |
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
- **The scope switch's ring, measured as PIXELS here rather than as a computed style.** The live scene asserts the computed `outline: solid 1px` of the control role on the wrapper the ring is drawn on; the pixel count is the story frames' own, in the sibling set: the switch's box holds 18px (dark) / 35px (light) of the control colour BEFORE the fix and 220px / 284px after, with the top and bottom edges of the ring at ~118px each - calibrated against the same colour's full-width rule in the same frame, which paints 638px of a 640px frame.
- **The pane's error and paused states.** They are the surface's own, shared with
  the route and photographed in `../browser-pane/`; nothing in this run can make
  the pane's own page fail.
