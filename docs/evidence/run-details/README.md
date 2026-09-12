# Run details — the header popover, as a design proposal

`docs/run-details.md` specifies a header button that opens a popover over the
session's subagent roster and its to-do plan. These frames are the design
proposal as it was judged, re-taken on the base the feature was wired onto.

The frames render the **real `ChatHeader`** — the production component, with its
own action cluster, its own 32px controls and its own `!isCanvasOpen` gate — with
a fixture `runDetails` inside a chat-column ground, and the popover opened by
clicking the real button. The panel is Radix's own portal, so a frame is a picture
of the product's surface rather than a reproduction of it.

## The capture

```
# Storybook walks forward when a port is taken, so read the port off the banner
# rather than assuming it: the design round found 6017 held and bound 6018, the
# attempt before that landed on 6019, and the re-capture below found 6017 AND
# 6018 held by other worktrees' Storybooks and bound 6019 itself.
pnpm storybook --port 6017 --no-open

# Remediation round: bound 6017 (the two held ports were free this round).
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=run-details \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend

pnpm check-evidence
```

**This round ALL EIGHTEEN frames moved, and the reason is the ground.** #113 gave
the working surface the page ground, so the story now paints `canvas` under this
popover instead of `surface`; a pixel that used to be `(30,26,21)` in the dark
theme now reads `(23,19,14)`, which is a 7-unit channel step across everything the
panel does not cover. At zero fuzz that is 29-85% of each frame's pixels — a real
change and a quiet one, and the previous round's "thirteen came back
byte-identical" is the opposite result because there was nothing under the panel
to move.

The two causes are separable, and the thresholds are stated so that stays true:
the ground step is invisible to an 8% fuzz (8% of the quantum range is a 20-unit
channel difference, larger than the 7-unit step), so at **more than 20 units**
per channel — decoded with `dwebp -ppm` and compared pixel for pixel against the
previous set (`git show c1e648b49:<path>`) — the only frames with more than a few
differing pixels are the two whose CONTENT changed: `crowded` (**994 dark / 956
light**) and `subagents-only` (**4,048 / 4,236**), and `both-in-flight` (light,
**117**; dark, 1) whose running clock ticked. Every other frame is under 41 at
that threshold rather than exactly zero — 1–3 in nine of them, 19 in the light
`todos-only`, and up to 29 / 41 in the light `failure` and `failure-unseen`
frames — which is WebP re-encode noise on glyph edges, not ground or layout, and
the earlier "every other frame is zero" rounded it away. Read the pixel counts at
zero fuzz for the ground (29–85% of each frame's pixels differ there, all of it
the ground step), and at >20 units for the content; neither number alone says
what moved.

A caveat the counts alone would hide, and the reason `subagents-only` is quoted
beside `crowded` rather than instead of it: on `crowded` the six visible rows are
UNCHANGED between the two sets — same labels, same order, because the previous
fixture was stored chronologically and the two tie-break rules therefore agreed
there. What moved on `crowded` is the tally and the cancelled row's icon. The
frame whose rows were RE-SELECTED is `subagents-only`, and it is the one that
pins the rule.

**What the re-capture also confirms, numerically.** The panel's ground measures
`(40,34,25)` dark / `(255,253,252)` light against a page of `(23,19,14)` /
`(246,241,231)` — `elevated` over `canvas`, where the previous set's committed
frames measured `(24,21,13)` at the shadow's edge returning to `(30,26,21)`,
which IS `surface`. The geometry table's ground-and-edge row carries the
re-measured separation.

**Why narrowed rather than swept.** A full sweep is 516 frames and about half an
hour, and it DELETES the set before re-taking it — so a sweep to add eighteen
frames rewrites 516 nobody reviewed and buries the eighteen that changed. `--only`
plus `--themes` switches `capture-evidence.mjs` to append mode: nothing is swept,
and `manifest.json`'s `partialCapture` records that this surface arrived outside
the sweep.

**Why `--allow-backend`.** These stories render from fixture state and never call
out, which is what that flag asserts. A backend on the configured port otherwise
fails the run because a captured frame must be a function of the tree.

**Two of the twelve themes.** The other ten are covered numerically by
`pnpm check-themes` (1999 assertions across all twelve palettes); these frames
cover the two palettes that *are* the brand.

## What each frame shows

| Frame | What it shows |
| --- | --- |
| [`both-in-flight`](both-in-flight/) | Both sections and the hairline between them. Two children at work — a long label truncating with an ellipsis while the numbers run (`reviewer · 1m12s · 46% · $0.31`) stays whole, and an activity line indented under its label — over a phased plan with a blocked item and its reason. Both sections overflow here, so the panel is at its ceiling (`min(60vh, 480px)`) and paints its scrollbar (y≈52..327): this is the ordinary mid-run state, where `todos-only` is the content-sized one that paints nothing. The clock in this row is LIVE, so the two themes' frames were taken seconds apart and their elapsed labels may differ by a second: that is the same number's next tick, not a difference between the palettes. |
| [`subagents-only`](subagents-only/) | One section only, no empty `To-dos` heading. Three children in priority order: **running first, then the queued child, then settled** — running and queued share the top rank, and within it the tie falls to the child's own clock, so the queued row (which carries no clock at all) sorts after the running one. The queued row carries **no numbers at all** — no clock, no context, no cost — because the wire reported none for it, which is the omission rule (a number that is unknown is ABSENT, never zeroed); the rule is not "a queued child has no clock", and `crowded` shows the other side of it, where the queued child did carry a start time and prints its `9s` clock. The settled row shows no role (`agent_role` is the default `task`) and no second line. |
| [`todos-only`](todos-only/) | One section only: fifteen items over three phases, capped at ten with the five hidden rows disclosed **inside the phase that lost them**, and all five of them in the panel's OLDEST phase — `Reconcile` is wholly closed (`5/5 resolved`), so nothing of it survives the cap and the frame shows the state `§6.3` names but no earlier set reached: a phase header, its own `+5 more` in the item-text column, and **no rows under it**. Every item state in one plan — pending, done (struck, `ink-dim`), dropped (struck, `— dropped`, tag not struck), blocked (full `ink`, the loudest row, its `— blocked: <reason>` on its own indented line beneath it, complete rather than cut mid-word) — and the flat/headerless path is in `failure` rather than here. The tallies read in one grammar: `11 of 15 resolved · 1 dropped` for the section, `Reconcile · 5/5 resolved` and `Verify · 4/5 resolved` for the phases, where `resolved` is done **or** dropped. The plan's roster-order is visible too: the shed rows are the OLDEST, so `Verify` keeps `Re-run the totals` and its dropped row while the earliest phase's finished rows are the ones disclosed. |
| [`failure`](failure/) | The only colour the panel spends: the cross on the failed row, `danger`. Its second line is the first line of `error_text`, in monospace and allowed to wrap to two lines — the frame reads `FileNotFoundError: [Errno 2] No such file or` / `directory: 'ledger/q1.csv'`, so the identifier survives where a one-line head-truncation kept the exception's preamble and cut it. Nothing else on the row is red. Beside it a settled child with its role suppressed and no activity line. Below: the **flat single-phase plan**, rendering headerless with no `Todos · 0/3` it does not need. |
| [`failure-unseen`](failure-unseen/) | The state the `danger` dot exists for, photographed OPEN: the ONLY reason this run has a trigger is a failure nobody has read — both children have settled and every to-do is closed. Opening the panel acknowledges the failure in the same commit that shows it, and the panel stays — which is the whole point of the frame: against a trigger gated on `hasRunDetails` alone, this frame has no panel in it at all. It shows both halves of the second-line fix as well: the monospace exception wrapped to two lines with `'ledger/q1.csv'` intact, and the trigger's own tally reading `1 failed · 1 done`. |
| [`crowded`](crowded/) | Both overflows. Six rows, then `+3 more`, in the priority order (running/queued, failed, interrupted, then settled; ties to the NEWEST, by `settled_at` or `start_time`). The tally has shed whole segments down to `2 running · 1 queued · 1 failed`. **This is the frame that pins the slice's tie-break**: its jobs are stored deliberately out of chronological order (see the fixture), so an index tie-break shows a different six rows — the newest settled child, `Draft the migration plan`, visible on its `3m` clock and its slashed circle, is the one it would hide. Its status is `cancelled` rather than `paused` because a LIVE pause is mechanically a cancel on this wire and this fixture models a live session's `frontend.jobs` rows (`docs/run-details.md` § 3.3: the `paused` WORD is reachable, but only on a restored record from the durable graph after a restart — which is why the model has a mark for it and no story reproduces it). Below, the plan starts and the panel stops at its own ceiling — **with its scrollbar thumb painted at the right edge**, which is the frame's other subject: the thumb spans y≈52..380 of the panel's ≈478px viewport (≈330px of 478), so the content is roughly 1.4 viewports tall (≈690px) and ≈210px of it scrolls, and the 10px the bar overlays are taken off the content rather than out of the panel's right padding (see the measurement table). The row sliced at the bottom is now visibly "more below" rather than damage. |
| [`settled`](settled/) | Everything settled and nothing unseen, so **there is no run-details button** in the header. `§3.3`: settled work alone does not raise the trigger, because a finished roster is history and history lives in the transcript. |
| [`header-trigger`](header-trigger/) | The same ground with work in flight: the button is present, at the end of the bar beside the canvas button, in the cluster that took over `ml-auto`. Diff `settled` against this one — the fixtures are the only difference. |
| [`header-trigger-failed`](header-trigger-failed/) | The unseen failure: an 8px `danger` dot on the button's top-right corner. It is not a count; it says a child failed and nobody has looked, and the trigger clears it when the panel opens. |

## Geometry, measured from the frames

| What | Value | Where it comes from |
| --- | --- | --- |
| Panel width | 384px (`w-96`) | 377px of unbroken `elevated` on a text-free row, plus the two 1px hairline edges: x≈119..503. Outside it the one shadow, measured from the hairline out to the canvas ground ≈20px away — the focus ring that used to sit at x≈505 is gone (`docs/run-details.md` § 7). |
| Panel ceiling | `min(60vh, 480px)` | The 820-tall frames take the 480px branch: the panel's bottom edge lands at y≈528 with its top at y≈45. The 480-tall frame this surface was first captured in took the `60vh` branch instead — a 288px panel, which is the cap working, and the reason `todos-only` and `crowded` are captured at 820: at 288 the item cap's `+5 more` row falls past the fold of the one frame that exists to show it. |
| Scrolls, not clips, and says so | thumb ≈330px of a ≈478px viewport, and its 10px lane reserved in the content | The `ScrollArea` is `type="auto"`, so the thumb is painted whenever the content overflows and not at all when it fits. Measured in this set rather than assumed: `crowded` carries a `border-control` bar at x≈494..501 spanning y≈52..380 (330 of 478 ⇒ ≈690px of content, ≈210px scrolls), `both-in-flight` carries one at y≈52..327, and `failure-unseen` and `todos-only` paint none because their content fits. The bar is an OVERLAY, so it lands inside the panel's 12px right padding; while it is up the panel's own 10px lane is therefore taken off the scroll viewport instead, keyed on the live scrollbar, so the padding the reader sees is the padding the panel promises. Measured: with a bar up (`crowded`, `both-in-flight`, both themes) the widest tally inks to x479 against a thumb at x494..501 — a 14px gutter, where the same two edges measured 4px before the lane was reserved; with no bar the tally inks to x489-490 and nothing moved. The earlier set could not show the scroll state at all: Radix's default `type="hover"` needs a pointer, a capture has none, and the only cue left was a row sliced by the panel's floor. |
| Row heights | subagents 32px single line, 48px with a second line, 64px for a failure whose exception takes both clamped lines; to-do rows 24px single line, 40px for a blocked row's reason line | Measured off the first-line TEXT column in `crowded`, where a row's pitch is the distance from its first line to the next row's: 32, 48, 48, 64, 32 across its six rows in rank order — the queued 1-line, two running 2-line, failed 3-line (label plus two clamped exception lines), interrupted 1-line and cancelled 1-line rows. The earlier set read the same six rows off the ICON column, which carries each glyph's own ink offset inside its box (the cross inks 2px lower than the slashed circle), so the failed row's 64 read there as 65 and the two documents disagreed with the render. `failure-unseen` measures the same 64 — the pitch from the failed row's first line to the next row's, 67 before the error variant pinned `leading-4`. The to-do pair comes from `todos-only`'s mark column. The line heights are pinned (`leading-5` on the first line, `leading-4` on the second line, both variants of it) because the inherited 19.5px and 17.4px measured as a 48-50px two-line row and a 67px failure row. |
| One grid | marks and state icons in one 16px column at x≈133..149; first-line text at x≈157-158 in **both** lists, and the plan's `+N more` with it | Measured: the roster's state icons ink at x134..148 with labels at 158, and the plan's marks now ink at x134..147 with item text at 157-158. Before the fix the plan sat 12px right of the roster (marks at `pl-6`, text at 170), which is what made one panel read as two lists. The plan's own indent lives on the second line — the blocked reason at x≈157 — not in the first column, and the phase's `+N more` follows the same rule: it inks at x157 in `todos-only` (both themes), where the phase HEADERS below it ink at x133, so the disclosure reads as the footer of the rows above it rather than as the next header. |
| Panel edge | the one shadow, and no focus ring | Measured in both brand themes by walking DOWNWARD from the panel's floor in `crowded` (a horizontal probe crosses the transcript the panel overlaps, which is what made the previous set's edge numbers a mixture of shadow and glyph ink): the ground runs from the shadow's darkest pixel at the edge back to the page's own ground — dark `(16,14,8)` just below the hairline → `(23,19,14)` by ≈30px out; light `(217,214,206)` → `(245,239,230)` by ≈34px out, and the reach is uniform: measured as the last row more than 3 units off `canvas`, every column across the panel's span gives 21px dark and 29px light. Those two distances are one quantity, and naming the token's parts is what makes them checkable: `--lo-overlay-shadow` is `0 12px 32px -12px`, so `32 − 12 = 20` is the LATERAL reach and the downward reach is that plus the 12px y-offset — a vertical probe reads further than a lateral one, which is why this row says which direction it walked, and why the measured 21 / 29 are the shoulder of that falloff rather than the blur itself. **The ground it returns to is `canvas`**, the working column's own ground since #113 — and it returned `canvas` on the previous set as well, to the byte: comparing the two sets at identical coordinates, the strip below the floor (y532–819) differs by ≤2/255 in 196 of the 161,280 dark pixels and ≤6/255 in 4,729 light — encoder noise on the same gradient — and the measured reach is identical (21px / 29px in both sets). **What actually changed is the ground ABOVE the panel's floor.** In the previous set the story's column painted `surface` from y0 to y427 in every panel and header frame and the preview frame's `canvas` showed below y428, so the panel sat on `surface` for its upper 377px and on `canvas` for its floor (measured at x520, y200: `(29,25,20)` then, `(23,19,14)` now; at y428 it was already `canvas`); this head paints `canvas` under all of it (§ 5, and the story's own note), so the plane the panel is over is one plane instead of a seam. The previous row's `(24,21,13) → (30,26,21)` by x≈526 was that row's own HORIZONTAL probe — the reading this row's probe exists to reject as a measurement of the shadow. The panel's separation, measured as the modal colour of a panel-interior box against a ground box below the panel: dark L* 6.14 → 13.62 (Δ 7.48) and light 95.28 → 99.43 (Δ 4.16), against the palette tokens' own `elevated`-over-`canvas` step of 7.90 (dark) and 4.73 (light) and their `elevated`-over-`surface` step of 4.41 / 2.10 — which is the 4.50 / 2.07 the previous set's frames certified, on the wrong plane. No frame in the set — all eighteen, panel or header — contains an accent pixel at all: the capture opens the panel programmatically, so the trigger is never `focus-visible`, and its ring is therefore neither shown nor claimed by these frames (it is measured in `docs/run-details.md` § 7 instead). What that does prove is that the 2px ring the round before this one removed from the panel has not come back. |

## What these frames do NOT prove

- **That the product behaves this way.** The frames are real components over
  fixture state: `chat-page.tsx` derives the model from the canonical stream and
  hands it down, so the trigger IS reachable in the running app now, but no frame
  here is a photograph of a session anyone has run — and `Settled`'s missing
  button is a claim about the derived model, not about a live session. What the
  frames do carry is the pair that makes the claim checkable: `header-trigger`
  (a run with work in flight, button present) beside `settled` (everything
  settled, no button). The elapsed value is measured afresh once a second while
  a frame's panel is open (`run-details-clock.ts`), which is why the clock in a
  re-taken frame may read a second or two past its fixture anchor: that drift IS
  the behaviour — a frozen clock is the defect it exists to prevent.
- **The tooltip copy.** A still cannot show a hover tooltip and the frames are
  captured without a pointer. The strings — the clause order, the shedding, the
  singular/plural forms — are asserted in `scripts/run-detail-model.test.mjs`
  instead. The `danger` dot, which is not a hover, IS photographed.
- **Reduced motion.** The running mark is `motion-safe:animate-spin` and the
  circles stay put when motion is reduced; the frames are taken with motion on.
  The design's claim is that the SHAPES carry the states, and the six states in
  these frames are all distinguishable without colour.
- **The panel updating while open.** The frames are one instant each; whether a
  row that settles mid-read reflows the list is a behaviour, not a still. One
  half of it IS photographed: `failure-unseen` opens through the real button,
  which acknowledges the failure in the same commit, and the panel is still
  there — the state that used to unmount it.
- **Ten of the twelve themes.** See above.
- **Any interactive path.** Rows are not clickable and nothing in the panel is,
  which is the design (`§4.3`) — so a still loses nothing here, but it also cannot
  demonstrate the absence of a click. What it CAN demonstrate is the absence of a
  hover ground, which is a class and not a state: no frame in this set paints
  `accent-wash` on a row, because no row carries it any more.
