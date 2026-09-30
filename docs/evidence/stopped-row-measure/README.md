# `stopped-row-measure` — the stopped turn's line, at the edge it must share

The operator report this directory photographs (2026-09-27): a cancelled turn's
"Stopped · Retry" line renders at the chat column's far-left edge instead of
inside the conversation's shared measure — 86px left of the composer box at a
1120px column, while every other surface centres.

## The mechanism

`CHAT_MEASURE` (`src/renderer/src/features/chat/chat-measure.ts`) resolves the
conversation's shared 900px measure through CONTAINER-QUERY variants keyed to the
named `chatcol` container (`@min-[750px]/chatcol:…`). A surface whose wrapper
declares no such container matches NEITHER variant — it keeps `w-full` and paints
at the column's 24px inset — while a surface that declares one caps at 900px and
centres. The stopped row was the one consumer whose wrapper never declared it;
the dock above it and the composer band below it both do. The fix is one class on
that wrapper (`CHAT_COLUMN_CONTAINER`), beside the rig handle the measurement
needs (`data-lo-composer-measure` on the composer box).

## What the frames and the records show

`scripts/interrupt-esc-proof.mjs` presses the composer's Stop control and then
Escape against turns that are genuinely running (the backend's mock provider
runs a real `sleep 45`), in the BUILT app, headless, on an isolated profile and
config dir — the setup is `docs/evidence/interrupt-live/README.md`'s. As of this
set the rig also reads §G3's line and the composer box off the app's own DOM and
claims their left edges agree within 2px (`stopped.*` steps in each record).

| arm | window | column | container | line left | composer box left | Δ | claim |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `before/default` | 1380x900 | 1120 | 1072 (binds) | **284** | **370** | **-86** | ok:false |
| `after/default` | 1380x900 | 1120 | 1072 (binds) | 370 | 370 | 0 | ok:true |
| `before/narrow` | 820x900 | 764 | 716 (below 750) | 80 | 80 | 0 | ok:true |
| `after/narrow` | 820x900 | 764 | 716 (below 750) | 80 | 80 | 0 | ok:true |

At the standard width the defect is the -86px step and the fix is its absence.
Below the measure's 750px threshold no cap can bind, so BOTH surfaces must hug
the column's inset (column + 24px) — the guard for the width where centring must
NOT happen, which a fix that centred unconditionally would break.

The frames carry the same readings in pixels (2x): the line's first painted
pixel is x=570 (285 logical) in `before/default` against the composer box's
x=740 (370 — the box border's own step from canvas, read by a column scan) and
x=742 (371) in `after/default` against the same 740. At 820 wide every arm reads
x=162 (81) against 160 (80). The 1px between a box's left edge and its text's
first lit pixel is the glyph's own side bearing.

The narrow arm's escape-path read is the one exception, and it is the
instrument's, not the layout's: in that take the line did not arrive at all
(`turn2.readsAsStopped` fails on the same absence, and that claim predates this
change), so the escape-path claim fails on `line: null` rather than on a
misalignment. The below-threshold guard rests on the Stop-path reading, which is
the same claim the narrow run exists for.

## Instrument note

The rig's older, timing-based claims read state a fixed wait after an input;
under this host's fleet load a read can outrun its wait. Across the seven takes
this change made (both trees, two widths), four takes carried one such failure
each — `slot.livePressStartsRecording` (twice), `slot.graceIsTheBusyRow` +
`slot.settledCollapses` (once), `turn2.readsAsStopped` (once) — and two of those
land in the committed records (`before/default`, `before/narrow`). The
`stopped.*` reads are DOM rectangles taken once the line is on screen and
reproduced identically in every take that reached them; the two `after` arms
carry no other failure at all.

## Reproducing

Backend and app setup: `docs/evidence/interrupt-live/README.md` ("How to re-run
it") — an isolated config dir, an invented bearer, `values: hosting: test` /
`model_name: mock`, the placeholder `RADIENT_API_KEY` PATCH, and the worktree's
`.env` pointed at the run's backend before `pnpm build`.

```sh
LO_PROOF_TOKEN=… LO_PROOF_BACKEND=http://127.0.0.1:1131 \
  node scripts/interrupt-esc-proof.mjs <out-dir>              # the standard width

LO_PROOF_WIDTH=820 LO_PROOF_TOKEN=… LO_PROOF_BACKEND=http://127.0.0.1:1131 \
  node scripts/interrupt-esc-proof.mjs <out-dir>              # below the threshold
```

`LO_PROOF_WIDTH` re-runs the same rig at another window width. The
below-threshold run needs a width under ~854: below the sidebar's 1024px dock
gate the rail is 56px, so the column is `width - 56` and the container is 48px
inside that. The claim and its numbers live in `<out-dir>/interrupt-proof.json`
(`stopped.geometryAfterStop` / `stopped.geometryAfterEscape`, and the two
`…MeetsTheMeasure` claims).
