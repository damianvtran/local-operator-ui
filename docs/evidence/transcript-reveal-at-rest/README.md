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
   mid-motion displaced the view by the mount's own height — 6966px in one
   sampled frame pair — before the anchor hold restored it, and the terminal UI
   this surface is asked to match defers its checks while the scroller animates.
2. **One round trip per act** (`actFetchSpent`): a fling that crosses two walls
   spends once; the next chunk needs a fresh act (`GESTURE_GAP_MS` of quiet and
   a new push) or the affordance. Local widens are not budgeted — they show the
   reader rows already in hand.

## What produced these frames

The same rig as `docs/evidence/transcript-scroll-paging`: the real renderer,
served by the shipped dev desktop proxy, driven with real wheel events over CDP
against a real `local-operator serve` on an isolated `LOCAL_OPERATOR_CONFIG_DIR`
(`hosting: test`, `model_name: mock`), over a 620-row seeded session from
`scripts/seed-paging-session.mjs` — seven durable pages, where the previous
round's fixture had three.

Both arms are THIS tree; the two policy modules are swapped for the `before`
arm by `scripts/paging-evidence-arms.mjs`, which writes the ref's bytes, asserts
the swap by a symbol only the after arm carries (`actFetchSpent`), runs the rig,
restores in a `finally` and re-reads the digests. Its stdout line is the swap's
artefact:

```
paging-evidence-arms: restored=identical {"scroll-paging.ts":"7198d678812f05fc","use-scroll-paging.ts":"4e2a89ea0ce49674"}
```

`before-arm-record.json` carries the records; the before ref is `origin/main`
(`939b7ed48`). The isolated backend was restarted between arms — each page
reload attaches a session-stream subscriber and one isolated backend answers
409 after about ten, as the previous set's README documents.

Frames are named for the palette (`localOperatorDark.webp`), which is the
basename the evidence gate derives a theme from. One theme deep on purpose:
nothing under test is palette-dependent.

## The readings

Per scenario, both arms, from `before-measurements.json` /
`after-measurements.json` (620-row fixture, 489px client height, zone 320px):

| scenario (one act unless noted)  | before: req / reveals / on-approach | after: req / reveals / on-approach |
| -------------------------------- | ----------------------------------: | ---------------------------------: |
| `fast-fling-to-top`              |                             0 / 1 / 1 |                            1 / 4 / 1 |
| `fling-crossing-two-walls`       |                             2 / 5 / 2 |                            1 / 4 / 1 |
| `page-lands-with-rows-hidden`*   |                             2 / 6 / 6 |                            2 / 8 / 1 |
| `resting-finger-at-clamped-top`  |                             1 / 4 / 4 |                            1 / 6 / 1 |
| `slow-approach-into-zone`        |                             0 / 2 / 2 |                            0 / 2 / 2 |
| `continuous-train-beyond-the-lead` |                           0 / 0 / 0 |                            0 / 0 / 0 |
| `keyboard-home`                  |                             0 / 1 / 1 |                            0 / 1 / 1 |
| `scrollbar-drag-to-top`          |                             0 / 0 / 0 |                            0 / 0 / 0 |
| whole run, all phases            |                16 `sessions.history` |                10 `sessions.history` |

`*` two flings 400ms apart, i.e. two acts by `GESTURE_GAP_MS`. The table lists
this set's eight phase-2 scenarios; the whole-run row is the rig's own
`historyRequestsTotal` across every phase, which is what moves 16 -> 10.

- **One fling, one request**: `fling-crossing-two-walls` — the scenario built to
  cross two walls inside one act — spends **2** round trips on the replaced
  modules and **1** here. That is the operator's chain, counted.
- **No mid-motion dispatch**: `on-approach` counts reveals dispatched while
  input was still arriving. It drops 6→1 and 4→1 in the scenarios that used to
  mount rows under a travelling viewport. The remaining 1s are the hard-top
  spend (the finger is still pushing but the content cannot move — the one case
  the terminal UI's edge spend also covers), not a projected arrival.
- **The reader's place holds**: `maxAnchorFrameDeltaPx` is **0** on both arms —
  the held row never moved a sub-pixel after the last input. With the mid-motion
  mounts gone, every mount left in this set happens at a stop, so the corrections
  are same-frame and invisible rather than a 6966px frame followed by a restore.
- **No regression in the old ends**: `endsPinnedWithHiddenRows` is `false` in
  every scenario on both arms, and `resting-finger-at-clamped-top` still answers
  its parked reader with a page (1 request) rather than freezing.

## The test runs, both shown

`scripts/transcript-paging.test.mjs` was rewritten around the two stops that
remain. The new and rewritten cases were run against BOTH modules:

- `unit-tests-prefix.txt` — the new test file against `origin/main`'s two
  modules: **9 fail**, including both headline cases
  (`no reveal is dispatched while the viewport is travelling`,
  `a fling that crosses two walls spends exactly one fetch`) plus
  `a fast train is spent at the wall, never mid-motion` and
  `a slow approach inside the zone is spent once it settles there`.
- `unit-tests-postfix.txt` — against this branch's modules: **38/38 pass**.

The lead-sensitive cases pass `travelVelocityPxPerMs` in their notches even
though this branch's policy no longer reads it; the replaced module does, and
without it the case would go red for the wrong reason (a missing field rather
than the behaviour under test). That is the same discipline the previous round's
cases used to discriminate against the module before the lead existed.

## What these frames do NOT prove

- The momentum tails are synthetic (a burst plus a time-bounded decaying tail),
  not a real trackpad. The previous set's caveat stands: native momentum and the
  ≤1px post-momentum tolerance remain measured on hardware only.
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
