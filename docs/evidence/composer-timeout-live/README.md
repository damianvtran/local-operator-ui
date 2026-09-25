# The real 20-second deadline, over a live (slow) owner

One arm of `../owner-refusal-send/harness/capture.mjs`, added in this change:
the owner is **alive and slow** — nothing is refused, the first `POST
…/messages` is HELD for 21 s and then ADMITTED — so the app's own 20 s control
budget is reached while the request is genuinely pending, and the message lands
afterwards. The rig is that set's: the app's own `desktopProxyPlugin` → the
shipped `requestDesktop` in `src/main/desktop-transport.ts`, the shipped
composer, a private headless Chrome, everything reaped on exit.

```
node docs/evidence/owner-refusal-send/harness/capture.mjs <out-dir> --only=timeout-admitted
```

## What the frames are

| frame | state |
|---|---|
| `timeout-admitted-composed/localOperatorDark.webp` | the message typed into the real chat page, before the press |
| `timeout-admitted-after-first-send/localOperatorDark.webp` | **the operator's screen, replaced**: the message and its file still in the composer, and above it ONE sentence — "Couldn't confirm your message was sent. Sending it again is safe." — with `Retry` and `Clear`. No held paragraph, no Restore/Discard, and the 20 s transport prose is not what the composer shows |
| `timeout-admitted-after-second-send/localOperatorDark.webp` | the operator's remedy pressed: admitted, box empty, the message in the transcript |

The `-after-first-send` frame also carries the app's own "Lost the connection to
this conversation — reconnect to keep reading." line beside the notice, and that
is honest rather than incidental: the owner really is not answering (that is the
arm), so the transcript's stream reports what it can see. It is a different fact
from the send's, which is why the two lines are separate.

## The readings, which are the claim that can fail

`readings.json` is written by the rig's own probe, and `wire.log` by the stub
owner. For this arm they read:

| reading | first send | after the retry |
|---|---|---|
| the notice | one sentence, `["Retry","Clear"]` | gone |
| the box | the message, as typed | empty |
| transcript user rows | 0 | **1** |
| request ids on the wire | `797ef5a4-…` (held 21000 ms) | `797ef5a4-…` (same id, 200 admitted) |

So: ONE message, ONE user row, and the retry is a replay under the id the first
attempt was issued with — which is what the owner's receipt de-duplicates. A
fresh id on the retry would be a second row for one message, and the rig throws
before writing a frame if the two ids differ.

## What is NOT proven here

- **No packaged Electron build, no native window**: the page is the app's own dev
  server (`app.vite.mjs`), the same surface the sibling set documents.
- **The hang is a hold at the HTTP boundary, not a `SIGSTOP` of a daemon this
  session started.** The deadline path, the transport, the classification, the
  store, the composer and the copy are the shipped code; what is substituted is
  the owner's slowness. A `SIGSTOP` arm needs an isolated `serve` with a
  discovery record the app will admit, which this session could not stand up —
  recorded on the PR as not-verified rather than implied.
- **The credential-substitution arm** (`M4`: a replay whose first attempt never
  rendered still runs the seam) is pinned at the store level, not here.
