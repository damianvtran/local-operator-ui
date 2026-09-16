# The pane in the app, opened by a press, against an isolated backend

Five frames from `scripts/renderer-driver.mjs`'s `browser-pane` scene — the scene
§10.3 of `docs/design/browser-approval-ux.md` names — photographed through the
app's own `capturePage()` in the headless window mode, with the pane opened by a
hit-tested press on the chat header's Globe trigger.

Where the sibling set (`../browser-pane/`) is Storybook and stubs the desktop
bridge, THIS set is the app: a real Electron renderer, a real backend, real IPC,
and the pane mounted in the chat's right slot by the product's own store. What it
cannot show is a page inside the pane's rectangle (the `WebContentsView` is a
native view, so the same limit applies in both sets) and the badge or the dock
with live requests, because nothing in this run's backend is an agent asking for
an approval — see *What is not here*.

## The run, exactly

The backend is one this run owns: a scratch config dir, a scratch token, its own
port, and a worktree of the Python repo's `origin/main` (the daemon that publishes
the `run/serve` rendezvous record the app's discovery requires):

```
# 1. the isolated backend, on a port this run picked and verified free
cd /tmp/lo-serve-main            # git worktree of local-operator origin/main
LOCAL_OPERATOR_CONFIG_DIR=/tmp/bp-backend/config \
LOCAL_OPERATOR_HOME=/tmp/bp-backend/home \
LOCAL_OPERATOR_DESKTOP_TOKEN=<minted for this run> \
  ~/local-operator/.venv/bin/python -c "from local_operator.cli import main; main()" serve --port 7391

# 2. one conversation in its catalogue, so the chat route has a header at all
curl -X POST http://127.0.0.1:7391/v1/desktop/sessions \
  -H "Authorization: Bearer <the same token>" -H "Content-Type: application/json" \
  -d '{"request_id": "<uuid4>", "cwd": "/tmp/bp-backend/home"}'

# 3. a build that points AT that backend (the URL is inlined at build time)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:7391 pnpm build

# 4. the scene
LOCAL_OPERATOR_DESKTOP_TOKEN=<the same token> node scripts/renderer-driver.mjs \
  --scene browser-pane --backend http://127.0.0.1:7391 \
  --backend-records /tmp/bp-backend/config/run/serve --seed-onboarding-complete \
  --out /tmp/bp-driver-live --clean
```

Output, verbatim (`[PASS]` lines):

```
[PASS] the renderer was built against the backend this run started
[PASS] the app holds a connection to this run's backend (http://127.0.0.1:7391)
[PASS] the app holds NO connection to the operator's own backend (http://localhost:1111)
[PASS] with a backend the chat route renders its header, and the trigger with it
[PASS] the press opens the pane, in the store the slot reads
[PASS] the pane occupies the right slot
[PASS] the pane takes its width OUT of the column rather than covering it: the slot ends at
        the window's right edge and the column keeps the rest
[PASS] the page area inside the pane is a real rectangle, not a zero-width one
[PASS] the handover mounts one host: the route's surface is there and the pane's slot is gone
[PASS] and the page still has a rectangle after the handover
[PASS] the pane is still open after the round trip, and its page has bounds again
[PASS] no process from this run outlived its boot
frames: browser-pane-dock.png, browser-pane-handover-back.png, browser-pane-handover-route.png,
        browser-pane-open.png, browser-pane-scope-all.png
ALL CHECKS PASSED
```

The same scene run WITHOUT `--backend` is the gate's half, and it passed too: the
chat route is then the offline surface, the trigger has no header to sit in, and
the run says so instead of photographing a spinner
(`/tmp/bp-driver/browser-pane-gated.png` in that run; not committed here because
it is a frame of a screen this feature does not change).

## What each frame shows

| Frame | What it shows, and the claim it carries |
|---|---|
| `browser-pane-open.png` | The press's result, in the app: a real conversation (this run's own backend session, `72a33e699874`) with the browser pane open in the right slot. The pane's own geometry in this run — `{"slot":{"x":740,"width":640,"height":868},"content":{"x":741,"y":118,"width":639,"height":750},"window":{"width":1380,"height":868}}` — is the narrowing claim as two numbers: the slot is the window's right 640px and ends at its edge, the conversation keeps the 520px between the rail and the slot, and the page area inside the pane is 639x750 rather than zero. The chat header's cluster carries all three of the slot's controls. The pane is on `This conversation` and shows its scope-empty state — no tab of this conversation is open, and the one tab that exists in the browser (visible in `browser-pane-handover-route.png`) is unattributed, so it belongs to no conversation and appears only under All tabs |
| `browser-pane-scope-all.png` | The scope switch after a real press on `All tabs`: the same surface, the wider list |
| `browser-pane-dock.png` | The pane's dock, opened from the URL bar's Approvals control — the state §7.4 and D7 are about, at the pane's real width in the real app |
| `browser-pane-handover-route.png` | The host handover, first half: navigating to `/browser` with the pane open mounts the ROUTE's surface and unmounts the pane — one host, one rectangle reporter (the pane's slot tag is absent from the document, which the scene asserts, and the route's own geometry in this run is `{"route":{"x":220,"width":1160},"content":{"x":220,"width":1160},"paneSlot":null}`). The route's own tab strip and URL bar are here, and the page area is the full 1160px |
| `browser-pane-handover-back.png` | The handover's other half: back to `/chat`, the pane is still open (the slot belongs to the window) and its page area has bounds again. This is the direction where a stale null rectangle from the unmounting host would leave the page invisible on a surface that looks correctly laid out |

## What is not here

- **A tab, a request, and the badge with a count, in a live conversation.** All
  three need an agent to have opened a tab and raised an approval, and this run's
  backend has no agent and no model: the isolated daemon is real, the session is
  real, the panes are real, but nothing in it browses. The states themselves are
  in the sibling `../browser-pane/` set (and in PR 1's `../browser-composition/`),
  on the same components, with the fixture as the only difference. A run that
  would close it: an isolated backend with a provider credential and one agent
  turn that calls the browser tool.
- **The pane's page.** No frame in either set can contain it (a native view is not
  in the renderer's pixels); the frames that do contain a real page are
  `../browser-composition/` for the route.
