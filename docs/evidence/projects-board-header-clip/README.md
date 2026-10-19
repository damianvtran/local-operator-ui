# Projects board: cards clipped below the column header

Operator report, 2026-10-18: mid-scroll on the board, card text was readable
**through** the sticky column header band, and one card's text painted over the
header line. The operator also named the team straps; the measured bleed in
these captures is the column header row (the straps are `bg-canvas`, opaque,
and no glass rule overrides them). The worse case was window glass on, where
the header's own background is a lane wash.

## Root cause

The column header row was a `sticky top-0` child of the board's one two-axis
scroller (`project-board.tsx`, at `origin/main` `863c7e5664`). Cards therefore
scrolled **under** it and were hidden only by the header's fill. On glass that
fill is `[data-glass-lane]`'s lane wash — `--lo-glass-a-lane` is `0.48` on dark
and `0.49` on light at the default intensity 80 — so the text underneath was
plainly legible through the header. The scrollport's top edge and the header's
top edge were the same pixel, which is exactly the "merely a header with a
background" shape the fix had to remove.

## The fix

- **The column header row is now static, above the vertical scrollport.** The
  board is a 44px header viewport (a hidden-overflow window) above
  `[data-board-strip]`, the one two-axis scroller. The body's top edge is the
  header viewport's bottom edge, so card content is clipped there by
  `overflow`, not covered by a fill. The body stays full-view width, so its
  vertical scrollbar sits on the view's right edge (the round-1 affordance
  rule) and the straps' `sticky left-3` still resolves against a port that
  really scrolls on x.
- **The header row is opaque.** Its cells keep the flat `sunken` role on glass
  as well as off (computed `alpha: 1`, `backdrop-filter: none`). The band well
  below still carries the glass lane wash; the header is the clip boundary and
  does not rely on alpha for legibility.
- **Horizontal scrolling still moves headers with columns.** The header
  window's `scrollLeft` and the body's are mirrored in BOTH directions (with a
  padding-right copy of the body's scrollbar gutter, so both max offsets
  match), so a UA focus scroll of the header window moves the real scroller
  too; wheel over the 44px header is forwarded to the body. The drag
  measurement, auto-scroll and indicator read the body and the header row. The
  pointer reorder story still commits and persists
  `planning,qa,validation,active,done,paused`.
- **The team straps, per-column scrollers and board scroll are unchanged in
  behaviour**: straps pin at `top-0` of the strip (the strip now starts below
  the column row), each cell keeps `max-h-[calc(100cqh-92px)] overflow-y-auto`,
  and the strip still scrolls between teams.

## Frames

Captured from Storybook (the `GlassFrame` preview harness calls the shipped
`applyGlassFacts`; glass is intensity 80, vibrancy, coverage full). Viewport
1280x720 CSS px at dpr 2 (2560x1440 source). The boundary story scrolls a card
to 8px above the strip's top edge, so its title line sits at the boundary.

| frame | glass | scheme |
| --- | --- | --- |
| `before-glass-on-dark.png` | on | dark |
| `before-glass-on-light.png` | on | light |
| `before-glass-off-dark.png` | off | dark |
| `before-glass-off-light.png` | off | light |
| `after-glass-on-dark.png` | on | dark |
| `after-glass-on-light.png` | on | light |
| `after-glass-off-dark.png` | off | dark |
| `after-glass-off-light.png` | off | light |
| `after-top-of-column-dark-glass-on.png` | on | dark — no scroll, header flush with the columns |

The before glass-on frames show the card's key line (`load-shed-2`, its title
fallback) legible inside the `Active / In flight / 20` header band; the
description (`Slice 2 of the load shed`) is the line below it. The after frames
show that band clean and the card cut at the scrollport's top edge; the
description is the first line visible below the team strap. The glass-off pair
shows the structural change without translucency.

## Numbers

`geometry.json` carries the measured values. The two that decide the bug:

| reading | before | after |
| --- | --- | --- |
| scrollport top − header top | `0.0px` | `44.0px` (header bottom) |
| header computed background | `alpha 0.48` dark / `0.49` light (glass on) | `alpha 1` |
| header `backdrop-filter` | `none` | `none` |
| card top − scrollport top | `-8px` | `-8px` (clipped at the port) |
| vertical scrollbar | at the view's right edge | at the view's right edge (`clientWidth 1265` of `1280`) |
| strap label at body `scrollLeft 111` | — | pinned at x 36 while the band header is at x −87 |

Confirmed by the story plays as well as the frames: `BoardSticky` asserts the
header row's bottom edge IS the body's top edge, the band straps pin at `0px`,
and the cell cap resolves to `100cqh - 92px`; `BoardColumnDropCommits` commits
and persists the pointer drop; `BoardHorizontalScroll` asserts the header
window, the header row and the band cells all move by the same `scrollLeft`;
`library-tab--in-shell-glass` asserts the new global glass frame does not clear
the Library harness's own paint.

## Reproduce

```sh
node_modules/.bin/storybook dev -p 6033
# then, in the iframe:
#   ?id=projects-tab--board-header-boundary&viewMode=story&args=theme:localOperatorDark;glass:on
#   ?id=projects-tab--board-header-boundary&viewMode=story&args=theme:localOperatorLight;glass:off
```
