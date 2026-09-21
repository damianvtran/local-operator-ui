# Sidebar row space - rendered evidence

The sidebar row's **horizontal budget**, photographed in the running app at the
three panel widths the operator's report is about, with the pointer off the row
and on it, plus the one frame of the panel's archive register in the state they
reported. These are the **before** frames: the spec they exist for is
`docs/design/sidebar-row-space.md`, and every number in it is a subtraction over
the boxes in `measurements/`.

## What the operator reported, and which frame carries it

| Their words | The frame |
| --- | --- |
| "far too much space to the right of each row now" | `rest-280/localOperatorDark.png` - an unpinned row reserves two 24px boxes and paints neither: **52px of control plus the row's own 4px gap = 56px off every title**, on every row, at rest (measured: the title is 180px where the row's own button is 208px wide) |
| "the pin glyph then sits with a large dead gap to its right" | the pinned row in the same frame: the pin is drawn, its neighbour is not, and **28px to the right of the glyph paints nothing** |
| "the `· agent` badge is followed by an equally empty right side" | any unpinned row here: the trailing statement ends and 56px of the row is empty |
| "its confirmation … shows up in a weird awkward spot in the sidebar with a gap below it" | `register-280/localOperatorDark.png` - the offer is a 264x25.4px line at y 493.6..519, i.e. at the bottom edge of the region *above* the list, 8px above the split line and **117px above the first list row it is about** |

Two things the operator's own reading does not contain, both measured here, are
stated in the spec as findings rather than folded into their report:

- **At the 240px clamp minimum a PINNED row carries no pin at all** - the mark
  lives inside the container the shed query hides, so its box reads `0x0` and
  nothing is painted (`rest-240/*.png`, both palettes). "The pin's state must
  read without hovering" is a rule this panel states; at the narrowest width the
  shipped build breaks it.
- **The frames below understate the operator's own crowding.** They were taken
  on a machine with macOS overlay scrollbars, where the list region's scroller
  takes no width. Their screenshot shows a classic scrollbar, which on those
  systems eats ~15px *inside* the scroller - so their rows are ~15px narrower
  than the same state photographed here.

## How these frames were taken

`scripts/renderer-driver.mjs`, scene **`row-space`** (added by this change), in a
headless launch - `AGENTS.md` § *Running the app without taking the operator's
focus*, and note that `--window-mode` resolves to `headless` for a rig-shaped
launch with no mode named. One launch per palette, because the scene's last step
presses a real control and the stand-in backend is stateful.

```
# 1. a build pointed at this set's stand-in backend (the repo's own .env
#    supplies the other keys)
set -a; . ~/local-operator-ui/.env; set +a
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18234 pnpm build

# 2. a FRESH stub per launch, then ONE launch per palette. The stub is a
#    RESPONDER, not a backend: no store, no turns, no transcript.
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs \
  --port 18234 --records /tmp/row-space-stub-records
LOCAL_OPERATOR_DESKTOP_TOKEN=[redacted] node scripts/renderer-driver.mjs \
  --scene row-space --backend http://127.0.0.1:18234 \
  --backend-records /tmp/row-space-stub-records --seed-onboarding-complete \
  --theme localOperatorDark --out /tmp/row-space-dark --window-size 1380x900
# …then the same launch with --theme localOperatorLight --out /tmp/row-space-light

# 3. the frames land as <out>/<label>.png and the label IS the directory name
#    here (no renaming step), plus one geometry file per palette:
#    <out>/row-space-geometry-<theme>.json -> measurements/
```

**Why the panel width is written through the divider's own action.** A row's
width is the user's own preference (`chatSidebarWidth`, clamped 240..360, default
280 - `DEFAULT_CHAT_SIDEBAR_WIDTH`), not a function of the window, so a window
resize would photograph the same panel at the same width. The scene writes it the
way the divider writes it (`setSidebarWidth`), which is also what makes **320**
reachable at all: `--window-size` cannot.

**Why the fixture is not the archive set's.** Two of the states these claims need
are not in it: a conversation long enough to TRUNCATE (all four of the archive
fixture's titles fit their box at every width here) and a conversation PINNED at
boot (`docs/evidence/sidebar-row-space/harness/stub-daemon.mjs` says so at its own
head). Nothing else about it differs.

**The app is real; the daemon is not.** The catalogue read, the store, the
sidebar, the drawer's geometry and the composer are the app's own. The frames
show the app's real empty-transcript state for the opened conversation (the stub
answers no history), which is why the pane to the right of the sidebar is not
what these frames are of.

## The frames

Every frame is **2760x1736 device pixels at DPR 2** - a 1380x868 content viewport
(the app's own default window, `--window-size 1380x900`) - and exists in both
palettes (`localOperatorDark.png`, `localOperatorLight.png`). App revision: the
build is of `b7f3e6126` (= `origin/main`, v0.30.5) with only this change's
`scripts/renderer-driver.mjs` scene added, and the runtime is the pinned
Electron **44.3.0** (the harness asserts installed == pinned, `AGENTS.md` § the
committed frame is only reproducible on the runtime that produced it).

| Directory | Scene label | The state | The pointer | Panel |
| --- | --- | --- | --- | --- |
| `rest-240` / `rest-280` / `rest-320` | `rest-<w>` | the panel at rest: pinned row, unpinned rows, one long title and the current row all in one frame | parked at (2, 2), off the panel | 240 / 280 / 320 |
| `hover-long-240/280/320` | `hover-long-<w>` | the **long** row (54 characters, the unread-marked one) under the pointer | on that row's own button, i.e. over its title | as above |
| `hover-pinned-240/280/320` | `hover-pinned-<w>` | the **pinned** row under the pointer, pin and archive both revealed | on the pinned row's button | as above |
| `hover-short-280` | `hover-short-280` | the **short** row (its title fits its box at every width) under the pointer - the row a marquee must leave alone | on the short row's button | 280 |
| `hover-current-280` | `hover-current-280` | the **current** row (`aria-current="page"`) under the pointer: both acts reveal and the SELECTED ground survives the pointer | on the current row's button | 280 |
| `register-280` | `register-280` | the panel's archive register after a REAL press on the short row's archive control, with a conversation open (so the composer is on screen) | parked, after the press | 280 |

## The measured geometry

All figures are CSS pixels, read from the running app by the scene and written
out in `measurements/row-space-geometry-localOperator<Theme>.json` (`states` is
the derived table, `boxes` the raw rects it is derived from). They are identical
in both palettes - the geometry does not move with the theme.

Panel: outer box **x 220..500** at the default (the rail is 220 wide), `padding:
8px` (`p-2`), so a row's box is **264** wide; the clamps give 224 and 304.

| Panel | Row box | Button | **Title** | Tail after the title | Pair | Pin | Archive | Shared |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **240** (clamp min) | 224 | 196 | **168** | 32 | `0x0` (shed) | `0x0` | `0x0` | 24, **not painted** |
| **280** (default) | 264 | 208 | **180** | 60 | 52 | 24, painted **only on a pinned row** | 24, **not painted** | `0x0` |
| **320** | 304 | 248 | **220** | 60 | 52 | 24, as above | 24, **not painted** | `0x0` |

The tail after the title is `4 (the row's own `gap-1`) + 24 (the pin) + 4 (the
pair's inner gap) + 24 (the archive) + 4 (the button's own `px-1`)` at 280 and
320, and `4 + 24 (the shared control) + 4` at 240. The title's own budget is
`row - 4 - controls - 8 (px-1) - 16 (the leading status slot) - 4 (its gap)`.

What is painted in that tail, at rest:

| Row class | Painted in the trailing 60px (280) | Paints NOTHING |
| --- | --- | --- |
| unpinned | - | **56px** of the 264px row (**21.2%**) |
| pinned | the 24px pin glyph | 32px |
| current (`aria-current="page"`) | - | 56px |

Title text at rest, 280: `"Quarterly retention sweep and the transcripts it
dropped"` (54 characters) needs **341px** and is given 180 - it truncates at
`"Quarterly retention sweep a"`, about 28.5 of its 54 characters (6.31px per
character measured on this string). `"Migration checklist"` needs 180 and gets
180: it fits, and this is the row a marquee must not move.

On hover, at 280, both controls are painted and **the title's own box does not
change** (180 before, 180 after): the reveal is `opacity` and `pointer-events`
only, which is the rule the spec replaces.

### The register, and where the offer could go instead

`register-280` measured, in the same frame:

| Box | x | y | size |
| --- | --- | --- | --- |
| the register's `Undo` line | 228..492 | **493.6..519** | 264 x 25.4 |
| the split boundary (0-height) | 228..492 | 527 | - |
| the first row of the list it is about | 228..492 | **644** | 264 x 32 |
| the composer's form | 524..1356 | 740..852 | 832 x 112 |
| **Send** | **1307..1339** | **803..835** | 32 x 32 |

So the offer sits 8px above the split line and **117px above the first row of
the list it refers to**, which is what "a weird awkward spot with a gap below
it" is: the line is positioned by the flex column between the two regions, not
by the list. The sidebar's outer box (220..500) and the composer (524..) are
**24px apart and disjoint**, which is the property the spec's toast lane is built
on. The Send box is the same one design round 2's D12 measured (1307..1339,
803..835) - that round's finding was a toast whose box spanned x 1001..1360.5,
y 789..842.5, i.e. exactly over it.

## Instrument notes

- **The frame set is reproducible to the pixel in the sidebar, and it is not
  perfectly reproducible overall.** Re-running the whole set (both palettes, a
  fresh stub) reproduces every sidebar pixel and the whole geometry file byte for
  byte; consecutive runs differ only in a **2x33px strip at device x 1098, y
  1531** - the composer's input caret, in the chat column, at a different phase of
  its blink. It is named here rather than left as a puzzle for whoever diffs two
  runs.
- **`captureSettled` is what makes a frame evidence at all**: each capture is
  retried until two consecutive frames are byte-identical with no toast on screen,
  so a frame that was never held still is reported as such rather than committed.
  Both runs of this set passed every check (25 of them) with no failure.
- **The scene asserts the width it labelled each frame with** (`setSidebarWidth`
  reports the clamped value it applied), because every number in the spec is
  quoted as a width's and a silent clamp would make three labels one panel.

## What these frames cannot show

- **A classic scrollbar.** macOS overlay scrollbars take no width, so the frames
  are of the 264px row. On a system set to always show scrollbars, the same state
  is ~15px narrower. The spec therefore *decides* the gutter question rather than
  measuring it.
- **The states that do not exist yet**: the marquee, the edge fade, the flyout and
  the sidebar-lane toast are this change's, so they are specified with numbers
  and photographed after the fact (the spec names the label each one is owed).
- **Motion.** A still frame is not evidence about a pan; the spec's numbers for
  it (dwell, speed, distance, reset) are what the coder and QA check, and the
  distance is measured here (341px of text in a 180px box).
