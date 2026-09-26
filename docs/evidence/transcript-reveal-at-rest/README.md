# Reveals at rest, one fetch per gesture

The transcript's scroll-up paging used to dispatch a reveal while the viewport
was still travelling (rule 3's velocity lead) and to let ONE gesture's momentum
buy page after page, because every reveal mounted the next wall in front of the
reader and each crossing looked like a fresh arrival. The operator's report is
the contract this round restores:

> instead of keeping me in the same apparent scroll in the view, it keeps me at
> the same percentage of scroll which then keeps me at the top which then keeps
> loading in chunks and goes into a loop until it loads all the way back to the
> start

Two changes, both in `scroll-paging.ts` and `use-scroll-paging.ts`:

1. **A spend waits for the motion to settle, or happens at the hard top.** The
   velocity lead is removed. Measured on this rig's scroller, a mount dispatched
   mid-motion displaced the reader's distance-from-top by up to **6834px in a
   single frame** in the committed samples (`maxDistanceFrameDeltaPx`,
   `page-lands-with-rows-hidden`, both arms) before the anchor hold restored it,
   and the terminal UI this surface is asked to match defers its checks while
   the scroller animates.
2. **One round trip per act** (`actFetchSpent`): a fling that crosses two walls
   spends once; the next chunk needs a fresh act (`GESTURE_GAP_MS` of quiet and
   a new push) or the affordance. Local widens are not budgeted — they show the
   reader rows already in hand.

## Round 1's remediation (this revision)

Review round 1 on the PR raised two code findings (F1, F2) and two evidence
findings (D1, Q1); this revision carries their fixes and the re-shot evidence.
The frames and readings below are all from the folded tip (`53ce0d4876` + this
branch), captured by the same rig for both arms.

- **F1 — an owed widen is re-decided at the settle.** A rule-6 widen owed
  because a page landed INSIDE the input debounce had nobody to re-decide it
  when the landing itself returned `none`: the pump's only delayed re-run for a
  `none` state was gated on an armed demand. The gate now also admits
  `pageWidenOwed`, and the new hook case (`transcript-paging-hook.test.mjs`)
  drives the real mounted hook through exactly that state — 0 reveals at the
  landing, the owed widen paid at the settle, no further input. It fails on
  `0ed7c7efb`'s pump and passes here.
- **F2 — a failed fetch keeps the act's budget.** The budget bounds the
  operator's chain of SUCCESSFUL pages; a failure is rule G's case, where the
  reader's continued ask is the retry and `MAX_AUTO_ATTEMPTS` stops a loop.
  `noteFailed` now clears the budget, and the reviewer's own sequence (spend,
  fail, same-act notch, settle → fetch again) is a case that fails on
  `0ed7c7efb`'s policy and passes here. The terminal UI draws the same line: a
  genuine fault gets an honest notice and the next ask, not a spent act.
- **D1 — a shutter that lands INSIDE the pinned window.** The 05 and 08
  shutters are now probe-triggered while `distanceFromTop <= 2` (a light probe,
  ~20-30ms cadence) and the step's `atWall` field records what the trigger saw.
  On this revision's after arm, **08's shutter landed pinned at
  `distanceFromTop = 1`** (`after-08-resting-finger-at-clamped-top-at-wall`) —
  recorded in `atWall` in the measurements. 05's pin lasts too briefly for a CDP
  round trip in this run: its frame remains the act-end fallback
  (`after-05-…-at-act-end`, act-end `d = 530`), which is what the file name and
  this paragraph say. The before arm never pins at all in either scenario
  (minimum `d` across its samples: 1334px and 614px), so both of its shutters
  are the act-end fallback, as named.
- **Q1 — the drag scenario's coverage, stated rather than claimed.** A native
  scrollbar drag is not reproducible on this surface: the scroller has **no
  layout scrollbar at all** (`offsetWidth - clientWidth === 0`, measured with
  `Emulation.setScrollbarsHidden: false` forced as well), and the selection-drag
  substitute cannot start a selection at this head — every in-viewport press
  point lands inside a row's disclosure button and the counted selectable text
  runs are **0** (`selectableTextRuns` in the step). The scenario now presses
  the gutter, records the gutters it measured (0/0 before and after forcing),
  and reports its legs as travelled (0, 1, 0, 0px). **The pointer-drag clause is
  recorded as not covered by this set, not implied.** The whole-run totals below
  include that scenario's 0 requests on both arms.
- Two observations from the review are also answered here: the `6966px` figure
  in the code comments and the PR body is restated as the committed **6834px**
  above (the old number was from the diagnosis run's scratch, not from this
  set's JSONs), and `worstMsAfterArrival`'s meaning is stated under the readings
  table — it is a scenario-timeline wait, not a fetch latency.

## What produced these frames

The same rig as `docs/evidence/transcript-scroll-paging`: the real renderer,
served by the shipped dev desktop proxy, driven with real wheel events over CDP
against a real `local-operator serve` on an isolated `LOCAL_OPERATOR_CONFIG_DIR`
(`hosting: test`, `model_name: mock`), over a 620-row seeded session from
`scripts/seed-paging-session.mjs` — seven durable pages, where the previous
round's fixture had three.

Both arms are THIS tree (the folded tip); the two policy modules are swapped for
the `before` arm by `scripts/paging-evidence-arms.mjs`, which writes the ref's
bytes, asserts the swap by a symbol only the after arm carries
(`actFetchSpent`), runs the rig, restores in a `finally` and re-reads the
digests. Its stdout line is the swap's artefact:

```
paging-evidence-arms: restored=identical {"scroll-paging.ts":"2a5c4056b1111f36","use-scroll-paging.ts":"b375dea0a576d08e"}
```

`before-arm-record.json` carries the records; the before ref is `origin/main`
(`53ce0d4876` at capture time — the two modules are byte-identical to the ones
every earlier fold carried). The isolated backend was restarted between arms —
each page reload attaches a session-stream subscriber and one isolated backend
answers 409 after about ten, as the previous set's README documents.

Frames are named for the palette (`localOperatorDark.webp`), which is the
basename the evidence gate derives a theme from. One theme deep on purpose:
nothing under test is palette-dependent. Both arms were captured at the folded
tip, so the frames are the app as this revision ships it.

## The readings

Per scenario, both arms, from `before-measurements.json` /
`after-measurements.json` (620-row fixture, 489px client height, zone 320px):

| scenario (one act unless noted)  | before: req / reveals / on-approach | after: req / reveals / on-approach |
| -------------------------------- | ----------------------------------: | ---------------------------------: |
| `fast-fling-to-top`              |                             1 / 3 / 3 |                            0 / 2 / 1 |
| `fling-crossing-two-walls`       |                             1 / 3 / 3 |                            1 / 6 / 1 |
| `page-lands-with-rows-hidden`*   |                             2 / 7 / 7 |                            2 / 7 / 0 |
| `resting-finger-at-clamped-top`  |                             2 / 6 / 6 |                            1 / 6 / 1 |
| `slow-approach-into-zone`        |                             0 / 1 / 1 |                            0 / 2 / 2 |
| `continuous-train-beyond-the-lead` |                           0 / 0 / 0 |                            0 / 0 / 0 |
| `keyboard-home`                  |                             0 / 1 / 1 |                            0 / 1 / 1 |
| `scrollbar-drag-to-top`†         |                             0 / 0 / 0 |                            0 / 0 / 0 |
| whole run, all phases            |                19 `sessions.history` |                 9 `sessions.history` |

`*` two flings 400ms apart, i.e. two acts by `GESTURE_GAP_MS`. The table lists
this set's eight phase-2 scenarios; the whole-run row is the rig's own
`historyRequestsTotal` across every phase.
`†` coverage stated, not claimed — see Q1 above; the step records the measured
gutter (0), the selectable text runs (0) and its legs.

- **No mid-motion dispatch**: `on-approach` counts reveals dispatched while
  input was still arriving. It drops 3→1, 3→1, 7→0 and 6→1 in the scenarios
  that used to mount rows under a travelling viewport. The remaining 1s are the
  hard-top spend (the finger is still pushing but the content cannot move — the
  one case the terminal UI's edge spend also covers), not a projected arrival.
- **The reader's place holds**: `maxAnchorFrameDeltaPx` is **0** on both arms —
  the held row never moved a sub-pixel after the last input.
- **One act, one request at the wall**: `resting-finger-at-clamped-top` — 200
  notches at the clamp — spends 2 round trips on the replaced modules and **1**
  here; `page-lands-with-rows-hidden`'s two acts spend 2 on both arms.
- **No regression in the old ends**: `endsPinnedWithHiddenRows` is `false` in
  every scenario on both arms, and the parked reader is still answered (1
  request, not a freeze).
- **Scenario travel varies between runs of the synthetic fling**, which is why
  the claims above are the on-approach counts and the whole-run totals rather
  than any single no-fetch row: `fast-fling-to-top`'s after arm rode 2 reveals
  without reaching the wall in THIS run (a reader who stops outside the zone is
  spent nothing — rule 3 doing its job), while the previous revision's committed
  run reached it. The pure suite's cases pin the behaviour regardless.
- **`worstMsAfterArrival` is a scenario-timeline wait, not a fetch latency**:
  for each reveal, it is the time since the reader's own arrival at the wall —
  so `resting-finger`'s 6776ms includes the remaining notches of its deliberate
  200-notch push and the act's settle, and `page-lands`' 5135ms includes the
  deliberate 400ms gap between its two flings plus the second act that buys the
  second page. The numbers that discriminate this change are `revealsOnApproach`
  and `maxAnchorFrameDeltaPx`, not this one.

## The test runs, all shown

`scripts/transcript-paging.test.mjs` (39 cases) and
`scripts/transcript-paging-hook.test.mjs` (2 cases) were run against both
module sets, and the round-1 remediation carries its own two arms:

- `unit-tests-prefix.txt` — both files against `origin/main`'s two modules:
  **30 pass / 9 fail** and **1 pass / 1 fail** respectively. The 9 are the
  previous round's discrimination; the hook file's failure is F1's case, and
  F2's case passes on `origin/main` by design (the act budget it guards is this
  branch's).
- `unit-tests-postfix.txt` — against this branch's modules: **39/39** and
  **2/2**.
- `unit-tests-remediation-prefix.txt` — F1 and F2's own arms: the same files
  against `0ed7c7efb`'s modules (the state review round 1 measured), where F2's
  policy case and F1's hook case fail (38/1 and 1/1), and against the fixed
  modules, where both pass.

The lead-sensitive cases pass `travelVelocityPxPerMs` in their notches even
though this branch's policy no longer reads it; the replaced module does, and
without it the case would go red for the wrong reason (a missing field rather
than the behaviour under test). That is the same discipline the previous round's
cases used to discriminate against the module before the lead existed.

## What these frames do NOT prove

- The momentum tails are synthetic (a burst plus a time-bounded decaying tail),
  not a real trackpad. The previous set's caveat stands: native momentum and the
  ≤1px post-momentum tolerance remain measured on hardware only.
- **The pointer-drag clause is not covered**: a native scrollbar drag cannot be
  performed on this headless surface and the selection-drag substitute cannot
  start here (both measured — see Q1). The scenario records the attempts; no
  frame or number in this set depends on the drag having moved the reader.
- One theme, and the harness page replaces the Electron preload with a shim. The
  transcript, its reducer and the desktop transport are the real ones; the IPC
  transport is not exercised here (it is covered by `pnpm test:desktop`).
- The hard-top spend still dispatches while input is arriving, by design: the
  content is against its edge, so no mount can move under it. A reader who never
  pauses for `GESTURE_GAP_MS` and never reaches the wall waits for their first
  pause before the next chunk — the accepted trade, stated in the policy's
  rule 2.

## How to reproduce

```sh
# one isolated backend + a 620-row seeded session (never a live config dir)
node scripts/seed-paging-session.mjs "$SCRATCH/config" 620 "Scroll reveal probe 620"
LOCAL_OPERATOR_CONFIG_DIR="$SCRATCH/config" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" local-operator serve --host 127.0.0.1 --port 11411 &

# the renderer harness (port 5290 in this capture)
LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
  LOCAL_OPERATOR_DESKTOP_BACKEND_URL="http://127.0.0.1:11411" \
  VITE_LOCAL_OPERATOR_API_URL="http://127.0.0.1:11411" \
  npx vite --config scripts/submit-latency-evidence.vite.mjs --port 5290 --strictPort

# one arm at a time; restart the backend between arms (~ten reloads exhaust the
# isolated backend's subscribers, and it then answers 409 without saying so)
node scripts/paging-evidence-arms.mjs before origin/main -- \
  http://127.0.0.1:5290 <session-id> "$SCRATCH/rig-before"
node scripts/paging-evidence-arms.mjs after -- \
  http://127.0.0.1:5290 <session-id> "$SCRATCH/rig-after"
```
