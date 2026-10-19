# Projects board: cards clipped below the column header

Operator report, 2026-10-18: mid-scroll on the board, card text was readable
**through** the sticky column header band, and one card's text painted over the
header line. The team straps showed the same bleed. The worse case was window
glass on, where the header's own background is a lane wash.

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
  board is an outer `overflow-x-auto` scroller containing (a) the 44px header
  row and (b) `[data-board-strip]`, an `overflow-y-auto` viewport. The strip's
  top edge is the header row's bottom edge, so card content is clipped there by
  `overflow`, not covered by a fill.
- **The header row is opaque.** Its cells keep the flat `sunken` role on glass
  as well as off (computed `alpha: 1`, `backdrop-filter: none`). The band well
  below still carries the glass lane wash; the header is the clip boundary and
  does not rely on alpha for legibility.
- **Horizontal scrolling still moves headers with columns.** Both live inside
  the one outer x-scroller; the drag measurement/auto-scroll code now reads
  columns and `scrollLeft` from that element. The pointer reorder story still
  commits `planning,qa,validation,active,done,paused`.
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

The before glass-on frames show the title (`Slice 2 of the load shed` and the
card's `load-shed-2` key) legible inside the `Active / In flight / 20` header
band. The after frames show that band clean and the card cut at the scrollport's
top edge; the glass-off pair shows the structural change without translucency.

## Numbers

`geometry.json` carries the measured values. The two that decide the bug:

| reading | before | after |
| --- | --- | --- |
| scrollport top − header top | `0.0px` | `44.0px` (header bottom) |
| header computed background | `alpha 0.48` dark / `0.49` light (glass on) | `alpha 1` |
| header `backdrop-filter` | `none` | `none` |
| card top − scrollport top | `-8px` | `-8px` (clipped at the port) |

Confirmed by the story plays as well as the frames: `BoardSticky` asserts the
header row ends at the scrollport's top edge, the band straps pin at `0px`, and
the cell cap resolves to `100cqh - 92px`; `BoardColumnDropCommits` commits and
persists the pointer drop; `BoardHorizontalScroll` asserts the header row and
the band cells move by the same `scrollLeft`.

## Reproduce

```sh
node_modules/.bin/storybook dev -p 6033
# then, in the iframe:
#   ?id=projects-tab--board-header-boundary&viewMode=story&args=theme:localOperatorDark;glass:on
#   ?id=projects-tab--board-header-boundary&viewMode=story&args=theme:localOperatorLight;glass:off
```
