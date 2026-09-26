# `hit-zones` — the window drag region against the overlays painted over it

The operator's report: the Analytics panel's corner `×` looked unclickable, and
the top bar's grab zone was the suspicion. It is the right suspicion. This set is
the evidence for the fix and for the audit of the other overlays.

## The mechanism, and why the reading is a region rather than a click

Chromium builds the window's draggable region in
`LocalFrameView::CollectDraggableRegions`: a pre-order walk of the document's
boxes, where a box whose computed `app-region` is `drag` unions its border box
into the region and one whose value is `no-drag` subtracts its own
(`LayoutObject::AddDraggableRegions`). The value is inherited, so one marker on a
surface subtracts everything inside it. **The walk never sees paint order or the
top layer**, so a modal painted over the chrome strip does not stop being inside
the strip's rect by painting. Electron's own hit test is
`region->contains(point)` (`WebContentsView::NonClientHitTest`), and a click
inside the region is a window drag that the page never sees — which is
indistinguishable, from the user's seat, from a dead handler. That is why the
scene reads the region (`--scene hit-zones`, `scripts/renderer-driver.mjs`, which
reproduces the walk in the page) and samples five points per control, rather than
clicking and reporting nothing happened.

## The rig

Built app, headless (`--window-mode=headless`, 1380x900, `devicePixelRatio: 2`),
against an isolated daemon this lane started on `127.0.0.1:8123` with its own
scratch `HOME`/config and a seeded analytics ledger (473 synthetic calls) so the
Analytics panel renders at its full height. `ELECTRON_DEBUG_DRAGGABLE_REGIONS=1`
turns on Electron's own region debugger, whose `[draggable-regions]` lines are the
cross-check below.

```sh
# before (the fix's own src reverted; the merged base's #535 band rules stay):
#   - the standalone [data-titlebar-no-drag] rule removed from styles/index.css
#   - the five ui/ primitives back to `11cc11b56b^`
#   - the update card's marker stripped (it postdates the fix commit)
node_modules/.bin/electron-vite build          # with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8123
node scripts/renderer-driver.mjs --scene hit-zones --backend http://127.0.0.1:8123 \
  --backend-records <config>/run/serve --seed-onboarding-complete --out <frames>
# after: restore those four, rebuild, same command
```

The daemon is the one an isolated `local-operator serve --host 127.0.0.1 --port
8123 --hosting test --model mock-model` gives, under a scratch `HOME`/config with
a random bearer in a 0600 file; `seed-analytics.py` beside this file is what puts
rows in its ledger, because the Analytics panel's HEIGHT is the point of the
reading (`python3 seed-analytics.py <config dir>` - synthetic data, 473 calls).
The driver's own boot checks are what prove the isolation: it asserts the app
holds a connection to this backend and none to the operator's.

TWO THINGS ABOUT THE SET ITSELF, because both are load-bearing. The run logs
beside this file are force-tracked (`git add -f`): `.gitignore` excludes `*.log`,
and five other evidence logs in this repository override it the same way - the
logs are what makes the frame and region claims checkable, so they ride the set
rather than being referenced from outside it. And only macOS is exercised: the
band assertions below branch on the window's own layout, this host runs the
leading branch (band stood down, the lane is the drag surface), and the
caption-trailing branch is written for the Windows/Linux runners that render it -
stated rather than implied, because a scene that names one platform only is how
the win/linux half of this vocabulary goes unchecked (review round 1).

## The readings

`before-1380x900.log` / `after-1380x900.log` are the driver's own records. The
per-surface summary the scene prints, verbatim:

| surface | before | after |
| --- | --- | --- |
| `analytics-panel` (overlay `y 20 h 860`) | 7 controls, **5/5 sampled points of the `×` swallowed**, held by the chat header's drag row | 7 controls, 0 swallowed; 5 would be without this surface's own opt-out |
| `info-panel` (overlay `y 44 h 813`) | 2 controls, **2/5 swallowed** (the `×`'s top half) | 0 swallowed; 2 would be |
| `usage-panel` (overlay `y 350 h 199`) | 3 controls, 0 swallowed (it does not reach the strip) | 0 |
| `command-palette` (overlay `y 213`) | 10 controls, 0 swallowed | 0 |
| `sidebar-sheet` (900x900, `after-900x900.log`) | not run before (see below) | 17 controls, 0 swallowed; 5 would be |
| `onboarding-wizard` (`wizard-1380x900.log`) | not run before | 7 controls, 0 swallowed; 0 would be |
| `settings-route-band` (both trees - #535's shape, not this fix's) | band stood down where the lane is drawn; the lane's centre is a drag region | same; 4 checks PASS in both, and the caption-trailing branch is written for the runners that render it, not exercised on this host |

The before log's failure detail, verbatim:

```
[FAIL] [analytics-panel] every sampled point of every control is OUTSIDE the window drag region
        button "Close" at centre (1171, 50.8) - held by drag div "New chat/private/…/home"
        button "Close" at top-left (1164, 43.8) - held by drag div "New chat/private/…/home"
        …(all five points)
        (region: 12 entr(ies) (5 drag, 7 no-drag), drag-entry union {"x":0,"y":0,"w":1380,"h":72}; overlay box {"x":178,"y":20,"w":1024,"h":860})
```

"would be without this surface's own opt-out" is the same predicate computed with
the surface's own subtree excluded from the walk — i.e. the region as it stood
pre-fix, since the fix adds only `no-drag` entries. On the before tree the two
numbers are equal (5 and 2), which is the check that the reconstruction is not
doing the fix's laundering: the after run reports 0 swallowed *now* and 5/2 as
the pre-fix verdict.

## The cross-check from Electron's side

`electron-region-before.log` / `electron-region-after.log` are the app's own
`[draggable-regions]` lines, filtered out of the run logs. Same computation, read
from the other end:

| | with the Analytics panel open | region |
| --- | --- | --- |
| before | `renderer sent 13 region(s) (6 drag, 7 no-drag)` | `5 rect(s), bounds 0,0 1380x72 (identical to previous region)` |
| after | `renderer sent 380 region(s) (6 drag, 374 no-drag)` (then `405 (6, 399)`) | `7 rect(s), bounds 0,0 1380x72` |

Before, the dialog contributed nothing to the region and the region was unchanged
while it was up. After, the dialog's subtree contributes 374 subtracting rects and
the computed region is reshaped (5 rects to 7) — the carve the `×` needed.

The two sides are two instruments rather than one, and their counts are
like-for-like in shape only (review round 1, R5): the page-side summary prints its
own walk's `N entr(ies) (X drag, Y no-drag)` — `12 entr(ies) (5 drag, 7 no-drag)`
on the base screen, `375` with the analytics panel up — beside Electron's
`renderer sent …` line, and Electron's computed `R rect(s)` and bounds are quoted
as Electron's own reading, not reproduced page-side. What the pair is for is the
CHANGE, and on that the two agree: the dialog adding nothing before, hundreds of
subtracting rects after, the region reshaped 5 to 7.

## Frames

`before-analytics-dark.png` and `after-analytics-dark.png` are the same screen on
the two trees, `webContents.capturePage()` from the app itself. **The fix is
visually inert, and that is measured rather than claimed**: the two differ only in
the panel's own "as of 12:31 / as of 12:29" clock — 6,280 of 4,968,000 device
pixels, all inside a 616x23 device strip at (1729, 309), i.e. the timestamp line
(`magick compare -metric AE`; the box from `-compose difference -threshold 0` plus
`-trim`). As a reproducibility reading on the same code, four of the frames came
back byte-identical (0 px) to an earlier independent run of this scene (`usage`,
the command palette, the sheet and the wizard); the analytics pair differs only in
the clock (6,031 / 6,295 px, the same strip); and the `info` frame is the one that
cannot reproduce, because its content is live state — the daemon's pid, its
install generation, and the scratch paths it runs under all change with the
backend — so it is carried as the geometry record for that surface and nothing
more. What the frames carry is the geometry the readings refer to — where the `×`
sits (`y ≈ 36..64` at 1380x900, inside the 0..72 band). The remaining frames are
the other audited surfaces on the fixed tree: `after-info-dark.png`,
`after-usage-dark.png`, `after-command-palette-dark.png`,
`after-sidebar-sheet-dark.png` (900x900), `after-onboarding-dark.png`.

## The fold, and the convergence run

`origin/main` moved under this branch twice. The first fold (`fe98692e8e`, #533)
is the one the earlier revision of this file recorded. The second
(`093a329a4d`, #535, the sub-view top inset) is the one that matters here, because
#535 takes the non-chat route band OUT of the flow wherever the shell's lane is
drawn — macOS included — and this branch's scene asserted the old band geometry
there (review round 1, R1). So the scene now asserts #535's shape per platform:
the band stands down on this host and the lane is the drag surface (four checks,
PASS in both trees), and the caption-trailing branch is written for the runners
that render it. A scene adjusted until it passes while asserting nothing was the
failure mode to avoid, so it pins exactly that difference.

The fold's conflicts were `docs/evidence/manifest.json` and its binding list
(`scripts/evidence-manifest.test.mjs`), mechanical: main's side is carried whole,
this branch's note is re-added, and all 39 bound notes are re-pointed to the pair
the folded tree ships. One semantic seam was checked, because a file both sides
touch is where a silent loss lives — the driver's `--scene` banner listed this
branch's `hit-zones` but not #535's `route-tops`; the folded banner lists both. The
branch's own delta is byte-identical through the fold (`scripts/renderer-driver.mjs`
= 754/1 insert/delete against both bases; the five primitives, the guard,
`package.json` and this file compare equal byte for byte to the pre-fold head).

`converged-1380x900.log` is the same scene re-run against the same head this set
ships: its check lines diff empty against `after-1380x900.log`, and the
Electron-side numbers (`380 (6, 374)` → `7 rect(s)`) reproduce exactly.

## What was audited, and what was not

Exercised (headless, this rig):

- Analytics, Info and Usage machine panels (`DialogContent` shell; three
  different panel bodies behind it) — pass after; the first two were dead at the
  `×` before.
- The command palette (`DialogContent`, `showClose={false}`) — pass both.
- The sidebar sheet at 900x900 (`SheetContent`, `⌘B` through the app's own
  handler) — pass after; its brand-row `×` would have been swallowed before
  (5 points), which is the same class as the operator's report, found by the
  audit rather than reported.
- The non-chat route band on `/settings` — post-#535 it stands down where the lane
  is drawn: asserted that the band is out of the flow, the lane's own centre is a
  drag region, and no route control reaches into the lane's 32px strip (four
  checks, both trees). The caption-trailing shape (the band at
  `env(titlebar-area-height)`, nothing overlapping it) is asserted in the same
  scene for the platforms that draw it and is not run on this host.
- The portal scan in `scripts/overlay-drag-zones.test.mjs` finds six files in
  `ui/` that render a portal — the five marked primitives plus the tooltip,
  which is exempt because its content is `pointer-events: none`; the exemption is
  asserted, so a tooltip that gains a clickable control stops being exempt.
- The onboarding wizard (a first-run profile, no `--seed-onboarding-complete`) —
  pass; its dialog does not reach the band.

Not reached, and why (no verdict is claimed for these):

- The browser approvals dock and the chat ask-gates (a pending approval needs a
  parked gate the scene does not create), the update notification (needs an
  available update), and the model picker's own dialogs. The three picker
  surfaces the scene does open go through the same `DialogContent` the marker is
  on, and `scripts/overlay-drag-zones.test.mjs` asserts the marker per element on
  every `*Content` of every primitive that renders a portal — but that is an
  argument about the shell, not a hit test, and it is written here as such. The
  update card is the one surface that reaches the strip through no portal: its
  marker is on the card and the guard names the file (F-4) rather than deriving
  it, and its running verdict is still not claimed — there is no available update
  in this rig to raise it.
- The MUI `DatePicker`/`TimePicker` poppers (`date-time-picker.tsx`) are outside
  the Radix scan — whether they portal out of a surrounding `DialogContent`'s
  subtree (which decides whether the marker's inheritance covers them) was not
  settled here, so no verdict is claimed for them either.
- A control inside a hover-revealed container (the sidebar's section cluster) is
  reported as unpaintable and not sampled: it is `pointer-events: none` while
  hidden, so it is not a click target either way.

## One flake, for the record

The first wizard attempt failed in the driver's boot handshake ("the renderer
never registered the dev driver verbs"), with the app still up; the retry was
clean and is what `wizard-1380x900.log` records. Nothing in this change touches
the bridge or the boot path, and the same shape has been seen on other scenes —
recorded here because a reviewer reading one failed run should find the retry
named rather than inferred.
