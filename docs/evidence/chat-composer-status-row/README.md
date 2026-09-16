# The composer's status row: the goal and the plan, above the box

The row itself, in the states `docs/composer-status-tabs.md` § 3.1 lists, at the
two column widths its own container queries resolve against.

These frames come from `scripts/capture-evidence.mjs` driving Storybook, which is
the committed and re-derivable route — unlike the composer-readings set beside this
one, whose live-app driver is deliberately not in the tree. The exact command that
wrote them:

```
pnpm storybook --port 6017 --no-open        # 6018 if a sibling worktree holds 6017

# The full surface, which is what a from-scratch re-derivation runs:
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-composer-status-row \
  --themes=localOperatorDark,localOperatorLight --allow-backend

# What the ROUND 1 REMEDIATION pass actually ran, in partial mode, because only the
# frames this round's fixes invalidated were re-taken: the clause change (the parked
# band), the wrap change (every width band), the new stacked/motion stories.
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=composer-status-row--activity --themes=... --allow-backend
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=composer-status-row--long-goal --themes=... --allow-backend
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=composer-status-row--activity-mark-motion --themes=... --allow-backend
```

`--only` is a substring of the story id, so the two names differ: the surface is
`chat-composer-status-row--*` and the story ids this set uses are its tail. This
pass ran against **6017** (no sibling held it this time); the frames are whatever
the URL you pass is serving. `states/`, `expanded/` and `column-floor/` were NOT
re-taken: the partial sweep rewrote only the directories its stories own, and those
three are byte-identical to the round-1 commit, which is itself the check that the
wrap fix did not reach them.

`--themes` is the two brand palettes, which is `branding.md` § 9.9's minimum, and
the light pass is where contrast defects hide. The tree is the commit that added
this surface; `manifest.json`'s `srcTree`/`scriptsTree` and `partialCapture` carry
it, as they do for every frame here.

## What is in each frame, and what it proves

The stories render the PRODUCTION `ComposerStatusRow`, over real `RunDetails` from
`deriveRunDetails` over wire-shaped `todos` — so the counts are the model's own,
not a tally written for a picture. Each frame carries more than one band because
every claim here is a comparison: a state, or the same state at another width,
with its control next to it. The composer box under each band is a stand-in whose
only jobs are the ground the row renders on (`rounded-frame border-control
bg-surface p-4`) and a neighbour whose height makes the row's vertical cost
legible; it contains no controls, and nothing in these frames is a claim about it.

| Frame (`<theme>.webp`) | Bands, and what they show |
| --- | --- |
| `states/` | The matrix in the record's order. **Band 1 is the state that most needs pinning: the row renders NOTHING**, so that band IS the pre-change composer — the box with no row above it, which is what every session with no goal and no plan looked like before this change. Then: goal alone, plan alone at the row's start, both, and a finished plan still saying `0 to-dos open`. |
| `long-goal/` | Three bands: a goal that fits (the chip is content-sized), a 300-character goal (the snippet truncates), and — added by round 1's D4 — **that same long goal with all four chips**. The truncation claim needs the first band to be legible at all: an ellipsis only says anything beside a value that does not need one, and the third band is where the goal's new width is legible, since the goal is the item that yields when the counts arrive. Its caption prints the measurement: **`900px column · row 32px tall · overflowX 0px · 4 chips · goal 484px (text 414/1956)`** — a 484px item whose text needs 1956px, against 698px of client width before the activity chips existed. `RowFacts` prints the goal's own numbers whenever a band has a goal, which is also why `activity-widths` and `activity-stacked` carry them. |
| `expanded/` | The collapsed row above its own expanded form at a 900px column, the second opened by CLICKING the real trigger. The vertical cost is the difference between the two bands; the body's cap is the whole-line ceiling `CAPPED_BLOCK` sets (120px, six lines at `leading-5`), which the frames show ending on a complete line rather than through a seventh line's glyphs. |
| `column-floor/` | The same pair at a **172px** column — the width the app's chat column actually reaches with the canvas open (QA round 1, measured on the built app; this set was captured at 220px before that correction, which meant it pinned a large-view inset at a width where the product renders the small-view step). The story derives `isSmallView` from its own band width, so the row takes `px-2 pb-1` and the stand-in box `p-2` exactly as the app does. Collapsed, the row stacks with its label visible; expanded, the body takes the row's own width less the primitive's 20px indent. |
| `activity-chips/` | The two activity chips (`docs/composer-activity-chips.md`), one band per state of the count gate: both lists in flight (four chips), the jobs chip alone at the row's start (no goal, no plan — so the first-chip rule falls to it), a PARKED child (open, so the chip renders, and nothing spins because nothing is running), and settled work, where the rows are still on the wire and **no chip is drawn for them**. Read the last band against the first: that pair is the gate. |
| `activity-widths/` | The width story. (This row called it "the only frame that carries its own numbers" until design round 1's D5: `wake-widths` prints numbers into all four of its bands too, through the same `RowFacts`, so the claim was about to stop being true the moment the wake set landed.) Three bands — 900px (the app's column), 240px (`CHAT_CHIP_ICON_ONLY_PX`) and the 172px floor — each MEASURING the row it contains after `document.fonts.ready` and printing `Npx column · row Npx tall · overflowX Npx · N chips` beneath it. Measured at this commit: **900 → 32px tall, overflowX 0, 4 chips; 240 → 106px tall, 0, 4; 172 → 106px tall, 0, 4.** The arrangement is visible in the picture (at 240 and at 172 the goal keeps the line and the three counts share the lines below it as one left-aligned group) and `overflowX 0` at all three is the property, not a hope: the group shrinks and wraps INSIDE the column rather than painting past it. **240 read 80px in round 1 and reads 106px now, which is the wrap fix and not a regression**: the old arrangement put the goal on the first line with ONE count chip pushed to the right margin and the other two on a left column below, so it was 26px shorter and the goal was truncated to `Goal: Rec…`; today the goal has the line to itself (`Goal: Reconcile the March i…`) and the counts are one column under it (`docs/composer-activity-chips.md` § 7, design review round 1, D2). |
| `activity-stacked/` | The 240px arrangement on its own, with its own numbers, and the two browser states a story cannot set (round 1's D5): `activity-stacked-hovered/` puts a real pointer on the GOAL's trigger and `activity-stacked-chip-hovered/` puts it on the jobs CHIP, which is the pair that shows the row's edge rule — the goal is the row's leading chip and its ground starts at the row's own edge (`-ml-1.5`), where the stacked chips' grounds start at theirs. `activity-stacked-focused/` walks the real `Tab` key to the subagents chip (`{ tabTo }`), so the ring in the frame is a genuine `:focus-visible` rather than a class; its tooltip is open in the picture, which is the state focus actually produces, and it covers part of the goal line above. |
| `wake-chip/` | The wake chip (`docs/composer-wakes.md`), five bands: **one armed wake** with nothing else in the row (`1 wake armed`, the state nothing in this app could show before this change), a plan-and-wakes pair (two count chips in one gutter), **nine armed schedules**, the **no-wakes CONTROL band** (the same plan and activity with NO wake chip, so the gate is legible as an absence), and all five chips on one line at 900px. Hover and focus for this chip are carried by the LIVE set, `docs/evidence/wake-live-app/` — the bullet in "What this set does NOT prove" now names it, because two states that this set re-derives for the activity chips are in no frame here for the wake chip. |
| `wake-widths/` | The row's own numbers with FIVE items at 900 / 240 / 220 / 172. **`overflowX 0` and 5 chips at every one**, `32px` tall at 900 and `132px` in the stacked arrangement below the 240px switch: the fourth count costs the goal width and one line at the floor, and nothing at width. |
| `activity-motion-1/`, `activity-motion-2/` | **The spin, photographed at a HELD phase.** The pair is the same story, theme and rig, half a turn apart: `activity-motion-1` holds the shipped `animate-spin` at `0ms` of its own 1s cycle and `activity-motion-2` at `500ms`, through the rig's `{ liveMotion, phaseMs }` tuple, whose hold is now applied — and asserted — **at the shutter**, not when the story's styles are first overridden (before Storybook has mounted anything, a cold server served an empty document and the hold matched nothing). **What the PAGE differs by, measured losslessly:** the same two phases captured at `format: "png"` instead of webp differ in **220 (dark) / 228 (light) pixels, every one of them inside the two marks' boxes (x648-664 and x807-823, y53-67) and none outside**. **What the committed WebP pair differs by:** 7,917 (dark) / 1,850 (light) pixels, of which only **193 / 168 exceed 8/255** and **147 / 148 of those sit in those same two boxes** (the rest are isolated singles on glyph edges); the remaining **7,724 / 1,682** are an achromatic ±1-2/255 field across the row's glyphs, i.e. the lossy ENCODER's own response to a differing input rather than the page — which is exactly why the lossless pair has no field at all. Round 3's M1' is that this row (and the manifest record and the commit message) claimed the whole 7,917/1,850 sat in two 14x14 boxes, which hold 392 pixels between them. **And the pair is re-derivable:** three consecutive captures of all four frames came back byte-identical (`cmp`), and capturing the two tuples at the SAME phase yields two byte-identical frames (AE 0), so the pair carries the phase and nothing else. Round 2's M1 is why any of this is measured: the rule this option once used selected `.animate-spin`, the token the mark does NOT carry (`motion-safe:animate-spin` is), so it matched nothing and the pair was sampled. Read the limits with it: a Storybook fixture rather than a live app, and the encoder's field IS in the committed files — a reader comparing those two byte-wise will see more than the marks. |
| `activity-chips-reduced-motion/` | The same four states with `prefers-reduced-motion: reduce`. **Say plainly what this frame is and is not**, which is what round 1's D3 asked for: it is NOT a comparison and proves NOTHING about the animation, because the rig injects `animation: none !important` before every shutter, so the animation is off in both frames. **How far the identity goes differs by theme, and round 2's n1 is that this sentence read as a property of the pair:** in dark the two frames ARE byte-identical (md5 `f6553f04140aa3558a41157157356ce2`, 23,094 bytes each), while in light 14,788 pixels differ — every one of them in rows 96-671, i.e. the composer stand-in BELOW the strip, at no more than 14/255 per channel, with rows 40-90 (the chip band this row is about) byte-identical in both themes. What it is worth is the one claim a still of that state can carry: with the reduced-motion media query active the mark renders, lands on a VISIBLE end state (the page's reduced-motion block CAPS durations rather than cancelling anything, so an element must never end invisible) and its shape still distinguishes running from parked. The spin itself is pinned as a class string in `scripts/composer-tabs.test.mjs` and photographed — at a held phase, re-run to byte-identity — in `activity-motion-1/2` above. |

## The numbers the bands were measured at

Read from the live DOM of these stories (the rig's own viewport), not from the
record's arithmetic — and stated because four of them are what the record's
§ 2.3 and § 11.1 predicted and two are not:

| | Record | Measured (900, one line) | Measured (172, small view) |
| --- | --- | --- | --- |
| Collapsed row height | 32px | **32px** | **54px** (the stacked arrangement, `pb-1`) |
| Goal chip box | 24px | **24px** | **24px** (156px wide) |
| Plan chip box | 24px | **24px** (112.3px wide, its `Info` mark 14px) | **24px** (112.3px wide) |
| First chip's left edge, both states | one edge | **x=34 in both** (`-ml-1.5`) | — (stacked; the goal chip leads) |
| Row `overflowX` | 0 | **0** | **0** |
| Row height, four chips (`activity-widths`) | — | **32px** | **106px**, and **106px at the 240px boundary too** (80px in round 1, before the chip group; see that row above) |
| Row height, FIVE chips (`wake-widths`) | — | **32px**, `overflowX 0`, goal 257px | **132px at 172px**, and **132px at 220px and at the 240px boundary too** — the same arrangement `activity-widths` measured at 106px with four chips, 26px taller because the fourth count adds a line in the stacked state |
| The wake chip's leading edge (`wake-chip`, band 1) | one edge | **x=40**, where the goal's chevron sits — a fourth chip that is FIRST takes the row's edge like the other three | — (stacked; the goal chip leads when there is one) |
| Goal item, four chips at 900 (`long-goal`, band 3) | — | **484px**, text **414** client against **1956** scroll | — |
| Goal snippet, 240 vs 172 (`activity-widths`) | — | `Goal: Reconcile the March i…` | `Goal: Reconcile t…` |
| Expanded body measure | (see below) | — | **136px** client, **120px** tall (six whole lines) against **300px** of content — the cap and its own scroller |

Measured with a real browser on these stories, out of the live DOM — not
re-derived from the record's arithmetic, which is what made the first version of
this table wrong in two rows. The two corrections worth naming: the floor is 172px
and takes the small-view step (so 54px, not 58px, and the body is 136px, not the
168px a large-view inset produced), and the goal's label is VISIBLE at the floor
rather than `sr-only` (design review round 1, D3 and D4).

**The body's 136px is narrower than the ≥160px the record used to call its
acceptance floor, and that floor was the wrong number**: it was arithmetic at a
220px column, `204 − 20`, and the app does not render that column. At the real one
even § 10's option D — the body spanning the whole row — tops out near the row's
own 156px content box. The record's § 11.1 now says this in its own words; the
number here is what the frame contains, and whether a ~136px measure is acceptable
at the floor is the design round's call rather than this set's claim.

## What this set does NOT prove

- **Not the live composer.** The row's real neighbours in the app are the send
  alert and the composer box, whose widths come from the chat column and the
  canvas pane; here they are a stand-in at a chosen width. The set the live app
  owns for this region is `docs/evidence/composer-readings/`, and the geometry
  claims that depend on the real column belong there.
- **No interaction beyond the two clicks.** The expanded bands were opened by a
  click on the real trigger, which is what makes the body's existence a rendered
  fact rather than a forced prop. The plan chip's REVEAL — pane open, reader left,
  To-dos section scrolled into view, focus unmoved — is a flow across three
  components, and a still of a story cannot show a scroll position in a pane that
  is not mounted. It is covered by `scripts/composer-tabs.test.mjs` for the
  request's mechanics and by QA's independent pass for the flow.
- **Nothing here is a live-app geometry claim.** The column width, the box and the
  band heights in these frames are the story's, chosen to match the app's measured
  numbers; the app's own numbers come from QA's driven pass. Where the two now
  agree is stated above and in the record's § 2.4, rather than left to look equal.
- **Hover and the focus ring are photographed in ONE arrangement only.**
  `activity-stacked-hovered/`, `activity-stacked-chip-hovered/` and
  `activity-stacked-focused/` are the 240px column (round 1's D5); the 900px and
  expanded states are still unphotographed, and the wash itself is the readings'
  own class (`session-status-strip`, already photographed in
  `docs/evidence/chat-session-status-strip/`), imported rather than restated.
  **The WAKE chip's own hover, focus ring and tooltip are in NO frame of this set**
  at any size — they are carried by the live set,
  `docs/evidence/wake-live-app/` (`live-wake-chip-hover`, `live-wake-chip-focused`),
  which is why round 1's D1 was answered there rather than here.
- **Not a running clock.** Every frame in the set except the two
  `activity-motion-*` ones is shot with the rig's blanket `animation: none
  !important`, so nothing in them is mid-animation; the motion pair HOLDS the
  shipped keyframes at a chosen phase rather than sampling a live one, as its row
  above says. No frame here shows the mark animating over time, and none claims
  to: that is what the class-string case in `scripts/composer-tabs.test.mjs` and
  the pair's two phases are for.
- **Nothing about a draft or a legacy pane beyond band 1 of `states`.** Both
  render nothing, which band 1 shows; a draft's *readings* are a different
  surface's claim.
