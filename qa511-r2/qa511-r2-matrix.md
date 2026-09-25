# QA round 2 — PR #511 (local-operator-ui) — matrix

**Scope:** `25fb964cc..7add4c30e9b858141876a8197ee852a456eca178` (the fold) with the
remediation delta `0eb887f58..25fb964cc` measured in-app; A/B against the round-1 head
`0eb887f580f85c38ed82f4a03a86d0746f5da3c8` (`prev`) and — for row 1's before frame — the
pre-PR parent `c44d29c34ae3ef0e2d4dd5213d4bfd622b4ada84` (`parent`).
**Head:** `7add4c30e9b858141876a8197ee852a456eca178` (`gh pr view 511 --json headRefOid`
before the pass and re-checked before posting).

**Environment.** macOS 27.0, Electron 44.3.0 (the trees' own `node_modules/.bin/electron`),
window 1380x900, `--window-mode=headless`, scratch `HOME`/`TMPDIR`/`LOCAL_OPERATOR_CONFIG_DIR`/
`--user-data-dir`/log dir/cwd, env allow-list (no `CMUX_*`, `LOP_*`, `XPC_*` inherited).
Three trees, each its own git worktree and its own `electron-vite build`:
`~/local-operator-ui-worktrees/qa511r2-9c41-{head,prev,parent}`.

**Data.** The operator's conversation `b747a2c8d3bb`, read once and COPIED into the rig's
scratch (`~/.local-operator/sessions/b747a2c8d3bb/transcript.jsonl`, 3.2 MB, 1139 rows),
served to the app by a stub that speaks the desktop wire (SSE `open` + `snapshot`,
`/history` with `before_id`-exclusive paging, live `event` frames on demand, and the
`/v1/desktop/commands` catalogue). The journal is the real transcript CUT at row 1052.
Free text that reaches a published frame is the sanitized twin (same rows, same ids, same
numbers, synthetic words); every count quoted here is from the REAL copy except the two
screenshots, which say so.

**Command shape for every row** (`S=$LOCAL_OPERATOR_SCRATCHPAD/r2`):

```sh
env -u XPC_FLAGS python3 bounded.py 300 "$S" \
  node r2rig.mjs --tree ~/local-operator-ui-worktrees/qa511r2-9c41-<head|prev|parent> \
  --label <head|prev|parent> --scen "$S/scen/<scenario>.json" --out "$S/out" --port <47831|47931|48131>
```

| # | surface | scenario | head `7add4c30e` (actual) | prev `0eb887f58` (actual) | verdict |
|---|---|---|---|---|---|
| 1 | re-open mid-turn, a call settles LIVE (clocked frame) | `r1-live-settle` | settle fires the read that names the call: 312-row tail page, then **104 rows 637–740 NAMING the call**, answered **+~760 ms**; the row at its own position carries its **command** (`standIn:false, labelled:true`); `readsFromScroll` = the reader's own paging only | same (2 reads, row labelled) | **PASS** (row 1's bug was the PARENT's: `parent` = **0 reads** after the push, row keeps `… --- stdout -`, i.e. its OUTPUT where the command belongs — re-measured here, and the head is unchanged from round 1) |
| 1b | same, clockless frame | `r1b-live-settle-noclock` | 2 reads (312, then 104 naming the call), naming page **+634 ms**, row labelled | not run (round 1: PASS) | **PASS** |
| 2 | **R1's shape**: live settle whose step has NOT committed, then a re-sync naming it, then the step commits behind `turn_end` | `r1c-step-commits` | settle **1 req / 312 rows** (speculative, NOT charged); re-sync **1 req / 312 rows**; durable round ending → **2 req / 416 rows, the 312-row page NAMES the call** → **row labelled** (`msToLabelled` +7.58 s frame-sampled) | settle **3 req / 500 rows** (the full walk, an attempt spent); re-sync 1 req / 312 rows (the second attempt spent); round ending **0 req / 0 rows** → **row keeps `… QA r2: this call's step has not committed yet` for the rest of the window** (1281 sampled frames) | **PASS — the round-1 failure (0 reads at the durable moment, budget gone) reproduced on `prev`, fixed on head** |
| 2b | same, with no re-sync in between | `r1d-step-commits-direct` | settle 1 req / 312 rows; commit → 2 req / 416 rows → labelled | settle 3 req / 500 rows (**wasted**: 500 rows to learn nothing); commit → 2 req / 416 rows → labelled | **PASS** (both label; prev pays 500 extra rows — the R1 defect needs the second spend to bite) |
| 3a | cost over 6 settles | `r3-cost` | **3 requests for the whole session** = 1 open + 312-row page + 104-row page naming **all six**; settles 2–6 cost **0 further reads** each; all six labelled | identical (3 requests, all six named) | **PASS** |
| 3b | second settle in a row | `r2-long-turn` | settle 1 → 2 reads (312 + 104 naming **both** calls); settle 2 → **0 further reads**; both rows labelled | identical | **PASS** |
| 3c | an ordinary open with nothing left to label | `r3b-open-nothing-to-label` | exactly **ONE** request (limit 104, tail) | exactly ONE | **PASS** |
| 3d | an UNLABELABLE settle whose frame states the call's start | `r3c-unlabelable-settle` | **1 request / 312 rows** — one bounded tail page; row keeps its stand-in | **3 requests / 500 rows** (312 + 104 + 84 = the `RECONCILE_WALK_MAX_ROWS` bound); row keeps its stand-in | **PASS** (the reviewer's 500-row walk is now one page; the ROW SPEND is 312 vs 500) |
| 3e | the same, startless (the stated residual) | `r3d-unlabelable-settle-noclock` | 3 requests / 500 rows (one bounded walk), row keeps its stand-in | 3 requests / 500 rows | **PASS (residual, stated in the body)** |
| 3f | a SECOND startless unlabelable settle in the same conversation | `r3e-allowance-two-settles` | settle 2 costs **0 further requests** (`LABEL_SETTLE_ROWS_MAX` spent) | settle 2 spends another 3 requests / 500 rows | **PASS** (the allowance ends the speculative path per conversation) |
| 4a | open mid-turn: first paint must show 0 output stand-ins | `r4a-open-midturn` | first frame **54 rows, 0 stand-ins, 19 label-pending blanks**; settles to 46/0/0; 1 read | identical | **PASS** |
| 4b | switch away and back ×6, history frozen | `r4b-switch-loop` | 6/6 returns 46 rows / **0 blank / 0 stand-in**, **0 reads** during the cycles; frame runs alternate `d3bb,46,0,0` / `ther,46,0,0` | identical | **PASS** |
| 4c | hung read — columns fall back ~3 s | `r4c-hung` | 19 blanks from t=225 ms → 19 stand-ins at **t=3266 ms**, read still unanswered | fallback at **t=3255 ms** | **PASS** |
| 4d | finished conversation | `r4d-finished` | **0 reads**; 36 rows, 1 stand-in (a journal call with no arguments anywhere) | identical | **PASS** |
| 4e | a call with genuinely no arguments anywhere | `r4e-noargs` | keeps its stand-in; pays a bounded walk **3 req / 500 rows** once | identical (4 req / 812 rows total) | **PASS** |
| 4f | edit rows keep `+N −M`, diff expands | `r4f-edit` | `+91 −19`, height 20 → **236**, expand → `@@ -1,3 +1,7 @@`, 6 `+` lines, 4 `−` lines | identical | **PASS** |
| 5 | the fold: transcript renders, #482's aside panel from the chat surface | `r5-fold`, `r5b-fold-aside-streaming` | transcript 46 rows / 0 stand-ins / 0 blank before AND after; `/btw` + one Enter attaches the panel (`role` region, **0 dialogs**), composer cleared and still usable; the ask leaves as `POST /v1/desktop/sessions/<id>/asides` `{text, request_id, subscription_id}`; the panel shows the thinking state, a live `aside_delta` chunk, then the POST's authoritative answer; **0 history reads**; transcript unchanged | not applicable (#482 is main's) | **PASS** |
| 6 | the repo's own harness suites | `node --test scripts/seed-label-gap.test.mjs` / `scripts/evidence-manifest.test.mjs` on the folded head | **26/26 pass, 0 fail** (2.8 s) / **36 tests, 35 pass, 1 skip, 0 fail** (15.6 s) | — | **PASS** |

## Row 1 in detail

Conversation = the operator's `b747a2c8d3bb`, cut at row 1052, turn opening at row 540,
seed = newest 100 `tool_execution_end` frames, snapshot page = rows 953–1052. The live
settle is `call_00_kuxaxfVWex8EIyAevrmd4900` (journal row 686, assistant row 685 — 313 rows
above the tail, outside both the page and the seed window).

- **parent `c44d29c34` (before):** after the live settle, the session's request count stays
  at **1** (the open's own read). The row is mounted in the live view and reads
  `… --- stdout -` — the call's OUTPUT in the object column — and keeps it.
- **head `7add4c30e` (after):** the same live settle fires two reads: the 312-row tail page
  (t=1720 ms) and **104 rows 637–740**, the page that NAMES the call (t=2047 ms, answered
  2025 ms → **+~760 ms** after the push). The row at its own position carries its COMMAND
  (`bash` + the command text + its duration), not its output. No scroll is needed for the
  label: the post-scroll reads are the reader's own paging (2 × 100-row pages).
- **prev `0eb887f58`:** identical to head — this row was fixed in round 1; round 2's finding
  is that the same shape is still correct on the folded head.

## Row 2 in detail (the remediation's own axis)

`r1c-step-commits` serves a journal in which the settling call's step has NOT committed: no
assistant row carries its arguments anywhere, and the frame states the call's own (recent)
start. Then a re-sync snapshot names the same call in its seed; then the step commits (the
assistant row + result row are appended) behind a durable round ending.

| phase | head | prev |
|---|---|---|
| settle | 1 request / 312 rows, row on its stand-in | **3 requests / 500 rows** (the full walk), row on its stand-in |
| re-sync snapshot naming the call | 1 request / 312 rows | 1 request / 312 rows |
| step commits + `turn_end` | **2 requests / 416 rows — the 312-row page NAMES the call → row LABELLED** | **0 requests / 0 rows — row keeps its stand-in** |

`r1d-step-commits-direct` (no re-sync) labels on BOTH heads, and shows the other half of the
fix: on `prev` the settle's speculative read is a 500-row walk that buys nothing, on head it
is one bounded page. The defect needs both spends (settle + a later seed naming the call) to
eat `LABEL_GAP_ATTEMPTS`; the head never charges the settle at all.

## Row 3 in detail (costs, re-measured in-app)

- **Six settles:** 3 requests total (1 open + 312 + 104), the 104-row page naming all six;
  settles 2–6 → 0 further reads. Same as round 1.
- **Second settle in a row:** 0 further reads.
- **An open with nothing to label:** exactly 1 request.
- **An unlabelable settle with its clock:** 1 request / **312 rows** (one bounded tail page),
  against `prev`'s 3 requests / 500 rows. The walk's floor is the frame's own
  `started_at_epoch`, so the tail page is already older than a call that just started.
- **The residual:** with NO clock the same settle still costs one bounded walk (3 requests /
  500 rows) — measured identical on both heads — and a **second** such settle in the same
  conversation costs **0 further requests** on head (the `LABEL_SETTLE_ROWS_MAX` allowance is
  spent) against another 500-row walk on `prev`.

## Row 5 in detail (the fold)

The folded head is #482's tree plus this branch's two manifest keys. Booted on the real
built app with the stub's `/v1/desktop/commands` catalogue serving the backend's own `btw`
row (`destination: session.aside`, `execution: native`):

- the transcript paints normally (46 rows, 0 stand-ins, 0 blanks) and is unchanged by the aside;
- a bare `/btw` + ONE Enter attaches the panel above the composer (`Aside — off the record —
  nothing here joins the conversation`), clears the composer, keeps it enabled and keeps the
  keys (no `role=dialog` anywhere on the page);
- `/btw <question>` + Enter leaves the app as
  `POST /v1/desktop/sessions/b747a2c8d3bb/asides` with `{text, request_id, subscription_id}`
  (the 32-hex stream id), the panel shows the thinking state, a pushed `aside_delta` chunk
  renders inline, and the POST's authoritative answer settles the turn.

## Evidence

`qa511-r2/` on the orphan branch `evidence/qa511-r2-frames` (not part of this diff):
`qa511-r2-matrix.md` (this file), `r2rig.mjs`, `scen2-build.py`, `bounded.py`, `digest2.py`,
`run2.sh`, `harness.log`, `runs/*.json` (every run the table quotes), `frames/*.png`.
