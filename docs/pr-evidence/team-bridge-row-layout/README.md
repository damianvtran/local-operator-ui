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

## 3. Reaction picker open time (evidence corrected, cold-open gate still pending)

The picker filtered all 3963 emoji candidates through a per-glyph canvas font
probe (two paints and two `getImageData` readbacks each) before its first
render. Two commits change that: the probe is paged to the visible window and
the rest is filled in 8 ms idle slices after paint, and the timeline warms the
whole corpus from its mount, so opening is a cache lookup.

**`10-before-picker-1088-light.png` and `11-after-picker-1088-light.png` are
byte-identical** (md5 `f600e692145daa7ee89aa691d85c12c5` for both), so they are
**not** a before/after pair. They show the settled picker unchanged by this PR -
correct as a label, wrong as a claim of a visual fix. The picker gains no pixel:
it gains time.

**Provenance of the timing table below.** The numbers were taken from the story
revision as captured, whose play function clicked through `userEvent`; the
committed board dispatches the pointer and click events directly, because
`userEvent`'s own action delays are harness time rather than the operator's
wait. They are therefore an upper bound measured on a host at load average
60-137 with swap 9.3/10.2 GiB in use, and they are not reproducible from the
committed board as it stands.

| Run | Before (story `userEvent` click) | After (story `userEvent` click) |
| --- | --- | --- |
| 1 | 11859.3 ms | 1644.6 ms |
| 2 | 2957.8 ms | 533.3 ms |
| 3 | 5481.4 ms | 802.4 ms |
| 4 | 5639.6 ms | 861.6 ms |
| 5 | 6114.1 ms | 758.9 ms |

A direct pointer dispatch on a warm page measured 145.1 ms and 101.0 ms
painted (under the 200 ms gate), and 1083.4 ms of synchronous canvas readbacks
on the very first, cold open before the warm-cache commit landed.

**The 200 ms gate is not measured, and the committed board does not measure
it.** Under the committed holds `PickerOpensInsideViewport` returns at its
`if (!toolbar)` check and records `held` as its `data-picker-measured` value,
because no toolbar or picker renders in this build. Re-measuring needs the
untracked scratch config that flips the two holds at build time. The cold-open
figure with the warm-cache commit therefore stays a pending merge condition,
not a met one.

**One transient state is uncaptured.** A cold open now fills the grid, its
height and `aria-rowcount` in place while idle slices probe, which shows as a
scroll thumb that resizes. No frame records that state; the capture pass that
re-measures the cold open should also take consecutive frames of it.

The picker's own containment held in every run - rect `408, 123.5 -> 754, 593.5`
inside a `1088 x 640` viewport, i.e. it opens inside the viewport from a trigger
at the column's end edge.

**Dropped probe.** Both geometry files used to carry a `playErrors` key holding
Storybook's generic "The component failed to render properly" copy. No story
failed: the capture scraped `.sb-errordisplay`, which Storybook mounts
unconditionally with that placeholder text. The key was a bad probe and has
been removed from both files rather than annotated.

## Regression boards added

- `Team Bridge/Page → PersonDraftAvatarAlignment`: the mark's left edge equals
  the name's left edge, and the trigger is mark-sized.
- `Team Bridge/Page → LongContentRowsStayInColumn`: every row, and the toolbar
  where one is rendered, lies within the scroll viewport's `clientWidth`, with a
  240-character unbroken token, a long URL, a 20-line code block and a 12-column
  table in the fixture.
- `Team Bridge/Reactions → PickerOpensInsideViewport`: click → painted under
  200 ms from `performance.measure`, and the picker's rect inside the viewport.
  Under the committed holds this board records `held` and asserts nothing (see
  section 3).
- `scripts/team-bridge-row-layout-pin.test.mjs` (CI, registered in
  `test:desktop`): the guard that fails on a revert. It pins the thread pane's
  block wrapper (the only behaviour this PR changes), the page's two matching
  wrappers, the list's and rows' width constraint and the draft trigger's
  `self-start`, and it exercises the warm-up's once-per-module guarantee against
  the real module. Red on `origin/main` (5 of its 6 assertions fail), green at
  head.

## Scratch, not committed

The two holds were flipped only by a scratch Storybook config
(`.storybook-scoped/`, untracked) whose plugin rewrites the constants at build
time. Nothing in the product, the stories or the committed Storybook config
changes either hold.
