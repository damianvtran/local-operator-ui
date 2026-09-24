# QA round 6 — PR 490 (local-operator-ui), matrix

Head `486351dbdda783284080917f4e57915b81bf2118`, control `7b5ee49d96268d717e2c67bc6742e87492f0d780`
(round 5's head, i.e. the pre-R16 state). Scope `7b5ee49d..486351dbd` (de6081e9e the fold, 486351dbd the fix).

## Setup

- App: the built Electron 44.3.0 app, run headless (`--window-mode=headless`), 1380x900.
- Backend: the round-3/4/5 stub `qa-rig-r3.mjs`, unchanged, plus two ADDITIVE probe keys
  (`probeAnyId`, `standInsAll`, `domAtSettle`) that change no measurement; the round-5
  numbers reproduce on `7b5ee49d`, which is the harness's own parity check.
- Session: the synthetic `5eed1abe1490`.
- Command per row: `env -u XPC_FLAGS node rig.mjs --tree <worktree> --label <head|prev> --scen scen3/<name>.json --out out --port 46711`.
- Reads are the open's own reads, written as the requested `limit`s; a probe scenario freezes
  history at the moment of the probe, so a trailing `100`-row read stays pending and is not
  counted (the convention rounds 3-5 used).
- "Labelled" = the probe found the row mounted with its real command in the object column.

## 1. R16 — a FINISHED call whose end frame carries no start time

| # | shape | head `486351dbd` (actual) | prev `7b5ee49d` (actual) | verdict |
|---|---|---|---|---|
| 1a | `r6-noclock-settled`: a settled end (no `started_at_epoch`) for EARLY (assistant idx 98) beside a clocked call no page names | **3 reads**, 107+110+107 = **324**. EARLY **mounted and labelled** `rvvswwqecbcx…`. 58 rows / 1 stand-in / 0 empty | **2 reads**, 107+110 = **217**. **No mounted row carries EARLY's id** after the full scroll | **PASS** |
| 1b | `r6b-noclock-unpresent`: round 5's own discriminator (blocked/`is_error` end, no clock) | **3 / 324**, EARLY labelled | **2 / 217**, EARLY not mounted | **PASS** |
| 1c | `r6-noclock-settled-pending`: 1a plus a gate-waiting compose | **3 reads**, 110+113+110 = **333**, EARLY labelled, the waiting compose **not painted** | **2 / 223**, EARLY not mounted | **PASS** |
| 1d | `r6-noclock-blocked-pending`: 1b plus a gate-waiting compose | **3 / 333**, EARLY labelled | **2 / 223**, EARLY not mounted | **PASS** |

1c/1d are the mixing test: the gate exemption must not swallow the refusal a clockless
settled call makes. It does not.

## 2. The shapes the earlier rounds pinned (the inversion must reopen none)

| # | shape | head | prev | verdict |
|---|---|---|---|---|
| 2a | R6(b) not-run compose (`r6b-notrun-unpresent`) | 3 reads / 324, EARLY labelled | 3 / 324, labelled | PASS, unchanged |
| 2b | a call waiting at a gate (`r5-lone-pending`: waiting compose + unlabelable call) | **2 reads** 107+110 = 217. ORPH107 (`…XDecV1fpz9n8`) labelled `ffxpftzlruxy…`. The waiting call is **not painted at all**. The unlabelable call keeps `… no page names this`. 0 empty. Round 5 measured 2 / 217 on this same code | identical | PASS, unchanged |
| 2c | pending compose placed NEWEST (`r5-labels-stray-pending`) | **1 read / 325**. The stray row reads `… QA-STRAY`; the waiting call not painted; 0 empty. Round 5: 1 / 325 | identical | PASS, unchanged |
| 2d | the same on the counts journal (`r5-counts-stray-pending`) | **1 / 331** | identical | PASS, unchanged |
| 2e | R6(a) orphan-result join (`r6a-boundary104`) | **2 reads** 104+107 = 211. ORPH (`…xRL4Th77FneZ`) labelled `mpetouadfhzv…`; the current call labelled. Round 5 measured 2 / 211 for this scenario | identical | PASS, unchanged |
| 2f | single-turn unlabelable call (`f-noargs`) | 1 read / 107, 36 rows, 2 stand-ins, 0 empty | identical | PASS, unchanged |
| 2g | stray-oldest | 1 read / 325, 0 empty | identical | PASS, unchanged |
| 2h | startless-by-type: dictation-only compose (`r6b-dictation-unpresent`) | 2 / 217, EARLY not mounted | 2 / 217, EARLY not mounted | PASS, unchanged — and by design: a compose with no `not_run_reason` IS the exempt kind |
| 2i | the all-clockless runtime (`r5-oldruntime-noclock-pair`, pre-v0.57.0 shape) | 3 / 324, EARLY labelled | 3 / 324, labelled | PASS, unchanged |

## 3. The fold onto `cb9d97b79` (#426)

| # | check | actual | verdict |
|---|---|---|---|
| 3a | transcript renders on the folded build | 56-58 rows painted, 0 stand-ins, 0 blank at settle; `a-labels` 1 read / 321 and `merge-render` 1 read / 328 | PASS |
| 3b | an edit row expands to its diff with counts | collapsed: mounted, `+91 -19`, `aria-expanded=false`, h = 20 px → after a real click: `aria-expanded=true`, h = 757.9 px, `+`/`-` lines in the body. Identical on prev | PASS |
| 3c | the working line renders | `[data-lo-working-line]` = 1, text `⋯ thinking 3s` (`4s` on the second run). Identical on prev | PASS |
| 3d | `package.json`'s `test:desktop` union | proved off the two manifests, not the runner: main `cb9d97b79` **207** unique entries, head **208** (207 + `scripts/seed-label-gap.test.mjs`), **0** duplicates, all 208 present on disk | PASS |
| 3e | the runner's own "N files" header | `node scripts/run-desktop-tests.mjs scripts/seed-label-gap.test.mjs` prints `desktop tests: 1 file` — the header counts its own argv, so it cannot prove the union; 3d is the independent check | note |
| 3f | the manifest the fold re-stamped | `srcTree`/`scriptsTree` equal `git rev-parse HEAD:src` / `HEAD:scripts`; 116 top-level keys; `BRANCH_RECORDS` 16/16 present; `frames` 8856 declared, 668 PNGs under `docs/evidence` | PASS |

## 4. Suites (head worktree)

| suite | result |
|---|---|
| `seed-label-gap` | 21/21 (the new case: "a settled call whose end frame states no clock still refuses the floor") |
| `evidence-manifest` | 36/36 |
| `transcript-reducer` | 80/80 |
| `tool-row` | 67/67 |

## 5. `pnpm check-evidence`

BLOCKED. The machine lease was free (probed), so the sweep was attempted twice under a hard
bound in its own process group: 900 s at load 168 (bound fired, no verdict) and 240 s at load
165 (rc = -15, elapsed 250.3 s, output was the pnpm banner and `ELIFECYCLE` only). No survivor
process afterwards and the lease re-probed free. CI is the gate for the pixel sweep on this head.
