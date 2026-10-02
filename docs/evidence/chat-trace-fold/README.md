# The trace fold's header: the sentence it says, the count line it caps, and the wrap that backs it up

The fold is the transcript's condensed group
(`src/renderer/src/features/chat/components/trace/trace-fold.tsx`): three or more
consecutive calls roll into one row (`> 3 shell · 1 python · 12s`), the reader
presses it open, and the header states what the run did — a class sentence when
the run is one or two kinds (`Explored 4 files, delegated 3 tasks`), a per-kind
count line when it is not (`3 shell · 1 python`), both composed by `foldSummary`
in `src/renderer/src/features/chat/canonical/trace-fold-model.ts`.

**This set is the fold's own states, and this file is the record it did not have
until this change.** Its directories are the sweep's cells under
`chat-trace-fold--…` in `scripts/capture-evidence.mjs` — the live header, its
long-name and mid-run shapes, the groups that arrived condensed, the picture
strip with its hover and focus states — photographed in the two `localOperator`
palettes (the brand pair; the other palettes are the theme gate's business), so a
re-run of the commands below reproduces them.

## The operator's report (2026-10-01, relayed by Aida)

> 6 searches · 1 task · 2 browser actions · 1 ai_search · 1 get_tool_access ·
> 1 query_data_sources · 1 todo update · 1 wait · 1 workspace_get_gmail_thread_content
>
> "make sure that wraps or has a summarization of everything past the most
> majority tool calls like 'and N other actions' for less majority classes of
> actions so that we have a cap of how many unique action types will show up per
> line."

Nine unique action types on one line, wider than the column at every realistic
window: the state [`../chat-trace-fold-before/`](../chat-trace-fold-before/)
photographs, ellipsised from `1 query_…` on.

## What the cap does (`FOLD_COUNT_LIMIT`)

- **Five segments, then a tail.** The line shows at most `FOLD_COUNT_LIMIT` (5)
  unique action-type segments; the kept ones are the first five in the line's own
  order — the sentence's class order (files, searches, web, shell, python, edits,
  tasks), then the meta kinds by count and name — so whatever falls into the tail
  is what that order already ranked least-major.
- **The tail counts CALLS, not types** (`and N other actions`): the same unit
  every other number on the line counts (the bar's `N actions`, the foot's `N
  actions`), so a reader who adds the kept segments to the tail still reaches the
  turn's action count. `1` singularises (`and 1 other action`). The number of
  hidden TYPES is deliberately not stated — the tail is a measure of work, and
  the expanded rows are the lossless record.
- **Short lines are unchanged**: at five segments or fewer the string is
  byte-identical to what it has always been, which is why every expectation in
  `scripts/trace-fold-model.test.mjs` that predates the cap still passes
  unedited.
- **Expansion stays lossless**: the summary was never the record — the rows
  behind the trigger are, and one press still shows every one of them.
- **The header's `title` tooltip carries the same string**, so hovering a folded
  group reads exactly what its header paints.

The operator's own run composes to `6 searches · 1 task · 2 browser actions · 1
ai_search · 1 get_tool_access · and 4 other actions` — it is the first case in
`scripts/trace-fold-model.test.mjs`, and the `many-types/` frame.

## What the header does when the line still cannot fit: it WRAPS, and it FITS

The summary span no longer truncates. `truncate` (ellipsis) was the older rule and
it is what the report replaced — a cut count line cannot say which actions the run
hid — so at a minimum-width column, or beside a live clause whose object is long,
the counts wrap onto the next line and the row grows (`min-h-5`, so the ledger
pitch opens only where a line genuinely needs it).

**The yield order is the two flex factors, and both halves were measured in the
Chrome this ships on rather than reasoned about.** Flex hands each item a share of
the deficit proportional to `factor × basis`:

- the live clause yields at `shrink-[100000]`. Against the summary's default `1`
  its share is under a layout unit, so the counts keep their exact one-line width
  while the name truncates — D1's ruling. The weight is an order of magnitude
  above the `999` the first draft used, because at `999` the summary still lost
  0.05px and wrapped in the `long-name` state (a tenth of a pixel is enough: the
  wrap needs one layout unit, 1/64px);
- the summary carries **no factor of its own** (the default `1`), which is what
  makes it the element that pays once the clause has no width left — or never
  mounted at all, which is a settled header at a narrow column. A tuned low factor
  (`shrink-[0.01]`, the first draft) left the capped line holding 558px inside a
  540px line at the 640px window and pushed the stamp and the time 52.7px past
  the row's own right edge. With the factor gone the same state takes the whole
  deficit and breaks: `lastRight` 592 == the line's own right edge, which is what
  "fits" means in the numbers below.

The two claims are independent — the clause-priority one is the `long-name` and
`image-live` frames coming back **byte-identical** (`compare -metric AE` = 0
against the committed frames), the fit one is the `lastRight` reading — and both
are asserted in `scripts/trace-fold-behaviour.test.mjs` so a tuned factor is a
failing test rather than a silent re-derivation of the evidence.

## The pair

| frames | tree | what they show |
| --- | --- | --- |
| `many-types/` — 2 frames (1280×130) | this branch | the operator's nine-type run, capped and on ONE line: `6 searches · 1 task · 2 browser actions · 1 ai_search · 1 get_tool_access · and 4 other actions`, the `1h` span intact at the far end |
| `many-types-narrow/` — 2 frames (640×130) | this branch | the same capped header at the 640px window: two lines (`… · and 4` / `other actions`), the `1h` span still inside the row |
| [`../chat-trace-fold-before/many-types/` + `many-types-narrow/`](../chat-trace-fold-before/) — 4 frames | `af6fffa899` (this branch's cut point) with ONLY the new story cell and its sweep rows added | the UNCAPPED line: nine segments, ellipsised (`1 query_…` at 1280; truncated mid-word at 640) — the state the report quotes |

The before half's base is the branch's cut point, the same convention
[`../chat-turn-collapse-before/`](../chat-turn-collapse-before/) uses for its own
pair.

## The numbers

The fold entries read the count line's box by its `data-fold-summary` marker, and
the LINE box plus its last child's right edge — the reading that tells a row that
fits from one that overflows.

```sh
node scripts/chat-alignment-geometry.mjs http://127.0.0.1:6077
```

| state | summary (left→right) | width | height | lines | line (left→right) | last item right |
| --- | --- | --- | --- | --- | --- | --- |
| `many-types` @1280 — after | 52 → 610.7 | 558.7 | 19.5 | **1** | 52 → 712 | 644.7 |
| `many-types-narrow` @640 — after | 52 → 558 | 506 | 39 | **2** | 52 → 592 | **592** (fits) |
| `many-types` @1280 — before | 52 → 678 | 626 | 19.5 | 1 (ellipsised) | — | — |
| `many-types-narrow` @640 — before | 52 → 558 | 506 | 19.5 | 1 (truncated) | — | — |

The before rows are read the same way, except that the marker does not exist on
the pre-change span: the rig-only attribute was added to it by hand for that
measurement (a `data-` attribute has no rendering effect, and the before FRAMES
are from the patch-free tree). The before line/last-right cells are left out
rather than guessed — that probe change landed with this pass, after the before
frames were taken.

The 640px half of the table reads on two trees: the before half photographs this
branch's cut point, whose column gives the summary the same 506px of room it has
here, and the AFTER half's two numbers are what changed — one line becomes two,
and the row's last item ends exactly on the line's own right edge instead of 52px
past it.

## How they were taken

```sh
node scripts/capture-evidence.mjs http://127.0.0.1:6077 \
  --only=chat-trace-fold --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=180000
```

Storybook 8.6.12 on the shipped `.storybook/main.ts`, headless Chrome as the rig
always runs it, `--allow-backend` because the operator's live daemon answers on
:1111 and must not be stopped for a capture (every story here is a static
fixture).

**The whole set was re-taken on the folded tree** (after this branch folded
`origin/main` = `0d4db85a5e`), not only the two new cells, and again after the
yield factors were corrected — so the frames this record owns are the ones the
shipped code paints. Every frame came back byte-identical across those passes
except the cells the correction is about (`many-types-narrow/`, where the row
stops overflowing) and `images-many-hover-reduced-motion/localOperatorDark`
(390 pixels at ≤5/255 — the same difference a re-capture on the *unmodified* tree
reproduces, measured, so it is the environment's encode rather than this change;
the strip it sits on is untouched by both).
