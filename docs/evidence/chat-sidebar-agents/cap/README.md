# The sidebar section's raised cap, and its release (issue #765)

The Agents section's `Show N more` foot raises that section's row cap. Before
this change nothing lowered it: collapse the section, re-expand it, and the grown
list came back until the app was restarted. The fix is the invariant — **a
collapsed section is compact** — so the close edge of the disclosure releases the
section's raised cap and a re-expand lands back on the shipped
`SIDEBAR_SECTION_ROWS` of 8. No second control was added; that shape was the
operator's.

This directory is the rendered half of that claim: what the affordance looks
like at each state, on both trees, with the numbers behind it.

## What produced these frames

Storybook, from this branch, through the repo's own capturer. The story is
`chat-sidebar-agents--long-roster` — the ONE shipped scene that carries a
cap-bound, collapsible section (twelve agents against the eight-row cap, so a
`Show 4 more` foot to press and a `data-chat-section="agents"` disclosure to
close). No new story was authored: the state under test is a PRESS SEQUENCE on a
scene that already exists, which is what an entry's `press` array is for.

```
# the branch half, from this worktree
pnpm build-storybook && npx http-server storybook-static -p <port> --silent
node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=chat-sidebar-agents --dirs=cap/resting,cap/grown,cap/reopened \
  --themes=localOperatorDark,localOperatorLight --allow-backend \
  --theme-settle-ms=180000

# the base half — a detached worktree of the PR's base (`20fa9c1db29`), the same
# dependency tree linked in, its own Storybook build, and `cap-baseline/` for the
# two `dir`s (the same entries with the foot's assertion inverted, because on
# this tree the reopen leaves the raised cap standing):
cd <base worktree> && pnpm build-storybook
node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=chat-sidebar-agents --dirs=cap-baseline/grown,cap-baseline/reopened \
  --themes=localOperatorDark,localOperatorLight --allow-backend \
  --theme-settle-ms=180000
```

`--theme-settle-ms=180000` is the raised budget this host's load requires: at the
shipped 10s the theme guard refused the first attempt with `document carries
theme ""` on both trees.

`harness/measure.mjs` is the geometry instrument: it launches the same private
headless Chrome the capturer launches, opens the same story, drives the same
three presses, reads the DOM, and exits. It takes no frame. Its two records are
committed beside it (`cap-geometry-branch.json`, `cap-geometry-baseline.json`).

## What each frame is

| directory | state | tree |
| --- | --- | --- |
| `resting/` | no press. The shipped compact form: eight rows, the `Show 4 more` foot. | this branch |
| `grown/` | after ONE press of the section's own foot: the cap goes 8 → 16, all twelve rows draw, the foot is GONE. | both halves |
| `reopened/` | after the foot press, then a press on the section heading (close) and another (open) — the fix's own claim: eight rows and the foot back. | this branch |
| `baseline/grown/` | the same press on the pre-fix tree. **Byte-identical to `grown/`** — see below. | pre-fix |
| `baseline/reopened/` | the same two heading presses on the pre-fix tree: **twelve rows, no foot** — the grown list surviving the reopen, which is the defect. | pre-fix |

Two palettes, `localOperatorDark` and `localOperatorLight`, which is the brief's
minimum. The width is the story's own 360px column inside a 420px frame, and the
height is 760 as the committed `long-roster` frames are, so a reader can lay this
set beside that one.

## What the numbers say

Read out of the live DOM by `harness/measure.mjs` (one sample per state, all of
it in the committed JSON):

| state | agent rows drawn | foot | section box | Teams heading top | chats region top | scroller content/box |
| --- | --- | --- | --- | --- | --- | --- |
| resting (branch) | 8 | `Show 4 more` | 388px | 452 | 536 | 712 / 361 |
| grown (branch) | 12 | — | 488px | 552 | 636 | 812 / 361 |
| collapsed (branch) | 0 | — | 28px | 84 | 168 | 361 / 361 |
| reopened (branch) | 8 | `Show 4 more` | 388px | 452 | 536 | 712 / 361 |
| resting (pre-fix) | 8 | `Show 4 more` | 388px | 452 | 536 | 712 / 361 |
| grown (pre-fix) | 12 | — | 488px | 552 | 636 | 812 / 361 |
| **reopened (pre-fix)** | **12** | **—** | **488px** | **552** | **636** | **812 / 361** |

- **The reopen on this branch is the resting state, on every one of those
  numbers**, and its eight drawn names are the same eight in the same order. The
  deltas the harness prints are all zero (`rows +0`, `Teams heading top +0`,
  `section box +0`, scroller `712/361` both).
- **Nothing shifts beyond the intended rows.** The growth is `+4 × 32px = 128px`
  of rows and `−28px` of foot, so every boundary below the section moves by
  exactly **+100px** — the Teams heading, the chats region and the first chat row
  all move 100, and the section box grows 100. The 16px gap between the section's
  box and the Teams heading is the same in both states, so the raise does not
  disturb the panel's rhythm; it moves it.
- **The pre-fix half is the defect, measured**: after the identical presses its
  reopen carries 12 rows, no foot, a 488px section and a 100px-shifted panel
  below it — the state `reopened/` shows undone.
- **The collapsed state costs the whole section** (0 rows, 28px, `aria-expanded`
  false) — that is the state the shrink path passes through, and it is why the
  reset's discoverability is this set's one design finding.

## The pair, and what is measurable about it

- **The control is byte-identical across the two trees.** `grown/` and
  `baseline/grown/` are `cmp`-clean in both palettes: the `Show N more` press is
  untouched by this change, so the pair's only difference is the reopen.
- **`reopened/` against `resting/` is a near-identical frame**, and the residual
  is characterised rather than waved at: `AE` 25,651 (dark) / 23,302 (light)
  pixels differ, with a **mean of 0.28 / 0.31 of 255** and a **maximum of
  17 / 19** — and it is concentrated on the `Agents` heading row (band mean
  5.7 / 7.1 against 0.13 / 0.11 for the rest of the panel). That band is the
  pointer: the entry's last press is on the heading, so the frame carries the
  heading's hover step. The geometry above is the claim; the residual is one
  hovered row and WebP encoding.
- **The `grown/` frame carries the pointer on `translator`'s row**, because the
  foot that was pressed unmounts and the row that took its place is under the
  pointer — the row's hover ground and its two reveal controls are what that
  highlight is. It is not a selection.
- **A raised section has no mark of its own.** The heading band is `AE` **0**
  between `resting/` and `grown/` in both palettes: an eight-row section and a
  twelve-row one draw the same heading, and the only on-screen difference is the
  row count and the foot's disappearance.

## What these frames do NOT prove

- **They are not the query-forced case.** While a list query is in force the
  sections are force-DRAWN, and a press there is a deliberate no-op on the raised
  cap (agent review round 1's M1, QA round 1's QA-F1). No frame here photographs
  that state — the branch's own `scripts/chat-sidebar-view.test.mjs` pins it at
  the model level and QA drove it — and the fixture would need a query entry to
  reach it from this story.
- **They are not a chevron-collapse frame.** There is no committed still of the
  collapsed section, deliberately: `localStorage['chat-sidebar-disclosures']` is
  written by every chevron press and is NOT the key the capturer re-seeds per
  frame, so a `press` on the section heading persists `{agents:false}` and the
  NEXT capture in the same sweep starts with the Agents section collapsed. The
  other stories that mount this sidebar reset that key themselves for exactly this
  reason (`chat-sidebar-view-menu.stories.tsx`); an entry here would have been the
  first press in the shared script to leave it set. The state's geometry is in the
  numbers above instead, and the two frames on either side of it
  (`grown/`, `reopened/`) are the pair the claim is about.
- **They are not the ladder.** The story's fixture holds twelve agents, so the
  deepest reachable rung is the one press this set photographs; the multi-rung
  cycle (8 → 16 → 24 → 32 → 8) is pinned in
  `scripts/chat-sidebar-view.test.mjs`, not here.
- **They are two palettes of fifty-nine.** Two is the brief's minimum. This
  change introduces no colour, spacing, type or radius value — the diff's only
  edited `className` is the foot's existing one — so the theme axes are a floor
  rather than a risk.
- **They are not a focus capture.** A hidden window has no focus ring, so nothing
  here shows one. What the harness does record is where the keyboard ENDED UP
  after each press, and the answer is in the JSON: `BODY` after the foot press
  (the foot unmounts and nothing claims the focus), the heading button after the
  heading press.
