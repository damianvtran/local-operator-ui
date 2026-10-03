# The ask item's countdown, and urgency with an ink of its own

The desktop-surface audit filed three defects against the queued-ask lane. Its
first item — the bar counted a timed-out ask as one the agent was still waiting on
— is **#810's**, landed on `main` as `da76ff4795`: the split is now
`waiting`/`movedOn` in the read model, the item prints `1 question moved on` for a
queue the agent has walked past, and the row's attention ink is scoped to the asks
that are genuinely waiting.

The other two died with the strip that PR retired, and this set is their rehome
onto the row item that replaced it:

| the defect | where it was, before the move | this pass |
| --- | --- | --- |
| the deadline was invisible unless the panel was open | the strip printed `expires in 42m` on its collapsed face; `1 question waiting` cannot tell a queue with fifty minutes left from one that lapses while the reader looks at it | the item prints the soonest waiting countdown, with a subject when it is not the only waiting ask's |
| urgency was never painted | the wire has carried `urgent` since the lane existed (the backend derives it from the window, `timeout_s <= 900`) and no desktop surface rendered it: a row with ten minutes left looked exactly like one with an hour | the item's mark, the panel row's mark and the announced name all carry it, scoped to the waiting rows |

## The pair this set is

**Fourteen states, two brand palettes, before and after: 56 frames.** `before/` is
`origin/main`'s components (`da76ff4795`) rendering **the same fixtures, stories and
pinned clock** as `after/`, so a frame and its twin differ only in the code under
test. Every caption names the STATE and its fixture facts, never the rendering,
because one caption is printed into both halves.

| state | before (`da76ff4795`) | after |
| --- | --- | --- |
| `waiting` | `1 question waiting`, accent mark | `1 question waiting · expires in 48m` |
| `mixed` | `1 question waiting` (the split is in the announced name), accent | the same clause + `· expires in 48m` |
| `multiple` | `2 questions waiting`, accent, no countdown | `2 questions waiting · soonest ask expires in 48m` |
| `two-windows` | `2 questions waiting`, accent, no countdown | `2 questions waiting · soonest ask expires in 20m` (the sooner ask's number, from asks with 48m and 20m left) |
| `urgent` | `1 question waiting`, **accent** mark | `1 question waiting · expires in 3m`, **`warning`** mark, `· Urgent` in the announced name |
| `truncated` | `12 outstanding` | `12 outstanding` — and NO countdown, because a prefix cannot state a queue-scope deadline. **A guard frame** (see below) |
| `narrow-393` | a moved-on ask among its chips, wrapping | unchanged. **A guard frame** |
| `column-floor-220` | `1 question waiting` at the app's 220px column | unchanged — the countdown has already yielded. **A guard frame** |
| `multiple-band-260`, `two-windows-band-260`, `multiple-band-241` | a chip overhanging its own column in that band | the subject yields, the NUMBER stays, and the row does not paint past its column |
| `expanded-waiting` | the panel row: HelpCircle, accent, `expires in 48m` | the panel row unchanged; the ITEM below it now states the countdown (the pair differs at y 239-357, which is the item) |
| `expanded-urgent` | the panel row: HelpCircle, **accent** | HelpCircle kept, ink **`warning`**, `Urgent.` announced |
| `expanded-moved-on-urgent` | the panel row: **Clock**, warning, no urgency | identical. **A guard frame** |

**Four frames are guards rather than deltas**, and this list is MEASURED (the
count of differing pixels between each pair, both palettes, in the table below)
rather than asserted:

- `truncated` and `column-floor-220` are byte-identical pairs: they photograph the
  yield floors, where this pass changes nothing.
- `narrow-393` is identical too: a moved-on queue has no countdown, so the item is
  the same chip #810 shipped.
- `expanded-moved-on-urgent` is identical in both halves, and the reason is worth
  stating: `main` never had an urgency arm at all, and this pass's arm is scoped to
  the WAITING rows — so a timed-out urgent row wears its status arm's own Clock and
  warning ink, untouched. What the frame pins is that a timed-out urgent ask is
  neither inked nor announced as urgent (`data-lo-ask-row`'s DOM: `lucide-clock`,
  `rgb(224,176,75)`, **no `sr-only`**), which is the property UX round 2's U7 and
  round 3's U2 filed against this PR's own earlier head — a `main`-based pair
  cannot show that head, so the guard is the honest shape.

The discriminating pairs for the two rehomed items are `waiting`, `multiple`,
`two-windows`, `urgent`, `expanded-urgent` and the three `*band*` states.

## The fixture invariant

A fixture no consumer could produce renders a frame claiming a state the product
cannot be in — round 3's headline frame paired a 900-second window with
`expires in 18m`, three minutes longer than the ask's whole life (D1, Q2). The
stories' factory now **derives** the wire's two invariants instead of restating
them: `expires_at = created_at + timeout_s * 1000` and `urgent = timeout_s <= 900`,
with a `throw` if a site passes either explicitly and disagrees. The urgent
fixture's own window is the wire's short one, so its frame reads `expires in 3m`.

## The numbers, measured

**Item widths at a 569px column** (CDP probe on the live stories, `getBoundingClientRect`):

| state | item width |
| --- | --- |
| `truncated` (count only) | 115.38px |
| `column-floor-220` (count only, at its 220px column) | 133.47px |
| `urgent` | 221.83px |
| `waiting` | 229.69px |
| `multiple` | 308.73px |
| `two-windows` | 308.16px |

**The overflow band, and what fixes it.** The first yield rule was titrated on the
one-ask string: the deadline hid only below 241px while the two-ask forms measure
283px and 286px, so every column in **[241, 286)** painted a chip wider than
itself — `row.scrollWidth − clientWidth` of 3px at 300, 33px at 260 and 52px at 241
on the reviewed head. The countdown now yields in two steps and the chip can
compress, so **the row's overflow is 0 at every column in the sweep**:

| column | `waiting` | `multiple` | `two-windows` | `truncated` | countdown shown |
| --- | --- | --- | --- | --- | --- |
| 220 | 133.47 | 141.44 | 141.44 | 115.38 | yielded (the count only) |
| 241 | 215.00 | 215.00 | 215.00 | 115.38 | the number, subject yielded |
| 260 | 229.69 | 234.00 | 234.00 | 115.38 | the number, subject yielded |
| 300 | 229.69 | 237.66 | 237.08 | 115.38 | the number, subject yielded |
| 320 | 229.69 | 294.00 | 294.00 | 115.38 | both |
| 569 | 229.69 | 308.73 | 308.16 | 115.38 | both |

(every cell's `rowOverflow` is 0; the item is compressible with the COUNT as its
floor, so a squeezed `multiple` gives up the subject first, then compresses under
its own `max-content` - 308.73px at 569, 294.00 at 320 - while its number stays.)

**The guarantee, exercised.** The shipped copy fits every column after those
yields, so the compress-and-clip path is only reachable by copy that outgrows a
threshold. That is synthesised in the live DOM — a countdown grown to
`· soonest ask expires in 128m` — and re-measured:

| column | row overflow | count width | countdown width | countdown clipped |
| --- | --- | --- | --- | --- |
| 241 | **0** | 109.44 | 67.56 | 98 |
| 260 | **0** | 109.44 | 86.56 | 79 |
| 300 | **0** | 109.44 | 126.56 | 39 |

The count keeps its width, the countdown takes the whole squeeze and ellipsises,
and the row still never paints past its column. **Two earlier shapes of this were
caught by frames rather than by reasoning** and are recorded in the component's own
comment: a compressible chip beside a *wrappable* count collapsed to two lines
inside the box's fixed `h-6` (the truncated frame), and `max-w-full` on this box
resolved its percentage cap 6px short of the content's own `max-content` (the
urgent frame clipped `expires in 3m` to `expires in …` at a 900px column).

**Ink**, nearest palette token (ΔRGB, decoded with `sharp`):

| state | before (dark / light) | after (dark / light) |
| --- | --- | --- |
| `waiting`, `mixed`, `truncated` | accent 53.9 / 37.7 | accent (unchanged) |
| `multiple`, `two-windows` | accent 53.2-53.9 / 37.7 | accent (unchanged) |
| `urgent` | accent 53.9 / 37.7 | **warning 54.0 / 43.9** |
| `expanded-urgent` (row mark) | accent 51.0 / 31.8 | **warning 51.6 / 40.7** |
| `expanded-moved-on-urgent` (row mark) | warning 52.4 / 41.7 | warning (the Clock's own arm) |

Tokens: `localOperatorDark` `accent #38c96a` / `warning #e0b04b` on `surface
#2b2721`; `localOperatorLight` `accent #137742` / `warning #8a5800` on `surface
#f7f5ee`. **Contrast against the row's surface**: dark accent 6.88:1 and warning
7.41:1; light accent 5.14:1 and warning 5.54:1 — every reading clears 4.5:1, so
the step is legible in both themes and the light theme's warning is the STRONGER
of its two. It is also not colour-only: the item's announced name carries
`· Urgent` (design round 3's D5), and the panel row carries an `sr-only` `Urgent.`

**The row of glyph identities**, read from the rendered DOM rather than the source:

| state | `data-lo-ask-status` | glyph | ink | `sr-only` |
| --- | --- | --- | --- | --- |
| `expanded-urgent` | `open` | `lucide-circle-help` | `rgb(224,176,75)` | `Urgent.` |
| `expanded-moved-on-urgent` | `timed_out` | `lucide-clock` | `rgb(224,176,75)` | none |
| `expanded-waiting` | `open` | `lucide-circle-help` | `rgb(56,201,106)` | none |

## Records

- **UX U1 (accepted).** The row's height moves between an empty and a populated
  band (32px against 84px, 96.22px of the item being the countdown). That is
  `main`'s own arrangement — a chip row that wraps grows — and the app's band is
  bottom-anchored, so the composer field does not jump. Not fixed here.
- **UX O1 (inherited, not this pass's).** On a MIXED queue the moved-on count is
  announced-only: the visible chip says `1 question waiting` while the name says
  `1 question waiting · 1 moved on`. That is #810's own copy contract, recorded
  here so it is not mistaken for this pass's.

## What produced these frames

```
node_modules/.bin/storybook dev -p 6021 --no-open --ci --quiet

node scripts/capture-evidence.mjs http://localhost:6021 \
  --only=composer-status-row--ask- --allow-backend \
  --themes=localOperatorDark,localOperatorLight
```

`--allow-backend` because a backend was listening on the app's configured port;
these stories render from fixtures and never call out, which is what that flag
states. The widths, the overflow numbers, the glyph identities and the
contrast-derived ink readings come from scratchpad CDP probes against the same
rendered stories (one headless Chrome per scripted run, reaped by process group).

**Not in the sweep's `STORIES` table**, for the reason every bespoke set here is:
the pass ran with its fourteen entries appended temporarily — one per state, with
`before/` and `after/` substituted between the two runs — and they were removed
before the commit, because a `before/` directory IN the table would be re-captured
from the current code on the next sweep, which is how a pair becomes two identical
frames. The `before/` run is the same command with the four ask-lane modules
(`ask-queue.ts`, `composer-status-row.tsx`, `asks/ask-panel.tsx`,
`asks/ask-surfaces.tsx`) checked back out at `da76ff4795`, the fixtures kept.

## Not covered

`dom_audit.mjs` (the design-qa skill's overlap/clipping/target-size pass) did not
run: it needs playwright, which is not installed here and installing a browser
engine is out of bounds. Frame-level geometry is therefore **not** claimed as
covered by that tool; the geometry stated above is the CDP probe's measurements.
