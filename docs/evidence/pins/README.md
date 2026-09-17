# Pinned chats — durable conversation pinning, shared with the terminal

Hovering a conversation row in the chats sidebar reveals a pin control; pressing it
pins the conversation, and pinned conversations are drawn in a `Pinned chats` section
above the rest. The state is the BACKEND's: the same `sidebar-pins.json` the terminal's
`f10` writes, in the config root the daemon serves, so a pin made in the app is a pin the
TUI shows and the other way round.

The backend half of this feature is a sibling pull request (`feat/desktop-session-pins`).
These frames were taken against
**`46b0178fb`** of that branch (the append increment, `8300e843f`, included: the U15 pair in this directory is evidence about THAT build, not the earlier one), booted as a real uvicorn
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

Thirty-three files, counted by `ls docs/evidence/pins/*.png`: seventeen STATES, every one of them in
both themes except `pins-from-tui`, which the round trip photographs once, and the two
capability-withdrawn states. The earlier paragraph here added scene totals together (`17 + 4 + 6` = 27)
and so read as 31 against a directory that holds 31 for different reasons — the sets overlap,
because `pins-pinned-hover-{dark,light}` is drawn by `--scene pins-scroll` and belongs to both the
scrolled pair and the pinned-state pair. By the scene that writes it:

| Scene | States | Files |
| --- | --- | --- |
| `--scene pins` | `pins-populated`, `pins-hover`, `pins-unpinned`, `pins-flat`, `pins-selected`, `pins-filter`, `pins-from-tui` | 13 |
| `--scene pins-scroll` | `pins-scrolled`, `pins-pinned-hover` | 4 |
| `--scene pins-search` | `pins-search-pinned`, `pins-search-unpinned`, `pins-search-cleared`, `pins-search-resuperseded`, `pins-stationary`, `pins-tui-offpage` | 12 |
| the capability-withdrawn stage | `pins-withdrawn`, `pins-withdrawn-main` | 4 |

The window is `1380x900` in `--window-mode=headless` (a
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
| [`pins-scrolled-dark`](pins-scrolled-dark.png) ([light](pins-scrolled-light.png)) | the region at the top of a list whose `Pinned chats` section is taller than the window it is drawn in - the boundary state, after the unpin press the correction had to act on | **The pinned set cannot be whole in one window** (design round 2, D7): the check reads the capture-time state (`scrollTop`, pinned rows, wholly inside) and the frame is taken at it, so the picture and the number describe the same moment. The correction's own evidence is the pair of checks in the scene (`an unpin press the correction can act on...` and `the correction moved the region to do it`), whose numbers are printed in the run log |
| [`pins-pinned-hover-dark`](pins-pinned-hover-dark.png) ([light](pins-pinned-hover-light.png)) | the pointer ON an already-pinned row's glyph | **The pinned state does not depend on the reveal**: the glyph is filled and fully opaque at rest, and it says what a press would do (`Unpin “…”`) |
| [`pins-search-pinned-dark`](pins-search-pinned-dark.png) ([light](pins-search-pinned-light.png)) | a conversation OUTSIDE the panel's own page (568 seeded, the page reads 500), pinned from its search hit | **Qr2-1, both directions**: the press writes the wire, the store the terminal reads holds it, and the row it was made on follows - then the SAME row unpins it, with all three surfaces checked again |
| [`pins-search-unpinned-dark`](pins-search-unpinned-dark.png) ([light](pins-search-unpinned-light.png)) | the same row, after the second press | the control inverts the STORE's state, not a cached wire answer |
| [`pins-tui-offpage-dark`](pins-tui-offpage-dark.png) ([light](pins-tui-offpage-light.png)) | a pin written by the TERMINAL's own writer (`sidebar_pins.toggle_pin`) on a conversation the client's page does not carry: 568 in the store, 500 on the page | **UX round 5, U15**: the row is drawn, named, pinned at rest and counted by its section - `Pinned chats 2` with `RecentSweep 034` - 268 ms after the write, against the 11.2 s-and-beyond that drew nothing. Unpinned from the same surface, it leaves |
| [`pins-search-cleared-dark`](pins-search-cleared-dark.png) ([light](pins-search-cleared-light.png)) | the query cleared, with the pin still held for a conversation the catalogue page does not carry | **The pin the page cannot draw, drawn** (design round 4, D17; UX round 4, U14): the row is there, above `Active chats`, carrying the title the fact holds, and its section counts it — so the panel and the terminal hold the same set |
| [`pins-search-resuperseded-dark`](pins-search-resuperseded-dark.png) ([light](pins-search-resuperseded-light.png)) | the same row after the pin is removed through the daemon's own route, then asked for again | **The currency rule, live** (review round 3, MAJOR 2; round 4, M1): a fresh answer supersedes the client's memory and settles the ROW it speaks about, so the other surface's removal is visible here |
| [`pins-stationary-dark`](pins-stationary-dark.png) ([light](pins-stationary-light.png)) | a stationary repeat press on a pinned glyph, then a 3 px wobble of the same gesture | **U3-unpin**: neither press reaches a row the pointer is not on. The repeat acts on the conversation whose control is under the pointer and on nothing else - what the check asserts (`a stationary repeat press acts on the row under the pointer and on no other`). The disarm this caption used to name was replaced by `dropRepeatPress`, which drops a repeat press on a DIFFERENT conversation inside a 6 px slop of the last pointer press — identity AND a small radius, expired by the pointer's own path (a move beyond the slop, or leaving the list) — and the reader's own repeat is exercised by keyboard, where it is reachable |
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
claimed. The scene prints `[PASS]`/`[FAIL]` for every assertion it makes, and the counts below are this
head's own runs, read off the capture log — **45** in each `--scene pins` run, **45** in each
`--scene pins-scroll` run, **34** in each `--scene pins-search` run (the scene the earlier
paragraph here left out entirely) and **15** in each withdrawn run, all passing on the head these
frames were taken at:
```
[capture] pins/localOperatorDark: 45 checks passed, 0 failed
[capture] pins/localOperatorLight: 45 checks passed, 0 failed
[capture] pins-scroll/localOperatorDark: 45 checks passed, 0 failed
[capture] pins-scroll/localOperatorLight: 45 checks passed, 0 failed
[capture] pins-search/localOperatorDark: 39 checks passed, 0 failed
[capture] pins-search/localOperatorLight: 39 checks passed, 0 failed
[capture] pins/localOperatorDark: 15 checks passed, 0 failed
[capture] pins/localOperatorLight: 15 checks passed, 0 failed
```
It refuses to run at
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

The branch was folded three times while this set existed - onto `ccc3017a3` (#299), then onto
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

Those two rows describe the first two folds, where the sidebar was untouched and the
measurement was that the pins surface had not moved at all. **They stopped being the whole
story at the fold onto `318cbb75e`** (the fold this head carries), and the third row is what
that one measured:

```
fold onto 846ff92a5   re-shoot, 4db3ccb7f comparison: 0 moved   (small conflict set only)
fold onto 318cbb75e   re-shoot, this set: 9 frames moved, 22 byte-identical
                      moved: pins-filter-{dark,light}, pins-flat-{dark,light},
                             pins-from-tui-dark, pins-search-cleared-{dark,light},
                             pins-selected-{dark,light}
```

The nine are exactly the frames whose sidebar carries a SELECTED row, and the cause is a change
this surface inherited rather than made: main's #281 moved the `--lo-highlight` role, so the
current-row ground differs in every frame that paints one (design round 5 measured 30,700-62,813
pixels a frame, and confirmed the claim the ground carries still holds - the full 264 px box
including the pin slot, 13.7:1 dark and 13.9:1 light). No other frame carries that ground, which
is why the other 22 did not move: the field's own pixels are unchanged. The withdrawn pair is
byte-identical to the pre-change panel under `cmp` on this head, as before.

The `3afcc732f` row above is kept as history rather than deleted: it is what the set's older
frames were shot at, and the statement "the frames in this directory are the shipped tree's"
is now carried by `manifest.json`'s `srcTree`/`scriptsTree` stamps rather than by naming a fold.

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
| `pnpm lint` | `Checked 715 files in 224ms. No fixes applied. Found 68 warnings.` (the warnings are the tree's pre-existing backlog; `scripts/` is covered by the gate below) |
| `pnpm lint:scripts` | `check-scripts-lint: 7 changed file(s) under scripts/ are lint-clean against origin/main (3afcc73)` |
| `pnpm check-types` | `tsc --noEmit -p tsconfig.app.json` and `-p tsconfig.main.json`, both clean |
| `pnpm test:desktop` | 2314 of 2317 pass. Two failures are the machine's, not this diff's (`update-robustness.test.mjs`'s "operator's own install" and `python-bytecode-cache.test.mjs`'s prefix test, both failing identically in a worktree at `origin/main`). The third is `the SHIPPED manifest's stamps describe the tree it ships in`: `docs/evidence/manifest.json`'s `srcTree`/`scriptsTree` are written by the `pnpm check-evidence` sweep, which is deferred on this head, so the stamps still describe the previous one. It is a re-stamp, not a code failure - and it is named here rather than left to be discovered |
| `pnpm build` | clean |
| `pnpm check-themes` | `Contrast contract holds: 16070 assertions across 59 themes, 11 pinned exception(s), 5 pinned ink step(s).` |
| `pnpm check-evidence` | **DEFERRED, not passed.** The gate admits one sweep per machine and a sibling lane held the lease while this head was prepared; the frames in this directory were captured directly by the scene runner (`[capture] ... N checks passed, 0 failed`, pasted above) and are re-stamped in the single unbounded sweep when the manager schedules it. Nothing here should be read as that gate having run |

## The rounds, and what each one changed

| Round | Findings worked here | What the frames show now |
| --- | --- | --- |
| Review round 1 (M1, m1) | the current-row ground had to span the pin slot: the ground moved to the row's own box, with one decision (`current`) worn by every site rather than re-spelled at each | `pins-selected-{dark,light}`: the ground covers the row AND the slot the filled glyph sits in |
| Design round 1 (D1, D2, D5) | the section's placement; one theme per launch, because a two-theme pass left the light frames in the dark pass's state; the cost of the reserved slot | the table above: D1's placement in both modes, D2's per-theme frames, and the slot measured below |
| QA round 1 (U1, U2, U3) | the move a pin makes: content anchoring for a pointer press, follow-the-row for a keyboard press, and an inert reveal under a parked pointer | `pins-scrolled-{dark,light}` and the measured numbers above |
| Review round 2 (m2, m3) | the U1 assertion could not fail (its anchor was the row the correction anchors on); the disarm reached only the pointer path and only the unpinned glyph | the disarm was replaced in round 3 by `dropRepeatPress` - identity plus a 6 px slop, expired by the pointer's own path - and `pins-stationary-{dark,light}` carries the repeat-press state |
| Review round 3 (m1, m2, m3 + minors) | the replacement `m2` check was held by arithmetic and ran at `scrollTop 0` where the correction has nothing to add; the client's pin fact outranked a fresher answer with no currency; a dropped press armed the move correction; the central fix's test was a source scrape | an UNPIN press at a depth the correction can act from, with the region's own `scrollTop` asserted to have changed; `PinFact` carries the answer sequence and an answer that speaks about an id supersedes an older fact; the guard runs before `rememberMovedRow`; the test is behavioural |
| Design round 3 (D11, D12) | the scrolled pair photographed a depth its caption did not describe, and the state one click after the search pair was in no frame | the frame is taken at a state the checks assert (the correction settles before the scroll is set) and `pins-search-cleared-*` photographs the pin held for a row the page cannot carry |
| QA round 3 (Qr3-1) + UX round 3 (U9) | the guard was a coordinate disc with no expiry, so a press after the pointer left and returned was silently dropped | the record is expired by the pointer's path - a move beyond the slop, or leaving the list |
| Review round 4 (M1, m1, m2) | the page's currency guard covered the FACT but not the ROW, so a page whose request predated a press regressed the row and dropped the row the press inserted; the currency assertions passed with both guards deleted; two presses in flight on one row settled on the stale answer | the page's rows carry the same guard as its facts; the behavioural tests drive the ordering the way concurrency produces it (a page asked for, a press, then the answer) and each guard has a named mutation that turns a check red; each write takes its own sequence, so a superseded press's answer cannot settle the row |
| Design round 4 (D17) + UX round 4 (U14) | the pin a page cannot carry was drawn NOWHERE - no row, no heading, no count - so the app under-reported a set the backend and the terminal both held | `pinFacts` carries the title a row needs and the list draws a row from it, above `Active chats`, with the section counting it; `pins-search-cleared-{dark,light}` is the frame and the check asserts the row BY ID against the same store the terminal reads |
| QA round 4 (Qr4-1, Qr4-2, Qr4-4) | as above, plus the fold's `package.json` regression (the branch's own older file, 125 `test:desktop` entries where main has 138) and fourteen resurrected script reformats | `package.json` is main's with one registration added (139 entries, version `0.26.5`); the reformats are main's content again and `git diff origin/main` names only this feature's files |
| Code round 4 (B1) | the same `package.json` regression, merge-blocking | fixed and proven with the version, the argument-list diff and the count |
| Recorded, not fixed: UX U16 | focus after a POINTER press is `body`, so a Space before the reader Tabs is lost. The pressed row is replaced by the re-render, so restoring focus means focusing the moved row's own control from the pointer path - the same effect that arms the follow-the-row correction, whose record is keyed on the last pointer press - and re-arming it there is what the parked-pointer guard exists to prevent. A decision with its reason, not a gap |
| Recorded, not fixed: UX U12 | the 6 px slop is deliberate rather than accidental: a 3 px and a 6 px repeat are dropped, 7 px acts, so the guard narrows the DROP set rather than widening the ACT set, and U9's silent swallow is gone. Named here so the next reader does not re-derive it from the constant |
| Recorded, not fixed: UX U13 | the caret is restored one render behind the remount in the follow-the-row case; no reader-visible repro was found, and the correction itself is asserted |
| Design round 2 (D6-D10) | the nav rows move 44 CSS px on a press (recorded, below); the scrolled frames refuted their own claim; `pins-hover` had the pointer on the row, not the glyph; the gate table was a pre-B1 snapshot; the slot's cost was argued | fourteen pins and an assertion that the set is taller than the window, the pointer on the glyph, the refreshed table, and the D9 claim narrowed to what the frames carry |
| QA round 2 (Qr2-1, Qr2-2, Qr2-3) | a pin on a search-only conversation could not be undone from its own row; the gate table; a missing light link | the store now holds the row the press acts on (both directions proven in `pins-search-*`), and the table is refreshed |

**The motion a press still costs (design round 2, D6), measured.** The anchor keeps the pressed
row's neighbourhood still, and a region scroll moves everything: the two nav rows at the top of
the list consequently move on a press. The scene prints the measurement on every run
(`[pins] D6 nav rows (All chats) top ... -> ... CSS px`), which is where the round's 44 CSS px
is either confirmed or corrected for the tree that ships.

**U1's residual, with UX round 2's measurement.** A pin made from a list scrolled deeper than
the `Pinned chats` section is tall leaves the row and the section out of view - user-visible
past a fraction of the region's range that SCALES WITH THE PINNED SET, and UX round 3 measured both
ends of that: about 16% of the range with two pins, and 50% in the D7 shape (fourteen pins), where
the pressed row's new home is 554 px above the fold. The reason is legible - the pressed row lands at
its catalogue position inside the pinned section, so pinning an OLDER conversation from deep in the
list puts its new home at the END of a tall section, the furthest place in the panel from the
reader's line. Round 2's 30% figure was one measurement of a moving boundary, not the boundary.
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

## Round 2, closed: the two legs and the boundary

**The search-only conversation (QA round 2, Qr2-1).** The press reached the backend and the store's
optimistic write was a no-op, because the store held no row for it - and the row the panel drew was
rebuilt from the cached wire hit on every render, so it reported the state the search last saw and
the next press re-sent the state already applied. The instrument that found the rest of it was a
read of the element under the press coordinates: the press was landing, the row was not following.

Two mechanisms, both now closed:

* **The catalogue page dropped the row.** `replaceSessionRows` rebuilds the row list from the page
  payload alone - deliberately, since the page is the authority on which conversations exist - and
  `sessions.list` is capped at 500 while the search answer is uncapped. So a conversation the user
  pins from a search hit has its row inserted by the press and then dropped by the catalogue
  refresh that very write triggers. The store now keeps the pin itself (`pinFacts`): one boolean
  per conversation this window has written and the backend has confirmed, which the page cannot
  take away, and which `searchChats` renders for a row the catalogue does not list.
* **The repeat-press guard was a disarm.** After any press the reveal went inert until the pointer
  moved again, which kept a repeat press off the row that had slid into the vacated line - and also
  swallowed the reader's own second press on the control they meant, which is exactly what a reader
  does to unpin. The guard is now about identity rather than time: a pointer press repeating the
  last one inside the wobble slop is dropped only when the control under it belongs to a DIFFERENT
  conversation. The row's own button carries the same guard, because opening a conversation the
  reader never pointed at is the same hazard and worse to undo.

`--scene pins-search` on a 568-session store, 23 checks, 0 failed on both themes:

```
[PASS] the page does not list it, so the search answer is the only way it can arrive
[PASS] the hit is drawn, with a pin control, and the wire says it is unpinned
[PASS] the row follows the press: it is pinned, from a row the store did not hold
[PASS] the wire the search answers from says pinned, on the hit itself
[PASS] the store the terminal reads holds it
[PASS] the SAME row unpins what it pinned: the store's state is what the control inverts
[PASS] the store the terminal reads has dropped it
[PASS] a stationary repeat press acts on the row under the pointer and on no other (U3-unpin)
[PASS] a 3 px wobble is the same gesture: it never reaches a row the pointer is not on
```

**The scrolled pair (the promise and the boundary).** `--scene pins-scroll`, 38 checks, 0 failed on
both themes, now asserts two different things at two different depths, because one geometry cannot
carry both:

* **The promise, at a state shallow enough for it to hold.** The rows BELOW the pressed row keep
  their lines through the press (the row the correction anchors on, and the content the reader is
  looking at); a repeat press on a parked pointer changes only the conversation whose control is
  under it; and the pressed row's new home - `Pinned chats`, at the top of the content - is inside
  the region's window, so a reader at that depth watches the row arrive.
* **The boundary, at the D7 depth.** The anchor still holds (the neighbouring row keeps its line)
  and the pressed row's new home is OFF the window. That is UX round 2's residual as a measurement
  with both directions asserted, so the boundary cannot move silently either way. The rows ABOVE
  the pressed row move by exactly the section's growth - printed with their deltas on every run
  (`[pins] m2 measured: ... above [[ad49c02e766c,719,751], ...]`, +32 CSS px) - and the D6
  measurement of the nav rows is `delta 0` at this depth, which is the number that moved in the
  design round's favour (round 1 measured 44 CSS px there).
* The guard is what makes the residual survivable: whatever slid under the parked pointer after a
  press is a conversation the press did not mean, and pressing it does nothing.

The gate outputs are in the table above.

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
