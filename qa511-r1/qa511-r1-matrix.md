### QA report — round 1

**Reviewer:** qa-tester (Local Operator team `lopdev`, independent of the author), model `deepseek/deepseek-flash`. **Provider fallback, disclosed:** this session began on `anthropic/claude-opus-5-5` and was switched to `deepseek/deepseek-flash` mid-pass when that quota ran out; the whole app-side pass after the build ran on the fallback model. I edited, committed and pushed nothing on this branch.
**Scope:** `c44d29c34..0eb887f58`. Head pinned with `gh pr view 511 --json headRefOid` = `0eb887f580f85c38ed82f4a03a86d0746f5da3c8` before the pass and re-checked before posting; base `c44d29c34ae3ef0e2d4dd5213d4bfd622b4ada84` was `origin/main` at the start of the pass (`git rev-parse origin/main`, 10:08).

**Verdict: PASS.** The reported flow reproduces on the parent head and is fixed on this head, in the shipped app, with the numbers below. No FAIL on any row. Three informational notes (Q1–Q3) are recorded — none blocks the merge.

Independent pass by the `lopdev` team's qa-tester. Harness: my own rig (`rig511.mjs`, the PR-490 r7 rig's
infrastructure with this round's runner body), driving the BUILT app headless over CDP
against a stub backend that serves a COPY of the operator's conversation
`b747a2c8d3bb`, cut at row 1052 (the cut the PR's own reproduction uses).

## Command shape for every row

```sh
env -u XPC_FLAGS python3 bounded.py 300 "$S" node "$S/rig511.mjs" \
  --tree ~/local-operator-ui-worktrees/qa511r1-9f3c-<head|prev> \
  --label <head|prev> --scen "$S/scen511/<scenario>.json" --out "$S/out" --port 46731
```

- head = `0eb887f580f85c38ed82f4a03a86d0746f5da3c8`; prev = `c44d29c34ae3ef0e2d4dd5213d4bfd622b4ada84`
  (= `origin/main` at the start of the pass, verified with `git rev-parse origin/main`).
- Stub: SSE `open` + `snapshot` (`cold_reason: null`, page = journal tail 100 rows,
  seed = the newest 100 `tool_execution_end` frames, each carrying its call's start
  instant and no arguments, built the way `local_operator/session/frontend_state.py`
  builds them), `/history` with the route's own semantics (`before_id` exclusive,
  `has_more`), live `event` frames pushed on demand. Every request is logged with the
  row range it answered, so "the app never held this call's arguments" is a wire
  reading rather than an inference.
- App: built headless (`--window-mode=headless`), scratch `HOME`/`TMPDIR`/
  `LOCAL_OPERATOR_CONFIG_DIR`/`--user-data-dir`/log dir/cwd, env allow-list (no
  `CMUX_*`, `LOP_*`, `XPC_*`), window 1380x900.
- Data: the operator's session directory was read once and copied into my scratch;
  the stills published here are re-captured from a byte-structurally-identical
  SANITIZED twin (same rows/ids/args shape, synthetic text), never the real text.

## Matrix

| # | surface | scenario | head (`0eb887f58`) | prev (`c44d29c34`) | verdict |
|---|---|---|---|---|---|
| 1 | re-open mid-turn, a call settles LIVE (clocked frame) | `r1-live-settle` | **2 reads** after the push (312-row tail, then 104 rows 637-740 which NAME the call), row labelled with its command; frame-accurate latency to the naming page **+1044 ms**; `readsFromScroll: 0` when the row is mounted | **0 reads**; the row stays mounted showing `… 07:37:58 config.yml` (the call's OUTPUT) for 714 consecutive frames | **PASS (bug reproduced on prev, fixed on head)** |
| 1b | same, clockless frame (a call whose start the runtime never saw) | `r1b-live-settle-noclock` | 2 reads, row labelled; latency to the naming page **+1545 ms** | 0 reads; stand-in held 717 frames | **PASS** |
| 2 | long turn, TWO settles in a row, no durable `turn_end` | `r2-long-turn` | settle 1 → 2 reads (the page carries BOTH calls); settle 2 → **0 further reads** (its args were already held) and its row is labelled with its command; no scroll, no re-open | both rows mounted with output stand-ins, **0 reads** | **PASS** |
| 3 | cost over N settles (N=6) | `r3-cost` | **3 requests total** for the whole session = 1 open + 2 walk (312 + 104, naming all six); all six rows labelled; `readsFromScroll: 0` | 1 request (the open); six stand-ins | **PASS** |
| 3b | an ordinary open with nothing left to label | `r3b-open-nothing-to-label` | exactly **ONE** request (limit 104, tail) | exactly **ONE** request (limit 104, tail) | **PASS** |
| 4a | open mid-turn: first paint must show 0 output stand-ins | `r4a-open-midturn` | first frame 54 rows, **0 stand-ins, 19 label-pending blanks**; settles to 46 rows 0/0; 1 read | identical (54 rows, 0/19) | **PASS** |
| 4b | switch away and back x6, history frozen | `r4b-switch-loop` | 6/6 returns: 0 blank, 0 stand-in, 0 reads during cycles; frame runs alternate `d3bb,46,0,0` / `ther,46,0,0` | identical | **PASS** |
| 4c | hung read — columns must fall back ~3 s | `r4c-hung` | 19 blanks from t=232 ms fall back to stand-ins at **t=3229 ms**, read still unanswered | fallback at t=3114 ms | **PASS** |
| 4d | finished conversation | `r4d-finished` | **0 reads**; 36 rows, 1 stand-in (a journal call that genuinely has no arguments anywhere) — unchanged | identical | **PASS** |
| 4e | a call with genuinely no arguments anywhere | `r4e-noargs` | keeps its stand-in (mounted, 676 frames); pays a bounded walk: **3 requests / 500 rows** then drops the call | keeps the same stand-in; **0 requests** | **PASS (bounded cost, see Q2)** |
| 4f | edit rows keep `+N −M`, diff expands | `r4f-edit` (journal has no edit call; one appended in the wire's shape) | first paint `+91 −19`; expand → `@@ -1,3 +1,7 @@`, 6 `+` lines, 4 `−` lines, row height 20 → 236 | identical | **PASS** |
| 5 | adjacency: job roster in the snapshot, no job frames at all | `r5-adjacency` | rows still settle and label (2 settles: 2 reads then 0, both rows labelled); no new routes requested vs prev | rows keep stand-ins, 0 reads | **PASS for the row half; job/subagent half PARTIAL — see Q3** |

## Row 1 in detail (the reported flow)

Conversation = the operator's `b747a2c8d3bb`, cut at row 1052, turn opening at row 540,
seed window = the newest 100 settled ends (result rows 752..1051), page = rows 953..1052
(100 rows). The open reads 312 rows (rows 741..1052) — that is the app's own label read
for the seed, and it does NOT name the target (asst row 685 / result row 686).

- **prev**: after the live `tool_execution_end` at t=3503 ms there is **not one** further
  request — total requests for the session: 1. The row is mounted in the live view and
  shows `… 07:37:58 config.yml` (the command's first output line) for the remaining 714
  sampled frames. Screenshot: `prev-r1-live-settle-san-03-after-settle.png`.
- **head**: the same frame fires two requests — the 312-row tail page, then 104 rows
  (journal rows 637..740) which carry the call's assistant row (the wire log's
  `has_target` shows it). The row's object column becomes the command
  (`cd ~/.local-operator && ls -la --time-style=+%H:%M:%S config.yml mcp_cache.db …`) —
  read back from the DOM with `labelled: true, standIn: false`, and mounting it costs
  **zero** further requests (`readsFromScroll: 0`), i.e. the label came from the settle's
  own read and not from the observation scroll. Screenshot:
  `head-r1-live-settle-san-04-post-scroll.png`.

Latency, from the push instant to the page that names the call being answered:
635 ms–1044 ms across the four head runs (r1 1044 ms; r1b 1545 ms; r3 768 ms;
r5 798 ms) at host load 100-140/14 cores, with a 300 ms stub delay on every answer.

**A bound worth stating (not a defect):** the fix asks, but the walk is the same bounded
one the seed path uses (500 rows / 6 requests). A first cut of this matrix used targets
at journal rows 552-609 — 443-500 rows above the tail — and the walk stopped exactly one
row short of the assistant row (500 rows read), so those rows kept their stand-ins on BOTH
heads. The PR's own reproduction says the depth needed was 302 rows; QA confirms the
boundary empirically at 500.

## Row 2 in detail (the 17-hour turn)

No `turn_end` is ever sent (the reported turn sends none). Two live settles 14.6 s apart:
the first costs 2 requests and delivers both calls' arguments (its page names both); the
second costs **0 further requests** and its row is labelled with its command when mounted
(`labelled: true`), with no scroll and no re-open — which is the requirement this row
states. prev: both rows sit in the live view with their output lines and the session makes
exactly one request in total.

## Row 3 in detail (the cost)

- Six settles: 3 requests for the whole session (1 open + 2 walk). All six rows labelled;
  mounting them costs 0 further requests.
- An open whose seed names only calls the snapshot's page already carries: **exactly one
  request** (limit 104, tail) on both heads — the ordinary open's own read, unchanged.
- A call that has no assistant row anywhere: the walk spends its full bound once
  (3 requests, 500 rows) and the row keeps its stand-in; prev spends nothing. That is the
  PR's stated design ("spends at most its two attempts and is dropped"); QA's number for it
  is 3 requests, and it does not repeat.

## Row 5 / Q3 (the adjacency)

The drops are a BACKEND behaviour: `local_operator/session/runtime/server.py:637` relays
a degraded placeholder (`{epoch, sequence, degraded: true, degraded_reason}`) instead of
killing the connection when a frame crosses the 1 MiB socket line limit, and the attached
viewer logs `owner degraded canonical delta … (A live update was too large to send and was
dropped; the view refreshes from the session's own history.)`.

Measured in the retained logs (`~/Library/Application Support/Local Operator/logs`):

- 4,281 of those placeholder lines in total; per session: **`d81d04d3fd9c` 3,479**,
  `112979d41ccd` 585, `70ddfaaf163a` 208, **`b747a2c8d3bb` 5**, `835fbcafdc27` 4.
- The runtime-side line (`session runtime: frontend_update frame is N bytes, over the
  N-byte socket line limit`) is NOT in the retained logs — they have rotated — so the
  4,240 figure in the brief could not be re-derived here; for THIS conversation the
  retained evidence is 5 placeholders, not 4,240.
- Roster sizes from the copy: `jobs` 119,377 bytes (3 jobs); `records` 1,963,114 bytes;
  `accounting` 1,456 bytes; the whole roster 2,084,021 bytes — i.e. the frame that carries
  it is 2.0x the 1 MiB line, not 1.16x.

App-side: with a job roster in the snapshot and NO job frames afterwards, both heads
settle and label tool rows identically to row 2 (head 2 reads then 0; prev stand-ins,
0 reads), and head requests the same routes as prev (`POST /v1/desktop/radient`,
`GET /v1/agents`, `GET /v1/desktop/commands`, `GET /v1/credentials`,
`GET /v1/desktop/sessions/<id>/{command-entities,mcp}` — all unimplemented in my stub,
identical on both heads). So no tool row fails to settle because of a dropped
`frontend.update`. **The "does the app visibly lose job/subagent state" half is PARTIAL:
answering it needs the real backend's drop path (or a bridge that translates the degraded
placeholder), which this rig does not host — I measured that the app paints the same with
and without the roster, not what it does at the moment a real frame is shed.**

## The repo's own gate, checked independently

- `node --test scripts/seed-label-gap.test.mjs scripts/evidence-manifest.test.mjs` on the
  head worktree: **59 pass, 0 fail, 1 skipped** (the new case `a live settle with no start
  asks for the page that carries its command` passes).
- The same test file, copied onto the PREV worktree (where the case does not exist) and run
  against the base source: **23 pass, 1 fail** — `AssertionError: and a read labels it` on
  that case. The test discriminates; the copy was removed afterwards and the prev worktree
  is clean (`git status --porcelain` = 0 entries).

## Q-findings (informational — no FAIL)

**Q1 (info) — the transient live row.** On this head a live settle whose durable rows the
walk fetches paints at the live end for ~1.3 s and is then re-placed at its true position,
which for a call that ran 300–500 rows above the tail is outside the mounted window: the
sampler reads 3 frames absent → 39 blank → 41 stand-in → absent (r1, head), against prev's
standing `… <output>` that never leaves. The row's final state is correct and mounting it
costs no read, so this is the intended correction rather than a defect — recorded because
it is a visible change of behaviour on the live tail (a row that used to stay put now
moves), and the design/UX review may want to say whether that transient should be smoothed.

**Q2 (info) — the bounded walk's cost for an unlabelable call.** A call with no assistant
row anywhere now costs one bounded walk (3 requests / 500 rows, measured) where the parent
head spent nothing, and the row keeps its stand-in. That is the PR's own stated bound
(`LABEL_GAP_ATTEMPTS`, dropped after the budget); QA's number is 3 requests, once.

**Q3 (info, adjacency) — see above:** the `frontend.update` drops are a backend behaviour I
verified in the runtime source and in the retained logs, but the 4,240 figure in the brief
could not be re-derived (this conversation's retained evidence is 5 placeholders; 3,479 of
the 4,281 retained placeholders belong to `d81d04d3fd9c`), and the app-side half is PARTIAL:
tool rows settle normally with no job frames at all, but "does the app visibly lose
job/subagent state" needs the real backend's shed path, which this rig does not host.

## Evidence

- Matrix (this file) + rig + scenario builder + digest, and the sanitized stills:
orvanch `evidence/qa511-r1-frames`.
- Run summaries (JSON, per scenario per tree) are on the same branch; the runs made against
the REAL conversation text are NOT published — the stills and JSON here come from the
sanitized twin, which reproduced every number quoted above.

## Not covered

- The real backend's shed path end-to-end (Q3 above).
- Windows/Linux; macOS 27.0, Electron 44.3.0 only.
- The conversation's own live turn (the operator's session is not mine to disturb): all
  frames are served by the stub from the frozen copy.
