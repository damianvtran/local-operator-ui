# The console pane's grid fits the pane's box, and opening it gives you a terminal

Frames and measurements for `fix/console-pane-fit`, from the BUILT app in the
documented `headless` window mode, driven over CDP, against a backend this run
owns (scratch home, scratch config dir, scratch `--user-data-dir`, its own port
and its own desktop token).

Two operator items, one round:

1. **the terminal overflowed its own box** — "I scrolled to the bottom and the
   scroll wheel seems to bottom out at the bottom below the screen but I can't see
   it": the last rows of the terminal, the prompt included, were painted below the
   pane's clipped edge, where no scroll reaches them;
2. **opening the console should open and focus its first surface** — "opening the
   console typically means you want to run a console command right away", so the
   pane should not greet you with an empty state and a `New console` button.

## 1. The overflow, its cause, and the measurement that proves it

The pane reports a box and a cell size; main derives the grid (§8.2) and the
mirror never sizes itself. Main's arithmetic is a division:

```
rows = floor(reported contentRect.height / reported cellHeight)
```

xterm 6 does not draw that cell height. It measures its char height as
`fontBoundingBoxAscent + fontBoundingBoxDescent`
(`@xterm/xterm` `browser/services/CharSizeService.ts`, `TextMetricsMeasureStrategy`)
and then sizes each row to
`round(ceil(charHeight * dpr) * rows / dpr) / rows`
(`browser/renderer/dom/DomRenderer.ts::_updateDimensions`) — at this face and
ratio **17 px**, against the **15.6 px** (`13 * 1.2`, the line box) the pane
reported. A divisor smaller than the painted row over-derives rows, and the
terminal is painted past the bottom of the box it was measured from.

Measured, per window size, with the pane's own report read off the live DOM (the
rect the pane reads immediately before it reports) and main's own grid read back
through the app's console wire:

| window | pane's box (READ) | reported cell (INFERRED, below) | real row height (READ) | rows main derived (READ) | terminal painted (READ) | overflow |
| --- | --- | --- | --- | --- | --- | --- |
| 1380x900 | 643x**791** | 15.6 | **17** | 50 | 50 x 17 = **850** | **+59 px** |
| 1024x700 | 287x**591** | 15.6 | **17** | 37 | 37 x 17 = **629** | **+38 px** |
| 1380x900 (fixed) | 643x**791** | **17** | 17 | 46 | 46 x 17 = **782** | **-9 px** |
| 1024x700 (fixed) | 287x**591** | **17** | 17 | 34 | 34 x 17 = **578** | **-13 px** |

FIVE OF THE SEVEN COLUMNS ARE READINGS AND TWO ARE RECOVERED, and the header says
which is which rather than leaving a reader to quote an inference as a reading (QA
round 1, Q-2). `reported contentRect` and `rowsTimesReportedCell` are `null` in
`after-geometry.json` for the reason below, so the AFTER table's reported cell is
derived from `rows` and `box` against the code's constant — reproducible, and checked
by QA's audit script — but not measured off the wire.

`floor(791 / 15.6) = 50` and `floor(791 / 17) = 46`: 59px is three and a half
rows of terminal, painted outside the box. The font metrics behind the 17 are read
from the same page, not assumed: `measureText("W")` at `13px "Geist Mono"` reports
`fontBoundingBoxAscent 13` + `fontBoundingBoxDescent 4` at dpr 2.

**THE FIT HOLDS TO WITHIN HALF A DEVICE PIXEL, NOT EXACTLY** (QA round 1, Q-1). The
divisor main now uses is the pane's own `ceil(charHeight * dpr) / dpr` per row, while
xterm rounds the row TOTAL — `round(device.cell.height * rows / dpr)` — so for an odd
device-pixel total the painted height can exceed the box by up to **0.5 device px**
(0.25 CSS px at dpr 2). At this face and ratio the two agree exactly: the sweep in
`console-mirror.test.mjs` (every box at or above the grid floor, 60…1400 px) finds no
over-paint, and QA's independent sweep over 1,341 boxes found a worst case of
**+0.0 px**. Half a pixel clips no glyph — but that is the bound a later reader
inherits, and "exactly" would be the round number this PR exists to remove.

HOW EACH NUMBER WAS OBTAINED, because two of the four columns are read and two are
pinned, and a reader is owed the difference:

- **read directly**: the pane's box (the rect the pane's own `send` reads off its
  host immediately before it reports — the call is wrapped, and the three reads in a
  run are identical, so the box is stable), the terminal's painted `.xterm-screen`
  height, the number of rows in the live DOM, and the height of one of those row
  elements. Every one of them is in `*-geometry.json` verbatim.
- **pinned, not read**: the reported CELL height. The report itself crosses a
  `contextBridge` object that Electron freezes, so the argument cannot be wrapped
  from the page — measured, and recorded in each run as `bridgePatch`
  (`Object.isFrozen` true, an assignment that does not take, and
  `TypeError: Cannot redefine property: setContentRect`). What main used as the
  divisor is therefore recovered from two numbers that WERE read — main's own rows
  and the box — against the pane's source constant: `rows = floor(box / cell)`, so
  50 rows over a 791px box pins the BEFORE cell to `(791/51, 791/50] = (15.51,
  15.82]`, whose only candidate is `13 * 1.2 = 15.6` (the code), and 46 rows pins
  the AFTER cell to `(791/47, 791/46] = (16.83, 17.20]`, which is xterm's own
  `ceil(17 * 2) / 2 = 17`. The `after` column is corroborated a second way: it is
  the value the shipped `measureCell` now returns for those metrics, asserted in
  `scripts/console-mirror.test.mjs`.

`before-1380x900-bottom.png` / `after-1380x900-bottom.png` and the `1024x700` pair
are the same window size, the same seeded content (`ls -la ~`, `seq 1 120`, then
`echo BOTTOM-MARKER-OK`, scrolled to the bottom with the wheel). In the BEFORE
frames the last visible row is `120` and the marker line is cut off by the bottom
edge of the pane — in the `1024x700` one the fragment `OM-MARKER-OK` is visible
*below* the fold with the prompt after it entirely gone, which is the operator's
own description. In the AFTER frames the marker, its output and the prompt line all
sit inside the pane, with the pane's bottom edge visible below them and 9-13 px of
the box unused.

## 2. Opening the console creates its first surface and puts the caret in it

`after-1380x900-open.png` is the frame immediately after a real press on the chat
header's console trigger (a compositor press through CDP's input pipeline, not a
synthetic `element.click()`). Recorded with it: the press created the surface
(`the open itself created the surface: true`) and the caret is in the terminal
(`document.activeElement` = `xterm-helper-textarea`), so typing goes to the program
without a second gesture.

What the decision is, and what it deliberately is not:

- **a surface that exists is focused, never duplicated** — the pane's own
  `pickActiveSurface` chose which one is showing, and a second surface would take
  the lens off the one the user was reading;
- **the created surface is main's own object**, with main's defaults — the login
  shell, the session's id, and main's answer for its working directory — because
  two ways for a user's surface to be born is the defect (its `cwd` in this run is
  the run's scratch home, recorded in `*-geometry.json`);
- **only the user's press asks for it.** A completion banner's click, an agent's
  `reveal`, and the restored preference of a relaunch all open this pane and none
  of them is a user asking for a keyboard; the request is a consumed-once event
  that is excluded from the persisted preferences, so a launch cannot inherit one;
- **a console that cannot exist here is told so, not given a shell** (`available:
  false` answers `none`, which is main's §15 state and names main's own reason), and
  **a create that fails gets its own state**, because those are different sentences
  with opposite remedies: the console is available and the attempt failed, so the pane
  says that, prints the host's own words on the machine line, and offers the same
  action the header's `+` does. The first cut sent a refused create to the
  unavailable state, whose copy says the console cannot exist in this app and advises
  updating it — a claim about the app, above a machine line naming a pty failure
  (design round 1, U2). The frame is `harness-open-failed.png` below.

### The first tab's 22px is the rig's, not the product's (design round 1, D2)

The design round measured the tab pill growing from 36 to 58 CSS px between the open
frame and the settled frame and read it as the surface's icon resolving. It is a mark
appearing, and the reason it appeared is this rig: the run feeds its input down the
app's own console wire, so the surface's `last_actor` becomes `agent`, and a row whose
actor is an agent carries the provenance marker of §6.5 — a `size-4` glyph plus the
row's `gap-1.5`, which is **exactly the 22 px measured** (16 + 6). The product is
behaving as designed; the two frames were photographed either side of a change the
frame's own content caused. `after-geometry.json` carries the reading
(`last_actor: "agent"`), so the pair is comparable only when the same input path
produced both — which is why the harness frames below drive the pane's own path and
carry no marker.

### A conversation that already had a surface (a separate run, same rig)

One surface was created through the app's own console wire while nobody was
looking, and the trigger was then pressed the way a user does:

| reading | value |
| --- | --- |
| surfaces before the press | **1** |
| surfaces after the open | **1** |
| `document.activeElement` at the open | `xterm-helper-textarea` |
| pane's box | 634.5 px |
| rows / painted | 37 x 17 = **629** px, **5.5 px inside the box** |

The open FOCUSED the surface that was there and made no second one — which is the
half of the decision `pickActiveSurface` already answers: a second surface would
take the lens off the one the user was reading. (The rest of this set's runs start
from a conversation with no surface, where the same press creates the first one.)

## 3. The moments between the press and the terminal

`after-1380x900-open.png` is settled: there is no frame in the committed set between a
press on the trigger and a terminal being there, so the flow's central claim — the pane
does not greet you with an empty state and a `New console` button — had no visual half
(design round 1, D1). Three frames close that, one moment per page load, from
`scripts/console-open-evidence.{html,tsx,css,vite.mjs}` — the pane's own states in a
browser, **not** a second Electron boot: this round's host rule forbids taking a launch
of its own (load ~100, ~1–4 GB free), and the pane's state machine is what is under the
camera. QA's live launch is the app-level cell.

```bash
# from the worktree root; no pnpm, no app
export npm_config_manage_package_manager_versions=false
node node_modules/vite/bin/vite.js --config scripts/console-open-evidence.vite.mjs &
# then, with the browser tool, at a viewport taller than 800px, one load per frame:
#   http://localhost:5207/console-open-evidence.html?step=waiting   -> harness-open-waiting.png
#   http://localhost:5207/console-open-evidence.html?step=created   -> harness-open-created.png
#   http://localhost:5207/console-open-evidence.html?step=failed    -> harness-open-failed.png
```

**What I see in them, and what each one is evidence of:**

- `harness-open-waiting.png` — the press has been made and the create is in flight. The
  pane's body reads **"Starting a console"**. There is no "No console in this session"
  and no `New console` button anywhere in the frame: this is the moment the operator's
  report is about, and it is a wait rather than a greeting. (The state's sentence is
  the `creating` variant added for design round 1, U4 — the pane is starting a shell,
  not reading a listing.)
- `harness-open-created.png` — the create answered. The header is `Console zsh`, the
  surface strip holds one `zsh` row, and the terminal fills the pane's body with the
  prompt at the top. One surface: the open created the first and did not make a second.
- `harness-open-failed.png` — the create was refused. The pane says **"The console could
  not start in this session"**, prints the host's own words verbatim on the machine line
  (`… console_unavailable: the pty could not be started (spawn_failed)`), and offers
  **Try again** — and the header's `+` is still there and still enabled, which is the two
  controls agreeing rather than contradicting each other.

The middle moment is the one the eye cannot sample at 60 Hz, so the transition is also
pinned as a **commit record**: `scripts/console-pane-render.test.mjs` mounts the shipped
pane against a scripted bridge and records the text of every React commit from the press
onward, asserting that no commit contains the greeting and that the sequence is
wait → starting → terminal. Its readings, in the pane's own words:

```
["Reading this session's console", "Starting a console", "zsh zsh"]
```

**The pins are falsifiable, and were falsified**: reverting the await on the read that
follows a create (the pre-fix `void read()`) turns two of them red; clearing the open
request as the create STARTS rather than when it answers turns the same two red; putting
a refused create back on the read's `error` turns the U2 frame's assertion red. The
transition test found one of those for itself: the first version of the fix cleared the
request beside `setCreating(true)`, and a write to the preferences store inside that
effect flushes a render of its own (the store is read through `useSyncExternalStore`,
whose update is sync-lane) before the state update in the same tick applies — so one
commit still had no surface, no `creating`, no loading and no request. A sampling
instrument cannot see that; a commit record can, which is why the test counts commits.

## 4. What these frames do not show

- **The caret's own rendering.** A `headless` window is never shown and cannot be
  focused, so a text caret is not painted; the claim is made by the reading
  (`activeElement` = `xterm-helper-textarea`) and by the caret's *block* at the
  prompt in the AFTER frames, not by a blinking bar. Anything about focus rings is
  out of scope for this mode.
- **A failed create, live.** No lever available to the app's own rig makes main's
  `console-create-surface` reject — a shell path that cannot exist produces an ENDED
  surface rather than a failed create (measured: the pty is born and the child exits at
  once, which is the pane's ended state), so the refusal is photographed by the harness
  frame above (`harness-open-failed.png`) and asserted by a render test, not driven
  through the application. QA round 1 reached the same conclusion independently.
- **The caret inside the harness frames.** The harness's page reports no layout
  viewport (`window.innerWidth` 0) and drops programmatic focus, so
  `document.activeElement` stays `BODY` there whatever the code does — a reading that
  is confounded, and recorded as confounded rather than put in a frame as if it meant
  something. The caret half of item 2 is the LIVE evidence:
  `document.activeElement = xterm-helper-textarea` after the same press, recorded in
  `*-geometry.json`, and re-checked by QA's launch. What the harness does settle about
  focus is the one thing a page can: `console-mirror.test.mjs` pins that a mount for a
  surface nobody asked for cannot inherit the request, and that the app's own
  `StrictMode` double mount (dev) does not spend it on the mount that is discarded —
  with the acknowledgement applied synchronously, that test reads `focusCount 0`.
- **The conversation's own content.** The run's backend is one this rig owns, with
  one empty conversation in it; nothing in these frames is operator data.

## Where the design authority lives, and what is deferred

The comments across `src/renderer/src/features/console` and `src/main/console` cite
`docs/design/ui-console-tab.md` by section (§6.1, §8.2, §8.5, §15, …). That document
is **not in this repository** and never was: `git log --all -- docs/design/ui-console-tab.md`
is empty here because it lives in the Python repository beside this one, at
`~/local-operator/docs/design/ui-console-tab.md` — verified present, §8.5 included
("When the pane and the grid disagree": main holds the grid at its floor and the pane
crops rather than reflowing below 40 columns). A citation a reviewer cannot open is a
finding of its own (design round 1, D3); the files this round touches say where the
document lives, and qualifying the remaining twenty headers is a mechanical change of
its own rather than a ride-along here.

**Deferred — the narrow pane's glyph crop (design round 1, D3).** At 287 px the grid is
raised to `MIN_COLS = 40` and xterm paints 312 px into that box, so the 37th character
is cut mid-stroke and an `O` can read as a `C`. This is **pre-existing** — the BEFORE
record reports the same `cols 40` in the same 287 px box — and §8.5 decides the crop
deliberately (a terminal reflowed below 40 columns is less useful than one you scroll),
with one thing this pane does not yet have: §8.5 also asks for a horizontal
**affordance** for the columns beyond the edge, and there is none. Adding it is a
change to the pane's chrome rather than to its fit, so it is recorded here, deferred
rather than silently fixed, for the design round to sequence.

## The run

```bash
# 1. an isolated backend, its own config/home/port/token, one conversation in it
#    (see the PR body for the exact block), then:
# 2. a build that points AT it — the URL is inlined at build time
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> \
VITE_GOOGLE_CLIENT_ID=... VITE_GOOGLE_CLIENT_SECRET=... \
VITE_MICROSOFT_CLIENT_ID=... VITE_MICROSOFT_TENANT_ID=common \
LOCAL_OPERATOR_UI_NO_BYTECODE=true \
  node ./node_modules/electron-vite/bin/electron-vite.js build
# 3. the probe (a scratch rig, not committed: it seeds `onboarding-storage`,
#    `canonical-sessions-storage` and the preferences, reads the pane's own rect
#    off the live DOM, presses the trigger, creates the surface through the pane,
#    feeds a command down the app's own console wire, wheels to the bottom, and
#    writes the frames and the numbers)
node console-fit-probe.mjs --repo <worktree> --out <dir> --label before \
  --sizes 1380x900,1024x700 --session <id> --token <file> --pair <serve-records>
```

`before-geometry.json` and `after-geometry.json` are the runs' own records,
verbatim: the window's inner size and dpr, the reported box and the pane's own read
of it, main's grid after settling, the painted `.xterm-screen` height, the real row
height, the frame that follows the surface's creation, and the caret reading.
