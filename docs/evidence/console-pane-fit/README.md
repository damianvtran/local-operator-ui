# The console pane's grid fits the pane's box, and opening it gives you a terminal

Frames and measurements for `fix/console-pane-fit`, from the BUILT app in the
documented `headless` window mode, driven over CDP, against a backend this run
owns (scratch home, scratch config dir, scratch `--user-data-dir`, its own port
and its own desktop token).

Two operator items, one round:

1. **the terminal overflowed its own box** — "I scrolled to the bottom and the
   scroll wheel seems to bottom out at the bottom below the screen but I can't see
   it": the last rows of the terminal, the prompt included, were painted below the
   pane's clipped edge, where no scroll reaches them;
2. **opening the console should open and focus its first surface** — "opening the
   console typically means you want to run a console command right away", so the
   pane should not greet you with an empty state and a `New console` button.

## 1. The overflow, its cause, and the measurement that proves it

The pane reports a box and a cell size; main derives the grid (§8.2) and the
mirror never sizes itself. Main's arithmetic is a division:

```
rows = floor(reported contentRect.height / reported cellHeight)
```

xterm 6 does not draw that cell height. It measures its char height as
`fontBoundingBoxAscent + fontBoundingBoxDescent`
(`@xterm/xterm` `browser/services/CharSizeService.ts`, `TextMetricsMeasureStrategy`)
and then sizes each row to
`round(ceil(charHeight * dpr) * rows / dpr) / rows`
(`browser/renderer/dom/DomRenderer.ts::_updateDimensions`) — at this face and
ratio **17 px**, against the **15.6 px** (`13 * 1.2`, the line box) the pane
reported. A divisor smaller than the painted row over-derives rows, and the
terminal is painted past the bottom of the box it was measured from.

Measured, per window size, with the pane's own report read off the live DOM (the
rect the pane reads immediately before it reports) and main's own grid read back
through the app's console wire:

| window | pane's box (reported) | reported cell | real row height | rows main derived | terminal painted | overflow |
| --- | --- | --- | --- | --- | --- | --- |
| 1380x900 | 643x**791** | 15.6 | **17** | 50 | 50 x 17 = **850** | **+59 px** |
| 1024x700 | 287x**591** | 15.6 | **17** | 37 | 37 x 17 = **629** | **+38 px** |
| 1380x900 (fixed) | 643x**791** | **17** | 17 | 46 | 46 x 17 = **782** | **-9 px** |
| 1024x700 (fixed) | 287x**591** | **17** | 17 | 34 | 34 x 17 = **578** | **-13 px** |

`floor(791 / 15.6) = 50` and `floor(791 / 17) = 46`: 59px is three and a half
rows of terminal, painted outside the box. The font metrics behind the 17 are read
from the same page, not assumed: `measureText("W")` at `13px "Geist Mono"` reports
`fontBoundingBoxAscent 13` + `fontBoundingBoxDescent 4` at dpr 2.

HOW EACH NUMBER WAS OBTAINED, because two of the four columns are read and two are
pinned, and a reader is owed the difference:

- **read directly**: the pane's box (the rect the pane's own `send` reads off its
  host immediately before it reports — the call is wrapped, and the three reads in a
  run are identical, so the box is stable), the terminal's painted `.xterm-screen`
  height, the number of rows in the live DOM, and the height of one of those row
  elements. Every one of them is in `*-geometry.json` verbatim.
- **pinned, not read**: the reported CELL height. The report itself crosses a
  `contextBridge` object that Electron freezes, so the argument cannot be wrapped
  from the page — measured, and recorded in each run as `bridgePatch`
  (`Object.isFrozen` true, an assignment that does not take, and
  `TypeError: Cannot redefine property: setContentRect`). What main used as the
  divisor is therefore recovered from two numbers that WERE read — main's own rows
  and the box — against the pane's source constant: `rows = floor(box / cell)`, so
  50 rows over a 791px box pins the BEFORE cell to `(791/51, 791/50] = (15.51,
  15.82]`, whose only candidate is `13 * 1.2 = 15.6` (the code), and 46 rows pins
  the AFTER cell to `(791/47, 791/46] = (16.83, 17.20]`, which is xterm's own
  `ceil(17 * 2) / 2 = 17`. The `after` column is corroborated a second way: it is
  the value the shipped `measureCell` now returns for those metrics, asserted in
  `scripts/console-mirror.test.mjs`.

`before-1380x900-bottom.png` / `after-1380x900-bottom.png` and the `1024x700` pair
are the same window size, the same seeded content (`ls -la ~`, `seq 1 120`, then
`echo BOTTOM-MARKER-OK`, scrolled to the bottom with the wheel). In the BEFORE
frames the last visible row is `120` and the marker line is cut off by the bottom
edge of the pane — in the `1024x700` one the fragment `OM-MARKER-OK` is visible
*below* the fold with the prompt after it entirely gone, which is the operator's
own description. In the AFTER frames the marker, its output and the prompt line all
sit inside the pane, with the pane's bottom edge visible below them and 9-13 px of
the box unused.

## 2. Opening the console creates its first surface and puts the caret in it

`after-1380x900-open.png` is the frame immediately after a real press on the chat
header's console trigger (a compositor press through CDP's input pipeline, not a
synthetic `element.click()`). Recorded with it: the press created the surface
(`the open itself created the surface: true`) and the caret is in the terminal
(`document.activeElement` = `xterm-helper-textarea`), so typing goes to the program
without a second gesture.

What the decision is, and what it deliberately is not:

- **a surface that exists is focused, never duplicated** — the pane's own
  `pickActiveSurface` chose which one is showing, and a second surface would take
  the lens off the one the user was reading;
- **the created surface is main's own object**, with main's defaults — the login
  shell, the session's id, and main's answer for its working directory — because
  two ways for a user's surface to be born is the defect (its `cwd` in this run is
  the run's scratch home, recorded in `*-geometry.json`);
- **only the user's press asks for it.** A completion banner's click, an agent's
  `reveal`, and the restored preference of a relaunch all open this pane and none
  of them is a user asking for a keyboard; the request is a consumed-once event
  that is excluded from the persisted preferences, so a launch cannot inherit one;
- **a console that cannot exist here is told so, not given a shell** (`available:
  false` answers `none`), and a create that fails lands on the pane's unavailable
  state, which carries the error — it is not a dead pane.

## What these frames do not show

- **The caret's own rendering.** A `headless` window is never shown and cannot be
  focused, so a text caret is not painted; the claim is made by the reading
  (`activeElement` = `xterm-helper-textarea`) and by the caret's *block* at the
  prompt in the AFTER frames, not by a blinking bar. Anything about focus rings is
  out of scope for this mode.
- **A failed create, live.** No lever available to the rig makes main's
  `console-create-surface` reject — a shell path that cannot exist produces an
  ENDED surface rather than a failed create (measured: the pty is born and the
  child exits at once, which is the pane's ended state), so that path is covered by
  the decision table's `available: false` row and by the pane's existing error
  branch rather than by a frame here.
- **The conversation's own content.** The run's backend is one this rig owns, with
  one empty conversation in it; nothing in these frames is operator data.

## The run

```bash
# 1. an isolated backend, its own config/home/port/token, one conversation in it
#    (see the PR body for the exact block), then:
# 2. a build that points AT it — the URL is inlined at build time
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> \
VITE_GOOGLE_CLIENT_ID=... VITE_GOOGLE_CLIENT_SECRET=... \
VITE_MICROSOFT_CLIENT_ID=... VITE_MICROSOFT_TENANT_ID=common \
LOCAL_OPERATOR_UI_NO_BYTECODE=true \
  node ./node_modules/electron-vite/bin/electron-vite.js build
# 3. the probe (a scratch rig, not committed: it seeds `onboarding-storage`,
#    `canonical-sessions-storage` and the preferences, reads the pane's own rect
#    off the live DOM, presses the trigger, creates the surface through the pane,
#    feeds a command down the app's own console wire, wheels to the bottom, and
#    writes the frames and the numbers)
node console-fit-probe.mjs --repo <worktree> --out <dir> --label before \
  --sizes 1380x900,1024x700 --session <id> --token <file> --pair <serve-records>
```

`before-geometry.json` and `after-geometry.json` are the runs' own records,
verbatim: the window's inner size and dpr, the reported box and the pane's own read
of it, main's grid after settling, the painted `.xterm-screen` height, the real row
height, the frame that follows the surface's creation, and the caret reading.
