# The wakes cancel, on the real path

The Storybook set next door (`docs/evidence/chat-run-panel/`) photographs the
Wakes section's states. This set is the half a still cannot carry: the app's own
`webContents.capturePage()` while a **real press** fires a **real request** at a
daemon this run owns, with the wire side read back from that daemon's access log
and the canonical re-read's churn recorded as a trace.

Every frame here comes from the built app in `--window-mode=headless`, driven
through the dev-driver bridge (`docs/agent-driver.md`) — the same mechanism
`scripts/renderer-driver.mjs` uses. No Playwright, no Puppeteer, no downloaded
Chromium, no `screencapture` (which would need the focus theft the window modes
exist to remove). One Chrome/Electron launch per scenario, reaped by process
group, and every launch carries the mock-keychain switch
(`scripts/chrome-keychain.mjs`; a process under a scratch `HOME` has no login
keychain and macOS would otherwise ask the operator to create one).

## The harness

`harness/wake-cancel-rig.mjs` — a self-contained rig; it launches nothing but
the app and speaks only the repo's documented surfaces. Its own scratch
(`HOME`, `LOCAL_OPERATOR_CONFIG_DIR`, `LOCAL_OPERATOR_LOG_DIR`,
`--user-data-dir`, the app's cwd) is a fresh `mkdtemp` per run, and it strips
`CMUX_*`/`LOP_*`/`XPC_FLAGS` from the child.

`harness/relay.mjs` — the capture relay: a loopback proxy (the app talks to
`127.0.0.1:8080`; the daemon listens on `127.0.0.1:8081`) that can HOLD one
response still. Its knobs are read per request from a small JSON file:
`deleteDelayMs` holds the DELETE's answer (this is what keeps the one-press
write's `Cancelling…` window open long enough for a shutter), `eventsDelayMs`
and `desktopEventsDelayMs` hold the two canonical re-reads the receipt mark was
hoped to outlive (see the limits below for why that did not work), and
`listDelayMs` holds the Schedules page's listing. Every forwarded request is
appended to its `--log` as one `METHOD path -> status` line; that log is where
the frames' wire claims are read from.

Scenarios: `rest` (the section at rest + hover), `cancel` (the one-press write,
its in-flight verb and the dropped row), `refusal` (a stale row cancelled out of
band, then the pane's press — see the limits below), `live-refusal`, `aida` (her
conversation: the engine row's managed state, the named confirmation, Keep, the
cancel), `before` (the pre-change tree: the section as it reads without the
control), and `probe-cancel` (an instrument check, not a state of the product:
it validates the page-side sampler against direct reads and records the
press's DOM timeline).

## Running it

The daemon this run owns (never `:1111`, the operator's own). It listens on
`:8081` because the relay owns the port the app is built for:

```sh
ISO=~/workspace/wake-cancel-iso                       # any scratch root
TOKEN=$(openssl rand -hex 16)
mkdir -p "$ISO/home/.local-operator" "$ISO/logs"
cat > "$ISO/home/.local-operator/config.yml" <<'EOF'
values:
  hosting: test
  model_name: mock-model
EOF
export HOME="$ISO/home" LOCAL_OPERATOR_CONFIG_DIR="$ISO/home/.local-operator" \
       LOCAL_OPERATOR_LOG_DIR="$ISO/logs" LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN"
env -u XPC_FLAGS local-operator serve --host 127.0.0.1 --port 8081 \
    --hosting test --model mock-model --debug > "$ISO/logs/daemon.log" 2>&1 &
```

`--debug` is what writes the uvicorn access lines — the DELETE and its status
are the wire half of every frame below.

The conversation and its wakes:

```sh
# A cold conversation, created and armed by the same request.
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"request_id":"'"$(uuidgen | tr 'A-Z' 'a-z')"'","cwd":"'"$ISO"'/session-cwd",
       "message":"Check the 09:00 deploy finished","in":"3d"}' \
  http://127.0.0.1:8080/v1/desktop/wakes
# then a second one on the same session, for the refusal scenario's stale row.
```

The request id must be a lowercase uuid: the route's `RequestID` pattern refuses
the uppercase spelling `uuidgen` prints on macOS with a 422 ("The request has
invalid fields.") before any handler — measured here while re-arming for this
round's captures.

The app, built against that daemon and driven (the relay in front):

```sh
cd ~/local-operator-ui-worktrees/wake-cancel-pane
env PATH="$HOME/.nvm/versions/node/v22.13.1/bin:$PATH" \
    VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
    LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm build
node docs/evidence/wake-cancel-live/harness/relay.mjs \
  --listen 8080 --target 8081 --control "$ISO/relay.json" --log "$ISO/relay.log" &
echo '{"listDelayMs":0,"deleteDelayMs":1200,"eventsDelayMs":2500}' > "$ISO/relay.json"
env LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  node docs/evidence/wake-cancel-live/harness/wake-cancel-rig.mjs \
  --scenario cancel --tree "$PWD" \
  --out "$PWD/docs/evidence/wake-cancel-live/frames" \
  --api http://127.0.0.1:8080 --session <session> --wake w2 \
  --daemon-log "$ISO/logs/daemon.log" \
  --relay-control "$ISO/relay.json" --relay-log "$ISO/relay.log" --port 9473
```

`pnpm build` needs Node 22 (`.nvmrc`); the host's default is newer and the
bytecode step fails there on this fleet's shared `node_modules` (its babel
plugins are not linked), which is why the rig's own builds set
`LOCAL_OPERATOR_UI_NO_BYTECODE=true` — the repo's documented npm-path switch.
`LOCAL_OPERATOR_DESKTOP_TOKEN` in the rig's environment is what the app under
test authenticates with; without it every read is a 401 and the wake chip never
appears.

## The frames

| Frame | What it shows |
|---|---|
| `pane-at-rest.png` | The Wakes section on a real conversation: two rows, each carrying `Cancel` at rest, and NO storage sentence (`retiredFooter: false` in `run-facts-rest.json`). The pair of this is `frames-before/pane-before-no-control.png`, the same conversation on the pre-change tree. |
| `pane-hover.png` | The same section with the real pointer over `w2`'s control (CDP `Input.dispatchMouseEvent`, `:hover` asserted true before the shutter). |
| `cancel-before.png` | The press's starting state. |
| `cancel-writing.png` | The one-press write IN FLIGHT: the control reads `Cancelling…`, disabled. The relay held the DELETE's answer 1.2 s for this frame; the request itself reached the daemon at once (its 200 is in the wire block below). |
| `cancel-gone.png` | After the canonical re-read: the row is gone (`row dropped by the re-read: {gone: true}` in `run-facts-cancel.json`). The run's 80 ms samples (`churn trace`) already show the post-drop list held flat — the drop itself outruns the sampler, which is the same measurement the limits below record; the DELETE's own 200 is the wire block. |
| `aida-managed.png` | Her conversation: the operator's own `w1` ("4-hourly proactive check-in (operator-set cadence)") carries `Cancel`; the engine's `aida-cadence` row carries `managed by Aida`, NO control (asserted: `controlPresent: false`), and the sentence that names the lever — `This wake is Aida's own schedule, so it can't be cancelled here. To stop these check-ins, use /aida pause.` — drawn VISIBLY as the row's note (design round 1's D2). |
| `aida-confirm.png` | Pressing `w1`'s control on her conversation opens the card NAMING her: `Cancel Aida's check-in?` / "will not fire again, and nothing re-creates it. Aida's own cadence is unaffected." / `Keep` / `Cancel check-in`. The quoted prompt is clipped at a word boundary OUTSIDE the bracket — `“4-hourly proactive check-in…”`, not `(operator-set…` (D7). |
| `aida-cancelled.png` | After the card's confirm: the `DELETE` answered **200** (wire below) and the row still drawn with its `Cancelled` mark while the conversation's canonical refresh lags. This is the committed set's live `Cancelled` frame. |
| `refusal-before.png` | The refusal scenario's starting state — the row the run then tried to make stale. The press could not be staged (limits below), so this frame is the scenario's own record of what it had before it lost the race. |
| `debug-before-chip.png` | The rig's overlay probe on a fresh profile (the first-run "Connect an AI account" card) — kept because it is the reason the rig has a dismiss step at all. |

Every frame above is pairwise distinct; sha256 prefixes, for a reader who wants
to check that no caption claims a state another frame already carries:
`pane-at-rest.png` `8ea02f36a49ba1ee`, `pane-hover.png` `d5a520fc13adbb89`,
`cancel-before.png` `c9753bd4454fdb44`, `cancel-writing.png` `44a04ad1d80b92f5`,
`cancel-gone.png` `aee985e17835a8a7`, `aida-managed.png` `aedc17a1ce84dfed`,
`aida-confirm.png` `238899c5f2bc0a5c`, `aida-cancelled.png` `98b484b11789ff97`,
`refusal-before.png` `af42f05c9754ba89`. Round 1 shipped two byte-identical pairs
(`pane-at-rest`/`pane-hover` and a receipt frame identical to the dropped row);
the re-shoot above is what closed that. Note that a re-run of `cancel` rewrites
its three frames (the conversation's wake set advances); the digests above are
the committed ones.

The wire half, from `$ISO/logs/daemon.log` (quoted in the `run-facts-*.json`):

```
INFO:     127.0.0.1:55406 - "DELETE /v1/desktop/wakes/d02c4b26212c/w2 HTTP/1.1" 200 OK
INFO:     127.0.0.1:58257 - "DELETE /v1/desktop/wakes/1701e6fc975c/w1 HTTP/1.1" 200 OK
INFO:     127.0.0.1:57858 - "DELETE /v1/desktop/wakes/1701e6fc975c/aida-cadence HTTP/1.1" 422 Unprocessable Content
```

The first two are the app's own presses (the named confirmation; the one-press
path); the third is the request the app never sends — the route's own `WakeId`
pattern refuses an `aida-` handle with a 422 before any handler, which is why
the engine row carries no control instead of a doomed one.

and the 422 the UI can never send, recorded directly:

```
$ curl -i -X DELETE -H "Authorization: Bearer $TOKEN" \
    http://127.0.0.1:8080/v1/desktop/wakes/<aida-session>/aida-cadence
HTTP/1.1 422 Unprocessable Content
{"detail":"The request has invalid fields."}
```

That refusal happens BEFORE any handler, on the route's own `WakeId` pattern
(`^w\d{1,4}$`) — the accident of regex the PR describes. It is why the engine's
rows carry a state rather than a control that could only ever fail.

## Isolation, proven rather than asserted

- The app's own report: `hello.apiBaseUrl === http://127.0.0.1:8080` (asserted
  at arming; recorded in every `run-facts-*.json`).
- The daemon that wrote those access lines is the scratch one: its store says so
  itself — `"this store is not the one the shared unit serves; launchd cannot
  supervise it"` is the receipt on every arm.
- The operator's supervisor was untouched: `launchctl print
  gui/$(id -u)/com.local-operator.wakes` reports `state = running`, and
  `shasum -a 256 ~/Library/LaunchAgents/com.local-operator.wakes.plist` is
  `2a5abf87…` (unchanged by this work; the rig has no path to launchd).
- `:1111` — the operator's live daemon — is never addressed. The rig refuses to
  start if `--api` names it, and no DELETE this set records is aimed anywhere
  else.
- Window mode: the app's own log records `[window-mode] state: visible=false
  focused=false focusable=false`, so nothing took the operator's focus. A
  page-level `fetch` to `:1111` answers (the renderer can reach any loopback
  port), which is why the isolation assertion is the pair above and not that
  fetch: "reachable" is not "in use".

## What could NOT be staged here, and what covers it instead

Four states in the brief were not reachable on this daemon, and each is recorded
rather than implied:

1. **The one-press `Cancelled` receipt frame.** The mark is a ROW state, and on
   this host the pressed row leaves the drawn list within ~40 ms of the press in
   the page's own 40 ms sampling (`run-facts-probe-cancel.json`, the
   `probe-cancel` scenario; the sampler's readings were validated against direct
   `querySelectorAll` reads in the same runs). The held re-reads do not widen
   that window, because the row is gone before the receipt exists; held or not,
   there is no row left to paint the mark on. The window's own captures also lag
   the DOM by hundreds of milliseconds in this headless mode — the reason round
   1's two pairs came out byte-identical — so a shutter cannot win this race
   either. What the set carries instead: the in-flight verb (`cancel-writing.png`,
   a real shot), the receipt state on the OTHER path where the row does persist
   (`aida-cancelled.png`, the card's confirm), the JSOM test
   (`scripts/wake-cancel-panel.test.mjs`, which pins the mark's rendering), and
   the design's rendered cell (`chat-run-panel--wake-cancel-cancelled`). QA
   round 1's own DOM trace measured the mark at +56 ms on their rig, where the
   row outlived the answer.
2. **The 404 refusal on the ONE-PRESS path.** Making a row stale means
   cancelling its wake out of band and pressing before the pane's own push
   lands; measured, the push beats the rig every time (the control was already
   gone at **10 ms and 60 ms** after the DELETE answered). The refusal's
   rendering and its survival across the re-read are proven in
   `scripts/wake-cancel-panel.test.mjs` (jsdom, on the shipped panel) and shot
   in the Storybook cell `wake-cancel-refused`; QA can stage the race with a
   delayed response, which is the honest next step.
3. **The live owner refusal (`_via_owner`).** A runtime WAS warmed on the cold
   conversation (a real message through the composer; `message sent (runtime
   warmed): {echoed: true}`), and the desktop DELETE for an existing row answered
   **200** regardless. On this backend the owner does not refuse a desktop wake
   cancel, so the refusal state cannot be produced live; the same jsdom and
   Storybook evidence above covers the rendering.
4. **The Schedules page's doomed `aida-*` Cancel, BEFORE this change.** It is
   recorded as the direct `DELETE .../aida-cadence` → 422 above; the page's own
   press of that control was not driven in this set (the after-tree no longer
   offers the control at all — which is the change).

One fixture caveat, stated because a reader will otherwise meet it as a puzzle:
her `aida-cadence` row was planted through the ENGINE'S OWN builder and writer
(`proactive.cadence_schedule` + `wakes.store.write_entry`), because an isolated
store has no boot tick to arm it; her `w1` this round was armed through the
DESKTOP ROUTE itself (`POST /v1/desktop/wakes` with `session_id`), after a
file-planted `w1` turned out to be invisible to the DELETE's lookup (`known:
aida-cadence`, two 404s recorded in the run's daemon log) even though the
listing showed it — the route's own write is the one fixture the mutate agrees
with. That is a property of the fixtures, not of the product, and it is why the
`aida` scenario opens her pane before any write. (The `aida` run's own confirm
then removed her `w1`, which is why a later listing shows `aida-cadence` alone;
re-arm it through the route before re-running that scenario.)

## Reproducing the BEFORE half

The same rig runs against the pre-change tree (a detached worktree at the merge
base, built with the same two environment variables). The harness is copied in,
because the merge base does not contain it:

```sh
git -C ~/local-operator-ui worktree add ~/local-operator-ui-worktrees/wake-cancel-before \
    --detach origin/main
cp -R ~/local-operator-ui-worktrees/wake-cancel-pane/docs/evidence/wake-cancel-live/harness \
      ~/local-operator-ui-worktrees/wake-cancel-before/.rig-harness
cd ~/local-operator-ui-worktrees/wake-cancel-before
env PATH="$HOME/.nvm/versions/node/v22.13.1/bin:$PATH" \
    VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
    LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm build
env LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  node .rig-harness/wake-cancel-rig.mjs --scenario before --tree "$PWD" \
  --out "$ISO/frames-before" --api http://127.0.0.1:8080 --session <session> --wake w2
```

`--scenario before` photographs the section as it reads without the change: the
rows and the footer sentence, no control.

Run for this set: the before tree was `bb095dca28c` (the merge base), built with
the same two environment variables, and its frame is committed beside the after
half as `frames-before/pane-before-no-control.png` — the SAME conversation and
the same two wakes as `frames/pane-at-rest.png`, which is what makes the pair a
comparison rather than two pictures. The run's own readings are in
`frames-before/run-facts-before.json`: `"retiredFooter": true`,
`"cancels": []`, both rows present. Against the after half's
`"retiredFooter": false` and two `Cancel`s, the change is the difference between
those two files.

The Schedules page's doomed `aida-*` Cancel, BEFORE the change: the page offered
a `Cancel wake` on every wake line, so cancelling an `aida-` row sent a DELETE
the route refuses. The direct record of that refusal is the 422 above; the
page's own press was not driven in this set.

## Reaping

Every run prints `scratch kept at <path>` and kills its app by process group
(negative pid, `detached: true`) before returning; the daemon and the relay are
stopped by the pids their wrappers recorded. Nothing from these runs is left
running: `pgrep -fl "out/main/index.js"` answers nothing after a scenario, and
the operator's supervisor read above is the same before and after.
