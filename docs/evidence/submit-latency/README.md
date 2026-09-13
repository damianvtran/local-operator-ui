# Submit-latency evidence

Pressing Enter used to leave the user's text sitting in the composer for ~1.15s
with nothing on screen, because the cold runtime engage was taken inline inside
the message request. These frames are the before state, the after state, and the
moment that separates them.

**The fix is not the same shape on both paths, and the capture protocol below
exercises the harder one.** In an existing conversation the text leaves the box
in the same synchronous block that paints the echo — one frame after Enter — so
there the instant after Enter is the whole claim. On **New chat** (step 2) there
is no session to paint into yet: the box keeps the text for the create hop the
send spends in `sessions.create` (p50 142 ms, max 409 ms at load 433-445, UX
round 1), and the panel that mounts when that session exists paints the echo in
its FIRST state. **Nothing clears the composer the user is looking at on that
path** — the composer that held the text is unmounted by the identity flip, and
the one that replaces it never had the text — so the after column needs TWO
frames: the instant of Enter (text still in the box, transcript empty, the
bounded create hop) and the first painted frame after the flip (box empty,
message present). Neither still carries the claim alone; the pair, with the
same-turn readings beside it, is the claim.

## What produced these frames

**The renderer served to a real Chrome through the dev desktop proxy**, driven
by a browser tool. Not Electron's window, and not over CDP.

`scripts/submit-latency-evidence.vite.mjs` serves
`scripts/submit-latency-evidence.html`, which mounts the shipped `ChatPage`
under a minimal shell (`QueryClientProvider`, the app's own `ThemeProvider`, and
a `MemoryRouter`). The config carries `desktopProxyPlugin()` — the same plugin
`electron.vite.config.js` registers — so the shipped `desktopRequest` takes its
same-origin `/__desktop` branch (`desktop-api.ts:62-82`), which is a path the
product already ships for browser development rather than a harness fork of it.
`LOCAL_OPERATOR_DESKTOP_TOKEN` and `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` are read
by the Vite process and never reach the page.

Behind that proxy is a real `local-operator serve` with a throwaway
`LOCAL_OPERATOR_CONFIG_DIR` and `hosting: test` / `model_name: mock`, so the
runtime engages successfully and no tokens are spent. Every hop on the submit
path is real: real `admitChatDraft`, real `sessions.create`, real
`sessions.message`, real SSE stream, real watch lease. Verified in the backend's
own access log for the run that produced these frames:

```
POST /v1/desktop/sessions                        200 OK
POST /v1/desktop/sessions/797436cf2ddf/messages  200 OK
GET  /v1/desktop/sessions/797436cf2ddf/events    (SSE, held open)
POST /v1/desktop/sessions/797436cf2ddf/watch     200 OK
```

Text was entered into the real `<textarea>` and the send was triggered through
the composer's own **Send message** control, so the app's own submit path ran.

The before/after pair comes from two worktrees served at once against the **same
backend**, so the two surfaces differ only by the change under test:

| | worktree | port |
| --- | --- | --- |
| before | `submit-latency-before` at `a09f2e6f4` (this branch's merge-base) | 5203 |
| after | `submit-latency` at the branch head | 5202 |

## What these frames do not prove

- **No Electron IPC hop.** There is no main process here. `desktopRequest`
  reaches the backend by its `/__desktop` branch instead of `ipcRenderer`. The
  transport module, the store and the components are byte-identical either way;
  what differs is which of two existing branches carries the bytes.
- **Not the packaged or notarised build** — this is a Vite dev server.
- **Not paint timing.** These are stills. The latency numbers in the PR come
  from `scripts/submit-latency.test.mjs` driving the real transport against a
  real backend, not from these frames.
- **One theme and one window size** (`localOperatorDark`, whatever the capturing
  browser was at). No screen-reader announcement was verified.
- The harness answers three `window.api` methods and three
  `electron.ipcRenderer` methods (see below). None is on the submit path.

### The harness shims, and why they exist

The app cannot be driven in a plain browser at all, and that is **pre-existing
and unrelated to this change** — all three sites are byte-identical on
`origin/main`:

| site | call | effect in a browser |
| --- | --- | --- |
| `app.tsx:91` | `window.electron.ipcRenderer.on` | crashes at mount; avoided here by not booting `app.tsx` |
| `message-input.tsx:486` | `ipcRenderer.invoke("get-platform-info")` | crashes the composer at mount |
| `use-speech-to-text-manager.ts:152` | `ipcRenderer.removeListener` | crashes on unmount; this method is not even in the preload's declared surface (`src/preload/index.d.ts:140`) |

So the harness page defines the smallest shim that lets the real components
mount: `getHomeDirectory` / `directoryExists` / `selectDirectory`, and
`ipcRenderer.invoke` / `on` / `removeListener`. It lives in the harness page and
**not** in product code, deliberately — shipping a browser fallback for these
would make the app degrade silently where a preload is genuinely missing.

`window.api.desktop` is pointedly **absent**, because defining it would route the
transport into an IPC bridge that does not exist here and break the very path
these frames are about.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [before-typed.png](before-typed.png) | `origin/main`'s merge-base. The message is typed and the composer is focused; nothing has been sent yet. The baseline both columns start from. |
| [before-after-enter.png](before-after-enter.png) | The reported defect. Immediately after Enter the text is **still in the composer** and the transcript is **still empty**: for the whole engage the user has no evidence their message was accepted. |
| [before-settled.png](before-settled.png) | The same send once the backend answers, roughly a second later. Only now does the message appear. |
| [after-typed.png](after-typed.png) | This branch, same message, same backend. Identical starting state. |
| [after-after-enter.png](after-after-enter.png) | This branch, at the instant of Enter. On **New chat** this still shows the text in the composer and an empty transcript, and that is correct rather than the defect: it is the create hop (p50 142 ms), and the echo is admitted behind it, not withheld. Read it together with `after-flip.png`; it carries nothing on its own. In an existing conversation the same frame already shows the box empty and the message painted. |
| [after-flip.png](after-flip.png) | The claim on the New-chat path: the first painted frame of the panel the store mounts once `sessions.create` returns — composer empty, the user's message already in the transcript, painted optimistically under the admission request UUID while the message request is still in flight. |
| [after-settled.png](after-settled.png) | The owner's own row has replaced the echo in place — one row, not two, because the echo is keyed by the id the backend gives the durable row. The agent's reply follows. |

## Where this set is declared, and what that costs

`submit-latency` is a declared `supplementary` set in
`docs/evidence/manifest.json`, at **0 frames** - which is the state this
directory is actually in. It is declared rather than omitted because an
undeclared directory is invisible to `scripts/check-evidence.mjs`: the run
reports `0 of 851 frames` and that sentence is vacuous for this feature, since
the gate is not looking at this path at all (design round 1, D3).

Declaring it flips that. The declared count and the files on disk must agree, so
the moment a `.webp` lands in this directory the gate FAILS and names this set -
which is the point. **The protocol below produces seven** (three per column plus
the after column's extra `after-flip.png`), so the capture that lands them sets
this entry's `frames` to `7` in the same commit. Two things it does not buy,
stated so nobody reads the green
as more than it is: a passing run still says nothing about whether these frames
are good, only that there are none; and the manifest's own
`head`/`srcTree`/`scriptsTree` stamp is deliberately left where it was. A stamp
records a capture, and there has not been one - so the two structural tree-hash
failures already reported on this branch stay visible rather than being
re-stamped over a capture that never happened.

## Capturing the frames by hand

The frames above are **pending**: the browser tool's extension bridge was
unavailable from every agent session during this PR, and the operator's standing
rule forbids scripting a browser engine (no CDP, no Playwright, no downloaded
Chromium) precisely because a throwaway browser cannot hold a real login. So the
capture is a person driving their own Chrome. This section is written to be
followed verbatim in about five minutes.

Measured twice, and neither measurement took a frame. **2026-09-13, 13:34-13:36
UTC (manager):** navigation and the origin allowlist worked, but `screenshot`,
`read`, `snapshot` and `close` each returned "the browser extension received X
but did not answer within 20 s". **2026-09-13, ~14:01 UTC (implementing agent):**
the harness itself was healthy - the isolated `local-operator serve` reported
`session_catalogue 3` and both surfaces answered `200` on 5202 and 5203 - but no
browser could be driven at all: `browser` and `tabs` both returned "the bridge
daemon is running but no browser is attached".

So every image in the table above is still missing, and no substitute apparatus
- a downloaded Chromium, a CDP client, a headless engine - was used in place of
the operator's own browser. The capture remains a hand procedure.

### 1. Start an isolated backend (once, ~30s)

Any backend with the warm route works. Nothing here touches a real config dir or
spends tokens: `hosting: test` / `model_name: mock` is a real provider path with
no network.

```sh
ROOT=$(mktemp -d /tmp/lo-frames-XXXXXX)
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
TOKEN=$(openssl rand -hex 32)
printf 'version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n' > "$ROOT/config.yml"
# Scrub inherited cmux vars: an inherited CMUX_WORKSPACE_ID has renamed real
# workspaces before.
for n in $(env | sed -n 's/^\(CMUX_[A-Za-z0-9_]*\)=.*/\1/p'); do unset "$n"; done
HOME="$ROOT" LOCAL_OPERATOR_CONFIG_DIR="$ROOT" LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  <path-to-warm-backend>/.venv/bin/local-operator serve --host 127.0.0.1 --port "$PORT" &
sleep 8
# Must print 3. Below 3 the renderer gates the warm off by design.
curl -s "http://127.0.0.1:$PORT/v1/capabilities" | python3 -c 'import json,sys;print("session_catalogue =",json.load(sys.stdin)["result"]["features"]["session_catalogue"])'
```

### 2. Serve the two surfaces (~20s each)

Run each in its own shell, from its own worktree. Port 5202 is the branch, 5203
is the merge-base; they are configured to differ so both can run at once and be
photographed side by side.

```sh
# AFTER - in the PR branch worktree
cd <repo>            # the branch worktree
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL="http://127.0.0.1:$PORT" \
VITE_LOCAL_OPERATOR_API_URL="http://127.0.0.1:$PORT" \
  npx vite --config scripts/submit-latency-evidence.vite.mjs

# BEFORE - in a worktree at this PR's merge-base, same harness files copied in
cd <before-worktree>
# ...identical command; its vite config pins port 5203.
```

Check each answers before opening a browser:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5202/submit-latency-evidence.html   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5203/submit-latency-evidence.html   # 200
```

- **after:** <http://localhost:5202/submit-latency-evidence.html>
- **before:** <http://localhost:5203/submit-latency-evidence.html>

### 3. The click sequence, identical on both URLs

The two columns must differ only by the code, so run exactly the same steps on
each port. Use the same message text both times.

1. Open the URL. Wait until the left sidebar lists agents — that means the
   renderer has reached the backend through the proxy.
2. Click **New chat** (the button in the sidebar, or the one on the empty state).
   This is the case the whole PR is about: a draft with no session yet.
3. Click into the composer and type: `Warm the runtime and echo this line`
4. **Capture `<col>-typed.png`** — before pressing anything.
5. Press **Enter** and capture `<col>-after-enter.png` **in the same protocol
   turn as the keypress** - the key event and the screenshot issued as one pair
   on one session, with no round trip in between. A hand-timed one measures the
   hand: two runs would produce two different pictures, which is what stops it
   being re-derivable (design round 1, D2). Record the same turn's readings
   beside the still, in whatever notes accompany the capture: the composer
   textarea's `value` (empty, or the message) and whether the transcript holds a
   user row. On the before column you have ~1.15 s for both. On the **after**
   column this frame is expected to show the text still in the box and no user
   row - the create hop, not a defect - so it is the control, not the evidence.
6. **After column only.** Stay on the same session in the same protocol turn and
   capture `after-flip.png` at the first painted frame of the panel that mounts
   when the session exists. That panel is the harness's own `SessionPanel`
   remount - the same chat surface, not a second page - so this frame needs no
   apparatus step 5 did not already have. Wait on the DOM, not the clock: the
   conditions are the textarea's `value` going empty and the transcript gaining
   a user row, and screenshotting at that first observation keeps two runs
   comparable the same way step 5's same-turn pair does. Record the same two
   readings again at this instant. **This is the after column's evidence.**
7. Wait until the agent's reply finishes rendering. **Capture
   `<col>-settled.png`.**

Replace `<col>` with `before` or `after`. The seven filenames are exactly those
in the table above, and they are what the declared frame count in
`docs/evidence/manifest.json` is counted from (`scripts/check-evidence.mjs`
counts the `.webp` files in this directory against `frames`).

### What each frame has to show

- `*-typed.png` — identical on both columns. If they differ, something other
  than this PR is in the diff.
- `before-after-enter.png` — **text still in the composer, transcript empty**,
  and still so at `before-settled.png` minus the settle: the defect is an empty
  transcript for the whole ~1.15 s engage.
- `after-after-enter.png` — **text still in the composer, transcript empty**:
  the create hop on the New-chat path, bounded at p50 142 ms. It looks like the
  before column's frame and is not the same thing; the same-turn reading beside
  it is what distinguishes them (the before column holds that state for the
  whole engage, the after column for the create hop).
- `after-flip.png` — **composer empty, message in the transcript**, at the first
  painted frame of the panel the store mounts when the session exists. This,
  read with the keypress frame, is the after column's half of the argument: the
  interval between the two states is the create hop, not a gap the user waits
  out with nothing on screen.
- `after-settled.png` — exactly **one** copy of the user's message. Two would
  mean the echo failed to coalesce with the durable row, which is the R6 defect.

### Degraded path (optional, one extra frame)

Point `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` at a backend **without** the warm
route. The renderer is gated on `session_catalogue >= 3`, so the warm silently
no-ops and the send falls back to the old timing — the echo still paints, since
it does not depend on the warm. Worth photographing only if the gate is doubted.

### Cleanup

```sh
kill %1                 # the backend; vite dies with its shell
rm -rf "$ROOT"
```
