# A finished conversation read with a stale seed: the order it ends in

The report was "when I click into a completed session I see tool calls loaded
AFTER the final message from the agent, where I'd expect the final message to be
the last row of a finished conversation." The session was `f91fbda61750`
("Runtimes interrupted by updates"), and the rows under its final message were
`wait`/`hub`/`task`/`bash` rows from the previous morning.

## The four surfaces

- **`before-arrival/`** — the finished conversation with the runtime's **real**
  seed (100 settled calls, 67 of which the durable page cannot label) folded in
  at the reader's arrival, the way the pre-fix reducer folded it. In the reader's
  own pane the newest rows are the stale ledger lines: the answer is not on
  screen, and the pane's closing stamp is the reader's own clock.
- **`after-arrival/`** — the same page and the same seed through the fixed fold.
  The pane ends at the answer and its own `12:56 PM` stamp, with nothing under it.
- **`before-seam/`** — the same state with the seed narrowed to the newest
  twelve calls the page cannot label, so the answer and what sits under it fit
  one frame: twelve stale rows carrying raw stdout in the object column, ending
  at the reader's arrival. That raw-stdout row is the deferred state design
  round 1 recorded as D3 (the fix is the missing-object state the label-gap work
  owns), shown here for free.
- **`after-seam/`** — the same twelve refused: absent, not greyed and not
  captioned.

## These are ONE TREE's frames, not a base/head pair

Both orders are built by the **shipped** reducer from this branch's own fixture,
`scripts/fixtures/stale-seed-order.json`, which is the real journal of
`f91fbda61750` (see `scripts/seed-placement.test.mjs`'s header for the derivation
and every transform):

- the **pre-fix** order is the pre-fix fold spelled out — `applyEvent` once per
  seed event at the reader's arrival clock, which is literally what the pre-fix
  `applyLiveSeed` did;
- the **post-fix** order is `applyLiveSeed(..., streaming: false)` as the hook
  calls it.

So the pair shows the ORDER each fold produces, and it is not a base commit's
bytes: a pair captured from two trees photographs the fix but cannot be
re-captured once the base moves on. The story is
`src/renderer/src/features/chat/canonical/stale-seed-order.stories.tsx`.

## Why the pane's height is pinned

The story pins the transcript pane to 685px — the transcript's measured
`clientHeight` in a 1380x900 window, the height a reader actually reads at. A
transcript story with no fixed height lets the capture grow its viewport to the
document, and a full-content still of this state would paint the answer 48% down
a 3058px frame instead of out of the pane, contradicting the caption beside it.
The frames are therefore what a reader is looking at, and the caption is true of
the bytes. The two Arrival captions sit in a fixed two-line box so the pair
overlays when a reviewer flips between them.

## What produced them

Storybook built from this tree, through the repo's own capturer:

```
pnpm exec storybook dev -p 6106 --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:6106 \
  --only=chat-stale-seed-order --themes=localOperatorDark,localOperatorLight \
  --allow-backend
```

Captured on a **clean tree**, which is what `manifest.json`'s
`dirtyWorkingTree: false` records: the story, its `STORIES` entry, the fixture
and the reducer are all committed at the head the frames were taken from.
