# One default width for the right slot's panes, and separators that announce what they draw

The [#872](https://github.com/damianvtran/local-operator-ui/issues/872) follow-up,
built to the disposition the lane recorded on the issue
([comment](https://github.com/damianvtran/local-operator-ui/issues/872#issuecomment-6068677546)):
with the shared `rightSlotWidth` UNSET - the experience of anyone who never
dragged a divider - each pane used to open at its own seed (Run 420, Browser 640,
Console 796, the canvas 800 capped by its dock), so switching panes re-sized the
slot and re-wrapped the conversation. The change gives Run, Browser and Console
ONE default (`DEFAULT_RIGHT_SLOT_WIDTH`, 640 = the browser's shipped seed and
exactly 80 console columns at the shipped face), and it gives the Browser and
Console separators the run panel's own D4 treatment: they announce the width the
row actually draws and refuse a write the row cannot host.

`before/` is a worktree at `f6d9bfc0a0f` (the branch's base) carrying the fixture
patch this set ships (`base-fixture/shell.stories.patch`); `after/` is this
branch's worktree (re-shot at `27a79880718`, the head this round lands on). Each
half is **12 states x 2 palettes** - the four panes at 1280x900, 1380x900 and
1440x900, `localOperatorLight` and `localOperatorDark` - one webp per cell under
`<pane>-<WxH>/<palette>.webp`, with `readings.json` beside them counting every
number below.

## How to reproduce

```sh
# A Storybook per tree. The BEFORE tree is a detached worktree of the base commit
# with this set's fixture patch applied - the hand restatement of the base's own
# separator wiring, which a tree without `rightSlotDividerContract` can load.
BR=$(pwd)   # this branch's checkout, where the set lives
git worktree add --detach ~/local-operator-ui-worktrees/right-slot-one-default-base f6d9bfc0a0f
git -C ~/local-operator-ui-worktrees/right-slot-one-default-base apply "$BR"/docs/evidence/right-slot-one-default/base-fixture/shell.stories.patch
(cd ~/local-operator-ui-worktrees/right-slot-one-default-base && ./node_modules/.bin/storybook dev -p 6395 --ci --no-open)
./node_modules/.bin/storybook dev -p 6396 --ci --no-open
# One rig, run once per tree: the label picks the folder and the expectations.
env TZ=America/New_York node scripts/right-slot-one-default-evidence.mjs --label before --origin http://localhost:6395
env TZ=America/New_York node scripts/right-slot-one-default-evidence.mjs --label after  --origin http://localhost:6396
```

The patch is the whole before-tree fixture, verified at this commit by re-running
the rig on a fresh base worktree: it reproduces `before/readings.json` field for
field (the re-shoot that added the 1440 frames also re-derived it). Its three
restated prop sets are, verbatim:

- **Run**: `value = resizable ? min(max(drawn, 320), capacity) : drawn`,
  `min = resizable ? 320 : value`, `max = resizable ? min(640, capacity) : value`,
  `capacity = row - 480`, `resizable = capacity >= 320` - the base's own run
  wiring, transcribed.
- **Browser**: `value = max(480, raw === 0 ? DEFAULT_BROWSER_PANEL_WIDTH : raw)`
  (= 640 at the recorded cells), `min = 480`, `max = 1200`.
- **Console**: the same with `DEFAULT_CONSOLE_PANEL_WIDTH` (= 799 off the shipped
  face in the browser, 796 by the no-DOM ratio), `min = 480`, `max = 1200`.

where `drawn` is the slot width the frame's own resolver hands the arm (`raw` is
the stored shared width before the resolver's clamp).

The rig launches ONE private headless Chrome per run (mock-keychain switch, its
own scratch `--user-data-dir`, its own process group, reaped by exact pid), and
it **fails with exit 1** on any wrong reading - the table it prints is never a
substitute for the check: the drawn widths
are asserted against each tree's own arithmetic (`min(seed', row - 480)` for the
three panes, `min(seed, min(560, row - 480))` for the canvas), the row must
tile, the separators must announce the drawn width, and every frame passes
`assertFramePaints`. It also clears the persisted preferences before every load,
so each cell is the fresh-profile arm this issue is about. The stories are the
four `shell-app-shell` arms the committed frames come from
(`chat-dock-run-panel`, `chat-dock-browser`, `chat-dock-console`,
`chat-dock-files`), with `rightSlotWidth` as a story arg.

## The readings (measured in the real page, asserted as relations)

Width UNSET, the whole grid:

| Window | Pane | Row | before drawn | before chat | after drawn | after chat |
| --- | --- | --- | --- | --- | --- | --- |
| 800 | run | 700 | 220 | 480 | 220 | 480 |
| 800 | browser | 700 | 220 | 480 | 220 | 480 |
| 800 | console | 700 | 220 | 480 | 220 | 480 |
| 800 | canvas | 700 | 220 | 480 | 220 | 480 |
| 900 | run | 800 | 320 | 480 | 320 | 480 |
| 900 | browser | 800 | 320 | 480 | 320 | 480 |
| 900 | console | 800 | 320 | 480 | 320 | 480 |
| 900 | canvas | 800 | 320 | 480 | 320 | 480 |
| 1024 | run | 720 | 240 | 480 | 240 | 480 |
| 1024 | browser | 720 | 240 | 480 | 240 | 480 |
| 1024 | console | 720 | 240 | 480 | 240 | 480 |
| 1024 | canvas | 924 | 444 | 480 | 444 | 480 |
| 1180 | run | 876 | 396 | 480 | 396 | 480 |
| 1180 | browser | 876 | 396 | 480 | 396 | 480 |
| 1180 | console | 876 | 396 | 480 | 396 | 480 |
| 1180 | canvas | 1080 | 560 | 520 | 560 | 520 |
| 1280 | run | 976 | 420 | 556 | 496 | 480 |
| 1280 | browser | 976 | 496 | 480 | 496 | 480 |
| 1280 | console | 976 | 496 | 480 | 496 | 480 |
| 1280 | canvas | 976 | 496 | 480 | 496 | 480 |
| 1380 | run | 1076 | 420 | 656 | 596 | 480 |
| 1380 | browser | 1076 | 596 | 480 | 596 | 480 |
| 1380 | console | 1076 | 596 | 480 | 596 | 480 |
| 1380 | canvas | 1076 | 560 | 516 | 560 | 516 |
| 1440 | run | 1136 | 420 | 716 | 640 | 496 |
| 1440 | browser | 1136 | 640 | 496 | 640 | 496 |
| 1440 | console | 1136 | 656 | 480 | 640 | 496 |
| 1440 | canvas | 1136 | 560 | 576 | 560 | 576 |
| 1600 | run | 1296 | 420 | 876 | 640 | 656 |
| 1600 | browser | 1296 | 640 | 656 | 640 | 656 |
| 1600 | console | 1296 | 799 | 497 | 640 | 656 |
| 1600 | canvas | 1296 | 560 | 736 | 560 | 736 |

A STORED width at 1380 - the per-pane floor lift (350) and the shared width
(1000), which this change does not touch (both halves read the same):

| Stored | Pane | before drawn | after drawn |
| --- | --- | --- | --- |
| 350 | run | 350 | 350 |
| 350 | browser | 480 | 480 |
| 350 | console | 480 | 480 |
| 350 | canvas | 400 | 400 |
| 1000 | run | 596 | 596 |
| 1000 | browser | 596 | 596 |
| 1000 | console | 596 | 596 |
| 1000 | canvas | 560 | 560 |

The Browser and Console separators at rows that cannot host the pane's 480 floor
(the D4 half; `aria-valuenow/min/max` read off the element):

| Window | Pane | before pane | before valuenow/min/max | after pane | after valuenow/min/max |
| --- | --- | --- | --- | --- | --- |
| 800 | browser | 220 | 640/480/1200 | 220 | 220/220/220 |
| 800 | console | 220 | 799/480/1200 | 220 | 220/220/220 |
| 900 | browser | 320 | 640/480/1200 | 320 | 320/320/320 |
| 900 | console | 320 | 799/480/1200 | 320 | 320/320/320 |

The run separator's found-not-fixed cell - a stored 1000 at 1600 draws 816
against the pane's own 640 ceiling, on BOTH halves, so the announced value sits
above its own maximum before and after this change:

| Tree | pane drawn | valuenow/min/max |
| --- | --- | --- |
| before | 816 | 816/320/640 |
| after | 816 | 816/320/640 |

## What the numbers say

- **The unset arm, after**: Run, Browser and Console draw the SAME width at
  every window - the slot's 640, held to the row's leftover (220/320/240/396/496/
  596/640/640) - and the conversation column stops moving on a pane switch. The
  canvas is unchanged in both halves at every row (its dock cap was always the
  binding number below 640), which is why the canvas cells read identically.
- **The unset arm, before**: three different seeds at 1280 and up - Run 420,
  Browser 496, Console 496 at 1280 (the column 556 / 480 / 480), Run 420 vs
  Console 656 at 1440 - which is the re-wrap the issue reports, now measured
  rather than described.
- **The 1440 row (design round 1's D1)**: the console's first VISIBLE shrink -
  656 -> 640 - is in the frames; at 1280 and 1380 the console is cap-bound, so
  its pairs there are the unchanged control and the delta lives only here.
- **The console's default in a browser** is the store's own `measureCell()`
  derivation, not a fixed number: the base tree draws it at 799 here (the no-DOM
  ratio the tests pin computes 796), and the rig allows the split on that one
  cell and records what it read.
- **D4, before**: the Browser separator announced valuenow 640 (Console 799),
  min 480, max 1200 while the pane was drawn at 220/320. **After**: it collapses
  onto the drawn width exactly (valuenow = min = max = 220/320), and a drag or a
  double-click reset is refused where the row cannot host the pane's floor.
- **The run anomaly** is the one shape the contract keeps as found-not-fixed:
  clamping the announced value would lie about the drawn width, and lifting the
  ceiling would let a run-panel drag store past its 640 contract maximum - a
  design call, recorded here and on the PR rather than reshaped in this change.
- **Nothing stored changes meaning**: the 350 and 1000 cells read identically on
  both halves, and the persist version is untouched by this change (2).

## What this set does not claim

The frames are about GEOMETRY - drawn widths, the column's width, the separators'
announced ranges - not about a backend: every arm renders from its own fixtures
with scripted bridges, which is the same basis the committed `shell-app-shell`
frames use. The `canvas` cells at 1024-1183 show the CANVAS's own row (the shell
yields the docked sidebar to it there), which is why its row width differs from
the other three panes' in those cells; the rig compares it against its own row
rather than theirs, and the readings table carries both.
