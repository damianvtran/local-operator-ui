# The ask item's countdown, and urgency with an ink of its own

The desktop-surface audit filed three defects against the queued-ask lane. Its
first item - the bar counted a timed-out ask as one the agent was still waiting on
- is **#810's**, landed on `main` as `da76ff4795` ("the ask queue moves into the
composer status row"): the split is now `waiting`/`movedOn` in the read model, the
item prints `1 question moved on` for a queue the agent has walked past, and the
row's attention ink is scoped to the asks that are genuinely waiting.

The other two died with the strip that PR retired, and this set is their rehome
onto the row item that replaced it:

| the defect | where it was, before the move | this pass |
| --- | --- | --- |
| the deadline was invisible unless the panel was open | the strip printed `expires in 42m` on its collapsed face; `1 question waiting` cannot tell a queue with fifty minutes left from one that lapses while the reader looks at it | the item prints the soonest waiting deadline, qualified when it is not the only waiting ask's |
| urgency was never painted | the wire has carried `urgent` since the lane existed (the backend derives it from the window, `timeout <= 900`) and no desktop surface rendered it: a row with ten minutes left looked exactly like one with an hour | the item's mark and the panel row's mark step their ink to `warning` |

## The pair this set is

Ten states, two brand palettes, before and after. **`before/` is `origin/main`'s
components (`da76ff4795`) rendering these fixtures** - the state #810 shipped -
and `after/` is this pass's. The fixtures, the stories and the pinned clock are the
same in both halves: `parameters`/props carry them, so the only difference between
a `before/` frame and its `after/` twin is the code under test.

Every caption in a frame names the STATE and its fixture facts ("Two waiting asks
with DIFFERENT windows: fifty minutes left on one, twelve on the other"), never
the rendering, because one caption is printed into both halves - a caption that
described this pass's paint would be a claim the `before/` frame contradicts. The
per-state deltas are in the table below and in the README's own measurements.

| state | before (`da76ff4795`) | after |
| --- | --- | --- |
| `waiting` | `1 question waiting`, accent mark | `1 question waiting · expires in 48m` |
| `mixed` | `1 question waiting` (the split is in the announced name), accent | the same clause + `· expires in 48m` |
| `two-windows` | `2 questions waiting`, accent, no countdown | `2 questions waiting · soonest expires in 12m` |
| `urgent` | `1 question waiting`, **accent** mark | `1 question waiting · expires in 18m`, **`warning`** mark |
| `truncated` | `12 outstanding` | `12 outstanding` - and NO countdown, because a prefix cannot state a queue-scope deadline |
| `narrow-393` | a moved-on ask among its chips, wrapping | unchanged (this state is context: the moved-on register, and where the item sits in the row) |
| `deadline-floor-241` | `1 question waiting` at the app's 220px column | `1 question waiting` - the countdown YIELDS at this width rather than growing the item |
| `expanded-waiting` | the panel row: HelpCircle, accent, `expires in 48m` | unchanged (context for the two below) |
| `expanded-urgent` | the panel row: HelpCircle, **accent** | HelpCircle kept, ink **`warning`**, `Urgent.` announced |
| `expanded-moved-on-urgent` | the panel row: **Clock**, warning | **Clock**, warning - a GUARD frame, not a delta |

**Two frames are honest about being guards rather than changes.** `narrow-393` and
`expanded-waiting` photograph states this pass does not alter, and
`expanded-moved-on-urgent` is identical in both halves against `main`: the first
cut of the urgency arm returned `HelpCircle` *before* the status switch, which took
the Clock away from a timed-out urgent row (design round 1's D5). `main` never had
that arm, so no `main`-based pair can show it; what the frame pins is that the
shipped row keeps `lucide-clock`, which is the property a future arm must not
break. The discriminating pairs for the two rehomed items are `waiting`,
`two-windows`, `urgent` and `expanded-urgent`.

## The numbers, measured

**Ink** (smallest ΔRGB from each frame to the palette token, decoded with `sharp`;
the marks are 14px glyphs, so these are blends):

| state | before (dark / light) | after (dark / light) |
| --- | --- | --- |
| `waiting`, `mixed`, `truncated` | accent 53.9 / 37.7 | accent 53.9 / 37.7 (unchanged) |
| `two-windows` | accent 53.2 / 37.7 | accent 53.2 / 37.7 (unchanged) |
| `urgent` | accent 53.9 / 37.7 | **warning 52.7 / 43.9** |
| `expanded-urgent` (row mark) | accent 51.0 / 31.8 | **warning 51.6 / 40.7** |
| `expanded-moved-on-urgent` (row mark) | warning 52.4 / 41.7 | warning 52.4 / 41.7 (the Clock's own arm) |

Tokens: `localOperatorDark` `accent #38c96a` / `warning #e0b04b`;
`localOperatorLight` `accent #137742` / `warning #8a5800`.

**The row of glyph identities**, read from the rendered DOM rather than the
source (`data-lo-ask-row`'s own `svg` class and computed colour):

| state | `data-lo-ask-status` | glyph | ink |
| --- | --- | --- | --- |
| `expanded-urgent` | `open` | `lucide-circle-help` | `rgb(224,176,75)` |
| `expanded-moved-on-urgent` | `timed_out` | `lucide-clock` | `rgb(224,176,75)` |
| `expanded-waiting` | `open` | `lucide-circle-help` | `rgb(56,201,106)` |

**The item's width, and why the countdown yields** (measured with a scratchpad CDP
probe on the same rendered stories):

| column | item width | countdown |
| --- | --- | --- |
| 569px (the band's own measure) | 229.69px | shown |
| 241px (the row's narrow band) | 229.69px | shown - it just fits |
| 220px (the app's own column floor) | ~148px | **yielded** |

The yield is the row's existing narrow band, `@max-[241px]/chatcol:hidden`, which
Tailwind renders as `@container chatcol (width < 241px)`: at exactly 241px it does
**not** fire (measured - that is what the 241px column above is for), and below it
the deadline drops out so the item still fits the column the app's minimum window
leaves. The count stays, and the ANNOUNCED NAME keeps the countdown at every width
- a screen reader is not reading a 220px column, and hiding the fact from it would
be the defect this pass exists to fix.

## What produced these frames

```
node_modules/.bin/storybook dev -p 6019 --no-open --ci --quiet

node scripts/capture-evidence.mjs http://localhost:6019 \
  --only=composer-status-row--ask- --allow-backend \
  --themes=localOperatorDark,localOperatorLight
```

`--allow-backend` because a backend was listening on the app's configured port;
these stories render from fixtures and never call out, which is what that flag
states.

**Not in the sweep's `STORIES` table.** As with every bespoke set in this tree,
the pass ran with its ten entries appended to `STORIES` temporarily - one per
state, with `before/` and `after/` substituted between the two runs - and they were
removed again before the commit, because a `before/` directory IN the table would
be re-captured from the current code on the next sweep, which is how a pair becomes
two identical frames. The `before/` run is the same command with the four modules
(`ask-queue.ts`, `composer-status-row.tsx`, `asks/ask-panel.tsx`,
`asks/ask-surfaces.tsx`) checked back out at `da76ff4795`, the fixtures kept.

## Not covered

`dom_audit.mjs` (the design-qa skill's overlap/clipping/target-size pass) did not
run: it needs playwright, which is not installed here and installing a browser
engine is out of bounds. The DOM-level readings above come from a scratchpad CDP
probe against the same rendered stories. Frame-level geometry - overlap, clipping,
target size - is **not** covered by this pass and is not claimed.
