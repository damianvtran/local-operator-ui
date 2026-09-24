# QA round 2 matrix — local-operator-ui PR #490 @ f1ef98c4c

Round-2 delta pass. Head `f1ef98c4c7ab80a1d86cc1fa6ec2f65dac6bafb3` (re-read with
`gh pr view 490 --json headRefOid` before the pass and again before posting; unchanged).
Scope `d2975e6f5..f1ef98c4c`.

Rig: `qa-rig-r2.mjs` (this round's, written for this pass). Scenarios: `scen/*.json`.
Raw per-run JSON: `runs/<tree>-<scen>.json`. Frames: `*.png`.

Command shape for every row:

```
env -u XPC_FLAGS node qa-rig-r2.mjs --tree <worktree> --label <head|prev|main> \
  --scen scen/<name>.json --out out --port <46651|46661|46671>
```

Trees, each its own detached worktree, `node_modules` an APFS clone (`cp -Rc`) of the
one tree whose lockfile matches all three:

| label | ref | what it is |
|---|---|---|
| `head` | `f1ef98c4c` | the PR head under test |
| `prev` | `d2975e6f5` | the round-1 head: the PRE-fix code, the A/B control for every delta row |
| `main` | `d1402bbaa` | `origin/main` as of this head's own fold (the merge's second parent), so the comparison is not polluted by main's own later work |

Every scenario is a **length-preserving sanitized** copy: `sanitize.py` applies the
conventions `scripts/fixtures/seed-label-gap.json` states for itself in
`derivation.sanitization` (same original value → same placeholder, diff lines keep their
first character, scheme prefixes kept, ids/ts/roles/call ids/tool names/order/
`added`/`removed` verbatim, **every string's length identical**). The transform asserted
0 structural problems across 24 scenarios: same shape, same string lengths. Round 1's own
scenario copies predate that sanitization, which is why this pass re-ran the whole matrix
against rebuilt input rather than reusing them.

## Delta rows

| # | surface | command | head (actual) | control (actual) | verdict |
|---|---|---|---|---|---|
| 1 | **Q1's fix** — leave a mid-turn conversation and come back, 6 times, quickly, with history frozen; every painted frame sampled (`switch-loop`) | `--label head/prev/main` | 0 blank frames of 1063; every one of the 6 A-visits paints `163a,34,2,0` (34 rows, 2 stand-ins, 0 blank); settled blank 0; reads during the cycles 1 | `prev`: **513 blank frames**; each of the 6 returns goes `163a,34,0,2` for 40–42 frames and the FINAL settle is still blank (`163a,34,0,2` ×307, settled blank 2, stand-ins 0) | **PASS** |
| 2 | **D1's cap** — `/history` never answers (`d-hang`) | `--label head/prev/main` | 26 rows objectless from t=191 ms to **t=3028–3133 ms**, then 26 stand-ins, 0 blank; the read is still pending | `prev`: the same 26 rows still objectless at the 20 s ceiling (two control deadlines: reads at t=39 ms and t=20 037 ms, both pending); settled blank 26 | **PASS** |
| 3 | **R1's first-round floor** — join during the turn's FIRST tool round, no seeded call durable yet (`j-firstround`) | `--label head/prev/main` | **1 request**, 113 rows, tail | `prev`: **4 requests, 408 rows** (113 ×3 + 69). `main`: 1 request, 108 rows | **PASS** |
| 4 | one seeded call with no command anywhere in the journal (`f-noargs`) | `--label head/prev/main` | **4 requests, 409 rows** — the whole journal, unchanged from `prev` (4 requests, 409 rows) | `main`: 1 request, 104 rows (it never pages) | **FAIL (minor) → Q1** |
| 4' | the same shape's later retry: durable rows for the unlabelable call, then `turn_end` (`f2-retry`) | `--label head/prev` | retry read = **tail limit 107** | `prev`: retry read = **tail limit 409** — the poisoned depth floor | **PASS** |
| 5 | the request cap against an owner answering with 5 rows and `has_more: true` (`k-shortpages`, `page_cap: 5`) | `--label head/prev/main` | **exactly 6 requests**, 30 rows, then it stops | `prev`: **82 requests** and still paging at the window's end, 409 rows read. `main`: 1 request, 5 rows | **PASS** |
| 6a | **case (a)** — rows whose labels the EARLIER read FOUND, then one benign live frame between the mounts, then leave and return (`n1-refind`) | `--label head/prev/main` | **0 blank frames of 772**; on the return (mid-read, 3 s read) `heldPrevIds: 0`, blank 0, stand-ins 0; after settle `blankPrevIds: []` | the same run with the benign frame REMOVED (`n1-refind-noframe`): 0 blank frames of 773 — no difference | **PASS (clean)** |
| 6b | **case (b)** — leave and re-enter while the first paint's own read is outstanding, twice, so the backstop fires under a later generation than the one that armed it (`hold-across-switch`) | `--label head/prev/main` | blank only for the outstanding first read (`163a,34,0,2` ×31, frames 4–254), then `163a,34,2,0` for the remaining 1379 frames; **11.4 s after the last return: `blankIds: []`, blank 0, 2 stand-ins** | `prev`: **1404 blank frames**, and 10.9 s after the last return the two rows are STILL blank (`blankIds: [tool:toolu_QA_running_01, tool:toolu_QA_running_02]`) | **PASS** |

## Regression sweep of round 1's PASS rows (row 6), on the sanitized set

| round-1 row | head @ `f1ef98c4c` (actual) | round-1 measurement @ `d2975e6f5` | verdict |
|---|---|---|---|
| (a) mid-turn open, 100-call seed, 407-row journal (`a-labels`) | first frame 58 rows, 0 stand-ins, 26 empty, 0 reads answered; open = 1 read (tail, limit 321); mounted-all 105 rows, **0 stand-ins** | identical | PASS |
| (a) 471-row journal (`a-counts`) | first frame 56 rows, 0 stand-ins, 26 empty; 1 read (tail 328); mounted-all 105 rows, 0 stand-ins | identical | PASS |
| (a) `edit subagent.py` counters on the FIRST frame (read unanswered) | `+91 -19`; `frontend_state.py` edit `+19 -1`; after mount-all 0 of 4 edit/write rows without counts | identical | PASS |
| (b) finished conversation (`streaming:false`, `live_events: []`) | **0 history reads**, 0 stand-ins, 0 empty | identical | PASS |
| (c) short turn, seed covered by the snapshot page | **0 reads**, 0 stand-ins, 0 empty | identical | PASS |
| (c) same seed, legacy snapshot without `cold_reason` (`c3-short-legacy`) | 1 read (tail, limit 100), 0 stand-ins | identical | PASS |
| (c) short turn + 2 settled calls of the still-running round (`c2-short-running`) | 1 read (tail 100); the 2 rows empty during the read then stand-ins; walk stops without paging | identical | PASS |
| (d) `/history` answers 503 (`d-fail`) | 2 reads, both 503; 26 columns empty then 26 stand-ins at the budget's end (t≈338–642 ms), settled blank 0 | identical | PASS |
| (e) open A (read delayed), switch to B with A's read in flight, A's read lands on B, back to A (`e-switch`) | on B 20 rows, 0 A rows, 0 empty; after A's read landed still 0 A rows; back on A 58 rows, 0 empty, 0 stand-ins | identical | PASS |
| (e) A→B→A inside A's in-flight read (`e2-bounce`) | `[163a,58,26,0 ×3] → [163a,58,0,26 ×237]` | identical, with round 1's 3-frame flash noted | PASS |
| (e) re-open a fully labelled conversation (`e3-return`) | `[b0b0,20,0,0 ×1] → [163a,58,0,0 ×540]` | identical | PASS |
| (e) **re-open the c2 conversation with a 3 s read** (`e4-return-running`) — round 1's FAIL (Q1) | `[b0b0,20,0,0 ×1] → [163a,34,2,0 ×539]`: **0 blank frames** | round-1 head: 2 rows blank for 358–361 frames (~3.0 s), 3 of 3 runs | PASS — **Q1 closed** |
| (f) genuinely argument-less tool + a seeded end with no assistant row (`f-noargs`) | f1 stand-in at once, f2 empty during the walk then its stand-in; both stand-ins at settle | identical; extra reads → Q1 | PASS (with Q1) |
| (g) live after the open: bash start/end; edit end with `details {added:7, removed:3}`; edit end with `details: null` (`g-live`) | running row `echo QA-LIVE-COMMAND`; settled `[bash echo QA-LIVE-COMMAND, edit ~/qa/live-file.py +7 -3, edit ~/qa/stripped.py (no counters)]`; **0 reads, 0 empty** | identical | PASS |
| (g) the running round becomes durable, then `turn_end` (`g2-roundend`) | `[163a,34,2,0 ×186] → [163a,36,1,0 ×185] → [163a,58,0,0 ×111]`; **no empty frame**; both rows end labelled; retry reads 107 then 104 | round 1: `[2 stand-ins ×182] → [labelled ×300]`, no empty frame, 1 read (107) | PASS |

## Round-1 findings, one by one

| finding | claim | measured |
|---|---|---|
| Q1 (FAIL round 1) | per-conversation LRU bookkeeping so a switch back does not re-hold painted rows | **fixed** — row 1 and row (e)/`e4-return-running`: 0 blank frames over 3 runs of 6 cycles each; `prev` blanks on 6 of 6 returns and never recovers with a frozen read |
| Q2 (minor) | no walk to the 500-row cap; the depth floor only rises when a page labelled a call | **half fixed** — the depth floor is fixed and measured (row 4': 409 → 107); the walk still reads the whole journal on row 4's shape, now bounded by the 6-request cap |
| Q3 / D1 (minor) | the hold ends at the first attempt's settle, or after 3 s | **fixed** — row 2: 3028–3133 ms against `prev`'s ≥20 s |
| D2 | rejected as the designed fallback | no code; nothing to verify |
| D3 | body rewording | no code; nothing to verify |
| R1 | the walk is bounded by the turn's opening row | **fixed for a journal with more than one turn** (row 3: 4 → 1 request, matching `main`'s 1) and **not for a single-turn journal** (row 4: still 4 requests / 409 rows) |
| R2 | the fixture was rebuilt with same-length placeholders | **verified by behaviour**: 24 scenarios rebuilt under the same conventions reproduced every round-1 number and every delta number unchanged |
| R3, R4, R5 | comments corrected; a request cap added | R4 measured (row 5: 82 → 6); R3/R5 are prose/comments with no code path to exercise |

## Why row 4 is a finding and not a pass

`j-firstround` and `f-noargs` carry the same mechanism with opposite outcomes, and the
difference is only where the turn's opening `user` row sits:

- `j-firstround`: the journal holds a second turn, so a fresh `user` row is at the tail;
  the first fetched page contains it and `pageOpensTurn` stops the walk → **1 request**.
- `f-noargs`: the journal is ONE turn (its only `user` row is at index 3 of 409), so the row
  that opens the turn is 409 rows back and the floor cannot fire until the walk has read the
  journal anyway → **4 requests, 409 rows**, the same as `prev`.

In both cases the target is a call with no assistant row anywhere, so nothing can be
labelled and the walk's only real bounds are `RECONCILE_WALK_MAX_REQUESTS` (6) and
`RECONCILE_WALK_MAX_ROWS` (500). The request cap is what now bounds row 4's cost, and it
holds (6, not 82). The remediation's Q2 answer claims "no walk to the cap for an unfindable
call" — true, 409 < 500 — and "the retry starts at the goal's own size" — true and measured
(107 vs `prev`'s 409). The stricter expectation in this round's brief ("must not read the
whole history") is not met, which is what this row records.

No producer path is known for a settled call with no assistant row (round 1 found none;
round 2's code reviewer agreed), so this is a cost exposure rather than a field failure.

## Not covered

- No live runtime owner: every snapshot came from a stub serving the sanitized fixture's
  journal over the real desktop wire. A real `serve` could not be put mid-turn
  reproducibly and the operator's live sessions were not touched.
- Focus-dependent behaviour is out of scope for `headless` (see AGENTS.md); this diff has none.
- The mobile-web and run-panel readers were not driven. `labelPending` applies to the main
  transcript only, as the PR states.
- `pnpm test:desktop` was not re-run locally; CI's `Desktop Tests` is green on this head.
