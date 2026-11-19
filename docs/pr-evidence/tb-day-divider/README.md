# The day divider's rule no longer crosses the day pill

The operator's report: in a channel's timeline the day divider's 1px hairline ran
straight through the centred date pill — through the pill's fill and across the
glyphs of "Wednesday, November 4".

Both frames here are the app photographing itself: `scripts/team-bridge-bench.mjs
--frames` boots the **built** app (`out/`) headless over CDP against a stub
daemon, lands on a Team Bridge channel with synthetic history, and captures the
window content. Same viewport (1380x900 at dpr 2 → 2760x1800), same theme
(`localOperatorDark`), same channel, same scroll position.

| frame | reading |
| --- | --- |
| `before-zoom.png` | the rule runs through the pill and the label at its mid-height: "Wednesday, December 31" is cut by it |
| `after-zoom.png` | the rule stops at both of the pill's edges; the label is whole |
| `before-wide.png`, `after-wide.png` | the same pair, the full timeline column width, unscaled |

Crops are taken from the device-resolution frame (`scrolled-dark.png`, 2760x1800)
and the zoom pair is upscaled 2x nearest-neighbour, so the 1 CSS px rule is a 2px
band a reader can see.

## What changed, in pixels

A pixel walk of the two device-resolution frames, both taken after scrolling to
the top of the channel:

| quantity | before | after |
| --- | --- | --- |
| rule colour | `rgb(59,54,39)` | `rgb(59,54,39)` (unchanged) |
| rule rows (device px) | 250–251, one 1 CSS px band | 249–250, one 1 CSS px band |
| rule runs across the row | **one** run, x 560–2719 (2160 px: full content width) | **two** runs, x 560–1469 and x 1810–2719 (910 + 910 px) |
| rule pixels inside the pill (x 1470–1809) | the whole 340 px width | **0** |
| pill fill | `rgb(47,42,31)` | `rgb(47,42,31)` |
| pane ground | `rgb(29,27,23)` | `rgb(29,27,23)` |
| pill box (device px) | x 1470–1809, y 226–273 → 170 x 24 CSS px | x 1470–1809, y 226–273 → **identical** |

The whole 2760x1800 frame differs in **three device rows** — 249, 250 and 251,
the rule band — and nowhere else. That is the geometry claim measured rather than
argued: a day item that changed height, or a pill that moved horizontally, moves
pixels in hundreds of rows. The item is still 40 px (`py-2` around an `h-6`
pill), the pill still rests 8 px in and is 24 px tall, the rule is still at the
pill's mid-line and still centred.

## Why it happened, and why the fix holds

`DayHeading` (the windowed strip's day item) drew ONE full-width `absolute`
hairline as a sibling *before* a non-positioned, centred pill row. CSS 2.1
Appendix E paints a positioned sibling in step 6 — above that row's block
background (step 3) and its inline text (step 5) — so the rule crossed the pill's
fill and overwrote the label's glyph rows. Not a transparency problem: the pill
is opaque, and the line was painted on top of it. The operator guessed
transparency.

The rule is now **two flush spans** (equal `flex-1` segments) either side of the
pill inside the divider row, so nothing is painted behind the pill at all. The
break therefore does not depend on the pill's fill being opaque — which is what
keeps it correct under window glass or any later translucent `elevated`.

## Window glass: the pill is opaque, read back from the built app

The fix is only glass-proof because `bg-elevated` actually resolves opaque where
the pill sits. Read back over CDP from the shipped renderer (headless, scratch
profile, glass driven through the app's own `window.api.windowGlass.set` IPC row)
on an element carrying `DayPill`'s exact class list:

| glass state | `data-glass` | `--lo-glass-a-elevated` | pill `background-color` | pill `backdrop-filter` | inside a `data-glass-region` |
| --- | --- | --- | --- | --- | --- |
| off | `null` | `null` | `rgb(47, 42, 31)` | `none` | no |
| on | `sidebar canvas pane` | `0.74` | `rgb(47, 42, 31)` | `none` | no |

The alpha variable exists (`0.74`) but does not reach `bg-elevated`: the glass
rules override `background-color` only on `[data-glass-region]` elements, and the
pill is a descendant, not a region. The frames above are glass-on renders —
that same launch shape boots with `data-glass="sidebar canvas pane"` on this
machine — and the pill's background is identical in both states.

`DayGroup` (the grouped list) deliberately keeps its absolute rule: there the
rule must not travel with a sticky pill, so it stays in the group's own flow and
the opaque `elevated` pill occludes it (`sticky top-2 z-[5]`). Two mechanisms,
because a sticky pill and a scrolling pill cannot share one.

## Gates

```console
$ node --test scripts/team-bridge-arrival.test.mjs scripts/team-bridge-timeline-window.test.mjs scripts/team-bridge-owner-audit-render.test.mjs
ℹ tests 141   ℹ pass 141   ℹ fail 0

$ pnpm exec tsc --noEmit -p tsconfig.app.json
(no output, exit 0)

$ pnpm exec biome check src/renderer/src/features/team-bridge/team-bridge-message-list.tsx scripts/team-bridge-arrival.test.mjs
Checked 2 files. No fixes applied. (0 errors)

$ pnpm lint:scripts
check-scripts-lint: 1 changed file(s) under scripts/ are lint-clean against origin/main (e999d2a).
```

`pnpm check-changed` was NOT run to completion: its `test` job is `pnpm
test:desktop` (the full desktop inventory), and this machine was under a
deliberate load hold at the time (host load ~124 from ~25 concurrent sessions).
The sweep was killed by exact pid and replaced with the affected files above; CI
runs the full inventory on this head.
