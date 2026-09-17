# The run panel's reveal: the operator's original report, and the pane's fit

**READ THIS FIRST.** The frame shift this set was originally shot to document —
pressing the composer's plan chip sliding the chat column, the transcript and the
composer sideways under the sidebar — **does not reproduce on the merge base this
branch lands on.** `origin/main` landed the same region-scoped reveal itself
(#228, `c25a0a4e9`), so `shared/lib/scroll.ts` and the
`scrollRegionToTop(region, target)` assignment are main's now, and this branch
imports them. Measured on both ends with one rig: `movers: []` on the base at every state
driven, exactly as on this head — see *Re-derived on the merge base* below for the
full table. The two ends were driven against `5c53e1c75`; `origin/main` then moved
to `962f43350` and the branch was rebased onto it, and that diff touches **none**
of the reveal's own files (`git diff --name-only 5c53e1c75 962f43350` names the MCP
auth dialog, its evidence set, the manifest, `package.json` and two script tests —
zero of `chat-content.tsx`, `run-panel.tsx`, `scroll.ts`, `story-scroll.ts`), so
the readings carry. A re-drive against `962f43350` is owed with the rest of the
heavy list at the foot of this file.

What the set is still evidence for, and why it is kept:

- **`before-fix` is the record of the operator's original report**, not a
  reproduction against today's base. It is the BUILT app of `origin/main` at
  `8f80697c8` — the branch's ORIGINAL base and the v0.24.0 the operator reported
  the defect from — and the `0 → 108` / `0 → 221` rows in the table below are
  real measurements of a real defect on that tree. They are kept because that is
  what was reported and what this branch's history is about, and the frames are
  the only pictures of it.
- **`after-fix` is this branch's own build, and the half that still bites.** What
  it shows on the current merge base is the **pane's fit**: on the base the pane's
  right 116px (at the operator's 1024x673 with the rail expanded) and 340px (at
  the app's 800x600 floor) sit outside the window, its close control is off-screen
  and not hit-testable, and four rows end at a hard screen edge with no ellipsis;
  on this head all of those are zero. Exact numbers in *The pane's fit* and in the
  re-derived table below.

Thirteen frames, one pair per size and rail state, of the same gesture: **press the composer's plan
chip and look at what moves.** They were taken for
`docs/composer-status-tabs.md` § 5.2 step 3 ("bring the To-dos section into view
IN THE PANE'S SCROLL REGION"), which the `8f80697c8` code did not do — it called
`scrollIntoView`, whose default `container: "all"` walks every scrolling box up
to the viewport, `overflow: hidden` boxes included.

```
press-1024x673-before-fix/localOperatorDark.webp    press-1024x673-after-fix/localOperatorDark.webp
press-1024x673-before-fix/localOperatorLight.webp   press-1024x673-after-fix/localOperatorLight.webp
press-800x600-before-fix/localOperatorDark.webp     press-800x600-after-fix/localOperatorDark.webp
press-800x600-before-fix/localOperatorLight.webp    press-800x600-after-fix/localOperatorLight.webp
press-1380x900-before-fix/localOperatorDark.webp    press-1380x900-after-fix/localOperatorDark.webp
```

`before-fix` is the BUILT app of unmodified `origin/main` at `8f80697c8` — the
branch's ORIGINAL base and the v0.24.0 the operator reported the defect from, and
**not the merge base this lands on** (`962f43350`, which already carries the same
fix from #228). `after-fix` is this branch's own build. Read the box at the top of
this file and *Re-derived on the merge base* below before treating the
`before-fix` half as "the tree this lands on": it is the record of the report, not
a reproduction against today's base.

**The readings are committed with the frames.** Each directory carries the
`<theme>.json` the driver wrote, byte for byte — every scroll box's
`scrollTop`/`scrollLeft`, the panes and column and composer rects, the acceptance
block below, and the frame's own geometry. The driver writes
`<theme>-before.png` / `<theme>-after.png` / `<theme>.json` into
`press-<W>x<H>/`; this set renames the pair to `<phase-dir>/<theme>.webp`
(lossless WebP, same pixels, at the devicePixelRatio the app renders) and keeps
the JSON verbatim, so every number in the table below can be re-derived from the
repository rather than taken on trust.

Two rail states are committed, and they are not interchangeable: the pane's fit
depends on it (a 220px rail expanded, 48px collapsed, out of the same row), and
the two states that matter for the reported defect are the ones that slide and
the one the operator was actually in.

```
press-1024x673-before-fix/           press-1024x673-after-fix/
press-1024x673-rail-collapsed-before-fix/   press-1024x673-rail-collapsed-after-fix/
press-800x600-before-fix/            press-800x600-after-fix/
press-800x600-rail-collapsed-after-fix/
press-1380x900-before-fix/           press-1380x900-after-fix/
```

One artefact to read past: **the composer carries its focus ring in every
frame**, including the ones where nothing has been typed. That is the capture's,
not the app's at-rest state — the driver enables CDP's focus emulation so a
headless window can hold focus at all (`Emulation.setFocusEmulationEnabled`,
`AGENTS.md`'s note on focus-dependent rendering). The composer is half of what
the pair is about, so the ring is worth knowing about rather than wondering at:
the at-rest boundary is the same rect without the accent outline.

## What moves, in numbers

Every scrolling box in the ancestor chain of the composer chip and of the To-dos
section was read before and after a real `Input.dispatchMouseEvent` press at the
chip's painted centre. `scrollLeft` of the chat column's slot row
(`div.relative.flex.h-full`, the row holding the chat column and the run pane),
the chat column's and composer's `left`, and the pane's `left`:

| window (CSS viewport) | rail | build | theme | row `scrollLeft` before → after | chat column `left` | composer `left` | pane `left`..`right` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1024x673 (1024x641) | expanded | before-fix | dark | **0 → 108** | 500 → **392** | 500 → **392** | 613..1032 |
| 1024x673 | expanded | before-fix | light | **0 → 108** | 500 → **392** | 500 → **392** | 613..1032 |
| 1024x673 | expanded | after-fix | dark | 0 → **0** | 500 → **500** | 500 → **500** | 721..1024 |
| 1024x673 | expanded | after-fix | light | 0 → **0** | 500 → **500** | 500 → **500** | 721..1024 |
| 1024x673 | collapsed | before-fix | dark | 0 → **0** | 500 → 500 | 500 → 500 | 605..1024 |
| 1024x673 | collapsed | after-fix | dark | 0 → **0** | 500 → 500 | 500 → 500 | 605..1024 |
| 800x600 (800x568) | expanded | before-fix | dark | **0 → 221** | 500 → **279** | 500 → **279** | 500..919 |
| 800x600 | expanded | before-fix | light | **0 → 221** | 500 → **279** | 500 → **279** | 500..919 |
| 800x600 | expanded | after-fix | dark | 0 → **0** | 500 → **500** | 500 → **500** | 721..800 |
| 800x600 | expanded | after-fix | light | 0 → **0** | 500 → **500** | 500 → **500** | 721..800 |
| 800x600 | collapsed | after-fix | dark | 0 → **0** | 500 → 500 | 500 → 500 | 549..800 |
| 1380x900 (1380x868) | expanded | before-fix | dark | 0 → 0 | 500 → 500 | 500 → 500 | 961..1380 |
| 1380x900 | expanded | after-fix | dark | 0 → 0 | 500 → 500 | 500 → 500 | 961..1380 |

Every after-fix row above is also what `--expect=region-only` asserts: no box
outside `[data-run-panel-region]` changes `scrollLeft` or `scrollTop` across the
press, and the To-dos section lands flush with the top of the pane's own region
(its offset there is `0` in every row). The gate is a flag on the driver rather
than a human reading the JSON, so a regression fails a run.

Four facts the table carries, and one it deliberately does not:

- **1024x673 with the rail expanded is the defect.** The press slid the chat
  column, the transcript and the composer 108px sideways, under the sidebar: the
  column's `left` and its content moved with the row, and the frames show the
  transcript running underneath the chat list.
- **At 800x600 the same walk moves the column 221px.** The pane does not fit
  beside the column at either width, which is what gave the walk something to
  grab: the row has 116px of horizontal scrollable overflow at 1024 and 340px at
  800.
- **At 1380x900 nothing moved in either build**, because the row fits there and
  the walk had nothing to move. That is why this survived: the default window the
  app opens in is the one size where the defect is invisible.
- **In the rail-collapsed 1024x673 state — the state the operator's own
  screenshot shows — the shipped build does not move either**, and neither does
  this one: the row has no scrollable overflow there, so the walk had nothing to
  grab and the two builds' frames are identical. This change neither breaks nor
  is needed in that state; what it does there is leave it alone. The reported
  shift is reproduced on the seven rows that move, and the frame is the evidence
  for which state is which.
- **The vertical axis is not reproduced, and the numbers say so.** No ancestor of
  the pane ever had vertical scrollable overflow (`scrollHeight - clientHeight`
  was 0 for every box outside the pane, at all three sizes and both rail states,
  in both builds), so no ancestor can scroll vertically: the frame shift these
  frames reproduce is the horizontal one, plus the composer band's own reflow
  below.

### The composer band, and why "moves up 26px" was the wrong sentence

The band is driven by the COLUMN's width, and the column's width is what changes
when the pane opens — so the band's move is a step of that function, in both
directions, and its sign depends on the width the column had before the press:

| window | rail | column before → after | band top | band height |
| --- | --- | --- | --- | --- |
| 1024x673 | expanded | 524 → 220 | 483 → 457 (**26 up**) | 158 → 184 |
| 1024x673 | collapsed | 696 → 276 | 441 → 457 (**16 down**) | 200 → 184 |
| 800x600 | expanded | 300 → 220 | 410 → 384 (**26 up**) | 158 → 184 |
| 800x600 | collapsed | 472 → 220 | 410 → 384 (**26 up**) | 158 → 184 |
| 1380x900 | expanded | 880 → 460 | 700 → 710 (**10 down**) | 168 → 158 |

The measured band heights are 158px at a 524px and a 460px column, 184px at
220px, and 200px at 696px. So "the composer also moves up 26px in both builds"
was true of one row of that table and false of the others — in the
rail-collapsed state the operator is in, the band moves the other way. The band's
move is the pane opening, not the reveal: it is identical on both builds and on
the header-trigger path, and it is unchanged by this fix.

**Re-derived on the merge base `5c53e1c75` and on this head**, after the pane's
fit change moved the rows. The first version of this table read `696 → 276 /
441 → 483 (42 down) / 200 → 158` for the collapsed row and `640 → 460` for the
1380 column, which were the pre-fit and pre-`5c53e1c75` arithmetic; both are
corrected against the runs above rather than carried, and the collapsed row now
agrees with the pane's own fit (the pane takes its full 419px preference there,
so the column loses 420px and the band's tallest step is 184, not 158).

## What the fix is

The reveal now computes the To-dos section's offset inside the pane's own
scroll region and assigns `region.scrollTop` (`shared/lib/scroll.ts`,
`scrollRegionToTop`), instead of asking a browser to walk the chain. The region
still scrolls when it has to — with the pane open and its region already at
the bottom, the same press takes it from 346 back to 0 at 1024x673 — and no
ancestor is touched either way. The reader-first, request-holding, nonce-retirement
and focus-stays-put behaviours the effect encoded are unchanged. The Escape
ladder now also accepts a press that came from the composer's plan chip, which is
the third control that opens this pane and the one this whole flow is reached by.

**The Escape half, measured on both ends** (round 1, U2). One press of the chip
with focus left on it, then one `Escape`, on the same rig at 1024x673 with the
rail expanded: on the merge base the pane is still open afterwards (`paneOpen:
true`, focus still on the chip — the ladder's guard refused it, which is the
finding); on this head the pane is closed (`paneOpen: false`) and focus is back on
the chip. The ban is deliberately narrow: the composer's own `Escape` is
untouched, because the chip is a button in the status row and not the textarea
that owns that key.

## The pane's fit, which the same change had to settle

The reveal used to be the only mechanism that ever brought the pane near the
window: it paid a 108px sideways slide of the column, the transcript and the
composer to leave the pane 8px short of the edge. Take the slide away and the
pane's own geometry is what a reader gets — and the pane was pinned at its
preference (420px, as `minWidth`) with the row's `overflow-hidden` hiding the
difference, so at every window the row could not host 420 the pane's right edge —
its close control and its scrollbar — was outside the window with no gesture that
reaches it. Same rule as the canvas dock one slot up: the preference is the
`width`, the rendered box has no floor, and the pane takes what the row has left.

| window | rail | pane before → after | clip before → after | close control | cut rows after |
| --- | --- | --- | --- | --- | --- |
| 1024x673 | collapsed | 605..1024 → 605..1024 | 0 → 0 | inside, hit-testable | 0 |
| 1024x673 | expanded | 721..1140 → 721..1024 | **116 → 0** | inside, hit-testable | 0 |
| 800x600 | expanded | 721..1140 → 721..800 | **340 → 0** | inside, hit-testable | 0 |
| 800x600 | collapsed | 549..968 → 549..800 | **168 → 0** | inside, hit-testable | 0 |
| 1380x900 | expanded | 961..1380 → 961..1380 | 0 → 0 | inside, hit-testable | 0 |

"Cut rows" is the count of elements inside the pane whose text is clipped AND
whose elision point is outside the viewport — the failure the design round
measured as characters ending at a hard screen edge with no ellipsis. It is 0 in
every configuration; the rows that are truncated are ellipsised inside the
window, which is the design working.

The cost, stated rather than rounded away: **at the app's own 800x600 floor with
the rail expanded the pane renders 79px.** Nothing is off-screen and everything
is reachable, but a 79px pane is not usable, and no arrangement of the row's own
floors can make it usable: the rail (220px) plus the chat list (280px) plus the
column's own 220px floor already spend 720 of the 800px window before the pane
gets anything. That is a chrome decision — which of those three gives, and when —
and this change deliberately does not make it. What the pane owes in that state
is to stay legible in the width it is given, which is what the budgets below are
for.

## The width the pane is drawn at

The pane's width-derived layout (`tallyBudget` — how many characters a section's
trailing tally may occupy, and the shedding that follows) used to be handed the
user's PREFERENCE. That was already wrong at the pane's own 320px floor (`§ 8`),
and it becomes wrong everywhere once the rendered pane can be narrower than the
preference: a shrunk pane would shed for a width it does not have and truncate at
the width it does. It is now handed the measured width of the wrapper
(`renderedRunPanelWidth`, a `ResizeObserver` on the box the pane is drawn in), so
one number drives both the box and the budgets.

## The reader-first focus path (round 1, M1)

`run-child-reader.tsx` and `run-details-trigger.tsx` focus without
`preventScroll`, and the row `leaveReader` focuses lives INSIDE the pane — which,
before the fit above, could be partly outside the window. `focus()` performs its
own scroll-into-view, through the same ancestor chain `scrollIntoView` walks, so
this was worth a measurement rather than a note.

Measured on the base build at 1024x673 with the rail expanded, where the row's
button rect is `721..1140` in a 1024px viewport — 116px of the focused element
outside it — focusing that button (`driver --focus-probe`): the element takes
focus, and **every ancestor's `scrollTop`/`scrollLeft` is unchanged** (`movers:
[]`; the slot row stays at 0). The same probe on this branch's build at 800x600
with the rail expanded agrees. So the two `focus()` calls are left as they are,
and this is the measurement that deferral rests on rather than the argument that
used to carry it.

**This reading is carried, not re-taken, and it is one of the heavy verifications
the machine hold at the foot of this file stopped.** It was measured on the
pre-fit base, where the geometry it is about (116px of the focused row outside a
1024px window) actually existed; on this head the pane fits, that row is inside
the window, and there is no clipping left for a focus to scroll into view. A fresh
`--focus-probe` pass on this head is owed — see *What was NOT re-run* — so the
finding is closed on this measurement plus the fit change that removes its
premise, not on a run of the new head.

The full gesture the review asked for — press the chip WITH a child reader open —
is not reachable with a seeded fixture, and that is worth stating plainly: the
plan chip only exists once a runtime is engaged, and engaging it replaces the job
store the roster rows come from (measured: the pane's sections go from `Subagents`
+ `To-dos` to `To-dos` + `MCP servers`, and `[data-run-panel-row]` count goes to
0). The cold projection has the openable rows and no plan. The probe above drives
the app's own DOM in the exact geometry the concern names instead.

## Reproducing

An isolated backend, a seeded session, and the app paired to it. Nothing here
touches the operator's own backend, config dir, sessions or window.

```sh
# 1. An isolated backend with a plan in it. Never the live config dir.
node scripts/seed-plan-session.mjs /tmp/loui-plan/config 8
cd ~/local-operator                    # the backend repo
LOCAL_OPERATOR_CONFIG_DIR=/tmp/loui-plan/config \
LOCAL_OPERATOR_DESKTOP_TOKEN=$(openssl rand -hex 32) \
OPENROUTER_API_KEY=<dev key> \
  .venv/bin/python -m local_operator.cli serve --host 127.0.0.1 --port 18111
# ... and one provider credential in it, or the app opens its first-run modal
# over the whole window and swallows the press. This is the app's own credential
# path (the settings UI's), and the one the provider census reads: a key left in
# the backend's environment is not "connected" as far as `decideFirstTimeUser`
# is concerned. `GET /v1/auth/providers` then reports `configured: true`:
curl -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"value\":\"$KEY\"}" http://127.0.0.1:18111/v1/auth/providers/openrouter/key

# 2. The app, built against that port (VITE_LOCAL_OPERATOR_API_URL in `.env`,
#    VITE_DISABLE_BACKEND_MANAGER=true), launched headless and driven.
cd <repo> && pnpm install && pnpm build
LOCAL_OPERATOR_DESKTOP_TOKEN=$TOKEN LOCAL_OPERATOR_CONFIG_DIR=/tmp/loui-plan/config \
  node scripts/run-panel-reveal-proof.mjs --session=<seeded id> \
  --backend=http://127.0.0.1:18111 --width=1024 --height=673
```

`--window-mode=headless` (through `pnpm app:headless` or the switch the proof
script sets) is what keeps the operator's focus; the proof script also uses its
own `--user-data-dir` under the system temp dir and strips any inherited
`CMUX_*` variable, so a run cannot rename the operator's real workspaces. The
backend is a real `local_operator` server; only its conversation content is
synthetic.

## Re-derived on the merge base, which is not the tree these frames were shot against

This branch was re-integrated onto `origin/main` at `5c53e1c75` (the 0.25.18
release, ~14 PRs and 709 commits past `64c3283cb`), and then onto `962f43350`
(#283, which touches none of the reveal's files). **Both ends were rebuilt and
re-driven against `5c53e1c75`: the base and this head.** That changed what this
set can claim, and the change is the important part of this section.

**The frame shift this branch was opened for no longer reproduces on the merge
base.** `#228`'s composer work (`c25a0a4e9`, "state-aware activity clauses, a
region-scoped reveal and the chip group") landed the SAME region-scoped reveal
upstream — `shared/lib/scroll.ts` and the `scrollRegionToTop(region, target)`
assignment in `run-panel.tsx` are main's now, and this branch imports them rather
than carrying a second copy. So the `before-fix` frames below are pictures of
`8f80697c8` (v0.24.0, the build the operator reported the defect from — which is
what they were always shot against); they are NOT pictures of the current merge
base, and the `0 → 108` / `0 → 221` rows in the table above are a defect this
branch fixed and the base has since fixed independently.

Measured, both ends, on one rig: `movers: []` on the merge base at all four
states driven, exactly as on this head.

| state (1024x673 unless noted) | build | `movers` | pane rect | clip px | close control inside / hit | rows cut at a hard edge | `todosOffsetInRegion` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| expanded, dark | base `5c53e1c75`\* | **0** | 721..1140 | **116** | no / no | **4** | n/a |
| expanded, dark | this head | 0 | 721..**1024** | **0** | yes / yes | **0** | 0 |
| expanded, light | this head | 0 | 721..1024 | 0 | yes / yes | 0 | 0 |
| collapsed, dark | base `5c53e1c75`\* | 0 | 605..1024 | 0 | yes / yes | 0 | n/a |
| collapsed, dark | this head | 0 | 605..1024 | 0 | yes / yes | 0 | 0 |
| 800x600 expanded, dark | base `5c53e1c75`\* | 0 | 721..1140 | **340** | no / no | **4** | n/a |
| 800x600 expanded, dark | this head | 0 | 721..**800** | **0** | yes / yes | **0** | 0 |
| 800x600 expanded, light | this head | 0 | 721..800 | 0 | yes / yes | 0 | 0 |
| 800x600 collapsed, dark | this head | 0 | 549..800 | 0 | yes / yes | 0 | 0 |
| 1380x900 expanded, dark | base `5c53e1c75`\* | 0 | 961..1380 | 0 | yes / yes | 0 | n/a |
| 1380x900 expanded, dark | this head | 0 | 961..1380 | 0 | yes / yes | 0 | 0 |

Every reading in the table above still holds as a reading; what moved is what it
is evidence FOR. On the merge base this PR's remaining user-visible delta is the
pane's fit — 116px of clipped pane and four rows cut at a hard screen edge at the
operator's own size, 340px and four rows at the app's floor, with the pane's own
close control off-screen and not hit-testable in both — and that is what the
`after-fix` half of the set now shows. The band's move is unchanged between the
two ends, row for row.

\* The base rows are `5c53e1c75`, the merge base during the run; main then moved to `962f43350`, whose diff touches none of the reveal's files (see the box above the frame listing).

`todosOffsetInRegion` is `n/a` on the base because the region is NAMED by this
change (`data-run-panel-region`); the base's own region still lands the section
at its head, which `movers: []` and the pane rects show, but it carries no
attribute to measure against.

## What was NOT re-run, and why

The machine these runs came from went into a declared hold (load average 465–635,
swap 21.7 GB of 22.5 GB used) after the runs above, so three heavy verifications
are owed rather than done:

- a fresh `--focus-probe` pass on this head (the M1 reading below was taken on
the base build and is carried, not re-taken);
- a fresh `--reader=first` pass (the last one is on `8bd51bd03`);
- re-capturing the frames. **No frame in this set was re-taken for the
  re-integration.** The `after-fix` frames already show this head's post-fit
  geometry (they were shot at `8bd51bd03`, which carries the fit change), and
  the `before-fix` frames are `8f80697c8` by construction, so nothing in the set
  is contradicted by the re-derived numbers above — but the two runs that would
  refresh the readings that are not in this table are owed.

## Provenance and the limits of these frames

- The app is the BUILT one (`pnpm build` + `npx electron .`), never `pnpm dev`:
  the dev build paints a development-only strip over the header this surface
  starts at (`docs/evidence/chat-title/README.md`).
- The press is a real CDP mouse press at the chip's painted centre, after asking
  the page which element owns that point, so a chip that is painted but not
  hit-testable would fail the run rather than pass it.
- **CDP focus emulation is ON** (`Emulation.setFocusEmulationEnabled`). A window
  that is never shown cannot be focused, and a key event is dropped without it —
  the runs need Escape to close the pane first, which is the pane's own ladder.
  The visible consequence is the focus ring around the composer in every frame.
- **The MCP section is live and its height varies between runs** (it is a real
  read of MCP status against the isolated backend, and servers settle between
  captures): the 1024x673 dark pane's own region has 346px of vertical overflow
  and the light one 186px in the after-fix captures. Nothing in the table above
  depends on it — the compared facts are ancestor scroll offsets and the
  column/composer/pane rects — and the pane's own region still ends at the top of
  the To-dos section in every run.
- These frames cannot come from `pnpm capture-evidence`: a sweep photographs
  Storybook stories, and this claim is about the app's whole frame in a real
  window at three sizes, over a backend. That is why the set is declared
  `supplementary` rather than swept.
- **Not everything here is evidence about a fix.** This section used to say the
  pane's own fit was "unchanged and unfixed" at these widths; the fit change in
  this PR is what fixed it, and the numbers are in *The pane's fit* above and
  re-derived in the table below (clip 116 → 0 at the operator's size, 340 → 0 at
  the app's floor, rows cut at a hard edge 4 → 0, close control reachable in both).
  What remains unfixed is the pane's WIDTH where the row cannot host it: 79px at
  800x600 with the rail expanded, which is the chrome decision the record states
  as open rather than made (`docs/run-sidebar.md` § 8).
