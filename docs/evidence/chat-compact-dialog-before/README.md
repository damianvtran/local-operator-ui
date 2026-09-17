# `/compact` before the change: the dialog that never closes itself

The before-half of the change that deleted `/compact`'s dialog. These frames are
**not** from this tree: they are captured from the base commit `9adf108dc`, in a
detached worktree, because the component they photograph (`CompactView`) is
deleted by the change. The manifest declares the set under `supplementary` for
exactly that reason — a sweep of the shipping tree cannot produce them, so
nothing here pretends a sweep can.

| Frame | What it settles |
| --- | --- |
| [`pending`](pending/) | The state the operator was stuck in on the way to the bug: the owner's own optimistic receipt for `/compact` (`compacting context…`, the literal `_compact_slash` returns) has arrived, no `compaction` record has landed, and the dialog is spinning on `Applying the change…`. Nothing on this surface can retire it except its own Close. |
| [`settled`](settled/) | **The defect.** The record the dialog was waiting for HAS landed — the transcript carries the real reducer's own `Context compacted, 41.0k to 9.0k tokens` — and the dialog is still open on the same closing control, now labelled `Done`. The pass is over and the surface has not said so; the user has to dismiss a modal to get back to a transcript that already knows. |

Both frames at 1280x360, `localOperatorDark` and `localOperatorLight`.

## What the rig is, and the two stand-ins in it

`harness/compact-dialog-repro.stories.tsx` mounts the **real** `CompactView`
through the **real** `PickerHost`, from the base commit's own tree, with exactly
two stand-ins and nothing else:

- `window.api.desktop.request` answers `sessions.command` with the same
  `CRUDResponse[CommandReceipt]` envelope the backend sends — whose `result` is
  a receipt whose own `result` is that `SlashResult`. (Getting the envelope one
  level wrong is what the first runs of this rig measured: `toResult` then reads
  `.kind` off `undefined`, and the dialog shows a transport failure instead of
  the receipt. The frame's own strip is the check.)
- the canonical handle is a stub carrying the one field this adapter reads,
  `transcript.records`, handed in per story.

`pending` passes it no records; `settled` passes the records the **real**
reducer produces for a `compaction_end` (`applyEvent`, `success: true`,
41k → 9k). So the second frame is not a hand-written record that happens to look
like a compaction — it is the reducer's own output, which is also what the
shipping tree paints today.

A third measurement is worth recording because it is the same defect seen from
the other side: with the bridge left unmocked, the dialog renders
`/compact did not run: …` and is **also** stuck open. A dialog whose only exit is
its own Close button is stuck in every state, not only the successful one.

## How to reproduce it

From a worktree of the base commit, with `node_modules` from a checkout of the
same tree (`ln -sfn <checkout>/node_modules .`):

```sh
git worktree add --detach /tmp/lo-compact-before 9adf108dc
cp docs/evidence/chat-compact-dialog-before/harness/compact-dialog-repro.stories.tsx \
   /tmp/lo-compact-before/src/renderer/src/features/chat/pickers/     # untracked: the repo's own story glob picks it up
# and add these two rows to that tree's STORIES table, so the capturer can name them:
#   ["chat-compact-dialog-before--pending", 1280, 360],
#   ["chat-compact-dialog-before--settled", 1280, 360],
cd /tmp/lo-compact-before && npx storybook dev -p <a free port> --no-open   # 6017 and 6037 were both taken by peer sessions
node scripts/capture-evidence.mjs --only=compact-dialog \
  --themes=localOperatorDark,localOperatorLight --allow-backend http://localhost:<port>
```

Two things cost a round each when this rig is re-run, both measured here. The
first capture after a story file appears fails with `document carries theme ""
after 10s` — the capturer's 10s window is shorter than Vite's cold transform of
a new story, and the identical command succeeds on the second run. And the port
matters: Storybook self-hosts a whole renderer, so a peer session's server on
the default port makes this one fail to bind while still printing a normal log.

The **after** half of this surface needs no rig: it is the shipping tree's own
transcript, where the pass narrates itself — see
[`../chat-tool-rows/compacting-rung`](../chat-tool-rows/compacting-rung/)
and [`compacting-settled`](../chat-tool-rows/compacting-settled/), the frames on
either side of the info line. (The pair was called `compacting-pass-before` /
`-after` when this README was written; the names now say which STATE each frame
is, because every other `-before`/`-after` pair in this repo means before/after
the change — review round 1, R5.)

## The other half of the change is not a picture

The composer defect (`/compact hello` running `/compact` and eating `hello`, and
a command word inside a sentence being spliced out and run) is a decision, not a
surface, so its before/after is a table of the planner's own answers rather than
a frame. It is in the pull request, produced by bundling this repo's real
`slash-submit.ts` with esbuild the way `scripts/slash-submit.test.mjs` does, and
it is pinned case-by-case in that test file.
