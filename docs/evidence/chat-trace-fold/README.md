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
  order, which is the `order` array in `trace-fold-model.ts` and nothing else —
  the sentence's class slots (files, searches, web, the command kinds `shell` and
  `python` in the `commands` slot, edits, delegated), then the three named meta
  kinds the operator's report used (`agent`, `team`, `hub`), and every other kind
  after those sorted by count and then by noun. So whatever falls into the tail is
  what that order already ranked least-major — which also means a run with many
  `agent` calls can push a rarer named kind into the tail (agent review round 1,
  R1-6: this paragraph used to say "the meta kinds by count and name", which is
  not what the array implements).
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
- **The header's `title` tooltip is the bare total** (`13 actions`), NOT the capped
  line the header paints (`trace-fold.tsx` sets it from `actionCount`). The string
  that reads the same words as the header is the COLLAPSED TURN BAR's own title
  (`turn-collapse-model.ts` composes it through `foldSummary`), which is a
  different surface — this bullet used to claim the fold header's tooltip carried
  the capped line, and agent review round 1 (R1-1) and QA round 1 (Q1) both
  measured it as false.

The operator's own run composes to `6 searches · 1 task · 2 browser actions · 1
ai_search · 1 get_tool_access · and 4 other actions` — it is the first case in
`scripts/trace-fold-model.test.mjs`, and the `many-types/` frame.

## What the header does when the line still cannot fit: it WRAPS, and it FITS

The summary span no longer truncates. `truncate` (ellipsis) was the older rule and
it is what the report replaced — a cut count line cannot say which actions the run
hid — so at a minimum-width column, or beside a live clause whose object is long,
the counts wrap onto the next line and the row grows (`min-h-5`, so the ledger
pitch opens only where a line genuinely needs it).

**The COUNT LINE wraps at a ` · ` and never inside a phrase, and that is a shape
rather than a hope.** `foldSummarySpec` returns the line as its UNITS — each kept
segment, and the `and N other actions` tail as one unit — and says which SHAPE the
summary is. The header paints each count-line unit in a `whitespace-nowrap` span
with the separators between them, so the browser's only break opportunity is a
separator. The joined string still exists for consumers with no DOM to paint
(`foldSummary`, the collapsed bar's `title`). The first cut returned one joined
string, and the 640px frame broke `and 4 other actions` between the numeral and
its noun, leaving `other actions` alone on line 2 — design round 1's D1, measured
in the frame.

**What bounds a count-line unit is the column floor, NOT a break.** Round 1's
comment claimed `break-words` let an over-long unit break inside itself; it cannot.
`overflow-wrap` does not act inside a `white-space: nowrap` box, so on these units
the property is inert by design — agent review round 2's R2-1 is the finding, and
QA measured the served markup and bounded the consequence as Q-r2-3. The real
bound is arithmetic: the narrowest column the app can give this header is ~350px
(`WINDOW_MIN_WIDTH` 800 and `CHAT_PANE_MIN_PX` 480), and the longest unit a run can
compose is the **241.4px** `1 workspace_get_gmail_thread_content` — its own box, its text
range and a canvas measure of the same string all read 241.4 on the live component
(round 3's D4b named the unit as the claim; round 4's Q-r4-3 removed an earlier
draft's 230.6px, which reproduces under no reading of the component).
So a unit always fits and the units never break. The `many-types-kept/` cell
photographs exactly that state at 420 (five types, the long kind KEPT rather than
folded into the tail), with the geometry readout beside it.

**`break-words` on the span is for the SENTENCE, and a sentence must wrap.** The
header is told which shape it has (`FoldSummarySpec.prose`): a count line's units
hold together, a sentence is painted to break at its own spaces — which is how
`Explored 4 files, delegated 3 tasks` painted before this branch, and round 1's
first cut made it unbreakable by painting it nowrap too (R2-1's second half). Where
the sentence breaks, `break-words` is what keeps one over-long word inside the box.

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
| `many-types-narrow/` — 2 frames (**640×131** after, 640×130 before) | this branch | the same capped header at the 640px window: two lines, and the break lands on a ` · ` — `6 searches · 1 task · 2 browser actions · 1 ai_search · 1 get_tool_access ·` / `and 4 other actions`, the tail whole on line 2 and the `1h` span still inside the row. The wrap is what grows the row by the extra pixel (round 2, Q-r2-2: this row said `640×130` for the after half too, which the committed frames contradict) |
| `many-types-kept/` — 2 frames (**420×150**) | this branch | the ≤5-type run that KEEPS the long kind at the narrowest cell (round 2, design D3 / QA Q-r2-3): `1 file · 1 search · 1 web search · 1 shell · 1 workspace_get_gmail_thread_content` with every unit whole and the row inside its own right edge |
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
| `many-types` @1280 — after | 52 → 610.8 | 558.8 | 19.5 | **1** | 52 → 712 | 644.8 |
| `many-types-narrow` @640 — after | 52 → 558 | 506 | 39 | **2** | 52 → 592 | **592** (fits) |
| `many-types-kept` @420 — the long kind as a KEPT unit | 52 → 330.8 | 278.8 | 39 | **2** | 52 → 372 | **372** (fits; ink right **370 in both palettes**, per-channel |Δ| > 28 from the modal ground) |
| `many-types` @1280 — before | 52 → 678 | 626 | 19.5 | 1 (ellipsised) | — | — |
| `many-types-narrow` @640 — before | 52 → 558 | 506 | 19.5 | 1 (truncated) | — | — |

**The units hold, and the break lands on a separator.** The same two-line box at
640 is what the units change re-took: the old break was inside the tail phrase
(`… · and 4` / `other actions`, D1), and the frame now reads `… · 1 get_tool_access ·`
/ `and 4 other actions` — the wrap at the last separator, the whole tail on line 2.
The box is the same size because a wrap is what both were; the difference a still
shows is WHERE it falls. The `lastRight` reading is what says the row still fits:
`592 == 592`, the summary's own line's right edge.

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
`origin/main` = `0d4db85a5e`), again after the yield factors were corrected, again
for this round's units change, **and once more, whole, in round 5's remediation**
— at this set's documented two-palette budget (`--themes=localOperatorDark,localOperatorLight`,
23 states × 2 = **46 frames**), because that pass had left it at the rig's DEFAULT
twelve palettes (**276 frames**) while this README still documented the two; the
strays are deleted and `scripts/check-evidence-palettes.mjs` asserts the budget per
directory now. Every fold since has been measured against the six surfaces these
frames photograph and moved none of them, so the frames this record owns are the
ones the shipped code paints (QA round 6, Q-r6-1: this paragraph did not record the
round-5 re-shoot at all).

WHAT THE UNITS CHANGE DID TO THE PIXELS, measured rather than asserted, because
it re-shapes every header: each unit is its own text run now, so Chrome re-rastered
the glyphs — and this paragraph names its BASELINE for every count, because a
count without one is what round 2's R2-2 / Q-r2-1 and R2-3 caught here.

*Against the pre-round tree (`a3dde2d266`, the last head before this round's code
change):* **20 of the 44 frames differ, and 24 are byte-identical.** Eighteen of the
twenty are glyph-level — `compare -metric AE` reports a few hundred to a few
thousand pixels and with a 15% per-channel fuzz **the difference is 0 on all
eighteen**, while the ink extents are byte-for-byte the same (measured on
`many-types` and `agent-ops`: both `591×12+53+4` and `147×12+53+4` before and
after), so the words and their places are unchanged and only the antialiasing
differs. The other two are the LAYOUT change this round is about:
`many-types-narrow/{localOperatorDark,localOperatorLight}` at **448 / 462** under
the same 15% fuzz (the break inside the tail phrase became a break at a separator).
The eighteen include the two picture-strip cells the next paragraph names
(`images-many-focus/localOperatorDark` 472 and
`images-many-hover-reduced-motion/localOperatorDark` 390) — round 3's R3-1 is the
finding that an earlier draft of this paragraph left them out of the headline while
naming them below it.

*The re-take, attributed correctly (round 3's R3-2 corrects what R2-3's fix got
wrong).* The commit that re-took this set is **`331100ac18a`** — its diff is the
twenty frames above plus this README, and it is where the twenty-one paths live.
**`f21e8bab627`**, one commit later, is the FOLD re-take: it moves **2** of this
set's frames (`images-many-focus/localOperatorDark` **472** and
`images-many-hover-reduced-motion/localOperatorDark` **390**, both 0 under a 15%
fuzz) and no README — **2 changed / 42 byte-identical** of the 44. Its commit body
claims *"the fold set came back byte-identical, all 44 frames"*; that is false for
exactly those two, and the sample behind the sentence is the mistake: the re-take
was checked on the two cells this change is about (`many-types`, `many-types-narrow`
— genuinely byte-identical) and the sentence generalised them to the whole set.
The four picture-strip cells that have moved at some point in this round, named
rather than implied: `images-many-hover-reduced-motion/localOperatorDark` (390),
`images-many-hover-reduced-motion/localOperatorLight` (1,171),
`images-many-hover/localOperatorDark` (390) and `images-many-focus/localOperatorDark`
(472) — every one of them 0 under the 15% fuzz, in the class a re-capture on the
*unmodified* tree reproduces, and the strip they sit on is untouched by every
change in this branch.
