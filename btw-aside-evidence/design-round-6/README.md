# Design round 6 — PR #482, the narrow-follow-up fix

Head driven: **`cf5a12f9557dd03e73c0f70fcd6b68196182f689`** (`origin/feat/btw-aside-panel`).
Delta since design round 5's head (`f105c9953`): the narrow-regression fix `39c8d8015`,
its docs re-stamp `284ae00d0`, and the two folds onto main (`a7df70995` → `5b82e0d43`,
`955de97ba` → `15abad9ce`, re-stamped `cf5a12f95`).

This round's purpose is a method correction as much as a check: design round 5 measured
the cap edge at exactly 10.0 line boxes on a head where the panel had stopped following
the newest turn, and did not report the narrow refusal it had actually recorded. See the
PR comment for which round-5 readings missed it.

## Layout

| path | what it is |
| --- | --- |
| `frames/<pass>/` | one PNG per capture, the app photographing itself (`webContents.capturePage`) |
| `logs/<pass>.out` | one full pass log: every `[PASS]`/`[FAIL]` with its JSON, every measurement note, and the proxy's counters at the end |
| `logs/driver-<pass>.txt` | the driver's own stdout for that pass |
| `logs/proxy-stats-<pass>.json` | the instrumented proxy's counters (aside POSTs, `aside_delta` frames per subscription) |
| `logs/held-leave.out`, `logs/held-stay.out` | main's own `scripts/session-switch-latency.mjs`, both arms, raw stdout |
| `rig/` | the whole rig: the capture script, the two runners, the driver patcher and the scene layer |

## Passes

| pass | scene | window | purpose |
| --- | --- | --- | --- |
| `d6clipnarrow` | `btw-r5-clip` | 800×900 | the exact scene that failed (refused + answered follow-up) |
| `d6clipwide` | `btw-r5-clip` | 1380×900 | wide unchanged |
| `d6narrow` | `btw-r6` | 800×900 | D11's four properties, adoption, bare `/btw`, streaming counters |
| `d6answer` | `d6-answer` (this round's) | 800×900 | the answered follow-up, sampled across the stream, framed |
| `d6capnarrow` | `btw-r6-cap` | 800×900 | 5 question/quote shapes × `PARAGRID1..9` = 45 cells |
| `d6capwide` | `btw-r6-cap` | 1380×900 | the same 45 cells at wide |
| `d6fold` | `btw-r7-fold` | 800×900 | the fold's arriving surface: a seeded tool row is labelled on open |
| `d6foldlive` | `btw-r7-fold` | 800×900 | the same at a 5× slower stream (the leave still could not be landed mid-turn) |

PASS/FAIL: `d6clipnarrow` 21/0, `d6clipwide` 21/0, `d6narrow` 32/0, `d6answer` 11/0,
`d6capnarrow` 14/0, `d6capwide` 14/0, `d6fold` 11/0, `d6foldlive` 11/0 — **135 PASS, 0 FAIL**.

## How it was run

    pnpm build                     # in a detached worktree at cf5a12f95, node_modules symlinked
    bash chain6a.sh                # the four behavioural passes
    bash chain6b.sh                # the two cap sweeps
    bash chain6c.sh                # d6-answer and the slow-stream fold

`bash run6.sh <scene> <pass> <window>` is one pass; `run6live.sh` is `run6.sh` with the
scripted provider's pacing exposed. Real daemon: the local-operator worktree at
`8fd404248` (the same tree QA round 7 drove — the companion backend PR is merged there);
scripted provider on an OS-chosen port; an instrumented proxy on 8080 (shared lock taken
and released by the capture script). Headless throughout (`--window-mode=headless`,
asserted in every pass), scratch `HOME`/`TMPDIR`/config, `GIT_CONFIG_SYSTEM=/dev/null`,
no `CMUX_*`/`LOP_*`; each pass asserts the app holds no connection to the operator's own
backend and that no process outlived its boot.

The four `held-*` arms are main's own committed rig (`scripts/session-switch-latency.mjs`
over `scripts/session-switch.vite.mjs` on port 5211), run in the same isolated
environment; it launches a private `--headless=new` Chrome with the repo's own
`withMockKeychain` switch.
