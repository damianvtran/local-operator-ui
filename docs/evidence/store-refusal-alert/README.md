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

**The sentences in these frames are the sibling branch's own copy** (agent review
round 2's M1, and the manager's projection note for PR #307's second
remediation). They used to be shorter stand-ins (agent review round 1, R-2), on
the argument that the renderer paints `detail.message` verbatim so nothing about
the mechanism depends on the wording, and that a stand-in tracking another
branch's revisions would be re-captured for every reword. That argument held for
the wording and failed for the LENGTH, which is what this set measures. Taken
verbatim from `~/local-operator-worktrees/store-failure-classes`,
`local_operator/server/utils/store_failures.py` at `d4109ed35`, with `{root}`
filled by the harness's own stand-in for the config root the request used:

| code | the sentence in these frames |
| --- | --- |
| `store_out_of_space` | "This computer is out of disk space, so the message could not be written. Free some space on the volume holding `/Users/damian/Library/Application Support/local-operator` and send it again." |
| `store_unavailable` | "The session store could not be read or written. Retrying will not help; check `/Users/damian/Library/Application Support/local-operator` and the disk it is on." |

`{root}` is the config root the request actually used, so that PR moved both
sentences from "this disk"/"its logs" to a path — the copy half of design D1 and
UX U5, routed there. The 507 sentence is ~180 characters with a real root in it,
which is twice the stand-in that used to fit the composer's capped window at the
app's minimum size: the committed frames showed a state the shipped copy cannot
reach, and the defect the round-2 reviews found would have returned the moment
`local-operator#1243` merged. Both sentences now come from ONE module
(`scripts/store-refusal-copy.mjs`) that the harness *and* the stub server read, so
the expectation and the answer cannot drift.

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
| [busy-held.png](busy-held.png) | `store_busy` (503) | **The contrast frame for the held line's two registers** (design round 2, D8). Same empty box, same claim, same two controls as `out-of-space-held`; the only sentence that differs is the held line, which keeps the shared "whether it reached the agent is not knowable … send again only if no reply arrives" because contention really is retryable and its outcome really is unknown. The hint is absent from the SCREEN for the post-admission reason (the box is empty) while `withholdsRetryHint` is `false` for the code — the two facts are asserted separately. |
| [altered-held.png](altered-held.png) | `unconfirmed_send` | **The operator's own remedy from 2026-09-17, one step on**: text restored, image dropped, Enter pressed. The second send is really issued, so the store's unchanged-payload guard really fires and its own code is what the alert renders. The retry hint is **absent** — the guard refuses every resend until the claim is released — and the abandon control reads `Stop holding it`, which is the honest label for a press that keeps the user's text. **It is also the U10 frame**: the sentence above is the GUARD's while the claim still carries `store_out_of_space`, so the held line states the known fact ("Nothing was saved …") rather than reverting to the lost-response register — which is what it did until this round, one screen after the app itself said nothing was saved, with the disk off the screen entirely. `readings.json` carries both codes for it (`code: unconfirmed_send`, `heldClaimCode: store_out_of_space`) because that pair is the finding. |
| [unavailable-narrow-held.png](unavailable-narrow-held.png) | `store_unavailable` (500) | The held state at the app's own minimum window (**800x568**, which it clamps to) with the composer's track at **236px** — the width QA round 1 measured in the DEFAULT layout, where an operator starts. The column is an input (`--viewport=WxH --column=N`), so this is the harness's reproduction of that measurement rather than a re-derivation of the app's layout arithmetic. Both remedy controls are **on screen**, and since this round so is the **clause that names the control**: it is pinned outside the capped block, because at this track the backend's own sentence fills the window (120 of 160px shown) and the clause used to be the part cut off. This is the frame QA measured the finding on — the composer's track, the clip and the controls are the app's own numbers. |
| [out-of-space-narrow-held.png](out-of-space-narrow-held.png) | `store_out_of_space` (507) | The same state and window with the **longest** copy the sibling's contract can produce (~180 characters, `{root}` included), which is the projection design round 2's D5 made from the 500 frame's character width — measured here rather than projected. This is the frame where the capped block genuinely overflows: the sentences fill it, the last visible line ends mid-clause, and the claim naming the remedy is still fully painted below it. |

The `-restored` frames are the controlled comparison: the alert gates its hint on
the box holding something the store would accept, so a frame shot over an empty
composer would show no hint for a reason that has nothing to do with the code.
Same box, same pipeline, same viewport, same theme — the code is the only thing
that moves. The `-held` frames are where a hint would be *false* rather than
merely unhelpful: on this route they render none, for every code, because the box
is empty (UX round 1, U7 — which corrected this set's own description of the busy
arm).

`readings.json` is read out of the same live DOM at capture time, per frame: the
pipeline's `status`/`code`/`message`, the row's own `rowCode`/`rowMessage` and
`heldClaimCode` (the CLAIM's own verdict, which is a different field from the
attempt's), `withholdRetryHint`, `isStoreWriteRefusal` for both codes, whether the
refusal was classed as pre-admission, the box's value and chip set, the alert's
RENDERED prose, the prose the frame actually PAINTS, the text, and the geometry of
the capped block, the region, the controls and the send control. The driver
**fails** the run on any disagreement — a green capture is an assertion that the
sentence is the one this state produced, that the code is the expected one, that
the box and the chip set are the state under test, that the hint's presence
matches the predicate, that the claim's register follows the CLAIM's verdict
rather than the refusal on screen, that the clause naming the control is not only
written but PAINTED, that the copy wraps rather than overflowing the block
sideways, and that the controls are outside the scrolling block and inside the
window.

The frames and `readings.json` are written **only when every case passed** (agent
review round 1, R-1). They used to be written inside the case loop, so a capture
taken on a regressed tree silently overwrote the committed frames — the bad ones
beside a `readings.json` whose `failures` array said so, with only the exit status
to notice it. A failing run now writes nothing at all.

## The two instruments this round added, and why the old one could not see the defect

**The clause has to be PAINTED, not merely rendered.** `alertProse` reads
`textContent`, which the cap cannot reach: a sentence the window cuts off still
reports itself in full. That is how the committed `unavailable-narrow-held` frame
printed `prose: … Choose Restore message to put it back in the composer.` in its
PASS line next to a still that did not paint those words, while the same case
asserted `overflowing: true` — a green run that could not see its own failure
(QA round 1's Q-1, design round 2's D5, agent review round 2's M1, UX round 2's
U11). The probe now measures the prose **character by character**, and a
character counts only if its own client rect sits inside every box that clips it
(the paragraph's nearest scrolling ancestor, and the region). `namesControl` and
the known-fact clause are asked of THAT string, so a clipped clause fails the rig.
`readings.json` keeps both, because "never written" and "written where the
operator cannot read it" are different findings.

**The copy has to WRAP, and `{root}` proved it did not.** Measuring against the
sibling's real sentence found a second clip on the other axis, which no frame in
the set had shown: the failure sentence contains the config root, a real macOS
root contains one ~34-character path segment, and that segment was wider than the
whole composer track at the app's minimum window. The sentence's text sat in a
flex item with no `min-w-0`, so its minimum width was that one word, the item
could not shrink, and the block — `overflow-y: auto`, with the other axis
computing to `auto` too — **cut every line mid-word at its right edge** with no
scrollbar drawn at rest. The clause naming the remedy was beyond that edge on all
of them. The fix is `min-w-0 break-words` on the item, and the rig now asserts
`scrollWidth <= clientWidth` on every frame, so the axis that has no cue is
watched on every capture.

**Nine frames that reproduce byte for byte, after two timing artefacts were
taken out of the paint.** A still is only evidence if a re-run paints it again.
Design round 2 (D7) found one frame that did not — 4,004 pixels differing inside
the send control's own box, because the shot caught it mid-hover-transition — and
this round found a second: an independent re-run differed by 204 bytes in a 2x34px
strip, which is the composer's text CARET caught lit in one run and dark in the
other. Neither is a difference of state, and both are now removed rather than
recorded: the driver parks the pointer at the origin and waits out the transition
before every shot, and the harness's own stylesheet makes the caret transparent
(`caret-color`, page-scoped). A capture from a regressed tree still fails its
assertions and writes nothing, which is the property that matters; what changed is
that a capture from an UNCHANGED tree is now bit-identical, so a reviewer diffing
frames sees state changes only. Two independent runs of this set produce nine
byte-identical frames and a `readings.json` equal apart from `capturedAt`.

**One residual, stated because it is measured rather than argued.** With the
sibling's real 507 sentence at the app's minimum window, the capped block shows
six of its ~eight lines: the failure sentence's tail ("… and send it again") is
below the fold, and the app's own scrollbar is the only cue. Everything the
operator has to ACT on is above it — "Free some space on the volume holding
{root}" is visible in the failure sentence, and the pinned claim names the
control — and the retry clause that is cut is a step the app cannot perform before
`Restore message` is pressed anyway. It is the backend's copy length, not this
renderer's, and #1243 owns it; this set records the measurement so the projection
is not re-derived from a still.

## What this set does NOT prove

- **Not the Electron IPC hop.** `window.api.desktop` is deliberately absent here,
  so the renderer takes its real `/__desktop` dev-server path. The IPC hop is
  covered by `scripts/desktop-contract.test.mjs`, which drives the real main
  transport over real loopback HTTP and asserts a 507/500/503 body arrives with
  its `detail.code` and `detail.message` intact.
- **Not the scroll cue.** The harness page does not mount the app's own
  `global-scrollbar-styles` (`main.tsx`), so no frame here paints the scrollbar
  the app shows while a capped block overflows — design round 2 measured that
  injecting that rule into this page changes 0 of 1,817,600 pixels, i.e. the
  harness CANNOT photograph the cue. In the running app QA round 1 measured the
  8px gutter present on this state, with `overflow-y: auto`. The cue is real; it
  is this page that cannot show it.
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

For the **narrow** frames specifically, the app derives the composer's track from
the window and whatever panes are open beside it, so no still can pin the width of
"the minimum window" in the abstract: `--viewport=WxH --column=N` set the two the
frame was shot at, and the QA round is what walks the real window. Since this
round the narrow frames use **236px**, the track QA round 1 measured on the real
app at 800x568 in the default layout, so the reproduction starts from a
measurement rather than from the harness's own guess.
