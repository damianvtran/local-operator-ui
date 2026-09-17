# Pinned chats — durable conversation pinning, shared with the terminal

Hovering a conversation row in the chats sidebar reveals a pin control; pressing it
pins the conversation, and pinned conversations are drawn in a `Pinned chats` section
above the rest. The state is the BACKEND's: the same `sidebar-pins.json` the terminal's
`f10` writes, in the config root the daemon serves, so a pin made in the app is a pin the
TUI shows and the other way round.

The backend half of this feature is a sibling pull request (`feat/desktop-session-pins`).
These frames were taken against
**`cffdedfbdcffdfcc1bbc5e8846e045516f6dbbfb`** of that branch, booted as a real uvicorn
daemon with its own venv, on an isolated `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` under
`/tmp`, with `LOCAL_OPERATOR_DESKTOP_TOKEN` in its environment. That revision carries
`pinned` on every search row as well as every catalogue row, and refuses a coerced pin body:
`{"pinned":"yes"}`, `{"pinned":1}` and `{"pinned":"true"}` are all 422 with the store
untouched. The search-row half matters for a paged client - a hit is asked of the whole
store, so a pinned conversation the panel's page does not list arrives only through that
route - and the client hides the affordance on a hit that does not describe the state rather
than offering a press it cannot repair. The UI tree's head is named in the pull request, not
here, because a frame's own commit moves with every rebase.

They were **re-shot after the review, design and QA rounds were remediated in one commit**,
so every committed frame is a picture of the code that ships: the section moved below the nav
rows (design round 1, D1), each theme now runs in its own launch so its frames are the state
their name claims (D2), and the move a pin makes is corrected per kind of press (QA round 1,
U1/U2/U3 - see below). The transition between those runs is also in the numbers: the eleven
frames the remediation moved differ from the set before it only by the pixels the section's
own move and the clock's digits touch, which is why `pins-hover-*`, `pins-unpinned-*` and the
scrolled pair re-shot byte-identical.

They were **also re-shot after `origin/main` (`62c673adb`) was merged into this branch**, so every
frame is a picture of the tree this change lands on. The fold moved six of the frames' bytes
by exactly 33,490 pixels (0.7%) in one `1663x209+1049+1087` box — the
conversation tag chip's **focus ring** in the chat pane, drawn in the second run and not the
first. That is focus-dependent rendering in a window that is never shown (the class
`AGENTS.md` names for headless runs), it is not something the fold moved, and it touches no
claim here: the three frames taken before any conversation was opened
(`pins-unpinned-dark`, `pins-hover-dark`, `pins-populated-dark`) are byte-identical across
the two runs, and every claim below is about the sidebar.

## The frames

Twenty-three frames: seventeen from `--scene pins`, four from `--scene pins-scroll`, six from
`--scene pins-search` (three states per theme: the search-only row pinned, the same row
unpinned from its own control, and the parked pointer's stationary second press), plus the four
of the capability-withdrawn pair. The window is `1380x900` in `--window-mode=headless` (a
1380x868 CSS viewport, `devicePixelRatio` 2, so the PNGs are 2760x1736), never shown and
never focused: the run asserts both from main's own window facts before it takes a frame.

| Frame | State | The claim it is evidence for |
| --- | --- | --- |
| [`pins-unpinned-dark`](pins-unpinned-dark.png) ([light](pins-unpinned-light.png)) | four conversations, nothing pinned | **Zero pins renders no heading and no section** — the panel is the panel it was before this feature, plus nothing |
| [`pins-hover-dark`](pins-hover-dark.png) ([light](pins-hover-light.png)) | the pointer genuinely over an unpinned row | **The reveal**: the pin control becomes visible *under the pointer*, and only on that row |
| [`pins-populated-dark`](pins-populated-dark.png) ([light](pins-populated-light.png)) | one conversation pinned | **The section**: `Pinned chats (1)` BELOW the `All chats` / `New chat` nav rows and above `Active chats` / `Previous chats` (design round 1, D1 — see below), and the pinned row is *not* in `Previous chats` — a partition, not a copy |
| [`pins-selected-dark`](pins-selected-dark.png) ([light](pins-selected-light.png)) | the pinned conversation is also the current one | **Drawn once**, in the Pinned section, carrying `aria-current="page"` |
| [`pins-filter-dark`](pins-filter-dark.png) ([light](pins-filter-light.png)) | a query matching only the pinned conversation | **The filter**: the Pinned section is `matching ∩ pinned`; the other sections empty rather than keeping rows "because they are pinned" |
| [`pins-flat-dark`](pins-flat-dark.png) ([light](pins-flat-light.png)) | the panel in `All chats` (flat) mode | **Both modes**: the section is drawn in the flat list too, at the same place in the region, and the pinned row is drawn once — in the section, not twice |
| [`pins-from-tui-dark`](pins-from-tui-dark.png) | a pin written by the **terminal's own store** | **The round trip, TUI to app**: no manual refresh, no focus, no reload |
| [`pins-scrolled-dark`](pins-scrolled-dark.png) ([light](pins-scrolled-light.png)) | a region scrolled a quarter of its range, a click on a row's pin, and then a SECOND press through the keyboard | **The move, corrected** (QA round 1, U1/U2/U3): the row beside the pressed one keeps its line to the pixel (±2 px), no control is left under the parked pointer, and after the keyboard press the caret is on the moved row's own pin, in view |
| [`pins-pinned-hover-dark`](pins-pinned-hover-dark.png) ([light](pins-pinned-hover-light.png)) | the pointer ON an already-pinned row's glyph | **The pinned state does not depend on the reveal**: the glyph is filled and fully opaque at rest, and it says what a press would do (`Unpin “…”`) |
| [`pins-search-pinned-dark`](pins-search-pinned-dark.png) ([light](pins-search-pinned-light.png)) | a conversation OUTSIDE the panel's own page (568 seeded, the page reads 500), pinned from its search hit | **Qr2-1, both directions**: the press writes the wire, the store the terminal reads holds it, and the row it was made on follows - then the SAME row unpins it, with all three surfaces checked again |
| [`pins-search-unpinned-dark`](pins-search-unpinned-dark.png) ([light](pins-search-unpinned-light.png)) | the same row, after the second press | the control inverts the STORE's state, not a cached wire answer |
| [`pins-stationary-dark`](pins-stationary-dark.png) ([light](pins-stationary-light.png)) | a genuinely stationary second press on a pinned glyph, then a 3 px wobble | **U3-unpin**: neither changes a pin, because the disarm covers both glyph states and treats a 3 px tremor as the same parked gesture |
| [`pins-withdrawn-dark`](pins-withdrawn-dark.png) ([light](pins-withdrawn-light.png)) | a backend whose capabilities omit `session_pins` | **Fail-closed**: no affordance anywhere |
| [`pins-withdrawn-main-dark`](pins-withdrawn-main-dark.png) ([light](pins-withdrawn-main-light.png)) | the same backend, driven by the **same scene on `origin/main`** | **...byte-identical to the pre-change panel** — see below |

Two things are worth reading off the file set rather than per frame:

* **`pins-withdrawn-{dark,light}.png` and `pins-withdrawn-main-{dark,light}.png` are
  byte-identical** (`cmp` prints nothing for both pairs; sha256 `505e0c608…` and
  `13bc1a1dd…`). The `main` halves come from a second worktree at `origin/main`
  (`013aad424`) running the *same* scene against the *same* daemon, so what the pair
  compares is the two trees and nothing else. Nothing main moved between `013aad424` and
  `62c673adb` renders in them — the files it moved are the transcript's message items and an
  image lightbox, none of which is on screen in a panel with no messages — which is why
  those four frames are re-stamped rather than re-shot. This is the claim the design states
  as "the row is byte-identical to the pre-change frame", and it is a measurement rather
  than an assertion.
* **`pins-withdrawn-dark.png` is also byte-identical to `pins-unpinned-dark.png`**, which
  is a second, independent statement: with the capability present and nothing pinned, the
  panel paints exactly what it paints with the capability absent. The reserved 24px slot
  and the hover wrapper cost no pixel at rest, which is what makes the reveal unable to
  reflow a row.

## How these were taken

One daemon, one isolated config root, two trees. `harness/seed-store.mjs` writes the
catalogue (`transcript.jsonl`, `title.json`, `created_at.json` and the desktop marker per
session — the shape `scripts/seed-paging-session.mjs` establishes), then:

```sh
# the pins daemon, on an isolated root
env -i HOME=$SCRATCH/backend-home PATH=/usr/bin:/bin \
  LOCAL_OPERATOR_CONFIG_DIR=$SCRATCH/backend-config \
  LOCAL_OPERATOR_DESKTOP_TOKEN=$TOKEN \
  ~/local-operator-worktrees/desktop-pins/.venv/bin/python -m local_operator.cli serve \
    --host 127.0.0.1 --port 8977

# the app, built against that daemon's URL
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8977 VITE_GOOGLE_CLIENT_ID=<inert> … pnpm build

# the scene
LOCAL_OPERATOR_DESKTOP_TOKEN=$TOKEN node scripts/renderer-driver.mjs --scene pins \
  --backend http://127.0.0.1:8977 \
  --backend-records $SCRATCH/backend-config/run/serve \
  --seed-onboarding-complete \
  --tui-python ~/local-operator-worktrees/desktop-pins/.venv/bin/python \
  --tui-config $SCRATCH/backend-config \
  --out /tmp/pins-frames
```

The `VITE_GOOGLE_*`/`VITE_MICROSOFT_*` values are inert build fixtures
(`pins-build-only-not-a-credential`); no credential file was read and no sign-in is
claimed. The scene prints `[PASS]`/`[FAIL]` for every assertion it makes — 43 checks in the
pins run, 34 in each `--scene pins-scroll` run and 15 in each withdrawn run, all passing on the head these frames were taken at — and it refuses to run at
all without `--backend`, because a run with no catalogue has no row to pin and every frame it
could write would be a picture of an empty panel. The pins run also asks the daemon's SEARCH
route for the pinned conversation and asserts that the hit carries `pinned` (a hit is the
only way a row outside the client's page reaches the panel).

The withdrawn pair is the same scene against a daemon checked out at
`feat/desktop-session-pins^` (Ben's `feat/sidebar-pins-and-chips` head, `6ac627b39`),
where `capabilities.features.session_pins` is genuinely absent — the same server minus
this feature, rather than a client told to pretend.

## Reproducible until the clock moves, and that is measured

The frames are a property of the instrument and the tree, not of one afternoon: the
committed driver, re-run against the same daemon and the same store, reproduced all
thirteen byte for byte. The bound is stated rather than left to be discovered — the
transcript in these frames carries minute-resolution wall-clock timestamps that
`harness/seed-store.mjs` writes from `Date.now()`, so an exact reproduction is a
statement about a re-run inside the same minute.

A later re-run differs in exactly those digits and nothing else: 782 pixels,
identical in every affected frame, in one `42x154+2610+1270` box — the render of
`12:18 AM` against `1:38 AM`. That is how a clock was told apart from a fold that
moved something: a class or a layout change moves the box it touched, differently
in each frame it touches; a clock moves the same digits everywhere it is drawn.

## The round trip, measured

Both directions were measured inside the pins run, against the same file:

* **app → terminal.** After the press, the scene asks the terminal's own store what it
  holds, by importing `local_operator.tui.sidebar_pins.read_pins` — the function the TUI's
  sidebar calls — in a real interpreter against the daemon's config root. It contains the
  id of the conversation this app just pinned (`[PASS] a pin made in this app is in the
  store the terminal reads`).
* **terminal → app.** The scene runs `sidebar_pins.toggle_pin` — the function the
  terminal's `f10` calls (`action_toggle_pin` hands it to a thread) — against the daemon's
  config root, then watches the panel with nobody touching the window. The frame
  `pins-from-tui-dark` is the panel after that write, and the measured latency was
  **206 ms** on the merged tree (950 ms, 534 ms, 413 ms and 217 ms in the four runs before
  it, on the same box). The design's bound is ~1.5 s: the feed's 1 Hz catalogue probe
  fires on the pins file's own fingerprint, the renderer refetches once on that frame, and
  the panel's 30 s safety poll sits behind it as drift insurance.

The TUI *surface* (a real terminal with `f10` pressed) is not driven here: that leg lives
in the backend pull request's own pilot, where the terminal app and the route are in one
process tree.

## The folds onto `main`, measured rather than asserted

The branch was folded twice while this set existed - onto `ccc3017a3` (#299), then onto
`3afcc732f` (#290, the user bubble's measure width) - and each time the question was the same:
did the fold move anything this set is a picture of?

**It moved the PANE, not the sidebar, and that is a measurement.** Six frames moved on each
fold, and they are exactly the frames with a conversation open in the chat pane, where `main`
changed (`chat-content.tsx` on the first, `markdown.css` + `message-paper.tsx` on the second).
Cropping the frame from the previous head and the re-shot one to the sidebar's own columns
removes the difference completely:

```
fold onto ccc3017a3   sidebar 0 differing pixels   pane 1134-1200   (six frames)
fold onto 3afcc732f   sidebar 0 differing pixels   pane 923        (the same six)
```

So every claim in this file's table holds on the folded tree, and the thirteen frames whose
pixels did not move at all are evidence that neither fold touched anything the pins surface
paints - including the withdrawn pair, which re-shot byte-identical to the pre-change panel
both times. The frames in this directory are the `3afcc732f` set; the earlier fold's
measurement is in the pull request's fold comment rather than kept here, because only one set
of frames can be the pictures of the shipped tree.

## The move a pin makes, and what the panel does about it

Pinning moves a row out of `Active`/`Previous` and into `Pinned chats`, which is a change of
DOM POSITION, and left to the browser it went wrong in three ways at once (QA round 1,
U1/U2/U3, measured on a region scrolled a quarter of its range):

* the region's scroll was re-anchored by the browser (275 -> 319 on QA's run), moving the
  list under a reader who had not scrolled;
* the pointer, which had not moved, was left over a DIFFERENT conversation - a second click
  opens the wrong chat;
* the control holding keyboard focus was unmounted with the row, so the next Tab started at
  the top of the panel.

The panel now corrects the move itself, and ONE correction per kind of press, because the
two want opposite things:

* **a pointer press anchors the content.** The row beside the pressed one keeps the line it
  had - asserted to ±2 px, and it holds to the pixel: the committed run measures
  `region scroll 88 -> 88`, the neighbour's viewport top `803 -> 803` - and the reveal is
  DISARMED until the pointer moves, so the slot the pointer is parked over is hidden and
  inert rather than a control that would act on a conversation nobody chose. The scene
  asserts both: `[PASS] the list did not move under the pointer: the row beside the pressed
  one keeps its line (U1)` and `[PASS] no control is left under the stationary pointer, so a
  second click acts on nothing (U3)`.
* **a keyboard press follows the row.** The caret went to the row's control, so the row
  moving away from the caret is the disorienting part: the correction puts it back on its
  line, or - when that is geometrically impossible - brings it to the region's top edge and
  hands focus back to the same control on that row, with `preventScroll` so that focusing
  does not undo the correction. Asserted as `[PASS] Space pinned the conversation the caret
  was on`, `[PASS] focus follows the moved row: the caret is on the same pin (U2)` and
  `[PASS] the row the keyboard moved is still inside the list's view`.

The geometric limit is real and is stated rather than hidden: a conversation pinned from
DEEPER than the `Pinned chats` section is tall cannot be returned to the line it was pressed
on, because its new home then has less content above it than the reader had scrolled. The
measured case: a press at `scrollTop 334` needs a target of `-187`, which clamps to 0 and
places the row at the region's top edge instead. That is why the two corrections are
different, and why the scene prints `[pins] scrolled pin: ...` with both numbers on every
run: the clamped case cannot be mistaken for the passing one.

## The gates at this head

| Gate | Output |
| --- | --- |
| `pnpm lint` | `Checked 714 files in 296ms. No fixes applied. Found 68 warnings.` (the warnings are the tree's pre-existing backlog; `scripts/` is covered by the gate below) |
| `pnpm lint:scripts` | `check-scripts-lint: 7 changed file(s) under scripts/ are lint-clean against origin/main (3afcc73)` |
| `pnpm check-types` | `tsc --noEmit -p tsconfig.app.json` and `-p tsconfig.main.json`, both clean |
| `pnpm test:desktop` | 2312 of 2314 pass. The two failures are the machine's, not this diff's: `update-robustness.test.mjs`'s "operator's own install" test and `python-bytecode-cache.test.mjs`'s prefix test each fail identically in a worktree at `origin/main` (`47a7d5e37`). No `npx-smoke-test.mjs` and no electron cookie run appear at all - the duplicated runner token that manufactured them was removed this round |
| `pnpm build` | clean |
| `pnpm check-themes` | `Contrast contract holds: 16070 assertions across 59 themes, 11 pinned exception(s), 5 pinned ink step(s).` |
| `pnpm check-evidence` | the frame set is stamped against this head (see the re-stamp commit) |

## The rounds, and what each one changed

| Round | Findings worked here | What the frames show now |
| --- | --- | --- |
| Review round 1 (M1, m1) | the current-row ground had to span the pin slot: the ground moved to the row's own box, with one decision (`current`) worn by every site rather than re-spelled at each | `pins-selected-{dark,light}`: the ground covers the row AND the slot the filled glyph sits in |
| Design round 1 (D1, D2, D5) | the section's placement; one theme per launch, because a two-theme pass left the light frames in the dark pass's state; the cost of the reserved slot | the table above: D1's placement in both modes, D2's per-theme frames, and the slot measured below |
| QA round 1 (U1, U2, U3) | the move a pin makes: content anchoring for a pointer press, follow-the-row for a keyboard press, and an inert reveal under a parked pointer | `pins-scrolled-{dark,light}` and the measured numbers above |
| Review round 2 (m2, m3) | the U1 assertion could not fail (its anchor was the row the correction anchors on); the disarm reached only the pointer path and only the unpinned glyph | the row left under the parked pointer is now asserted not to have moved, and both glyph states and both press kinds are disarmed - `pins-stationary-{dark,light}` |
| Design round 2 (D6-D10) | the nav rows move 44 CSS px on a press (recorded, below); the scrolled frames refuted their own claim; `pins-hover` had the pointer on the row, not the glyph; the gate table was a pre-B1 snapshot; the slot's cost was argued | fourteen pins and an assertion that the set is taller than the window, the pointer on the glyph, the refreshed table, and the D9 claim narrowed to what the frames carry |
| QA round 2 (Qr2-1, Qr2-2, Qr2-3) | a pin on a search-only conversation could not be undone from its own row; the gate table; a missing light link | the store now holds the row the press acts on (both directions proven in `pins-search-*`), and the table is refreshed |

**The motion a press still costs (design round 2, D6), measured.** The anchor keeps the pressed
row's neighbourhood still, and a region scroll moves everything: the two nav rows at the top of
the list consequently move on a press. The scene prints the measurement on every run
(`[pins] D6 nav rows (All chats) top ... -> ... CSS px`), which is where the round's 44 CSS px
is either confirmed or corrected for the tree that ships.

**U1's residual, with UX round 2's measurement.** A pin made from a list scrolled deeper than
the `Pinned chats` section is tall leaves the row and the section out of view - user-visible
past roughly 30% of the region's range, which is where a reader with a real pin list lives.
The anchor strategy is kept deliberately: the alternative - scrolling the row back into view -
moves rows under a stationary pointer, which is the hazard U1 itself was about. Two ways out
were considered and neither is taken unilaterally here because both are design decisions: a
notice saying where the row went, or revealing the section only once the pointer is disarmed.

**D5, measured rather than argued.** The scene prints the row's own box and its two controls
on every run: `[pins] reserved slot: present row 264px, conversation button 236px, pin 24px`.
The arithmetic is the whole cost - 236 + 24 + 4 = 264 - so the reserved slot and the gap it
sits in come out of the conversation button's width and nothing else, the row's height is
unchanged in both pin states, and the withdrawn side (a row that is one button in its own
section, with no wrapper and no slot) prints its own shape rather than a comparison that
would be measuring a different element.

**What the frame set does NOT prove about it (design round 2, nit).** No title in the seeded
catalogue is long enough to reach the clip boundary, so the D9 claim (the slot costs a long
title its width) is carried by the arithmetic and the class - every row's title is drawn
through `truncate` in a box the slot narrows by 28 px - and not by a picture of an ellipsis.
Narrowed here rather than dressed up: photographing a clipped title is a two-line change to
the seeder, and it belongs to whoever next re-shoots this set with a reason to.

**One more recorded limitation (design round 2, D10).** In the scrolled frames the row's focus
ring sits 0.5 CSS px from the region's scrollbar, so a reader who tabs to a row in that state
sees the ring's right edge against the track. It is a measurement from the design round, not a
claim this change makes, and the ring itself is `outline` (never a shadow) as the branding
contract requires.

## Open on this head (recorded, not papered over)

Two legs of the round-2 remediation are NOT green on this head, and the scenes that carry them
are in the tree because a failing scene is worth more than a missing one:

* **`--scene pins-scroll`, the U1 anchor check at the D7 depth.** The D7 state (fourteen pins,
  a pinned set taller than the region's window) forces the region deep enough that the anchor
  cannot keep the pressed row's neighbourhood on its line, and the scene's own m2 check fails
  there: `the row left under the parked pointer did not itself move`. That is UX round 2's
  measured residual showing up as a check rather than as prose. The D6 measurement at that depth
  is `delta 0` - the nav rows do not move - so the residual is in the row neighbourhood, not the
  header.
* **`--scene pins-search`, the row-follows-the-press leg.** The wire and the terminal's store
  both take the pin (`the wire the search answers from says pinned, on the hit itself` and `the
  store the terminal reads holds it` pass), and the ROW does not follow it: the panel keeps
  drawing the cached hit, which is QA round 2's Qr2-1 seen from the client's side. The store's
  action was instrumented for one run and its body was never entered for that press, so the gap
  is between the row's press and the store's action rather than in the action itself - which is
  where the next attempt should look.

## What these frames do not show

* **A pin made on a delegated run.** The desktop catalogue is built with
  `include_subagents=False`, so a run with no desktop row cannot be pinned *to* anything
  visible: the terminal can pin it and its own `★ Pinned` section will show it, while the
  app has no row to draw. Documented rather than papered over (design §9.2); the UI must not
  silently under-report a pinned set, which is why the TUI keeps its `pinned_hidden_ids`
  exemption and this panel does not claim to.
* **Cross-host pairing.** The shared pin store is the file in the config root the
  *daemon* serves. Pair the app to a daemon on another machine and the app and the terminal
  on this one stop sharing pins — a property of the architecture, not of this change
  (design §9.1).
* **Where the section sits.** The section is drawn BELOW the `All chats` / `New chat` nav
  rows and ABOVE `Active chats`, in both modes (design round 1, D1). The first version of
  this change put it at the top of the region, above the nav rows, which the design round
  overruled: in flat mode there is no `Active chats` anchor for the section to sit above
  and a reader arriving at the panel had to scroll past the nav to see their own pins, while
  the pinned row itself is reached from the conversation list below either way. The two
  frames to judge it from are `pins-populated-{dark,light}` and, for the flat list,
  `pins-flat-{dark,light}`.
* **The 51st pin.** No rank or position travels on the wire (deliberately: the TUI's
  `★ Pinned` is drawn in the catalogue's order, so a rank would make two surfaces order one
  list two ways). The consequence is that pinning the 51st conversation drops the oldest
  server-side while that row keeps a stale `pinned` until the next catalogue read, which is
  closed by the same ~1 s doorbell. It needs 51 pins on one machine to observe and is not
  photographed.
