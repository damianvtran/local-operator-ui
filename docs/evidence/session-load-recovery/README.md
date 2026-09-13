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
`Emulation.setDeviceMetricsOverride`, device scale factor 2. The viewport follows
the case: 1380x872 (frames 2760x1744) everywhere except `narrow`, which is
980x760 — deliberately below the app's own `isSmallView` boundary, which the chat
column hits under 550px. Every frame asserts its own state before it is written,
so a blank or wrong frame fails the capture instead of reaching review. The set
was re-captured at this branch's remediation head, after the failure copy, the
notice's register and the collapse stand-down changed.

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
backend, a native window, a theme other than `localOperatorDark`, or the
`prefers-reduced-motion` rendering — that last one is a media query this capture
does not drive, and its fix (the loading words are shown instead of relying on
the skeleton's pulse) is covered by inspection of the one shared predicate in
`message-input.tsx` rather than by a frame. The main-process half of the fix —
the relay rebuilt on token rotation, an exited backend now restored by the
watchdog, and the watchdog restart no longer running the machine-wide `pkill` —
is not visible on any screen; it is covered by `scripts/session-stream-token.test.mjs`
against real loopback HTTP, which asserts a 401 before the fix and a 200 after on
the same URL. The renderer half is covered at hook level by
`scripts/session-load-recovery.test.mjs`.

**What the refused frame does prove about the shipped sentence.** The pixels are
the browser transport's; the WORDS are not the transport's. Both transports emit
the same machine vocabulary from `src/shared/desktop-stream-notice.ts`, so the
sentence the reader gets for a rotated-token 401 is the sentence in this frame,
and `scripts/session-stream-token.test.mjs` takes the detail the real relay emits
over a real socket and asserts exactly that mapping — rather than asserting the
copy and hoping the packaged path produces it.

The "Server is offline …" strip along the top of every frame is the legacy
agents REST probe against a stub that does not serve that API. It is present on
`origin/main` too and is unrelated to this change.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [before.png](before.png) | The reported state, on `origin/main`, with the stub refusing the stream twice and then serving it. The conversation is open — its row is the sidebar's `Previous chats` entry, `Failing deploys` — the pane says "What can I help you with today?" over a conversation whose two durable rows are on the server, and the stream is refused. No conversation title is painted in the header on any frame in this set: the header carries only the `Chat | Raw` tabs, and the conversation is named in the sidebar. The defect reproduces on base unchanged: the stub logged **one** `/events` attempt, because with no receipt the single auto-reconnect was skipped, so the refusal was permanent for that session. |
| [loading.png](loading.png) | This branch, 2.5s in with the stub refusing every attempt: the retry window. The pane says **Reconnecting**, at the reading step and inside the pane rather than clipped above a 0px box (measured `scrollerHeight 632`), and the greeting is NOT shown — the app does not yet know what the conversation holds. |
| [recovered.png](recovered.png) | This branch, same refusal, same stub. The stub logged `events attempt 1 -> 401`, `2 -> 401`, `3 -> 200` — the bounded retry re-armed the stream, the relay was rebuilt against the live token, and the real transcript painted: the user row, the agent's answer, "Start of conversation". No app restart. |
| [refused.png](refused.png) | This branch, with the stream refused for good. After the retry budget is spent the transcript says **"Lost the connection to this conversation — reconnect to keep reading."** with a **Reconnect** beside it, above the composer. The greeting is NOT shown: the app does not know this conversation is empty, so it does not say so. |
| [empty.png](empty.png) | This branch, a conversation with NO durable rows that the stub SERVES — the counter-case (design round 1, D5(b)): a readable empty conversation must still end up saying so, or "do not claim empty" and "load forever" are indistinguishable. `{"greeting":true,"rows":0,"loading":false}`: the loading skeleton is gone and the greeting is the settled state. |
| [narrow.png](narrow.png) | The same refusal at 980x760, i.e. below the app's own `isSmallView` boundary (the chat column under 550px). The notice wraps and the Reconnect control drops below it (measured `rect [524,593,432,60]` against `[524,688,832,28]` at full width); the greeting and the suggestion chips are suppressed outright. |

The states the frames exist to separate, read out of the DOM by the capture, which asserts each one before it writes a frame:

```
before     {"greeting":true,  "rows":0, "reconnect":0, "notice":"Reconnecting", "scrollerHeight":0}
loading    {"greeting":false, "rows":0, "reconnect":0, "notice":"Reconnecting", "scrollerHeight":632}
recovered  {"greeting":false, "rows":4, "reconnect":0, "notice":"Start of conversation …"}
refused    {"greeting":false, "rows":1, "reconnect":1, "scrollerHeight":632,
            "failure":{"text":"Lost the connection to this conversation — reconnect to keep reading.",
                       "fontPx":"13px", "fontColour":"rgb(239, 128, 120)", "rect":[524,688,832,28]}}
narrow     {"greeting":false, "rows":1, "reconnect":1, "scrollerHeight":569,
            "failure":{"rect":[524,593,432,60]}}
empty      {"greeting":true,  "rows":0, "loading":false, "reconnect":0}
```

### One sentence per condition, and the test that pins it (design round 1, D1)

The words in `refused.png` are not the transport's. `src/shared/desktop-stream-notice.ts` declares the machine vocabulary once (`DESKTOP_STREAM_DETAIL`); the relay (`src/main/desktop-stream.ts`), the preload bridge and the browser transport (`desktop-api.ts`) all emit those constants, and `streamFailureNotice()` maps whichever one arrives to one product sentence. That matters because the round-1 frame under review showed the **browser proxy's** string ("The event stream ended.") while the packaged app's relay emits "The event stream was refused (401)." for exactly this refusal — so the sentence that shipped a bare HTTP status was never the sentence that was photographed. Both now reach the reader as the same sentence, and the claim is checked rather than restated: `scripts/session-load-recovery.test.mjs` asserts the mapping from every emitted detail, and `scripts/session-stream-token.test.mjs` takes the detail the REAL relay emits over a REAL socket (a 401 against the loopback fixture) and asserts the sentence it produces.

### The register and the alignment (design round 1, D2)

The notice was set at `text-meta` — the contract's caption step, the same step this pane uses for a timestamp — for the only actionable thing on screen, at the bottom ~4% of a 648px void. It is now at the reading step § 4 gives something the reader must act on (`text-body-sm`, measured `13px`, `danger #ef8078` on canvas = 7.08:1 against the 3:1 floor for text). Placement is unchanged and is the reason it stays: it shares the composer's own column, edge-aligned with the composer it belongs to (measured `rect [524,688,832,28]`; the composer column starts at the same x), so it reads as attached to the composer rather than floating in the pane.

### Naming the control (design round 1, D4)

The transcript's control is labelled **Reconnect** — what it does — rather than "Retry". The shell also carries the legacy server banner's "Retry", which re-probes a different API, and the two shared one accessible name, reached a keyboard user together, and did different things. The capture scopes its query to the transcript's own pane for the same reason, and reports the banner's control separately as `legacyRetry`.

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

The notice and its control were inside a 0px box, so the one state that needs a
way out had none. `collapsed` now stands down while the pane has something of
its own to say, and the composer band asks the same predicate before it claims
the free height for a greeting. The re-capture above is the same refusal with
`scrollerHeight 632` and the notice reachable.

## The retry window was clipped the same way

The stand-down originally covered only `unavailable` with an error, so for the
whole ~23.5s retry budget this PR introduces the pane was still
`h-0 overflow-hidden` while the "Reconnecting" paragraph rendered at y 70.6 —
above the collapsed box's own top edge, and clipped. The pane therefore named
nothing at all while the app was retrying (design round 1, D3).
`canonicalTranscriptSpeaks()` in `canonical-transcript.tsx` is now the single
authority for both decisions that have to agree — may the pane collapse, and may
the band claim the conversation is empty — and it covers `reconnecting` as well
as `unavailable` with a failure. [loading.png](loading.png) is that window: the
line is inside the pane, and the greeting is not painted.

## Reproducing

```sh
# the stub, then the surface (both ports are overridable: several agent
# sessions share this machine, so a busy port must FAIL rather than be shared)
SESSION_LOAD_PORT=8796 SESSION_LOAD_MODE=flaky SESSION_LOAD_REFUSALS=2 \
  node docs/evidence/session-load-recovery/harness/stub-backend.mjs &
SESSION_LOAD_UI_PORT=5211 LOCAL_OPERATOR_DESKTOP_TOKEN=evidence-token \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:8796 \
  npx vite --config docs/evidence/session-load-recovery/harness/session-load.vite.mjs &

# frames: the retry window; refusals then served; refused for good; a served
# empty conversation; the same refusal in a small view
SESSION_LOAD_ORIGIN=http://localhost:5211 node docs/evidence/session-load-recovery/harness/capture.mjs <out-dir> loading      # SESSION_LOAD_MODE=down
SESSION_LOAD_ORIGIN=http://localhost:5211 node docs/evidence/session-load-recovery/harness/capture.mjs <out-dir> recovered
SESSION_LOAD_ORIGIN=http://localhost:5211 node docs/evidence/session-load-recovery/harness/capture.mjs <out-dir> refused      # SESSION_LOAD_MODE=down
SESSION_LOAD_ORIGIN=http://localhost:5211 node docs/evidence/session-load-recovery/harness/capture.mjs <out-dir> empty        # + SESSION_LOAD_ROWS=0
SESSION_LOAD_ORIGIN=http://localhost:5211 node docs/evidence/session-load-recovery/harness/capture.mjs <out-dir> narrow       # SESSION_LOAD_MODE=down

# and, on a pre-fix tree, the defect frame:
SESSION_LOAD_ORIGIN=http://localhost:5211 node docs/evidence/session-load-recovery/harness/capture.mjs <out-dir> before  # SESSION_LOAD_MODE=flaky SESSION_LOAD_REFUSALS=2
```

Each run prints the state it read off the page before writing the frame, and
exits non-zero when that state is not the one the case names.
