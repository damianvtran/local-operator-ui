# PR #490 — round-2 design review evidence

Orphan branch: none of this is in the PR's diff and none of it is committed to
`main`. Frames are PNG captures (`webContents`-side CDP `Page.captureScreenshot`)
from the built app; the JSON beside each is the run's own record — the request
log, the per-sample object-column counts, the per-row state trace, and the
geometry. No file here carries an absolute path.

## What this round is about

The only behaviour that changed between the round-1 head `d2975e6f5` and the
round-2 head `f1ef98c4c` is the first-paint hold: it now ends when the first
label read **settles** (answered or failed), or after `LABEL_HOLD_MAX_MS`
(3 000 ms), whichever comes first. Round 1's design verdict on the pending
(empty) object column was TERMINAL; this round confirms that one behaviour in
rendered frames and re-checks the switch-back case, and re-audits nothing else.

Round 1 measured the old hold only as a stall (`hang-labels-dark.json`, 26 rows
objectless from t=134 ms to t=40 126 ms) and the PR body's "What this does not
prove" records that the cap itself was driven with **fake timers** in the hook
harness, never against a wedged owner in the app. `hang.json` below is that
missing run: a `/history` request that is accepted and never answered, in the
built app.

## How the runs were made

The head was built in a worktree of its own (`pnpm build`, Electron 44.3.0 — the
version `package.json` `optionalDependencies.electron` pins) and booted
**headless**, never shown and never activated:

```
env -u NODE_TEST_CONTEXT -u XPC_FLAGS -u CMUX_WORKSPACE_ID -u CMUX_SESSION_ID \
  TERM=xterm-256color FIXTURE_TREE=<tree> LOCAL_OPERATOR_SCRATCHPAD=<scratch> \
  node design-rig-r2.mjs --tree <tree> --label <label> --scene <open|switchback> \
    [--hang | --fail] [--delay <ms>] --loop-ms 60 --shots <t,t,t> \
    --out <dir> --port <scratch port>
```

`--hang` holds every durable read unanswered; `--fail` answers them 500 in 60 ms;
`--delay` is the tail read's answer delay; `--scene switchback` leaves the
conversation (changing the session id in the hash, which unmounts the pane) and
returns. The app talks to a stub backend that serves the PR's own sanitized
fixture (`scripts/fixtures/seed-label-gap.json`) the way a runtime serves a
viewer joining mid-turn: an `open` + `snapshot` SSE frame whose page is the
journal's newest 100 entries, plus a `/history` route with the backend reader's
semantics (no cursor = tail, `before_id` exclusive, `has_more`). Every history
request is logged with its time, `limit`, cursor, row count and answer time.

Isolation per run: its own scratch `HOME`, config dir, `--user-data-dir`, log dir
and cwd; `CMUX_*`/`LOP_*`/`XPC_*` stripped; notifications and telemetry off; the
backend manager disabled; the app reaped by process group and by its own profile
path. No live session, store or backend was touched, and every run was
`[window-mode] window mode headless: 1380x900, window created and never shown`.

The viewport that window gives is **1380x868 CSS at devicePixelRatio 2**, which
is what the frames are (2760x1736 px), theme `localOperatorDark`.

| run | case | record |
| --- | --- | --- |
| `normal` | tail read answers at 1 532 ms | `runs/normal.json` |
| `hang` | read accepted, never answered | `runs/hang.json`, row rects in `runs/hang-row-rects.json` |
| `slow` | tail read answers at 3 432 ms — after the cap | `runs/slow.json` |
| `fail` | both reads 500 at 88 / 153 ms | `runs/fail.json` |
| `switchback` | leave and return, no `frame` alignment | `runs/switchback-first-attempt.json` |
| `switchback` (aligned) | leave and return, then the scroller is set to the offset the open settled at | `runs/switchback.json` |

`summarize.py` prints the readings below from any record.

## What the frames show

| frame | state |
| --- | --- |
| `hang-cap-02900-held-blank.png` | held: 26 of 58 rows have an empty object column, t=2 914 ms |
| `hang-cap-03100-cap-fired-standin.png` | the cap fired: the same 26 rows, stand-ins, t=3 242 ms |
| `slow-cap-02900-held-blank.png` | held, t=2 941 ms |
| `slow-cap-03100-cap-fired-standin.png` | cap fired, t=3 277 ms (the read is still in flight) |
| `slow-cap-03600-read-answered-label.png` | the read answered at 3 432 ms: real labels, t=4 002 ms |
| `normal-cap-01200-held-blank.png` | held, t=1 245 ms |
| `normal-cap-01700-answer-arrived-label.png` | the answer released the hold: real labels, no stand-in ever, t=2 211 ms |
| `fail-cap-00300-first-paint-already-standin.png` | the read failed at 88 ms: the first frame (96 ms) is already stand-ins, 0 blank |
| `switchback-03-open-settled.png` | the open, settled |
| `switchback-06-return-first-paint.png` | the first sample after the return: 58 rows, 0 blank, 0 stand-in |
| `switchback-08-return-aligned-to-open-offset.png` | the return, at the open's own scroll offset |

The object column goes from **0 ink bands to 48** (26 rows × two ink runs) inside
the seeded band between two consecutive samples on the cap path, and the geometry
recorded with each sample is a single distinct tuple — `(first row top 170.9,
scrollHeight 1473, scrollTop -877)`, row heights all exactly 20 px and the object
cell exactly 600 px wide — across every sample of every run, including across the
release.

## Cross-run identity (md5 of the finished frames)

| md5 | frames | what it means |
| --- | --- | --- |
| `c36ad025…` | `hang-…02900`, `normal-…01200`, `slow-…02900` | the held state is byte-identical in three independent runs |
| `e337e8c1…` | `hang-…03100`, `slow-…03100` | the cap-fired state is byte-identical in two runs |
| `5081644119…` | `normal-…01700`, `switchback-03`, `switchback-08` | the settled labelled state is byte-identical to the return's, once the return is read at the open's own offset |

`slow-cap-03600-read-answered-label.png` differs from `normal-cap-01700…` in **6
pixels of 4 791 360** (antialiasing in the elapsed-time column; the two runs
photographed the settled state a second apart).

## Reclaiming

The worktree, its build, the scratch trees and the frames all live outside the
repository (`LOCAL_OPERATOR_SCRATCHPAD`) and are removed at the end of the round;
only this ref is kept.
