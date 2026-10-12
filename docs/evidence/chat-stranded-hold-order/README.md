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

## Source-primary follow-on (PR994 / core2274)

The historical discharge mechanism and committed frames below describe the
legacy lane, not the new source guarantee. The companion source contract adds
all-complete-row `journal_seq` under an opaque equality-only generation.
Supported source viewers order by that domain, with explicit provisional slots
and causal ownership; clocks are labels only. Unsupported/omitted authority
retains the legacy lane without claiming the journal guarantee.

The source-primary after stories now derive coordinates from captured full-journal
line windows in `transcript-strand-hold.test.mjs`, not by enumerating selected
pages. Their 400 unique offsets305..704 include silent rows and agree across all
captured overlaps. The generation is explicitly a synthetic replay domain, not
the original session's current live source. Quiet ID-only metadata heals the echo
without transferring its images or payload to another record. The before story
remains the documented legacy ranking reconstruction; original pre-crash memory
was lost (manager report), so no original live before frame is claimed.

Fresh author browser-tool frames are private in the session scratchpad
`source-browser/` (source-after-slot pair, source replay before, and real isolated
TCP source paging/quiet correction). Those are production CanonicalTranscript
pixels, not these older committed captures. Missing original image bytes remain
explicit placeholders, not attachment-success evidence. The independent terminal
code/QA/design rounds must read the frozen head and that new evidence.

A separate synthetic real-router / production-hook checkpoint run placed an
initially unmounted in-budget target1100 rows back at pane-top+24.02px after real
`before_id` reads. The 4100-row first checkpoint exceeds pre-existing D7 limits:
12pages /1200mounted rows (`reveal-record.ts`); it correctly refuses after the
bounded reads. No arbitrary-distance/far-window success or new paging design is
claimed. See the continuity design note for source matrix and execution boundaries.

## Accepted round-2 source remediation

The three source findings were reproduced before this batch: legal raw
`synthetic:raw-send` was omitted from lookup and remained provisional; an
obsolete ready A delivered after installed B survived three fresh B reads; and
512 legal UUID/ASCII128/Unicode128 IDs produced HTTP431 on the production Vite
proxy before the request reached core. The respective measured request URLs
were 24,139 / 71,243 / 583,243 bytes. These are isolated synthetic fixtures, not
the original user's IDs or a reconstruction of the lost native cache.

Raw lookup eligibility now follows record kind/provenance, not punctuation.
A read captures the identity of the ready demand it was dispatched to resolve:
a fresh authoritative answer discharges that pre-existing debt, while a distinct
wake during the read stays owed. This witness is not another revision counter;
generation comparisons remain equality-only and caller revision/view fences
still own whether a response may commit.

All source GET/history/browser/native targets share a conservative **6 KiB
encoded request-target budget plus the API's 512-ID count limit**, measuring
URLSearchParams escaping and the actual path/fixed/cursor query overhead.
Omitted cached IDs remain unresolved and continue through sequential same-domain
metadata reads; attempted/missing IDs are tried once per sweep and attempts reset
on a new authoritative domain. Quiet repair consumes only coordinates and
verified ownership from the snapshot route, not its tail payload, images, reader
cursor, planner history or frontend projection.

Author verification used a private isolated production Vite proxy + FastAPI
router/DesktopSessions/transcript-index plane, fresh synthetic sessions, existing
worktree dependencies and no inherited CMUX/LOP/XPC variables. Shipped browser
transport URL construction was captured at the EventSource seam and its bytes
read by real HTTP; this is **not browser scheduling or full ChatPage evidence**.
For 512 raw identities each, actual stream/snapshot/history requests succeeded:

| IDs | Stream target bytes / carried IDs | Quiet repair reads | Final result |
| --- | --- | --- | --- |
| UUID36 | 6102 / 128 | 4 | 512 confirmed, 0 unresolved |
| ASCII128 | 6063 / 43 | 11 | 512 confirmed, 0 unresolved |
| Unicode128 (`漢`) | 5781 / 5 | 84 | 512 confirmed, 0 unresolved |

Snapshot tail coordinates independently attest cached rows and reduce subsequent
lookup demand; no cached payload or backward cursor was adopted from those tails,
no ID was retried, and all own fixture text/ordering survived. Maximum repair
request targets were 6112 / 6026 / 5744 bytes. The durable regression also sends
actual native-relay fetch/SSE traffic through an 8 KiB HTTP parser, exercises
escaped punctuation and long cursor/base-query overhead, and pins both shipped
hook stale-before-dispatch convergence and distinct-during-read wake handling.
A further isolated production-core execution of the actual main-process relay
also returned HTTP200 snapshots for all three 512-ID sets. With a128-character
epoch and receipt cursor carried too, native request targets were6128 /6091 /5948
bytes, carrying125 /42 /5 IDs respectively. Both proof planes were reaped by
owned process groups. Neither proves full packaged ChatPage/native IPC capability
negotiation or the timed browser source-reset checkpoint flow.

These source-only fixes change no layout or interaction. D1's terminal design
round remains valid on the unchanged rendered surface. The previously supplied
loading/connection-error PNGs are not twelve-page-refusal frames. The real near
checkpoint proof is ten sequential HTTP200 100-row backward reads, cache
100→1100, target3000 landing24.02px inside the viewport; seam-wheel paging and
arbitrary far-window jumps remain unclaimed. Original native before-memory/image
bytes remain unavailable. Current-head independent code/QA and whole CI gates
remain separate from the author checks above.

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
