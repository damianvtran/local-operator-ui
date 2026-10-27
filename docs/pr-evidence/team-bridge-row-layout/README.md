# Team Bridge row layout: empty-DM avatar and hover/action-row width

Operator report, 2026-10-27, two screenshots. Captured from the story-scoped
Storybook build of this branch (stylesheets, fonts and theme provider are the
app's own), driven by the `browser` tool, and — after the desktop browser host
failed its health check under host load — by one headless Chrome per capture run
(`--use-mock-keychain`), reaped by exact pid in the same command.

Viewport: 1088 x 640 (288 px rail + 800 px content column) and 1440 x 640, at
device scale 2, in `localOperatorLight` and `localOperatorDark`.

## 1. Empty DM avatar was centred over left-aligned text

`00`–`03` are the BEFORE frames of `Team Bridge/Page → PersonDraft` from
`origin/main`; `04`–`07` are the same story after the fix.

The trigger that wraps the 56 px plate in the empty-conversation header is a
`<button>` inside a flex column. It was stretched to the column's width, and
the UA's `text-align: center` for buttons then centred the mark while the name
and the "This is the beginning of your direct message history with …" line
stayed left. It arrived with #1433, which wrapped the plate in the profile-card
trigger; before that the plate was a bare `<span>`, which does not stretch.

Fix: the trigger hugs the mark (`self-start`), so the mark shares the text
block's left edge and the hit target is the mark, not the pane.

Measured, plate's left edge minus the name's left edge (`before-geometry.json`,
`after-geometry.json`):

| Viewport | Theme | Before | After |
| --- | --- | --- | --- |
| 1088 | light | 352.0 px | 0.0 px |
| 1088 | dark | 352.0 px | 0.0 px |
| 1440 | light | 528.0 px | 0.0 px |
| 1440 | dark | 528.0 px | 0.0 px |

## 2. Hover band and action row against the visible column

**What the operator saw, and what this build can show.** In `v0.44.1` and on
`origin/main` both Team Bridge holds are closed:
`TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD` and
`TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD` are `false`
(`src/shared/team-bridge-notify.ts`), so `TeamBridgeMessageToolbar` returns
`null`. Hovering a message therefore paints the row's `hover:bg-row-hover`
ground and renders **no action row at all** — the react and thread-in-thread
controls are held off in this build, not clipped. The operator's screenshot is
exactly that: a hover band with no actions. Returning the controls is a
separate product decision (the holds name unreviewed backend routes), and this
PR does not touch either constant.

**What was measured.** `08`/`09` are the hovered row at 1088 dark, before and
after, captured with a trusted pointer. In the page timeline the row did not
overflow in either build: rows were 800 px inside a 800 px viewport at 1088,
1152 px inside 1152 px at 1440, `scrollWidth === clientWidth`, and the toolbar
(rendered with both holds flipped in a scratch-only Storybook config, never
committed) ended at the row's own end edge. So the timeline's ground already
fits its column and this PR does not claim a before/after pixel change there.

**Where the intrinsic-width trap actually is.** The page timeline already lays
Radix's scroll content wrapper out as a block
(`[&_[data-radix-scroll-area-viewport]>div]:block!`); the thread pane did not,
so it inherited Radix's `display: table; min-width: 100%`, which grows to the
widest row's *min-content* — one wide table or one unbroken code line and every
reply's hover ground, and the toolbar floating at the content column's end
edge, run past the pane. This PR gives the thread pane the same block wrapper,
and pins the list and every row to the viewport's width (`w-full min-w-0`) so
the constraint is one rule rather than one per offending element. Long
unbroken text, code and tables keep wrapping or scrolling inside the row
(`lo-markdown` breaks words; `pre` and tables scroll in their own box).

## 3. Reaction picker open time (incomplete: cold-path gate unmeasured)

The picker filtered all 3963 emoji candidates through a per-glyph canvas font
probe (two paints and two `getImageData` readbacks each) before its first
render. Two commits change that: the probe is paged to the visible window and
the rest is filled in 8 ms idle slices after paint, and the timeline warms the
whole corpus from its mount, so opening is a cache lookup.

Measured click → painted (two `requestAnimationFrame` frames after the click
dispatch), picker story at 1088:

| Run | Before (story `userEvent` click) | After (story `userEvent` click) |
| --- | --- | --- |
| 1 | 11859.3 ms | 1644.6 ms |
| 2 | 2957.8 ms | 533.3 ms |
| 3 | 5481.4 ms | 802.4 ms |
| 4 | 5639.6 ms | 861.6 ms |
| 5 | 6114.1 ms | 758.9 ms |

These figures still include Storybook's `userEvent` dispatch cost and were
taken on a host at load average 60–137 with swap 9.3/10.2 GiB in use, so they
are an upper bound and not the operator's wait. A direct pointer dispatch on a
warm page measured 145.1 ms and 101.0 ms painted (under the 200 ms gate), and
1083.4 ms of synchronous canvas readbacks on the very first, cold open before
the warm-cache commit landed.

**Not yet proven:** the cold-open figure with the warm-cache commit in the
build. The host froze all Storybook and browser runs before the rebuild could
be taken, so this PR states the gate as pending rather than met, and the timing
must be re-measured on a quiet host before merge.

The picker's own containment held in every run — rect `408, 123.5 → 754, 593.5`
inside a `1088 x 640` viewport, i.e. it opens inside the viewport from a trigger
at the column's end edge. The `PickerOpensInsideViewport` board asserts both
the rect and the 200 ms bound, so the gate fails loudly the moment the timing is
measured again on a quiet host.

## Regression boards added

- `Team Bridge/Page → PersonDraftAvatarAlignment`: the mark's left edge equals
  the name's left edge, and the trigger is mark-sized.
- `Team Bridge/Page → LongContentRowsStayInColumn`: every row, and the toolbar
  where one is rendered, lies within the scroll viewport's `clientWidth`, with a
  240-character unbroken token, a long URL, a 20-line code block and a 12-column
  table in the fixture.
- `Team Bridge/Reactions → PickerOpensInsideViewport`: click → painted under
  200 ms from `performance.measure`, and the picker's rect inside the viewport.

## Scratch, not committed

The two holds were flipped only by a scratch Storybook config
(`.storybook-scoped/`, untracked) whose plugin rewrites the constants at build
time. Nothing in the product, the stories or the committed Storybook config
changes either hold.
