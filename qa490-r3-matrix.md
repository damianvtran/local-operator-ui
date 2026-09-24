# QA round 3 — PR 490 matrix

Head `f3f3c5dcd767b7330a85ec6fd00c9a8b8c2f24c4`; control `prev` = `f1ef98c4c` (round-2 head).
Scope `f1ef98c4c..f3f3c5dcd`. Built app, `--window-mode=headless`, stub backend, allow-listed env.
Command per row: `env -u XPC_FLAGS node qa-rig-r3.mjs --tree <worktree> --label <head|prev> --scen scen3/<name>.json --out out --port <46711|46721>`
Scenarios rebuilt by `python3 build_scen3.py` from round-2's sanitized `scen/` (session id → synthetic `5eed1abe1490`).

Reads are `(limit, cursor, rows answered)`, in order. Only the open's reads are counted; reads caused by the rig
scrolling to probe a row come after `readsAtSettle` in each run JSON.

| # | surface | scenario | head (actual) | prev (actual) | verdict |
|---|---|---|---|---|---|
| 1a | round-2 FAIL row: lone seed call with no assistant row, its start = oldest seed start (as built in r2) | f-noargs | 1 read: (107 tail 107). Settled 36 rows, 2 stand-ins, 0 empty | 4 reads: 107 + 104 + 104 + 94 = 409 rows | PASS |
| 1a | same, start = newest seed start | f-noargs-newest | 1 read (107) | — | PASS |
| 1a | same, start = median seed start | f-noargs-median | 1 read (107) | — | PASS |
| 1a | same, start = journal's first row (the ceiling) | f-noargs-first | 4 reads: 107/104/104/94 = 409 rows; settled 0 empty | — | PASS (bound by the instant given) |
| 1b | reviewer stray-oldest: a-labels' 100-call seed + stray unlabelable call placed OLDEST | stray-oldest | 1 read: (325 tail 325). Stray row paints `… QA-STRAY` (stand-in), 0 empty | 2 reads: 325 + 82 = 407 rows | PASS |
| 1c | tight floor, mid-page: call at journal idx 131, its row journaled 0.9 / 1.37 / 4.9 / 5.5 s BEFORE its start | tight-0p9 … tight-5p5 | each 3 reads (107/104/104); probe row shows its real command `bqeiwafmgb…` in all four | 3 reads, command found | PASS |
| 1c | tight floor ON the page boundary: call at idx 196, the next page's oldest row 20 ms after it; lead 0 / 0.9 / 1.37 / 4.9 s | edge-0p0 … edge-4p9 | each 3 reads, probe row shows its real command `zirbwbnifq…` | — | PASS |
| 1c | boundary, lead 5.5 s (beyond the 5 s slack — the documented miss) | edge-5p5 | 2 reads, walk stops one page early; row shows stand-in `… nucstsgpll…` (0 empty) | 3 reads, command found | expected by design; see Q-note |
| 2 | switch away/back ×6, history frozen | switch-loop | 0 empty of 797 sampled frames; every return `34 rows, 2 stand-ins, 0 empty`; 1 read during cycles; settled 2 stand-ins 0 empty | (r2: 513 empty of 803 on the round-1 head) | PASS |
| 2b | N1 in the shipped app: 29 KB results so the paint cache (1 MiB/conv) trims at switch; one benign live frame between mounts | n1-refind-big-benign | re-return: 0 held ids, `[58 rows, 22 stand-ins, 0 empty] ×361` then labels | **22 ids re-held empty ×359 frames** then stand-ins, then labels | PASS — N1 reproduced on prev, closed on head |
| 2b | same, no benign frame | n1-refind-big | 0 held | 0 held | PASS |
| 2b | r2's n1-refind / -noframe | n1-refind, n1-refind-noframe | 0 empty of 782 / 781 | — | PASS |
| 3 | hung read, fallback | d-hang | 26 rows empty until t=3033 ms, 26 stand-ins at t=3137 ms, 1 read still pending | — | PASS |
| 4 | open mid-turn, labels | a-labels | 1 read (321); first frame 0 stand-ins / 26 empty; mount-all 105 rows 0 stand-ins | — | PASS |
| 4 | open mid-turn, counts | a-counts | 1 read (328); `edit` row `+91 -19` on first frame; mount-all edits `+272`, `+59`, `+19 -1`, `+91 -19` | — | PASS |
| 4 | finished conversation | b-finished | 0 reads, 0 stand-ins, 0 empty | — | PASS |
| 4 | short turn | c-short | 0 reads | — | PASS |
| 4 | short turn + running round | c2-short-running | 1 read (100); 2 empty → 2 stand-ins | — | PASS |
| 4 | argument-less tool (durable `arguments: {}`) | f-noargs | `noargs_durable` shows its stand-in on the first frame (not held) | — | PASS |
| 4 | live rows after open | g-live | 0 reads; `echo QA-LIVE-COMMAND`; edit `+7 -3`; stripped edit no counts | — | PASS |
| 4 | round end retry | g2-roundend | 0 empty of 482 frames; retry 107 + 104; rows labelled | — | PASS |
| 4 | switch while first read in flight | e-switch | on B: 0 A rows; back on A: 0 empty 0 stand-ins | — | PASS |
| 4 | re-open running conversation (r1 FAIL row) | e4-return-running | 0 empty of 541 frames | — | PASS |
| 5 | leave/return ×2 while first read outstanding (hung) | hold-across-switch | 31 empty frames (the designed first-paint hold, frames 4–35), then `34,2,0` for 1322 frames; final 0 empty | — | PASS |
| 6 | merge render: edit row counts, expand → diff, working line (main's hunk) | merge-render | collapsed: `+91 -19`, h=20; click → `aria-expanded=true`, h=757.9, 32 `+` / 2 `-` diff lines, `… 89 more diff lines`; working line `thinking 3s` present | identical numbers | PASS |
