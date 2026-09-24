# QA round 7 — PR 490 (local-operator-ui), matrix

Head `dd589d57792b73a5f3603fd3c48b257a583c7f9c`, control `486351dbdda783284080917f4e57915b81bf2118`
(round 6's head, i.e. the pre-R18 state). Scope `486351dbd..dd589d577`.

## Setup

- App: the built Electron 44.3.0 app, **headless** (`--window-mode=headless` plus
  `LOCAL_OPERATOR_UI_WINDOW_MODE=headless`), 1380x900. Every run logged
  `[window-mode] window mode headless: 1380x900, window created and never shown, page
  throttling off, no Dock tile` — no window was shown and no focus was taken.
- Two in-repo worktrees of my own: `.worktrees/qa490r7-head-40ac63` (head) and
  `.worktrees/qa490r7-prev-40ac63` (486351dbd), `node_modules` shared by symlink
  (`ln -s ../../node_modules`, at that depth, so the tree's pnpm links resolve); the
  lockfile hash is `506713f37ce2bc460f539e57bba67c9429edee2f` on head, on the control and
  on `origin/main`. Nothing was installed. Build, both trees:
  `LOCAL_OPERATOR_UI_NO_BYTECODE=true electron-vite build` with the stub API URL baked in
  and non-credential placeholders for the four OAuth variables — `rc=0` for both,
  `out/{main,preload,renderer}` present, ~6m15s each in parallel.
- Backend: the round-3/4/5 stub, unchanged (the round-6 ref's `rig.mjs`), plus **one
  additive round-7 key** (`pass2`, used only by the two second-pass scenario names) and
  an additive `domAtSettle`-style pre-scroll dump. `unknownRoutes` on every run is the
  same short list the stub has never implemented (`/v1/desktop/radient`, `/v1/agents`,
  `/v1/credentials`, `/v1/desktop/commands`, `command-entities`, `mcp`) — that is the
  stub, not the app; the banner the frames show is that 404.
- Instrument parity, proved not assumed: all eight pinned scenarios I re-ran
  (`r6-noclock-settled`, `r6b-notrun-unpresent`, `r5-lone-pending`, `r6a-boundary104`,
  `stray-oldest`, `f-noargs`, `merge-render`, `r5-oldruntime-noclock-pair`) are
  **byte-identical** to the round-6 ref's copies (`cmp` on each).
- Session: the synthetic `5eed1abe1490`. Each run had its own scratch `HOME`, `TMPDIR`,
  config dir, `--user-data-dir` and cwd, with an env **allow-list** (`PATH`, `LANG`,
  `TERM` plus the rig's keys), so no `CMUX_*`, `LOP_*` or `XPC_*` variable reached the
  app. Every run was bounded in its own process group and reaped; nothing else on the
  host was touched.
- Command per row: `env -u XPC_FLAGS python3 bounded.py 260 <scratch> node rig.mjs --tree
  <worktree> --label <head|prev> --scen scen3/<name>.json --out out --port 46721`.
- Reads are the app's own requests, written as the `limit` asked for, `T` = tail,
  `B` = before-cursor; a probe freezes history, so a trailing read stays pending and is
  not counted (the convention rounds 3–6 used). "Labelled" = the row is mounted under
  `data-record-id="tool:<id>"` with its real command in the object column; "stand-in" =
  mounted showing `… <text>`.

## 1. R18 — A/B, both shapes (the round's evidence)

`EARLY` = `…SDbpziaz9MBtxwosfMLe2d` (assistant idx 98, result idx 99 — a call the journal
could label), `UNPRESENT` = a clocked call no page names (keeps the walk honest).
The delta is identical on both heads except the retraction, so the delta **is** the
retraction.

| # | shape | head `dd589d577` (actual) | prev `486351dbd` (actual) | verdict |
|---|---|---|---|---|
| 1a | **second pass, switch away and back**: pass 1's seed announces `EARLY` waiting at a gate (`r6b-dictation-unpresent`'s shape: compose + the clocked unlabelable call), pass 2's seed settles it with no clock (`r6-noclock-settled`'s shape) | pass 1 `107T=107 110B=110` = 217 · **pass 2 `107T=107 110B=110 107B=107` = 324** · settled 58/1/0 · **`EARLY` labelled**, `UNPRESENT` stand-in | pass 1 identical 217 · **pass 2 `107T=107 110B=110` = 217** · settled 58/1/0 · **`EARLY` absent — not painted under any record id**, `UNPRESENT` stand-in | **PASS** |
| 1b | the same two passes, delivered as a **re-attach** (a second snapshot for the same conversation on the stream already open, no switch) | pass 2 `107T=107 110B=110 107B=107` = **324**, `EARLY` labelled; streams 1→1 (no re-subscribe) | pass 2 `107T=107 110B=110` = **217**, `EARLY` absent; streams 1→1 | **PASS** |
| 1c | **one seed naming the same call both ways**, settling arm: compose(waiting) + `tool_execution_end` with **no** `started_at_epoch` | **3 reads / 324**, `EARLY` **labelled** | **2 reads / 217**, `EARLY` **absent** | **PASS** |
| 1d | one seed both ways, **stated verdict** arm: compose(waiting) + compose with a `not_run_reason` | **3 / 324**, `EARLY` **labelled** | **2 / 217**, `EARLY` **absent** | **PASS** |
| 1e | one seed both ways, **`tool_execution_start`** arm: compose(waiting) + the call's own start frame | 3 / 324, `EARLY` **labelled** | 2 / 217, `EARLY` **labelled** (`echo QA-R7-START`, painted from the start frame itself) | **PASS** — boundary row, see N-a |

The walk is not left short at head in 1a/1b/1c/1d: the third page is read and the call it
holds is painted with its command. At `486351dbd` it stops one page earlier and the row
is **not in the tree at all** (`probeAnyId`: every mounted `data-record-id` scanned, no
match) — so the previous head's symptom is a missing row, not a visible stand-in.

## 2. The pinned shapes (the retraction must reopen nothing)

Round 6's published `486351dbd` column, against this head:

| # | shape | round-6 `486351dbd` | this head `dd589d577` | verdict |
|---|---|---|---|---|
| 2a | R16: settled end with no clock beside a clocked call no page names (`r6-noclock-settled`) | 3 / 324, EARLY labelled | `107T 110B 107B` = **324**, 58 rows/1 stand-in/0 blank, `EARLY` **labelled** | PASS, identical |
| 2b | R6(b) not-run compose (`r6b-notrun-unpresent`) | 3 / 324, EARLY labelled | **324**, `EARLY` labelled, `UNPRESENT` stand-in | PASS, identical |
| 2c | gate-waiting call (`r5-lone-pending`) | 2 / 217, orphan labelled, waiting call not painted | `107T=107 110B=110` = **217**; `…XDecV1fpz9n8` labelled `ffxpftzlruxy…`; the waiting call **absent**, not painted; `UNPRESENT` stand-in; 0 blank | PASS, identical |
| 2d | R6(a) orphan-result join (`r6a-boundary104`) | 2 / 211, orphan labelled + current call labelled | `104T=104 107B=107` = **211**; `…xRL4Th77FneZ` labelled `mpetouadfh…`; the current call labelled; `UNPRESENT` stand-in | PASS, identical |
| 2e | pending compose newest (`r5-labels-stray-pending`) | 1 / 325, stray `… QA-STRAY`, waiting call not painted, 0 empty | `325T=325` = **325**; stray row `… QA-STRAY`; waiting call not painted; 0 blank | PASS, identical |
| 2f | single-turn unlabelable call (`f-noargs`) | 1 / 107, 36 rows / 2 stand-ins / 0 empty | **1 / 107**, 36 rows / 2 stand-ins / 0 blank | PASS, identical |
| 2g | stray-oldest | 1 / 325, 0 empty | **1 / 325**, 58 rows / 0 stand-ins / 0 blank | PASS, identical |
| 2h | switch away and back **×6** (`switch-loop-r7`, history frozen after the open) | (round 5: 0 empty of 797 sampled frames) | **800 sampled frames, every one `…,0,0`** — 0 stand-ins, 0 blank; each of the 6 returns reads 58 rows/0 stand-ins/0 blank; 1 read during the cycles; settled 58/0/0 | PASS |
| 2i | hung read (`d-hang`) | (round 5: 26 blank until t=3033 ms, then 26 stand-ins at t=3137 ms, one read still pending) | 1 read still **pending**; 26 rows blank from t=137 ms, last blank sample t=**3017 ms**, first sample with 26 stand-ins t=**3120 ms**; settled 58 rows / 26 stand-ins / **0 blank** | PASS |
| 2j | open mid-turn, labels (`a-labels`) | 1 read / 321, first frame 0 stand-ins / 26 blank | **1 / 321**; first frame 0 stand-ins / **26 blank** (the designed hold); settled 58/0/0 | PASS, identical |
| 2k | open mid-turn, counts (`a-counts`) | 1 read / 328, `+91 -19` on the first frame | **1 / 328**; first frame 0 stand-ins / 26 blank; the row the fold row measures carries **`+91 -19` in the first-frame dump too**; 2 of the 3 mounted edit rows carry counts on the first frame, all 3 by settle (`+59`, `+19 -1`, `+91 -19`); settled 56/0/0 | PASS, identical |
| 2l | short turn plus a running round (`c2-short-running`) | 1 read / 100; 2 empty then 2 stand-ins | **1 / 100**; first frame 0 stand-ins / 2 blank; settled 34 rows / 2 stand-ins / 0 blank | PASS, identical |
| 2m | finished conversation (`b-finished`) | 0 reads | **0 reads**; settled 30 rows / 0 stand-ins / 0 blank | PASS, identical |

## 3. The fold regression sweep, this head

| # | check | actual | verdict |
|---|---|---|---|
| 3a | transcript renders | `a-labels` 1 read / 321 and 58 rows painted, 0 stand-ins, 0 blank; `merge-render` 1 read / 328, 56 rows, 0 stand-ins, 0 blank | PASS |
| 3b | an edit row expands to its diff with counts | collapsed: mounted, `aria-expanded=false`, h = **20 px**, first frame already carries `+91 -19` → after a real click `aria-expanded=true`, h = **757.9375 px**, **32** `+` lines and **2** `-` lines with the diff body and `_ 89 more diff lines _` in the frame | PASS |
| 3c | the working line renders | `[data-lo-working-line]` = 1, text `⋯ thinking 3s` (4s on a second run) | PASS |
| 3d | the other edit rows keep their counts | 3 of the 4 edit rows are inside the settled window and every one carries counts (`+59`, `+19 -1`, `+91 -19`); the 4th is outside the pre-scroll window this dump measures — see N-b | PASS |

## 4. Suites (head worktree, `node --test`, no `NODE_TEST_CONTEXT` inherited)

| suite | result |
|---|---|
| `scripts/seed-label-gap.test.mjs` | **23/23** (rc=0, 3.2 s) |
| `scripts/evidence-manifest.test.mjs` | **36/36** (rc=0, 18.6 s) |
| `scripts/transcript-reducer.test.mjs` | **80/80** (rc=0, 2.1 s) |
| `scripts/tool-row.test.mjs` | **67/67** (rc=0, 7.2 s) |

All four in one invocation: 206 tests, 206 pass, 0 fail.

## 5. `pnpm check-evidence`

**BLOCKED — the machine lease, not load.** The sweep is admitted by a non-waiting
`flock` on `/tmp/local-operator-ui-check-evidence.lock`
(`scripts/evidence-run-guard.py`), so a free probe is not an admission: the lease was
**FREE at 19:44:27** and **HELD by another session at 19:44:31**, and every bounded
attempt then failed closed in ~4–7 s with `Evidence check DEFERRED: another sweep holds
the machine lease… No frames checked` and `rc=75` (pnpm's `ELIFECYCLE`, exit 75). That is
contention between sessions on a shared lock, not the load-bound failure round 6
recorded; the sweep never started, so there is no partial sweep to report. Every attempt
was run in its own process group under `bounded.py` with a 900 s bound, and no run
survived it (see the attempt log in this ref's `rig/`). CI's `Desktop Tests` on this head
is the evidence gate here.

## Notes (informational, not findings)

**N-a: the `tool_execution_start` arm is not user-visible either way.** In 1e the two
heads still differ by one page of reads (3/324 against 2/217) — head walks further — but
the row is labelled on **both**, because a seed that carries the call's own start frame
paints the command from that frame without needing a page. So the third arm of
`seedSettledCalls` is exercised and harmless; the shape cannot show a label difference,
which is why 1c/1d are the discriminating rows.

**N-b: 3 edit rows, not 4, is an artefact of when the dump is taken.** Round 5 read the
counts *after mounting everything*; the rig's `editRows` dump is taken at settle, before
the probe's scroll, so it sees the rows inside the 56-row pre-scroll window. The row the
fold row measures (`…U3Y21CrbaP1HVMGcKMapJu`) carries `+91 -19` in both dumps.

**N-c: what the frames do and do not show.** `frames/head-r7-both-ways-end-04-probe.png`
and its `prev-` twin are the same scroll sweep: at head the probe centres on `EARLY`'s
row, mounted with its command; at prev the same scan finds no row for that call at all
and centres on the unlabelable call instead — the missing row is the previous head's
symptom. The `05-second-pass` pair is the end of the second pass **without** the probe's
scroll, and at that viewport `EARLY`'s row is outside the virtualized window on both
heads, so that pair is not the discriminating one; the `04-probe` frames and the run JSON
are.

**N-d: the two-pass shape had to be built twice.** My first construction announced `EARLY`
as waiting with a compose *alone*. On this journal that still walks three pages and
labels the call in pass 1, leaving the second pass nothing to walk for — both heads came
out identical, so the row could not discriminate and I did not report it. Adding the
clocked unlabelable call to pass 1 (the `r6b-dictation-unpresent` shape, which stops one
page short and leaves the call unlabelled) is what makes the second pass the discriminating
one, and that is what the matrix reports.
