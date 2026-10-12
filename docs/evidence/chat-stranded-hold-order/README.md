# A stranded send: the exchange a window aged past, in both rankings

The report was "the conversation history renders messages OUT OF ORDER in a
session — the newest user message shows, but much older messages (a 'push it to
my private github' exchange) stay stuck at the TRAILING edge of the
conversation, not in their correct position." The session was `9c59d684d16b`,
the exchange was sent at 19:00:41. The trailing-edge behavior across re-opens
is the operator's report, not a live UI capture by this PR. The fixture replay
reproduces a pane ending at 7:06 PM content under rows placed up to 20:03;
the journal is correctly ordered and the reducer replay explains the ranking.

The mechanism, tested end to end in `scripts/transcript-strand-hold.test.mjs`:
a desktop send mints a provisional echo, and `withTimeOrder`'s tail block holds
the echo — and every row admitted while it pends that no merge states on the
owner's side — below all placed rows until a closed merge carries the echo's own
durable row. A send whose row ages out of the loaded window never gets such a
merge (tail-only reads never reach it; the delta filter excludes it;
`sealDisjointBlock` refuses echoes), so the hold never discharged. The fix
releases the hold when a contiguous owner window's OLDEST entry is strictly
newer than the echo's stamp — the window is journal-older than its whole range,
so the send cannot be "after everything here" — with an owner-stated row older
than the echo and ANY row newer than it already in the pane. A streamed row or
another pending local echo qualifies on the newer side; it is not evidence of
acceptance or delivery. The scan uses pre-merge records: if the first newer row
is supplied by this page, this read keeps the hold and a later qualifying page
read (even the same page again) releases it. A live event alone does not re-run
the discharge; this conservative one-read lag is documented and pinned.
The operator reported watching the live stream when they looked: a rule that
also required the pane itself to lie behind the window never fired for the shape that was reported, which is why
the Tail pair below folds the whole stream and not just the exchange.

## Why a story pair is the faithful capture

A fresh app open of a copied session cannot show this: the disorder is born of
the send, lives in the loading pane's in-memory state, and a cold open folds the
same journal bytes into a correctly ordered transcript. The story-through-
reducer pair is therefore the faithful capture — both orders are folds of the
SHIPPED reducer over the session's own payloads, and the `Before` ranking is the
pre-fix engine's rule spelled out (a pending echo's block, rows a read re-states
leaving it). The equivalence is measured, not asserted: the PR's probe folds
both window sets through the BASE tree's own reducer
(`.worktrees/base-probe-order` @ `8d2b153`) and through the story's spelled-out
`Before` rule, and the record ID order is identical for both stories. This is
not byte-identical reducer state: the base echo retains `provisional: true`,
while the story partitions a discharged state with that key removed. That
hold flag does not affect rendering of the user row; no frame pixels change.

## The frames, and what each shows

All four stories render the production transcript component with the reader's
pane height pinned (the same frame shape `chat-stale-seed-order` uses), over the
real session window; both brand palettes.

- `before-tail` / `after-tail` — the reader's pane AT THE END of the pane. The
  before ends the conversation at the tail block's own 7:06 PM content (`Worked ·
  25 actions 7:06 PM` is the pane's last line) while the newer reads' content
  (to 20:03) sits above the block; the after ends at the newest rows — the
  20:02-20:03 turn is the pane's last. The captions state what the bytes show.
- `before-slot` / `after-slot` — the exchange's own neighbourhood, where the
  ORDER itself is visible in one pane. The before reads: 6:57 held rows, then
  the 19:07 3D note ABOVE the 19:00 send — the pane's order steps back in time;
  the after reads 6:57, 19:00 send, its reply, the 19:01 alias row, then the
  19:07 3D note last. Same visible rows, same pane; the ranking changes (and the
  non-rendered hold flag differs as explained above).

### Visible artifacts and capture limits

The slot pair freezes the production **Loading earlier messages** arm:
`use-scroll-paging.ts` selects it for `loadingOlder || revealInFlight`. This
static story never lands that requested earlier page, so the still is not
evidence that a live application is stuck, nor a completed paging interaction.
The narrowed slot rows are shorter than the pinned 685px pane; the blank below
their last row is remaining pane space, not a clipped capture.

The fixture carries attachment references/metadata but **not stored attachment
bytes**. The strips therefore show placeholder glyphs and user cards show the
production unavailable-copy sentence. No image bytes were stubbed: that would
introduce non-session pixels into order evidence. These stills prove row order
and placeholder placement, not successful rendering of the original images.
The after-tail window ends on the 20:03:08 tool results, before the turn's
closing answer. Its `Took 1m4s · 3 actions · 3 images` bar therefore has neither
closing prose nor a timestamp: `turn-summary.tsx` renders no stamp when
`stampTs` is null (there is no closing answer instant in this captured window).
That is production-faithful partial-window content, not truncated frame bytes.

One trade-off is named rather than discovered, in `releasedEchoes`' docblock and
pinned by its own test: an owner clock running AHEAD can stamp a PRE-send page
row past the pane's own span, and the discharge ranks it by its stamp until the
merges that state the send's own row land — the same destination the pre-fix
code reached the moment a carriage dissolved the block, shown earlier.

## What produced them

Storybook built from this tree, through the repo's own capturer:

```
pnpm exec storybook dev -p 6127 --no-open
node scripts/capture-evidence.mjs http://localhost:6127 \
  --only=chat-stranded-hold-order --themes=localOperatorDark,localOperatorLight \
  --allow-backend
```

Captured on a **clean tree** at `e99f3f4f9` — the story, its `STORIES` entry,
the fixture, the reducer and the test are all committed at that head, and
`manifest.json`'s `dirtyWorkingTree: false` records it. The fixture is session
`9c59d684d16b`'s own journal window (held page, the send, the exchange, the
live-tail stream, the two entirely-newer reads), derived with ids/ts/order
untouched and text truncated; attachment references are retained but stored
attachment bytes are not included. `scripts/transcript-strand-hold.test.mjs`'s
header carries the journal-field transforms. This remediation changes only
prose and test coverage; the approved frames and their capture record remain
unchanged.
