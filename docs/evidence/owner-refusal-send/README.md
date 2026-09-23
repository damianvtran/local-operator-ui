# A send the owner refused before admission (held draft vs handed back)

Frames of the composer after a send that the session's OWNER refused before it
admitted anything — the state the operator reported as a held draft. `before/`
is unmodified `origin/main` (`e48d64b81`), `after/` is this branch, and the two
halves come from the SAME rig, the same stub, the same message and the same
window size, so the difference between them is the change and nothing else.

## What each frame shows

| Arm (the owner's verdict) | `before/` — origin/main | `after/` — this branch |
| --- | --- | --- |
| `retiring` — `409 {"code": "runtime_retiring"}` on the first send, admission afterwards | [before/retiring-after-first-send.webp](before/retiring-after-first-send.webp): the echo stays in the transcript, the composer is EMPTY, and the alert adds *"A message is still being held, so a different message cannot be sent yet. Whether it reached the agent is not knowable - its copy is in the transcript above - so restore it and send again only if no reply arrives."* with `Restore message` / `Discard message` under it. Pressing Send again changes nothing: the wire log records ONE request for the whole run. | [after/retiring-after-first-send.webp](after/retiring-after-first-send.webp): the owner's own sentence stands alone — *"This session is switching to a newer build; the one it loaded is gone from disk. The message was not admitted - send it again once the new build is up."* — the echo is gone, and **the text is back in the composer**. [after/retiring-after-second-send.webp](after/retiring-after-second-send.webp) is the operator's own remedy: the same request identity goes out and is admitted. |
| `busy-exhausted` — `503 {"code": "runtime_busy", "retryable": true, "retry_after_ms": 60}` on four attempts (the app's own three repeats included), admission afterwards | [before/busy-exhausted-after-first-send.webp](before/busy-exhausted-after-first-send.webp): the same held claim and the same two controls, over a message the owner had just said it did not take. | [after/busy-exhausted-after-first-send.webp](after/busy-exhausted-after-first-send.webp): the owner's sentence plus the composer's hint — *"Your message is still in the composer. Send it again."* — and the text IS in the composer. [after/busy-exhausted-after-second-send.webp](after/busy-exhausted-after-second-send.webp) shows the press landing. |
| `busy-internal` — the same `busy` 503, but answered by the app's OWN repeats | not captured: this arm's behaviour is the same in both halves, and the after frame is the record | [after/busy-internal-after-first-send.webp](after/busy-internal-after-first-send.webp): no refusal reaches the composer at all. The message is sent; nothing is held and nothing is restored. |
| `unreachable` — `503 {"code": "runtime_unreachable"}` on every send | [before/unreachable-after-first-send.webp](before/unreachable-after-first-send.webp): held. | [after/unreachable-after-first-send.webp](after/unreachable-after-first-send.webp): **still held, unchanged** — the control. The hop failure may have arrived and settled with only its ack lost, so the app must not claim the message never landed; the held claim and its controls stay. |

`*/readings.json` is the same measurement in numbers — the composer's `boxValue`,
the alert's prose, its controls and its visible text per arm — and `*/wire.log` is
the owner's own request log, which is where the identity claim is checkable:
every repeat carries the `request_id` of the first attempt, and in `before/` the
operator's second press produces no line at all.

## Which surface produced these frames, and what they do not prove

**Surface:** the app's own chat components served by a Vite browser dev server
(`harness/app.vite.mjs`), which mounts `src/renderer/index.html` and `main.tsx`
with the app's real CSP. Its `/__desktop` route is the committed
`desktopProxyPlugin`, which calls the SAME `requestDesktop` in
`src/main/desktop-transport.ts` that Electron's IPC handler calls — so the
refusal decoding, the classification, the store's record of it and the composer
are the shipping ones.

**Owner:** `harness/stub-owner.mjs`, a disposable stand-in answering the desktop
control routes. Its verdicts are substituted at the HTTP boundary; the sentences
are the backend's own (`session/errors.py::RuntimeRetiring`, and the
`runtime_busy`/`runtime_unreachable` bodies documented in
`src/shared/desktop-contract.ts`), and `retry_after_ms` is 60 ms rather than the
2 s a real owner asks for, because these frames are about the state a refusal
leaves, not about the pause.

**Capture:** `harness/capture.mjs`, one command that starts the stub, the dev
server and its own private `--headless=new` Chrome, drives the composer through
a send, records the readings, shoots with `Page.captureScreenshot` and reaps all
three on the way out — Chrome's argv routed through `scripts/chrome-keychain.mjs`
so the run cannot reach the operator's keychain. Frames are 2880x1800
(`deviceScaleFactor: 2` at a 1440x900 window), unaltered apart from the lossless
WebP encoding.

**These frames therefore do NOT prove:** the packaged Electron IPC hop, a native
window, any theme other than `localOperatorDark`, or the real backend's ladder
and timings. The transcript PANE is also not part of the claim: the stub answers
`/history` and then holds an EMPTY event stream, so the pane can sit in its
"Loading conversation…" placeholder — the alert region and the composer, which is
where this change lives, are painted from real state either way. A packaged-app
run and a real-owner run remain ungathered and are named here rather than
implied.

## Reproducing

```sh
# after: this branch.  before: the same three files copied into a worktree
# detached at origin/main, run with --tree=before.
node docs/evidence/owner-refusal-send/harness/capture.mjs /tmp/owner-refusal-out --tree=after
```

One command per half; it prints each arm's reading and writes the frames,
`readings.json` and `wire.log` into the directory given. `--only=<arm>` narrows
it to one arm while a rig is being changed.
