# Legacy goal-continuation rows: the pre-marker chrome, hidden on both transcript arms

The fix half of the pair [`../chat-harness-chrome-legacy-before/`](../chat-harness-chrome-legacy-before/).
The operator reported (2026-09-29) that goal-continuation messages
(`Continue working toward this goal: ...`) appeared as visible USER messages in
transcripts. The desktop already hid rows the harness stamps
(`provider_payload.harness_injected`), but a row written before that stamp
existed - and one still sent by an owner on an older build - carries no marker
to read, so it painted as the person's own words.

The fix: `src/renderer/src/features/chat/canonical/harness-chrome.ts` mirrors
core's own recogniser for the two goal families
(`local_operator/harness/rows.py::is_harness_chrome`, over
`session/goal_judge.py`'s continuation and `session/goal_loop.py`'s working
turn and fixed prompt), and `transcript-reducer.ts` applies it as a fallback -
only where the marker said no, on both the durable and the live arms. The
marker stays primary; core's contract keeps both halves ("the marker (and the
recogniser) remain the contract", `docs/DESKTOP_API.md`).

## The frames

```
stored-transcript/   2   the operator's case, the turn opened the way a reader reaches it
live-arrival/        2   the same unstamped row arriving live (`message_start`, no marker), at rest
typed-near-miss/     2   the control: the PERSON's own words - head but no tail - paints in both halves
multi-cycle/         2   the operator's real length: one ask, three (work turn, continuation) cycles, the answer
```

Each directory holds the two brand palettes (`localOperatorDark.webp`,
`localOperatorLight.webp`). The states are the production `CanonicalTranscript`
reading the production reducer (`applyHistoryPage` / `applyEvent`) over
`scripts/fixtures/harness-chrome-legacy.json`, via
`src/renderer/src/features/chat/canonical/harness-chrome-legacy.stories.tsx` -
no hand-set record. `multi-cycle` is the design round's D2: the operator's
transcript held ten continuation rows across repeated cycles, and the
repetition is the shape a folding fix breaks on.

## What moved

`magick compare -metric AE` of each pair, of 1,024,000 pixels (the viewport is
1280x800); the numbers are the round-1 re-taken set's:

| state             | dark    | light   |
|-------------------|---------|---------|
| stored-transcript | 106,473 | 103,720 |
| live-arrival      | 93,717  | 92,647  |
| typed-near-miss   | 0       | 0       |
| multi-cycle       | 316,222 | 304,115 |

The control is the pair's closest on purpose: byte-identical (`md5` equal, AE 0
in both palettes) across the halves, which is what a message the person typed
must be.

## Round-1 re-takes, and the capture hazard they hit

The design round asked for the stored pair re-taken (its dark half had caught
the older-history slot mid-load), the live pair matched, and a `multi-cycle`
pair added. All were re-captured narrow. What to know if you re-take any of
them: **the first shutter of a `capture-evidence.mjs` run can catch the
older-history slot in its transient loading state** ("Loading earlier messages"
with the spinner, and the turn's fold chip not yet painted), while every later
frame of the same run shows it settled as "Load earlier messages". The dark
stored frame was affected in both the first capture and the first re-take;
ordering the themes so the frame is not the run's first shutter, or re-taking
narrow until a crop against the settled reference matches, is what lands it
clean - the committed dark stored frames are of the settled state. The live
pair is now taken at rest (no in-flight turn): the live thinking counter ticks
with the capture's own wall clock (the halves read 1s against 4s before), so
with nothing in flight the row is the only thing the pair differs by.

## How these were captured

```sh
# this tree, at the apparatus commit (`d905144a8` carries the multi-cycle state)
node_modules/.bin/storybook dev -p 6214 --host 127.0.0.1 --ci --no-open
node scripts/capture-evidence.mjs http://127.0.0.1:6214 \
  --only=chat-harness-chrome-legacy \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=300000
# narrowed re-takes, e.g. one surface with the themes ordered light-first:
node scripts/capture-evidence.mjs http://127.0.0.1:6214 \
  --only=chat-harness-chrome-legacy --dirs=stored-transcript \
  --themes=localOperatorLight,localOperatorDark \
  --allow-backend --theme-settle-ms=300000
```

The before half is [`../chat-harness-chrome-legacy-before/`](../chat-harness-chrome-legacy-before/),
which carries the throwaway-checkout recipe in its own README;
`docs/evidence/manifest.json` declares it as a supplementary set with its own
`source` and `capturedAtHead`, and `captureOrigin.harnessChromeLegacyPass`
records both runs.
