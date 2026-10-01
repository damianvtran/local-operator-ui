# The composer's notice, every arm of the copy table

Not swept, and not a Storybook set. These are **rendered frames of the shipped
`MessageInput`**, taken from a private headless Chrome by
`scripts/composer-alert-geometry.mjs` — one command, its own vite page, its own
`--user-data-dir`, killed on exit — plus its BEFORE half, taken by the same
command at unmodified `origin/main`.

## What each frame is

Every state is rendered by the SHIPPED composer, with the app's own stylesheet,
palette and font faces, through the same `sendError` contract the chat pane
passes it. The notice's own copy is imported from the code that writes it (the
table in `canonical-sessions-store.ts`, the transport's backstop in
`desktop-transport.ts`, the renderer's pre-flight in `message-budget.ts`), so no
frame can show a sentence the app is unable to produce.

| frame | state | what it shows |
|---|---|---|
| `<w>-notice.*` | unknown outcome (the 20 s transport deadline's class) | the operator's own failure: the message and its chip are IN the box, and the notice is ONE sentence with `Retry` and `Clear` |
| `<w>-unreachable.*` | nothing answered (`transport.failed`) | the same two controls, because a press is safe and the message may not have gone |
| `<w>-answer-busy.*` | an ANSWER press the owner was too busy to confirm (`runtime_busy`) | the app's own sentence — "Your answer isn't confirmed yet. The agent is busy." — in the MUTED register, with NO controls: the repeat is the app's, and the band's only retry control would send the box rather than the option that failed |
| `<w>-answer-unreachable.*` | an ANSWER press the daemon could not hand to the session's owner (`runtime_unreachable`) | the unknowable lead kept, the route's "Reconnect and reconcile before retrying" replaced by a fact, and `danger` ink — this one really may be a lost answer |
| `<w>-too-large.*` | the transport's byte-budget backstop | the app's real sentence, and `Clear` only — a press meets the same limit |
| `<w>-too-long.*` | the renderer's character pre-flight | the app's real sentence with its own numbers, and `Clear` only |
| `<w>-gone.*` | a 404: the conversation does not exist | `Clear` only |
| `<w>-muted.*` | the send lock | one muted line, NO controls |
| `<w>-delivered.*` | the late confirmation over the user's own edit | one muted line, no controls, and no chip (the user's draft is their own) |
| `<w>-idle.*`, `<w>-edited-idle.*` | the two baselines | the same drafts with NO notice, which is what makes the others a statement about the notice |

`<w>` is the column width the chat area leaves at a 1440px window: `892` (both
sidebars), `472` (the app's compaction threshold) and `172` (a window with the
canvas pane open — the narrowest the app reaches). The `-sage`/`-iceberg` frames
are the `notice` arm in two of the five themes whose two ink roles the design
round measured 1.05-1.11 apart (D2).

## The before half

`892-unreadable*`, `472-unreadable*`, `172-unreadable*`, `*-split*` and
`*-idle*` are **`origin/main`'s own committed rig** (`scripts/
composer-alert-geometry.mjs` at `origin/main`, run from a detached worktree),
photographing the screen this change replaces: the same composer, the old
region with its capped, internally-scrolling prose block, the refusal's sentence
**plus** the explanatory paragraph under it (`892-split.png` is the clearest:
"The text of your refused message was restored, but not its files…"), which is
the grey paragraph the operator reported.

The pairing is therefore one instrument, one window, one theme, two trees. **It
is not** the operator's own screenshot, and no frame here is claimed to be: the
operator's screen was the timeout arm with the held-message paragraph and
`Restore message`/`Discard message`, and the committed
`../chat-cold-send-browser/admission-timeout` is a capture of that screen from
2026-09-14 (with different red text). `../chat-cold-send-browser/README.md` now
says so where it used to imply the frame was the operator's exact screen (review
round 1, m4).

## What this set asserts, and what it does not

The run fails, and writes no frame, unless every arm shows: one sentence block,
the control set its own row of the table gives (by label), the register its class
gives, no jargon (`held`, `admission`, `owner`, `request id`), and — the number
the rig exists for — **the line the user is typing does not move** when the
notice renders, against the same draft with no notice. `Retry`'s computed font
weight is measured as heavier than `Clear`'s wherever both are offered (D2).

It does NOT prove: a packaged build, the Electron IPC hop (the page takes the
transport's Http path, as the sibling rig documents), screen-reader behaviour, or
anything about a real send — that is `../composer-timeout-live/`, which drives
the same composer through a real 20 s deadline.

## Round 3: the frames were re-taken, and the chip is why

Every frame in this set was re-rendered from the same command at this change's
head, and the difference a reader can see is the chip: the rig used to stage it at
`/tmp/notes.png`, a PATH a page cannot render - the app reads attachment paths
through the main process - so each frame carried a broken-image icon that reads as
a product bug (review round 2, D7). The rig now stages a pasted screenshot
(`data:` URL), which is the shape this app holds a clipboard image in, so the chip
that says a file travelled with the message is legible and the notice is surrounded
by the state it is about rather than by a rendering artefact of the rig.

**The before half was NOT re-taken**, deliberately: it is `origin/main`'s own rig
run from a detached worktree, and its chip is the old path, so the two halves
differ in that icon. The difference is the RIG's, not the app's, and it is stated
here rather than left for a reader to read as a product change; every geometry
reading, every sentence and both halves' controls are the same pair as before.

## The answer press's two arms, and their before half

`<w>-answer-busy.*` and `<w>-answer-unreachable.*` are the two refusals the
answers route answers with a CODE, rendered in the band that carries an option
press whose card is already gone (design round 1 on that change, D1/D3/D4/D5).
Both frames come from the SHIPPED `answerReport` — the function the chat pane
itself calls — fed the failures the merged route produces, so neither sentence is
written into this rig: the busy arm's body is `_runtime_busy_refusal()`'s own
(`503`, `code: runtime_busy`, `retryable: true`, `retry_after_ms: 2000`) and the
dead-owner arm's is the ladder's `runtime_unreachable`, both carrying the same
sentence and differing only by their code, which is the app's job to read.

The six `<w>-answer-*-before.png` frames ARE `origin/main`'s own rendering:
the same rig, the same page, the same states, and the two state expectations set
to what the pre-change tree paints (the pair was taken with `origin/main`'s
`ask-answer.ts` checked out over this branch's, then restored — not a `git
stash`, which is machine-wide in this repository's shared `.git`). **That run
wrote its frames and then FAILED its own assertions, and the failure list is the
evidence**: at every one of the three widths it named the false lead and the
backend's vocabulary, on the rendered pixels —

```
892px: the notice's own words do not carry "isn't confirmed yet":
  "Your answer was not sent. Session owner is unavailable. Reconnect and reconcile before retrying."
892px: the notice is drawn as danger where this arm is muted
892px: the notice says "owner", which is the app's word for its own machinery
892px: the notice's own words do not carry "could not reach this chat's session":
  "Whether your answer landed is not knowable. Session owner is unavailable. Reconnect and reconcile before retrying."
```

So the busy arm used to state a fact the answer route does not establish ("was
not sent" over a write-then-wait request whose acknowledgement was lost), in the
backend's noun, beside an instruction — "reconnect and reconcile before
retrying" — that names no control on this screen and that the app had already
carried out under its own bounded repeat. The `owner` line is the rig's
pre-existing jargon assertion, which the band failed on the pre-change tree and
passes on this one.

The notice's structure, at the width the canvas pane leaves: 55.5px of notice at
600px of column, one sentence, `Retry` then `Clear`, and the line the user is
typing not moving at all when a notice appears.
