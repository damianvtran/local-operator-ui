# The rows written while the reader was on another conversation

The report was "I only start getting new messages past that point": in a
conversation A, the user steered a turn in flight, switched to B, and came back
to A — and every row written after the steering message (the assistant rows and
the tool calls between the steer and the return) was missing until new frames
arrived.

The frames here are the transcript itself, in the states the fix is about:

- **`gap/`** — the transcript the client ended up with. The re-subscribe
  snapshot's history page is read `through_id=<the owner's published
  history_cursor>`, so the page's newest entry IS that cursor by construction,
  and a cursor refreshed at the steer bounds the page at the steering row. The
  rows after it are in neither the page nor the live seed, so the conversation
  jumps from the steer straight to the live tail.
- **`restored/`** — the same transcript once the reconcile reads the unbounded
  durable tail back and merges it by id. Built the way the walk merges it: one
  `applyHistoryPage` per page, newest page first, ending with the page behind
  the tail — not as one page assembled by hand.
- **`restored-running/`** (the two `localOperator` palettes) — the state the
  report is about: the reader returns WHILE the turn is still running. The
  restored stretch carries one call that succeeded and one that failed, and
  below them the turn's own liveness line, the running call it names, and the
  transport notice a reconnecting reader is looking at.

## What produced these frames

Storybook, through the repo's own `scripts/capture-evidence.mjs`:

```
npx storybook dev -p 6017 --ci --quiet
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-reconnect-gap --allow-backend
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=restored-running --themes=localOperatorDark,localOperatorLight \
  --allow-backend
```

The stories (`Chat/Reconnect gap`, `reconnect-gap.stories.tsx`) render the
production `CanonicalTranscript` from transcripts built by the PRODUCTION
reducer out of wire-shaped frames — the way `chat-tool-rows--joined-mid-turn`
builds its rows. Nothing is hand-drawn, and the frames differ only by the merge
the fix adds.

What the pair is here to catch is the SEAM a merge can introduce, and the three
shapes in it that a still can show:

- a duplicated row (the walk's last read is a page it already holds, and the
  merge is by id — a second copy of a row would be visible here),
- a row out of order (the restored rows join the live tail at the ledger's own
  pitch),
- a row that has to be LABELLED by a page other than the one it came in on: the
  tail page carries the tool results, while the assistant row holding their
  arguments is one page further back, so a broken cross-page backfill paints the
  object column with the output's first line instead of the call's arguments.
  `restored/` exercises exactly that boundary, which is why the tail is split
  across two pages here rather than passed as one.

The id-set assertions in `scripts/reconnect-page-gap.test.mjs` cannot see any of
those; they assert which rows are present, not what they look like.

**The running frame is anchored to the capture's clock, not to the fixed instant
the other two use.** A running row's elapsed counts up to the machine's clock,
so a frame pinned to a past instant would photograph a call that started then as
`100d+` — a fixture artefact rather than a state the app can produce. The same
reason the tool-row stories pin `Date.now()` offsets. `gap/` and `restored/` stay
on the fixed instant so they re-capture against the same conversation.

`--allow-backend` is stated rather than implicit: the operator's own backend is
listening on `127.0.0.1:1111`, and these stories never talk to it — they render
fixture records and call nothing. The flag exists for exactly this case and is
opt-in per narrowed run.

## Local scaffolding these frames needed, and why it is not committed

Two things on this head stop Storybook rendering anything, both pre-existing and
outside this change:

- **`react-docgen-typescript` crashes on TypeScript 7** (`Cannot read
  properties of undefined (reading 'React')`), so the preview never builds. The
  frames were captured with `typescript.reactDocgen: false` set locally in
  `.storybook/main.ts`, and that edit is **reverted before this commit** — it is
  a workaround for a broken dev-tooling default, not part of the fix.
- **`.env` copied from `.env.template`** — with `VITE_PUBLIC_POSTHOG_HOST`
  given the schema's own default, because the template ships it EMPTY and the
  app's own zod schema rejects `""` for a URL field, which fails the story with
  "Configuration validation failed".

Because the docgen patch touches a file outside `src/` and `scripts/`, the
manifest's `dirtyWorkingTree` records a dirty tree; the stamped `srcTree` and
`scriptsTree` are the committed ones and are unaffected by it.

## Known limits

The reconcile reads back at most `RECONCILE_WALK_MAX_ROWS` (500) durable rows,
walking backwards a page at a time until a fetched page overlaps a row the
snapshot painted. That walk is the shape for the case where SOMETHING was
painted: with nothing on screen no fetched page can ever overlap, so the read
stops after the single page its own snapshot justified. Three batches reach that
state — a cold or cursor-less snapshot, an attention frame naming an unpainted
anchor, and a label-gap retry whose seed paints no message id — and the rule
lives in `reconcileTail`'s docstring. **Two of the three are asserted**
(`reconnect-page-gap.test.mjs`: the attention anchor and the cold snapshot, each
on a transcript long enough for a walk to reach its bound); the label-gap
variant is not driven by a test, because the guard it would exercise is the same
one those two cover — the branch keys on the painted set, not on which frame
asked. The three-batch list above is `reconcileTail`'s own docstring in
`use-canonical-session.ts`; the test file's comment counts two, and two is what
it asserts.

An absence wider than the bound cannot be closed through this route, which has no
forward cursor — the complete answer for a very wide absence is a snapshot whose
page is not bounded by a stale cursor, which is the backend half of this defect
and is being fixed separately.

The read is one shot at snapshot time, so a row that becomes durable *after* the
read and whose live event was missed while away is recovered by a later trigger
(another snapshot, an unpainted-anchor `attention` frame, a label-gap retry)
rather than by this read re-running. Same family as the row bound, and closed by
the same backend half.

## Re-taken for the turn stamp

These frames were re-shot by `feat/transcript-timestamps`, which puts the date and time under
a user turn (`3:42 PM`, `Yesterday 3:42 PM`, `Sep 12, 3:42 PM`, `Sep 12, 2025, 3:42 PM`) and at
the foot of an expanded tool call. Nothing about this surface's own subject changed: the user
turn at the head of this transcript now carries a stamp, and because the transcript is
bottom-pinned that addition shifts the rows above it, so the frames move by more than the
stamp's own pixels. The frames for the change itself, its before/after pair and the four
shapes of the formatter are in [`../chat-tool-rows/`](../chat-tool-rows/) (see *The turn
stamps*), with the before half declared in [`../turn-stamps-before/`](../turn-stamps-before/).

ONE STATE GAINED PALETTES IN THIS PASS and it is worth knowing before diffing:
`restored-running` was committed in the two brand palettes only (an earlier targeted
refresh), and the twelve-palette run that re-took this surface reached it too, so it now has
all twelve. The alternative was leaving ten of its frames showing the pre-change pixels.
