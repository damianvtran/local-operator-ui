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
| `column-floor-applied` | `1 question waiting`, no countdown | `1 question waiting · expires in 48m` — the deadline IS painted at the applied floor, because no yield tier can bind there. This frame replaced the set's `column-floor-172`/`-220` frames |
| `multiple-band-260`, `two-windows-band-260`, `multiple-band-241` | a chip overhanging its own column in that band, and a countdown cut to `expires in 4...` on this PR's own round-3 head | the sentence yields WHOLE to the value (`· 48m`), the count is the floor, and no column paints a partial number |
| `expanded-waiting` | the panel row: HelpCircle, accent, `expires in 48m` | the panel row unchanged; the ITEM below it now states the countdown (the pair differs at y 239-357, which is the item) |
| `expanded-urgent` | the panel row: HelpCircle, **accent** | HelpCircle kept, ink **`warning`**, `Urgent.` announced |
| `expanded-moved-on-urgent` | the panel row: **Clock**, warning, no urgency | identical. **A guard frame** |

**Three frames are guards rather than deltas**, and this list is MEASURED (the
count of differing pixels between each pair, both palettes, in the table below)
rather than asserted:

- `truncated` is a byte-identical pair: a truncated queue states a tally and no
  countdown at any width, so this pass changes nothing in it.
- `column-floor-applied` is the frame the correction pass added and it is NOT a
  guard: at the applied floor the two halves differ, because `main` paints no
  countdown and this branch paints the whole clause.
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

The discriminating pairs for the rehomed items are `waiting`, `mixed`, `multiple`,
`two-windows`, `urgent`, `expanded-waiting`, `expanded-urgent` and the three
`*band*` states.

## The fixture invariant

A fixture no consumer could produce renders a frame claiming a state the product
cannot be in — round 3's headline frame paired a 900-second window with
`expires in 18m`, three minutes longer than the ask's whole life (D1, Q2). The
stories' factory now **derives** the wire's three invariants instead of restating
them: `expires_at = created_at + timeout_s * 1000`, `urgent = timeout_s <= 900`
(round 3's D1), and — added in round 4, because the first two constrain the deadline
and the flag against each other but not against the STATUS derived from them —
**an `open` ask's deadline is still ahead of the pinned clock and a `timed_out`
ask's has already passed**, with `answered_at` never in the clock's future. A site
that disagrees gets a `throw` at the story, where it is visible, rather than in a
frame nobody can falsify. The urgent fixture's own window is the wire's short one,
so its frame reads `expires in 3m`.

**The new arm is exercised, not asserted.** As a positive control, `ASK_MOVED_ON`'s
`created_at` was set to `ASK_TS` — a live window under `status: "timed_out"` — and
the story then fails to render: Storybook paints its error display and
`[data-lo-ask-item-toggle]` never appears in the DOM (the probe's reading, before the
revert). Restoring the fixture restores the frame. The two arms added in round 3 were
proved the same way.

## The numbers, measured

**Item widths at a 569px column** (CDP probe on the live stories, `getBoundingClientRect`):

| state | item width |
| --- | --- |
| `truncated` (count only) | 115.38px |
| `column-floor-applied` (the whole clause, at the applied floor: box 432px) | 229.69px |
| `urgent` | 221.83px |
| `waiting` | 229.69px |
| `multiple` | 308.73px |
| `two-windows` | 308.16px |

**The yield, measured against the room the chip actually has.** The chip is painted
into the composer's content box, which reads **`column − 10px`** at every column this
was read at (213/241/269/270/341 — the same arithmetic at each); the earlier rules
measured the COLUMN instead, which is how a countdown got sized against 241px while
the chip had 231px, and cut to `expires in 4...` — a prefix of both `4m` and `48m`,
beside an urgency ink claiming fifteen minutes or less. Each form is now replaced
WHOLE by the next that fits, never cut:

| column | `waiting` | `multiple` | `two-windows` | `truncated` | countdown shown | slack |
| --- | --- | --- | --- | --- | --- | --- |
| 180 | 133.47 | 141.44 | 141.44 | 115.38 | nothing — the count alone | 29 |
| 213 | 172.23 | 180.20 | 179.63 | 115.38 | the VALUE (` · 48m`) | 23 |
| 241 | 172.23 | 180.20 | 179.63 | 115.38 | the value (the band this PR was filed against) | 51 |
| 260 | 172.23 | 180.20 | 179.63 | 115.38 | the value | 70 |
| 270 | 229.69 | 237.66 | 237.08 | 115.38 | the SENTENCE, subject dropped | 22 |
| 320 | 229.69 | 237.66 | 237.08 | 115.38 | the sentence, subject dropped | 72 |
| 341 | 229.69 | 308.73 | 308.16 | 115.38 | the sentence WITH its subject | 22 |
| 569 | 229.69 | 308.73 | 308.16 | 115.38 | the sentence with its subject | 250 |

`slack` is the gap between the chip's right edge and the composer content box's right
edge, in px — i.e. **the room left over**: it is ≥ 22 at every one of these 32 cells,
so nothing paints past the column. Each band edge also carries margin over the form
it admits: **~22px** on the shipped fixtures' count (`2 questions waiting`) and
**~15px** on the widest count the wire can deliver (`20 questions waiting`, the
list's own cap) - the second is the case that has to hold, and it is the one both
edges are titrated against (deliberately: a locale's digits are not this font's
digits, and a threshold tuned to fit exactly re-breaks on the next copy change).

**The floor, stated in the unit the rules are written in.** The correction pass
settled what three rounds argued about, and the answer is that the numbers were
right and the words were wrong:

- **The column's applied floor is 480**, not 220 and not 172. `CHAT_PANE_MIN_PX` is
  applied by §I, and `scripts/chat-pane-floors.test.mjs` asserts it EXACTLY - its own
  note records that the assertion it replaced allowed `(0, 480]` *"while the tree was
  still at 220"*, and that 220 is a legal value under that allowance is the defect §I
  spent. The three `chat-content.tsx` comments that cited 220 as the column's floor
  were corrected to 480 in this branch.
- **172 is the composer BOX inside a 220px column** (172 + 2x24 = 220), which is why
  `docs/composer-status-tabs.md` §2.4 reading *"the column measures 172px"* is a box
  labelled as a column. The frames in this set are pinned at BOX widths for the same
  reason, and that is now said once, here, so no caption implies the column.
- **No yield tier can bind at the applied floor.** At a 480 column the composer box is
  **432px** (measured on the live story: `containerWidth: 432`), and the widest tier
  (341) needs it below 341 - the column would have to fall to about **389px**. So
  the 341/270/213 tiers are a **container-query safety net against a future
  narrowing**, not a rule the product applies: at the applied floor the chip paints
  the full form, and `multiple-band-*`/`two-windows-band-260` photograph a narrowing
  the app does not currently render. What the guarantee is worth is unchanged and now
  stated truly: the countdown is never cut mid-number at any width the tiers can be
  reached from, and if the column ever narrows near 389px the yield engages rather
  than clipping `expires in 4...` (design round 4's MAJOR).
- **Q6 is withdrawn, and the measurement settled it.** QA re-measured the chip box at
  the small-view band and got `column - 10px` with **22.34 / 22.27px** of clearance -
  the docblock's number and the larger of the two the disagreement quoted. Q6's
  `column - 26px` came from applying the large-view inset at a small-view column.
- **A correction to a claim this branch made earlier, and the sweep's real extent.**
  The sweep reported that no `min-w-[220px]` remains anywhere in the tree. That is
  false - `grep -rn` finds it in three docs files plus a fourth spot outside
  `docs/evidence`: `docs/evidence/chat-shell/README.md:800`,
  `docs/evidence/tui-parity/layout-audit.md:30` and `:121`, and
  `docs/run-sidebar.md:205` (which states the layout in the present tense). Those are
  each file's own record of the layout it was written against and stay as records.
  What is true is that **no `min-w-[220px]` remains in `src/`**, and that the three
  `chat-content.tsx` comments the sweep corrected were describing the column's floor.
- **Design round 6's D2, answered by sweeping rather than by explaining.** The same
  stale present-tense claim stood in five further source comments - `chat-measure.ts`,
  `session-status-strip.tsx` (two), `older-history-slot.tsx`,
  `directory-indicator.tsx` and `message-input.tsx` - and all five now state the
  column's floor as 480 (or drop the number where the argument does not need one),
  keeping the 220 only where a measurement was genuinely taken at 220, labelled as
  that era's. What still says 220 is the set of things whose subject IS 220: the story
  boards pinned at that width (`session-status-strip.stories.tsx`), this set's own
  history, and the deliberate `IT WAS 220 UNTIL §I` notes in `chat-content.tsx` and
  this component.

**The one thing the yield may never produce is a partial TIME value** — `4...` and
`48...` are the same glyphs to a reader deciding whether to hurry. Swept over
[180, 200, 212, 213, 220, 240, 241, 260, 269, 270, 300, 320, 332, 340, 341, 400,
569] × the five countdown-bearing states, the painted countdown is **always a whole
form or absent: 0 partial values in 85 readings**, minimum slack 22.84px. The
`overflow-hidden text-ellipsis` on the spans stays as the never-paint-past-the-column
guarantee for copy this row has not seen; the bands are what make it unreachable for
the copy that ships.

**Two earlier shapes of this yield were caught by frames rather than by reasoning**,
and both are recorded in the component's own comment because each looked correct
until it was rendered: a compressible chip beside a *wrappable* countdown collapsed
to two lines inside the box's fixed `h-6` (the `truncated` frame), and `max-w-full`
on this box resolved its percentage cap 6px short of the content's own `max-content`
(the `urgent` frame clipped `expires in 3m` to `expires in …` at a 900px column).

**The DOM's own ink readings**, exact token values rather than a frame estimate:

| state | item mark | panel row: status / glyph / ink / `sr-only` |
| --- | --- | --- |
| `urgent` | `rgb(224,176,75)` = warning | — (no panel) |
| `waiting` | `rgb(56,201,106)` = accent | — |
| `expanded-urgent` | warning | `open` / `lucide-circle-help` / `rgb(224,176,75)` / `Urgent.` |
| `expanded-waiting` | accent | `open` / `lucide-circle-help` / `rgb(56,201,106)` / none |
| `expanded-moved-on-urgent` | `rgb(194,188,175)` = ink-muted | `timed_out` / `lucide-clock` / `rgb(224,176,75)` / **none** |

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

`dom_audit.mjs` (the design-qa skill's overlap/clipping/target-size pass) **was run
in QA round 4 and is clean**, apart from one advisory worth recording: the item's
target box is 24px tall (`h-6`, the row's shared chip box from `main`) against the
44px comfort target, so the advisory is the row's own and not this pass's copy — the
threshold asks for 44px and this row has always been 24px. This set's own frames are
not its evidence: the numbers above are CDP probe measurements against the same
rendered stories.
