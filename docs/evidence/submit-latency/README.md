# Submit-latency evidence

Pressing Enter used to leave the user's text sitting in the composer for ~1.15s
with nothing on screen, because the cold runtime engage was taken inline inside
the message request. These frames are the before state, the after state, and the
moment that separates them: the instant after Enter, when the text has to be out
of the box and in the transcript.

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
| [after-after-enter.png](after-after-enter.png) | The claim. Immediately after Enter the composer is **already empty** and the user's message is **already in the transcript**, painted optimistically under the admission request UUID while the engage is still running behind it. |
| [after-settled.png](after-settled.png) | The owner's own row has replaced the echo in place — one row, not two, because the echo is keyed by the id the backend gives the durable row. The agent's reply follows. |

## Capturing the frames by hand

The frames above are **pending**: the browser tool's extension bridge was
unavailable from every agent session during this PR, and the operator's standing
rule forbids scripting a browser engine (no CDP, no Playwright, no downloaded
Chromium) precisely because a throwaway browser cannot hold a real login. So the
capture is a person driving their own Chrome. This section is written to be
followed verbatim in about five minutes.

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
5. Press **Enter**, and **immediately capture `<col>-after-enter.png`**. This is
   the frame that carries the claim, so take it as fast as the screenshot tool
   allows; on the before column you have ~1.15s, on the after column the state
   is stable and you can take your time.
6. Wait until the agent's reply finishes rendering. **Capture
   `<col>-settled.png`.**

Replace `<col>` with `before` or `after`. The six filenames are exactly those in
the table above, and `scripts/check-evidence.mjs` expects that naming.

### What each frame has to show

- `*-typed.png` — identical on both columns. If they differ, something other
  than this PR is in the diff.
- `before-after-enter.png` — **text still in the composer, transcript empty.**
- `after-after-enter.png` — **composer already empty, message already in the
  transcript.** This pair is the entire before/after argument.
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
