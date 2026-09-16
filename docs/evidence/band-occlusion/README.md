# The full-bleed band covers the first rows of every surface (D9/D10)

This is the brief for the one defect family `local-operator-ui#205`'s design round
2 routed out of that pull request: both findings are measured inside #205's
committed frames, and both are **inherited from `main` rather than introduced by
#205's diff**. The measurements below are the designer's, taken on #205's head
`c4beb7a5f`; the reproduction says how to take them again.

## What ships today

The band is `fixed inset-x-0 top-0 z-2200` (`connectivity-banner.tsx`), so it
overlays the layout instead of taking its height out of it. Everything the shell
mounts below it keeps its y, which means the covered rows are not displaced —
they are absent.

**D9 — content under the band, at three different band heights.** Measured on
`main`'s own capture (`base-absent.png`, md5 `ac580c4d…`): the band occupies
device y 0-134, the same extent it has on `#205` (the copy is the same two-line
copy), so every row the design round measured as covered is covered on this
pull request's base as well — the numbers below are that measurement, and this
pull request is where they get fixed.

- The pane's page title occupies device y 62-89 in `after-attached.png` (no band).
  In `after-gate-open.png` and `after-flap-during.png` those rows are band paint
  while every other pane row sits at the same device y (subtitle 128-148, the
  `New chat` button 191-240). The title is on screen only when no band is up.
- The sidebar region x 430-1015 is byte-identical between the two frames from
  y=106 down, so rows 96-105 — where the search field's top border and its
  rounded top corners are drawn — are covered. The control loses its own
  boundary where the band ends.
- `after-daemon-absent.png` is the worst case: the band is 0-134 device (0-67
  CSS) and the search field's placeholder glyphs (device 119-142) are sliced
  through their upper half. A half-line of text reads as a rendering fault, not
  as a state.

**D10 — RESTATED AFTER QA ROUND 2: this is NOT this pull request's work.** The
design round measured the pane below the band in `after-daemon-absent.png` as 0
painted pixels of 2,808,960, one colour (`#15130e`). QA round 2 then measured the
same cell **re-run on #205's head** and found it painting — the pane's own
sentence at device y 828-853 and its `Retry` at 888-912 — and traced the
committed frame to a pre-pane-fix capture (`#205`'s Q-7, re-shot there on
`ced379608`).

Re-measured for this brief on both trees:

| frame | tree | pane content below the band (device x≥1000, y>134) |
| --- | --- | --- |
| `base-absent.png` (QA's capture, md5 `ac580c4d…`) | `main` | **0 painted pixels** — this is where the void is real |
| `after-absent.png` (QA's capture on #205's head) | `#205` | sentence at 828-853, `Retry` at 888-912 |

So the void is `main`'s and `#205`'s pane fix is what removes it: this pull
request does **not** need to re-fix it, and nothing here should be read as
claiming the pane is blank on the head being merged. What remains inherited — and
what this pull request is for — is D9 below.

**Why this is a separate pull request.** The band's position is the same on
`main` (`fixed inset-x-0 top-0 z-2200`), and `after-daemon-absent.png` is
byte-identical to the base-tree capture of that state (md5 `ac580c4d…`), so
neither finding is #205's to fix. They change app-shell layout for every banner
state, which is a design decision rather than a patch, and the frames a reader
checks belong to #205 — which is why the disposition is recorded there and the
work happens here.

## The two shapes, and the trade-off to decide

1. **In flow.** Render the band as the shell's first child, above the
   `h-screen` region (`app.tsx`), so the app keeps the rest of the window
   because the band occupies the rest. Nothing can be covered at any band
   height, by construction.
2. **A reserving overlay.** Keep the band `fixed` — the component's own comment
   records that choice as deliberate, with the z-index chosen to clear the
   chrome it covers — and give the shell a top inset measured from the band. The
   height follows the copy: **52 CSS px** in the gate frames against **67 CSS px**
   in the daemon-absent frame, so a hard-coded value is wrong in one of the two
   and the inset has to be measured from the band, and summed when more than one
   band is up.

The trade-off, stated so it is decided knowingly: an in-flow band shifts the app
down at the moment it appears, which is the moment the app is already announcing
a state change; a reserving overlay does not shift, but has to track the band's
height on every copy change and for every band that can show at once. Either is
defensible. What the current pair of frames shows is the third option's cost — an
invisible page title and a sliced line of text.

## What a fix has to show

- With any band up, at any of the three heights above, no text row of any surface
  is partially or wholly covered: the pane title, the sidebar search field's
  border and corners, and the placeholder glyphs all render in full, or the
  layout reserves enough that they are pushed.
- The reservation (if that shape is chosen) tracks the band's measured height,
  including the two-line band and two bands at once.
- If the pane's statement can then take the same top anchor as the pane's own
  empty state, the centring `#205` introduced goes with it — one anchor per pane,
  not three.

## Reproducing it

Every number above is a measurement of a committed frame on `#205`
(`fix/daemon-attach-robustness`, head `c4beb7a5f`):

```bash
# the frames, without checking the branch out
git -C ~/local-operator-ui show c4beb7a5f:docs/evidence/daemon-attach-live-app/after-attached.png > /tmp/attached.png
git -C ~/local-operator-ui show c4beb7a5f:docs/evidence/daemon-attach-live-app/after-gate-open.png > /tmp/gate-open.png
git -C ~/local-operator-ui show c4beb7a5f:docs/evidence/daemon-attach-live-app/after-daemon-absent.png > /tmp/absent.png
```

- The frames are 2760x1736 for a 1380x868 CSS viewport (device pixel ratio 2).
- "Covered" is decided by comparing a row's device y between the no-band frame
  and a band frame: the band's height is the band's own rect, and any row whose
  ink in the no-band frame falls inside the band's device rows in the band frame
  is absent rather than displaced.
- "The pane is blank" is decided by counting pixels in the pane column (device
  x≥1000) below the band and comparing them against the same region in a frame
  where the pane paints.

A live probe, once the app can be booted headless against a forced band, is the
same instrument `#205` used to decide its own pane finding: the band's
`getBoundingClientRect()` against the content rects it overlaps, which turns
"covered" from a pixel judgement into an intersection test.
