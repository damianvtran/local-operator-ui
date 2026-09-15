# Round 3 — U14/Q7 refusal retention on the created-session arm

Claim: a leading-slash refusal on the FIRST message of a NEW chat hands the user's
text back, exactly as the same refusal does on an existing session. Before this
round it did not: the box came back empty behind `Discard unsent message`, with
the copy instructing the user to move text that was on no surface at all.

Author: coder, one commit on `feat/composer-slash-parity`. Reviewed head
`a1116df4aa894228b58d2054d373f3ae0e44410e` (merge of `origin/main`) is the
"before" tree; the fix is the commit this file lands in.

## Rig

The inherited review renderer, unchanged: Vite on `http://localhost:5317` for
this worktree, the isolated QA backend on `:18762` through its logging proxy on
`:18763`, home `/tmp/qa-slash2/home`, run dir `/tmp/qa-slash2/run`. Driven with
the browser tool; no Electron window, no operator session touched. The pre-fix
still is from that tree before the fix was applied, the post-fix still from this
head, both captured the same way and both visually read.

## Repro, and what each arm does

1. New chat (no agent) -> type two lines whose first begins with `/` -> Send.
2. `POST /desktop/sessions` -> 200, `POST /desktop/sessions/<id>/messages` -> 422.
3. What the user is left with:

| Frame | Box | Controls |
| --- | --- | --- |
| `r3-u14-refusal-before.png` (`a1116df4a`) | EMPTY (`Ask me for help`) | `Discard unsent message` only |
| `r3-u14-refusal-after.png` (this head) | both lines | neither discard nor a restore, because the text is IN the box |

Live request log (`/tmp/qa-slash2/desktop-ops.log`, `backend.log`): the refusal is
`POST /v1/desktop/sessions` 200 then `POST /v1/desktop/sessions/<id>/messages`
422, on the before tree (`676b2baf9601`) and on this head (`b73cf02060df`).

Also exercised on this head, after the fix:

- **A full page reload of the refused draft restores the text into the box** and
  re-renders the copy. On the before tree the same reload re-rendered the copy
  and left the box empty, which is what made the retention record invisible: the
  row (with `activeDraftKey`) is in `canonical-sessions-storage` either way, and
  no route read it back into the composer.
- **Pressing Send again re-attempts the MESSAGE, not the leading command:**
  `POST .../messages` 422, not `POST .../commands`. This needed the caret to be
  restored with the text: a newly mounted composer sat at position 0, the planner
  reads the token at the caret (`slash-submit.ts`), so the leading `/usage` line
  read as a command to RUN and the refusal's own remedy swallowed the message.

## Why the text was lost, stated precisely

The store never lost it. `admitChatDraft` writes `submittedText` before the
request and the row is persisted, so both lines were in the draft row the whole
time and the copy rendered from the same row. What was missing was a REACHABLE
source: the composer's text is per-conversation local state, the page keys the
panel on `panelIdentityFor(draftKey, id)` (`id ?? draftKey`), and on this arm the
session id arrives inside the send - so the identity flips mid-send, the
composer that sent the draft is unmounted, its own refusal restore goes with it,
and the replacement mounts empty. The store now hands the composer the retained
text (`refusedBeforeAdmissionText`) and the composer adopts it under the box's
own rule (`restoreSubmittedText`, only into an empty box).

## Evidence in the suite

`scripts/canonical-chat.test.mjs`, run through the repository runner:

| Head | Command | Actual |
| --- | --- | --- |
| before (src change stashed, new cases kept) | `node scripts/run-desktop-tests.mjs --test-concurrency=1 scripts/canonical-chat.test.mjs` | exit 1; 36 pass / 2 fail; both new cases fail at the restore source (`refusedBeforeAdmissionText is not a function`), with every retention assertion above it green |
| this head | same | exit 0; 38 tests, 38 pass, 0 fail |

Pre-fix log: `/tmp/pr143-r3/u14-before-test.log`.

## Gates on this head, and U15

- `pnpm lint` exit 0 (511 files, 33 warnings, no fixes); `pnpm check-types` exit
  0 (main and renderer); `pnpm build` exit 0.
- `pnpm test:desktop`: 1041 tests, 1040 pass, 1 fail. The failure is
  `scripts/submit-latency.test.mjs` "M1/M2/M3: the warm removes the engage from
  the send" (`'warm' !== 'warming'`), and it fails identically at the pre-fix
  head with this round's changes stashed - pre-existing on `a1116df4a`, not
  introduced here, and not touched by this round.
- U15 is deferred, not fixed. The copy's own first suggestion (prose first, the
  command below) does produce the refusal's outcome only if the caret is NOT on
  the command's line: measured against the shipped planner,
  `prose\n/usage` with the caret at the end is `{"kind":"splice"}` (the command
  runs, the prose survives unsent) and the same draft with the caret on the prose
  line is `{"kind":"send"}`. Closing that gap means changing the planner's
  caret precedence - a re-plan, explicitly out of this round's scope - and no
  rewording of the sentence makes the two steps one. Nothing is lost either way:
  the prose stays in the box and one more Enter sends it.
