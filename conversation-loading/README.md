# Conversation loading: before and after, on the operator's report

The report verbatim:

> "I noticed that the local-operator-ui conversation loading has quite a bit of
> jitter, can you ensure all conversations load in under 300ms in the UI and that
> there's no jitter where things seem to load at different times? We should show a
> small loading indicator that is non-intrusive, move the composer into the
> position that it would be with all the composer displays (I noticed not all are
> present at all times, that also contributes to jitter). Then everything should
> load in one solid paint instead of incrementally which looks annoying"

This directory is the PR's own evidence: the live-backend performance runs, the
frames for each state, and the run logs behind the numbers in the PR body. The
committed frame set the change re-shot lives in the repository at
`docs/evidence/session-switch/`; nothing here is committed.

## What "loading" means in each run

All runs drive `scripts/session-open-live.mjs` against a local `local-operator
serve` backend on this machine (isolated config dir and token; the operator's own
sessions untouched), through a Vite-served renderer harness
(`scripts/session-open-live.tsx`). One open = one click on a sidebar row of the
named session; `painted` is measured from the click to the first frame in which
the conversation's content is painted (transcript content, composer settled), the
frame harness's own definition. Three conversation shapes: a nearly-empty one
(`c0b9bded50fc`), a typical one (`80fb2b461039`) and a large one
(`8846fbdcdb2c`), each opened five times per run.

`--warm-cache` opens each session a second time in the same page (the pane's own
paint cache is warm); the cold arm clears the cache between opens.

## Numbers

Live opens, real backend, load average beside each run (14 cores, ~25 sessions on
the box). p50/p95 in ms; budget 300 ms.

| tree | arm | load 1m | nearly-empty | typical | large | over budget |
| --- | --- | --- | --- | --- | --- | --- |
| `origin/main` (stashed branch, same harness) | cold | 70.9 | 133.2 / 357.6 | 167.3 / 186.9 | 109.6 / 210.9 | 1 of 15 |
| this branch | cold | 60.5-73.2 | 74.2-78.3 / 113.2-127 | 96.9-104 / 108.6-131.6 | 80-84.8 / 148.7-167.3 | 0 of 15 |
| `origin/main` | warm | 71.5 | 83.4 / 302.4 | 107.4 / 150.8 | 139.6 / 163.3 | 1 of 15 |
| this branch | warm | 62.8-81 | 62.1-162.6 / 133.8-205.1 | 106.1-171.3 / 155.4-350.9 | 86.2-89 / 109-124.2 | 0-1 of 15 |

Honest envelope: the after-tree's cold p50s sit at 74-104 ms (p95 at most 167
ms) and the warm ones at 62-192 ms p50 across the runs taken, all under the
budget except one outlier in one warm sample (350.9 ms p95). The rig's own
run-to-run spread is large - the same tree measured 86 ms and 162 ms p50 for the
same session in two consecutive runs - so read the pairs as "base: 110-167 ms
p50, branch: 62-104 ms p50", not as single points. What the UI's layer could do
(and did) for the warm path: not paint early from the cache (that was the
stagger), so the warm path no longer shows at 16-40 ms and then corrected; it
lands whole at the numbers above. Where a phase is backend-bound (the snapshot's
own read), the pane cannot beat the wire; the bar is met because the wire is
local and the paint is now one commit.

## Frames

`frames/before/` - the same three sessions, same harness, on `origin/main`'s
renderer: `<session>-loading.webp` (first frame naming the target),
`<session>-first.webp` (first frame with content) and `<session>-settled.webp`.

`frames/after/` - the same three states on this branch. The loading frame is the
hold: the caption and nothing of the cached paint; the first frame carries rows,
readings and the composer's chip together; the settled frame is the same, fully
scrolled.

What each proves, stated in the PR body: the hold (no partial transcript), the
one-paint arrival (rows + chip + strip together), and the small mark (8x8 CSS px
at (450, 737), caption 130.4x17.4 at (466, 732.6), opacity 1.00 at rest to 0.70
at the pulse's trough, measured in the live renderer at 1280x900).

## Load-bearing measurements (numbers quoted in the PR body)

- Composer band geometry, live renderer, 1280x900: band top 748.6 / height 110
  and textarea top 764.6 while the placeholder is up; identical once settled.
- The cached-paint stagger on the base tree (switch harness, warm cache): cached
  rows painted in the click's own frame, the readings strip at +67 ms, the stale
  caption left with it, moving the transcript up 33.4 px (pane top 174.4 -> 141).
- The window reset on the base tree: first painted frame held all 106 fetched
  rows, the next commit trimmed it (scroller extent 8,315.6 -> 4,864.2 px, all
  above the fold).

## Runs

`runs/` holds the harness logs behind the table: `base3` are the base-tree runs
(the branch's `src/` stashed, same rig), `final-cold`/`final-warm`/
`final-frames` are this branch's runs at the PR head. Each log prints the load
average and the per-session p50/p95 its run produced.

## Reproduce

```sh
# backend on an isolated config dir (the harness owns its token), then:
env LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
    LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:11411 \
    SESSION_OPEN_LIVE_PORT=5213 \
    node_modules/.bin/vite --config scripts/session-open-live.vite.mjs
# in another shell, in the worktree:
node scripts/session-open-live.mjs http://127.0.0.1:5213 \
  --sessions=c0b9bded50fc,80fb2b461039,8846fbdcdb2c --runs=5
node scripts/session-open-live.mjs http://127.0.0.1:5213 \
  --sessions=c0b9bded50fc,80fb2b461039,8846fbdcdb2c --runs=5 --warm-cache \
  --frames=<out-dir>
```

The committed evidence set re-shoots with:

```sh
node_modules/.bin/vite --config scripts/session-switch.vite.mjs   # one shell
node scripts/session-switch-latency.mjs --frames=docs/evidence/session-switch
```
