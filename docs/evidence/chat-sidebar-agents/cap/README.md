# The sidebar section's raised cap, and its release (issue #765)

The Agents section's `Show N more` foot raises that section's row cap. Before
this change nothing lowered it: collapse the section, re-expand it, and the grown
list came back until the app was restarted. The fix is the invariant — **a
collapsed section is compact** — so the close edge of the disclosure releases the
section's raised cap and a re-expand lands back on the shipped
`SIDEBAR_SECTION_ROWS` of 8. No second control was added; that shape was the
operator's.

This directory is the rendered half of that claim: what the affordance looks
like at each state, on both trees, with the numbers behind it. It was re-shot for
the design re-check on the remediation head, which also added the query-forced
states the first round had no frame for; the query-forced PRESSED pair was re-taken
once more when the round-3 fix landed, because its pre-fix assertion
(`expectGone`) was written to fail the moment the defect closed.

## What produced these frames

Storybook served by this worktree's own `storybook dev` on a loopback port,
driven by the repo's own capturer. The story is
`chat-sidebar-agents--long-roster` — the ONE shipped scene that carries a
cap-bound, collapsible section (twelve agents against the eight-row cap, so a
`Show 4 more` foot to press and a `data-chat-section="agents"` disclosure to
close) — and `chat-sidebar-agents--roster-filtered` for the states that need the
section's own filter applied as well. No new story was authored: the states under
test are PRESS SEQUENCES on scenes that already exist, which is what an entry's
`press` array is for.

```
# one run, one private browser, both palettes
node_modules/.bin/storybook dev -p <port> --ci --no-open --quiet
node scripts/capture-evidence.mjs http://127.0.0.1:<port> \
  --only=chat-sidebar-agents \
  --dirs=cap/resting,cap/grown,cap/collapsed,cap/reopened,cap/grown-again,\
cap/list-query-resting,cap/list-query-pressed,cap/filter-query-resting,\
cap/filter-query-pressed \
  --themes=localOperatorDark,localOperatorLight --allow-backend \
  --theme-settle-ms=180000
```

`--theme-settle-ms=180000` is the raised budget this host's load requires: at
the shipped 10s the theme guard refused the first attempt with `document carries
theme ""` on both trees.

Two things about this pass's rig are worth stating rather than leaving in the
command line. **A `storybook dev` server served it, not a static build**: the
static build this lane used for round 1 came back with one story chunk that
`import()` refused on this host while `fetch()` served it (`200`, 23,782 bytes),
so the iframe rendered Storybook's own failure display and the harness timed out
on a story that genuinely had not drawn — diagnosed with a scratch probe, not
guessed at. The development server served the same story without that failure,
and the control below shows its output is the same picture the static build
produced. **The capturer's frames are one entry per state, and this pass added an
opt-in `resetDisclosures`** (see *What these frames do NOT prove*) because the
states whose press sequence ends on the close edge could not otherwise be
photographed in both palettes at all.

## What each frame is

| directory | state | tree |
| --- | --- | --- |
| `resting/` | no press. The shipped compact form: eight rows, the `Show 4 more` foot. | this branch |
| `grown/` | after ONE press of the section's own foot: the cap goes 8 → 16, all twelve rows draw, the foot is GONE. | both halves |
| `collapsed/` | after the foot press, then ONE press on the section heading: the close edge the reset passes through, zero rows, `aria-expanded` false. | this branch |
| `reopened/` | the foot press, then the section heading twice (close, open): eight rows and the foot back. | this branch |
| `grown-again/` | the same three presses, then the foot a SECOND time: twelve rows again, which is the release not having disarmed the raise. | this branch |
| `list-query-resting/` | a LIST query (`b`) in force, no section filter: four rows drawn by the query, the `Filter agents` field drawn by the cap-bound roster. | this branch |
| `list-query-pressed/` | the same state, then the heading pressed — the press the panel documents as a no-op on the raised cap. **The `Filter agents` field survives**, the section box is unmoved and every boundary below it stays put. | this branch |
| `filter-query-resting/` | a LIST query (`b`) AND the section's own filter (`er`): two rows, the field drawn, with the reader's own question in it. | this branch |
| `filter-query-pressed/` | the same state, then the heading pressed: **the field an already-filtering reader had on screen survives**, and nothing else moves. | this branch |
| `baseline/grown/` | the same press on the pre-fix tree. **Byte-identical to `grown/`** — see below. | pre-fix |
| `baseline/reopened/` | the same two heading presses on the pre-fix tree: **twelve rows, no foot** — the grown list surviving the reopen, which is the defect. | pre-fix |

Two palettes, `localOperatorDark` and `localOperatorLight`, which is the brief's
minimum. The width is the story's own 360px column inside a 420px frame, and the
height is 760 as the committed `long-roster` frames are, so a reader can lay this
set beside that one.

## What the numbers say

Read out of the live DOM by `harness/measure.mjs` (one sample per state, all of
it in the committed JSON):

| state | agent rows drawn | foot | section box | Teams heading top |
| --- | --- | --- | --- | --- |
| resting (branch) | 8 | `Show 4 more` | 388px | 452 |
| grown (branch) | 12 | — | 488px | 549 |
| collapsed (branch) | 0 | — | 28px | 84 |
| reopened (branch) | 8 | `Show 4 more` | 388px | 452 |
| grown-again (branch) | 12 | — | 488px | 549 |
| grown (pre-fix) | 12 | — | 488px | 552 |
| **reopened (pre-fix)** | **12** | **—** | **488px** | **552** |

- **The reopen is the resting state, on every one of those numbers**, and its
  eight drawn names are the same eight in the same order. The deltas the harness
  prints are all zero (`rows +0`, `Teams heading top +0`, `section box +0`).
- **The release does not disarm the raise**: `grown-again/` against `grown/` is
  `rows +0`, `section box +0`, `Teams heading top +0`, and the grown state's own
  name (below) comes back with it.
- **Nothing shifts beyond the intended rows.** The growth is `+4 × 32px = 128px`
  of rows and `−28px` of foot, so the section box grows by **+100px** (488 − 388).
  The panel below it moves **+97px** (Teams heading 452 → 549), and the 3px
  difference is the SECTION'S OWN TOP: 48px at rest and in the pre-fix record,
  45px in this head's grown states (both palettes, and `grown-again/` too). This
  pass reports the reading and does not claim a cause, because its own evidence
  cuts both ways: the same instrument at the same press reads 48 on the PRE-FIX
  tree and 45 on this one, which points at this change — and the new focus
  contract's first-revealed-row focus is the only thing the press does here that
  it did not do before — while `grown/` and `baseline/grown/` are `cmp`-clean
  across the two trees, which a 3px scroll would not survive. What can be said
  without either reading being stretched: the movement below the section is
  97-100px against a change of 100px, and no boundary moves by anything else.
- **The pre-fix half is the defect, measured**: after the identical presses its
  reopen carries 12 rows, no foot, a 488px section and the panel 100px further
  down (Teams heading 552 against the resting 452, section top 48 throughout) —
  the state `reopened/` shows undone. Those four numbers are round 1's record,
  kept beside this pass's as `harness/cap-geometry-baseline.json`.

### The reset's own name, and where it lives

The grown heading carries `SECTION_GROWN_HINT` — *"Collapse, then reopen, to restore the
compact list"* — and the harness reads it per state rather than inferring it:

| state | heading `title` | `aria-describedby` → text |
| --- | --- | --- |
| resting | `null` | `null` |
| grown | the sentence | `section-grown-hint-agents` → the sentence |
| collapsed | `null` | `null` |
| reopened | `null` | `null` |
| grown-again | the sentence | `section-grown-hint-agents` → the sentence |

Both channels are real and both are invisible in a still: `title` is a
browser/OS overlay the page never paints, and the `sr-only` element the id points
at is clipped to a pixel. **No frame here shows the hint, and none can** — the
`grown/` heading band is `AE` **0** against `resting/` in both palettes, which is
the state of affairs round 1's D2 measured. The hint on the FOOT (for a raised
section that still draws one) is not reachable from this fixture: twelve agents
against a 16-row cap leave no foot while grown.

The foot's own accessible name is read the same way: `Show 4 more agents` at
rest, `aria-label` and `title` both, which is round 1's N1 closed.

### The query-forced press (round 1's U2), re-measured after the fix

Three sequences, each driven in the live DOM with the sidebar query, the
section's own filter, or both, then the heading pressed. The harness presses the
heading twice in each case — once as the page's own synthetic click and once as a
real CDP pointer press at the heading's centre — because the frame rig cannot
stage the order and the measurement must not rest on its own event path. Both
give the same answer.

| sequence | rows before → after | section box before → after | `Filter agents` before → after |
| --- | --- | --- | --- |
| LIST query only (`b`) | 4 → 4 | 413px → **413px** | present → **present** |
| LIST query (`b`) + section filter (`er`) | 2 → 2 | 264px → 264px | present → **present** |
| section filter only (`er`) | 4 → 0 | 232px → 28px | present → absent |

- **The first row is the repro, and it is closed.** Round 1 photographed this
  press taking the field away and moving the section up by exactly the field's own
  height (**−44px**, box 413px → 369px) with the rows and the chevron untouched.
  At this head the press leaves the field, the box and every boundary below it
  where they were (Teams heading top 560 → 560, `chatsTop` 644 → 644). The gate
  now reads the section BODY's own term — `isOpen("agents", true) || query !== ""`
  — so a query that keeps the body drawn keeps its control. That pre-fix reading
  lives in this file's history (the previous revision of
  `harness/cap-geometry-branch.json`, which this pass replaced in place) rather than
  beside the fixed one, because both are the same instrument at the same story.
- `list-query-resting/` and `list-query-pressed/` are the pair, and the entry
  `cap/list-query-pressed` asserts `expectPresent` on the field, so the frame
  cannot silently regress back into the defect's picture a second time.
- The middle row is the conjunction the round-2 remedy named
  (`query !== "" && rosterFilter.trim() !== ""`), and the field survives the press
  there too: `filter-query-resting/` and `filter-query-pressed/` are that pair.
- The third row is not a defect: with no list query the press really does close
  the section (0 rows, 28px, `aria-expanded` false), so a filter field leaving with
  the list it filters is correct. It is the case the gate must NOT spare, and it is
  pinned behaviourally in `scripts/chat-sidebar-view.test.mjs` beside the repro.

Round 3's finding (`U2`, agent review `R3-1` and QA `Q3-2`) was that the round-2
remedy was INERT in this first row: its clause held the field only when the reader
had typed the section's own filter, and the repro is a list query with no section
filter. What closes it is the body's own term, and the suite now drives the press
rather than matching the gate's source text — a source-string pin stayed green over
that inert clause, which is why the defect survived a round.

### Where the keyboard goes

Read after each press, with the instrument's own control (it focuses the control
before activating it) checked first:

| press | `document.activeElement` |
| --- | --- |
| the section's `Show N more` foot | a **BUTTON with `data-entity-name`**, `New chat with translator` — the FIRST row the raise added |
| the section heading | the heading button (`data-chat-section="agents"`) |

That is round 1's U3/D3 closed: the foot's press used to leave the reader on
`<body>` when the foot unmounted, and it now lands on the row the press revealed.

## The pair, and what is measurable about it

- **The control is byte-identical across the two trees.** `grown/` and
  `baseline/grown/` are `cmp`-clean in both palettes — re-verified on this head,
  across a `storybook dev` build rather than round 1's static one: the `Show N
  more` press is untouched by this change, so the pair's only difference is the
  reopen.
- **A raised section has no mark of its own.** The heading band is `AE` **0**
  between `resting/` and `grown/` in both palettes: an eight-row section and a
  twelve-row one draw the same heading, and the only on-screen difference is the
  row count and the foot's disappearance. The grown state is announced, not
  drawn — see the table above and the design re-check's adjudication in the PR
  thread.

## What these frames do NOT prove

- **They are not a focus-ring capture, except where they are.** A hidden window
  draws no focus ring for a pointer press. Three of these frames
  (`collapsed/`, `list-query-pressed/`, `filter-query-pressed/`) are driven by a
  real keyboard activation (the heading is Tab-focused, then Enter) because the
  press has to follow a typed query, so they DO carry the heading's focus ring —
  which is visible evidence that the press landed.
- **The order the rig cannot stage.** The capturer has no way to press a control
  after typing into a field except through the keyboard, so the query-forced
  frames are keyboard presses; the geometry table above is the same sequence
  driven by a real pointer press as well, which is why the claim does not rest on
  that limit. A `pressKey` on a NATIVE button does not activate it at all (its
  `rawKeyDown` carries no keypress, so no default action runs — the run refused
  the frame when this lane first tried it); `keys` with `text` is the spelling
  that does.
- **`resetDisclosures` is new, and it is why the collapsed state has a frame
  now.** `localStorage['chat-sidebar-disclosures']` is written by every chevron
  press and outlives the document, so a state whose sequence ends on the close
  edge left the NEXT frame — and the next PALETTE of the same entry — loading
  into an already-shut section. Round 1 dropped the collapsed still for exactly
  that reason and recorded the numbers instead. The option clears that one key on
  every new document for the entries that ask for it, so each frame is a function
  of its story rather than of whichever entry ran before it; it is opt-in because
  the frames whose claim IS the persisted disclosure must keep inheriting it.
- **They are not the ladder.** The story's fixture holds twelve agents, so the
  deepest reachable rung is the one press this set photographs; the multi-rung
  cycle (8 → 16 → 24 → 32 → 8) is pinned in
  `scripts/chat-sidebar-view.test.mjs`, not here.
- **They are two palettes of fifty-nine.** Two is the brief's minimum. This
  change introduces no colour, spacing, type or radius value, and the diff's only
  edited `className` is the foot's existing one, so the theme axes are a floor
  rather than a risk.
- **`harness/cap-geometry-baseline.json` is round 1's record**, taken with the
  pre-remediation harness against a detached worktree of the base; it predates
  the `query` section this pass added and is kept as the pre-fix measurement it
  is.
