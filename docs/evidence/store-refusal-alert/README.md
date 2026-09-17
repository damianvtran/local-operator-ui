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
code reaches the composer, the generic retry hint is withheld for the two the
hint is false for, and — since UX round 1 — the screen the operator is left with
is one they can act on.

## What produced these frames

`node scripts/store-refusal-evidence.mjs`, which drives
`scripts/store-refusal-evidence.html` — the SHIPPED `MessageInput` mounted on what
the app's own refusal pipeline produced — over raw CDP against a private headless
Chrome. No Playwright, no Puppeteer, no downloaded Chromium, no `screencapture`.

The pipeline is the app's own code, in order: the renderer's real transport
against the harness's `/__desktop`, the real `desktopResult` (which reads
`detail.code`/`detail.message` and builds the `DesktopControlError`), the real
`admitChatDraft` (which records the refusal and its code on the draft row the
composer reads), and the shipped `withholdsRetryHint` / `isStoreWriteRefusal` on
that code. The `composerSendError` handed to the composer is `chat-page`'s own
derivation, copied to the letter: `message: sendError || draft.error`,
`code: activeErrorCode`, `heldText`/`heldAttachments` off the row,
`onRestoreHeld`/`onDiscard`/`onReleaseHeld` supplied from the same row.

What is substituted is the BACKEND's verdict, at the HTTP boundary — the same
substitution `send-error-evidence.mjs` documents for its 409.

**The sentences in these frames are STAND-INS, not the sibling PR's copy** (agent
review round 1, R-2). The renderer paints `detail.message` verbatim, which is the
point of the arm, so nothing about the mechanism depends on the wording — but the
stills are read as the copy a user sees, and the sibling branch
(`~/local-operator-worktrees/store-failure-classes`,
`local_operator/server/utils/store_failures.py`) sends:

| code | the sibling's sentence today |
| --- | --- |
| `store_out_of_space` | "This computer is out of disk space, so the message could not be written. Free some space on the volume holding `{root}` and send it again." |
| `store_unavailable` | "The session store could not be read or written. Retrying will not help; check `{root}` and the disk it is on." |

`{root}` is the config root the request actually used, so that PR moved both
sentences from "this disk"/"its logs" to a path — the copy half of design D1 and
UX U5, routed there. This set is deliberately not updated ahead of it: a stand-in
that changed whenever the other branch reworded a string would be re-captured for
every revision of copy this repository does not own.

## Three states per arm, because one screen cannot answer every claim

The remedy for a store refusal is not a resend — the box is empty, the claim
holds the payload, and the sentence has to say so — so the set captures the state
the operator actually lands on, not only the state the hint's condition is
satisfied in.

| Frame | Code | State, and what it is for |
| --- | --- | --- |
| [busy-restored.png](busy-restored.png) | `store_busy` (503) | The payload back in the box. **The retry hint is rendered** — because for genuine lock contention a resend is exactly the right advice, which is what the split exists to preserve. This is also the incident's before-state: what a full disk used to be described as. |
| [out-of-space-restored.png](out-of-space-restored.png) | `store_out_of_space` (507) | Same box, same pipeline, same window — the code is the only thing that moves. The hint is **absent**. |
| [unavailable-restored.png](unavailable-restored.png) | `store_unavailable` (500) | Same, hint **absent**. |
| [out-of-space-held.png](out-of-space-held.png) | `store_out_of_space` (507) | **The state the refusal leaves**: the claim holds the text, the box is empty, the chip row still carries the file — and the held line states the known fact ("nothing was saved, and the copy above is this app's own rather than the agent's") and names the control its own sentence needs, `Restore message`. |
| [unavailable-held.png](unavailable-held.png) | `store_unavailable` (500) | The same screen for the other arm. |
| [altered-held.png](altered-held.png) | `unconfirmed_send` | **The operator's own remedy from 2026-09-17, one step on**: text restored, image dropped, Enter pressed. The second send is really issued, so the store's unchanged-payload guard really fires and its own code is what the alert renders. The retry hint is **absent** — the guard refuses every resend until the claim is released — and the abandon control reads `Stop holding it`, which is the honest label for a press that keeps the user's text. |
| [unavailable-narrow-held.png](unavailable-narrow-held.png) | `store_unavailable` (500) | The same state at the app's own minimum window (**800x568**, which it clamps to) with the chat column at **340px**, where the prose is 164px in the 120px block. Both remedy controls are **on screen** — the finding (UX U3) was that at this size the copy filled the window and both controls sat ~90px below the visible area with no cue that the region scrolled. |

The `-restored` frames are the controlled comparison: the alert gates its hint on
the box holding something the store would accept, so a frame shot over an empty
composer would show no hint for a reason that has nothing to do with the code.
Same box, same pipeline, same viewport, same theme — the code is the only thing
that moves. The `-held` frames are where a hint would be *false* rather than
merely unhelpful: on this route they render none, for every code, because the box
is empty (UX round 1, U7 — which corrected this set's own description of the busy
arm).

`readings.json` is read out of the same live DOM at capture time, per frame: the
pipeline's `status`/`code`/`message`, the row's own `rowCode`/`rowMessage`,
`withholdRetryHint`, `isStoreWriteRefusal`, whether the refusal was classed as
pre-admission, the box's value and chip set, the alert's rendered prose and text,
and the geometry of the capped block, the region, the controls and the send
control. The driver **fails** the run on any disagreement — a green capture is an
assertion that the sentence is the one this state produced, that the code is the
expected one, that the box and the chip set are the state under test, that the
hint's presence matches the predicate, that the prose names the control exactly
when the refusal needs it, and that the controls are outside the scrolling block
and inside the window.

The frames and `readings.json` are written **only when every case passed** (agent
review round 1, R-1). They used to be written inside the case loop, so a capture
taken on a regressed tree silently overwrote the committed frames — the bad ones
beside a `readings.json` whose `failures` array said so, with only the exit status
to notice it. A failing run now writes nothing at all.

## What this set does NOT prove

- **Not the Electron IPC hop.** `window.api.desktop` is deliberately absent here,
  so the renderer takes its real `/__desktop` dev-server path. The IPC hop is
  covered by `scripts/desktop-contract.test.mjs`, which drives the real main
  transport over real loopback HTTP and asserts a 507/500/503 body arrives with
  its `detail.code` and `detail.message` intact.
- **Not the packaged build**, not a second theme (the light arm was measured
  clean in design round 1 and is not committed here), and not screen-reader
  announcement (the `role="alert"` is present in the DOM, which is not the same
  as hearing it).
- **Not the backend's own ladder**, which is the sibling PR's subject, and not
  its copy (see the stand-in note above).
- **Not the retention behaviour.** The refusal is driven through
  `admitChatDraft` directly rather than through `chat-page`'s `send` wrapper, so
  the frames show the alert and the box, not the echo/turn machinery around a
  failed send.
- **Not what the abandon controls DO.** They are present, so their labels are
  what the frames carry; a still cannot show what a press did, and these handlers
  are deliberately inert.

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

For the **narrow** frame specifically, the app derives the composer's track from
the window and whatever panes are open beside it, so no still can pin the width
of "the minimum window" in the abstract: `--viewport=WxH --column=N` set the two
the frame was shot at, and the QA round is what walks the real window.
