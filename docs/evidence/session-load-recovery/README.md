# Session load: a refused stream must not read as an empty conversation

The operator's report was that every conversation opened with its title, an
empty composer and "What can I help you with today?", with no history and no
error, and that restarting the app fixed it. These frames are that state, the
reason it happened, and what the app does now instead.

## What produced these frames

**The real renderer, served by the app's own chat surface** — the browser dev
harness in `harness/session-load.vite.mjs`, which roots Vite at `src/renderer`
and serves the app's own `index.html` and `main.tsx` with the real stylesheet,
the real canonical store, the real `useCanonicalSessionStream` hook and the real
`CanonicalTranscript`. Its `/__desktop` route is the committed
`desktopProxyPlugin`, which calls the SAME `requestDesktop` in
`src/main/desktop-transport.ts` that Electron's IPC handler calls, and its
`/__desktop/stream` is the same authenticated SSE proxy the app uses in browser
development.

**The refusal is a real refusal at the transport.** `harness/stub-backend.mjs`
answers `GET /v1/desktop/sessions/{id}/events` with the backend's own 401 until
the policy says otherwise, so the browser's `EventSource` fails the connection
the way it does when main's relay holds a rotated token. The conversation is
real in the sense that matters here: the catalogue row and the two transcript
rows are served over the same routes the backend serves them on, and the
renderer paints them through its production reducer.

**Capture:** `harness/capture.mjs`, driving Chrome over raw CDP the same way
`scripts/capture-evidence.mjs` does — private `--headless=new` profile under the
system temp dir, swept on exit, `Page.captureScreenshot` with
`Emulation.setDeviceMetricsOverride` at 1380x872, device scale factor 2. Frames
are 2760x1744, unaltered. Every frame asserts its own state before it is
written, so a blank or wrong frame fails the capture instead of reaching review.

**The before tree** is a detached worktree at `98c32e85e` — `origin/main` at the
moment this set was captured, i.e. the tree this branch is proposed against,
which already carries `0.19.7`, #142, #137, #138 and #118 — with the same harness
copied in, the same stub backend, and the same port pair. The defect reproduces
on that base unchanged: the stub logged a single `/events` attempt for the
refusal, and the pane painted the greeting over a conversation whose rows were
on the server. The frame was re-captured on each base this branch was rebased
onto, so the pixels and the tree they describe are the same tree.

**These frames therefore do NOT prove:** packaged Electron IPC, the preload
bridge, main's `DesktopStreamRelay` token binding, a real `local-operator serve`
backend, a native window, or any theme other than `localOperatorDark`. The
main-process half of the fix — the relay rebuilt on token rotation, and the
watchdog restart no longer running the machine-wide `pkill` — is not visible on
any screen; it is covered by `scripts/session-stream-token.test.mjs` against
real loopback HTTP, which asserts a 401 before the fix and a 200 after on the
same URL. The renderer half is covered at hook level by
`scripts/session-load-recovery.test.mjs`.

The "Server is offline …" strip along the top of every frame is the legacy
agents REST probe against a stub that does not serve that API. It is present on
`origin/main` too and is unrelated to this change.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [before.png](before.png) | The reported state, on `origin/main`, with the stub refusing the stream twice and then serving it. The sidebar has the conversation open, the header names it, the pane says "What can I help you with today?" over a conversation whose two durable rows are on the server. The stub logged **one** `/events` attempt: with no receipt, the single auto-reconnect was skipped, so the refusal was permanent for that session. |
| [recovered.png](recovered.png) | This branch, same refusal, same stub. The stub logged `events attempt 1 -> 401`, `2 -> 401`, `3 -> 200` — the bounded retry re-armed the stream, the relay was rebuilt against the live token, and the real transcript painted: the user row, the agent's answer, "Start of conversation". No app restart. |
| [refused.png](refused.png) | This branch, with the stream refused for good. After the retry budget is spent the transcript says "The event stream ended." with a **Retry** beside it, above the composer. The greeting is NOT shown: the app does not know this conversation is empty, so it does not say so. |

The two states the frames exist to separate, read out of the DOM by the capture:

```
before     {"greeting":true, "rows":0, "retry":0, "notice":"Reconnecting"}
recovered  {"greeting":false, "rows":4, "retry":0, "notice":"Start of conversation …"}
refused    {"greeting":false, "rows":1, "retry":1, "notice":"The event stream ended. Retry"}
```

## A defect this capture found in its own fix

The first `refused` attempt photographed an empty chat column: the failure
notice was rendered *inside* the transcript's scroller, and that scroller
collapses to `h-0 overflow-hidden` whenever `transcript.records.length === 0` —
which is exactly the case a failed stream produces. Measured geometry from the
page at that moment:

```
transcript [508,60,864,44]   scroller [500,104,880,0]   clientHeight 0   overflow hidden
Retry button rects: [[601,12,...], [660,60,...]]
```

The notice and its Retry were inside a 0px box, so the one state that needs a
way out had none. `collapsed` now stands down while the session is
`unavailable` with an error to show, and the composer band stops claiming the
free height for a greeting in that state. The re-capture above is the same
refusal with `clientHeight 632, overflow auto` and the notice reachable.

## Reproducing

```sh
# the stub, then the surface
SESSION_LOAD_PORT=8796 SESSION_LOAD_MODE=flaky SESSION_LOAD_REFUSALS=2 \
  node docs/evidence/session-load-recovery/harness/stub-backend.mjs &
SESSION_LOAD_UI_PORT=5211 LOCAL_OPERATOR_DESKTOP_TOKEN=evidence-token \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:8796 \
  npx vite --config docs/evidence/session-load-recovery/harness/session-load.vite.mjs &

# frames: refusals then served; refused for good; and (on a pre-fix tree) `before`
node docs/evidence/session-load-recovery/harness/capture.mjs <out-dir> recovered
SESSION_LOAD_MODE=down node docs/evidence/session-load-recovery/harness/capture.mjs <out-dir> refused
```

Each run prints the state it read off the page before writing the frame, and
exits non-zero when that state is not the one the case names.
