# A store that is out of space is not a store that is busy

On 2026-09-17 the operator's boot volume reached 0 bytes free at 09:56. The
backend's SQLite store could not allocate its journal or WAL, so the desktop
routes' error ladder answered with the one 503 it had for **every**
`sqlite3.Error` — lock contention, an unopenable database, a corrupted one and a
full volume alike — reading:

> Read state is busy right now. It will catch up on its own.

and this composer appended its own generic "what to do" half:

> Your message is still in the composer. Send it again.

That second sentence is the one action a full disk cannot honour, and it is the
one the operator repeated, with an image attached. Removing the image let the
send through, because the image is by far the largest write in the flow —
attachment bytes plus a much bigger transcript append — so it is what crosses the
threshold while a few-KB text send still lands. It went away when disk space came
back, which is how the correlation was noticed.

The backend PR splits that ladder by what the failure actually is
(`store_busy` 503, `store_out_of_space` 507, `store_unavailable` 500) and makes
the server log the real exception. **This set is the renderer's half**: each new
code reaches the composer and the generic retry hint is withheld for the two the
hint is false for.

## What produced these frames

`node scripts/store-refusal-evidence.mjs`, which drives
`scripts/store-refusal-evidence.html` — the SHIPPED `MessageInput` mounted on what
the app's own refusal pipeline produced — over raw CDP against a private headless
Chrome. No Playwright, no Puppeteer, no downloaded Chromium, no `screencapture`.

The pipeline is the app's own code, in order: the renderer's real transport
against the harness's `/__desktop`, the real `desktopResult` (which reads
`detail.code`/`detail.message` and builds the `DesktopControlError`), the real
`admitChatDraft` (which records the refusal and its code on the draft row the
composer reads), and the shipped `withholdsRetryHint` on that code. The
`composerSendError` handed to the composer is `chat-page`'s own derivation,
copied to the letter: `message: sendError || draft.error`,
`withholdRetryHint: withholdsRetryHint(activeErrorCode)`.

What is substituted is the BACKEND's verdict, at the HTTP boundary — the same
substitution `send-error-evidence.mjs` documents for its 409. The sentences are
the backend's, deliberately: naming the volume and the remedy is a fact only the
process that touched the store has, and a second copy in the renderer would be a
second place for it to drift.

The composer's box is seeded with the text the refused send carried, **for every
frame**. That is the control: the alert gates its hint on the box holding
something, so a frame shot over an empty composer would show no hint for a reason
that has nothing to do with the code. Same box, same pipeline, same viewport,
same theme — the code is the only thing that moves.

## The frames

| Frame | Code | What the composer shows |
| --- | --- | --- |
| [busy.png](busy.png) | `store_busy` (503) | The sentence the operator read, **and the retry hint** — because for genuine lock contention a resend is exactly the right advice, which is what the split exists to preserve. This is the before-state of the incident: what a full disk used to be described as. |
| [out-of-space.png](out-of-space.png) | `store_out_of_space` (507) | The disk is named and so is the remedy (free up space, then send). The retry hint is **absent**, so the alert's "what to do" half is the sentence's own instruction rather than a contradicted one. |
| [unavailable.png](unavailable.png) | `store_unavailable` (500) | The store could not be read or written, retrying will not help, check the machine. The hint is **absent** for the same reason. |

`readings.json` is read out of the same live DOM at capture time, per frame: the
pipeline's `status`/`code`/`message`, `withholdRetryHint`, whether the refusal
was classed as pre-admission, the box's own value, and the alert's rendered text.
The driver **fails** the run on any of them — a green capture is an assertion that
the sentence is the backend's verbatim, that the code is the expected one, that
the box was not empty, and that the hint's presence matches the code. The frames
land only for frames whose assertions passed.

## What this set does NOT prove

- **Not the Electron IPC hop.** `window.api.desktop` is deliberately absent here,
  so the renderer takes its real `/__desktop` dev-server path. The IPC hop is
  covered by `scripts/desktop-contract.test.mjs`, which drives the real main
  transport over real loopback HTTP and asserts a 507/500/503 body arrives with
  its `detail.code` and `detail.message` intact.
- **Not the packaged build**, not a second theme, and not screen-reader
  announcement (the `role="alert"` is present in the DOM, which is not the same
  as hearing it).
- **Not the backend's own ladder**, which is the sibling PR's subject.
- **Not the retention behaviour.** The refusal is driven through
  `admitChatDraft` directly rather than through `chat-page`'s `send` wrapper, so
  the frames show the alert and the box, not the echo/turn machinery around a
  failed send.

## One harness note, recorded because it cost a run

The renderer's **dev-server** desktop path refuses any non-2xx response before
reading it (`Desktop controls need a compatible backend connection.`, with no
code), so a harness that answers `/__desktop` with the upstream status photographs
a refusal this transport cannot produce — every frame came back with that generic
sentence. The app's own `desktopProxyPlugin` answers `200` carrying the
`{status, body}` envelope, and the harness now does the same; the renderer's dev
path is only ever handed that shape. Nothing in the product needed changing for
it, and no frame in this set claims otherwise.

## Reaching this state by hand (for a QA or design round)

The rendered set substitutes the backend's verdict at the HTTP boundary, because
a store failure cannot be asked for on demand. Two ways to meet the real thing,
in the order of least risk to the operator's machine:

1. **The composer's half, in the running app.** Point the app at a backend whose
   `/v1/desktop/sessions/<id>/messages` answers `507` with
   `{"detail": {"code": "store_out_of_space", "message": "…"}}` (or `500` /
   `store_unavailable`), then send anything from a chat. That exercises the real
   Electron IPC hop, the real composer and the real store row, and needs no disk
   pressure at all — it is the shape a stub backend or an HTTP proxy gives you.
2. **The whole ladder, for real.** Run the backend against a bounded APFS disk
   image (`hdiutil create -size 30m -fs APFS`, then detach it afterwards) and let
   the volume fill: SQLite then fails exactly as it did on 2026-09-17, and the
   backend's own error ladder picks the status. Never fill the operator's live
   volume to reach this — the incident happened once already.
