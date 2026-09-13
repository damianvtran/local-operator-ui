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

## Reproducing

Start an isolated backend (`hosting: test` / `model_name: mock`), then in each
worktree:

```sh
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:<backend-port> \
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<backend-port> \
  npx vite --config scripts/submit-latency-evidence.vite.mjs
```

- after: <http://localhost:5202/submit-latency-evidence.html>
- before: <http://localhost:5203/submit-latency-evidence.html>

Point `LOCAL_OPERATOR_DESKTOP_BACKEND_URL` at a backend **with** the warm route
to see the warmed path, or at one without it to see the degraded path — the
renderer is gated on `session_catalogue >= 3` and no-ops cleanly against an
older backend, which is itself worth photographing if the gate is ever doubted.
