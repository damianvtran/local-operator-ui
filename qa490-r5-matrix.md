# QA round 5 — PR 490 (local-operator-ui), matrix

Head `7b5ee49d96268d717e2c67bc6742e87492f0d780`, control `99a8af88d2639348ef03d6c213908080de54b627` (the round-4 head). Scope `99a8af88d..7b5ee49d`.

Setup:
- App: the built Electron 44.3.0 app, run headless (`--window-mode=headless`).
- Backend: the round-3/4 stub `qa-rig-r3.mjs`.
- Session: synthetic `5eed1abe1490`.
- Command per row: `env -u XPC_FLAGS node qa-rig-r3.mjs --tree <worktree> --label <head|prev> --scen scen3/<name>.json --out out --port 46711`, wrapped by `run-matrix.sh <label> <names…>`.
- Reads are the open's own reads (`readsAtSettle`), written as requested `limit`s.

## 1. R11 veto shapes (A/B)
| scenario | head 7b5ee49d | prev 99a8af88d | verdict |
|---|---|---|---|
| r5-labels-stray-pending: a-labels seed, plus a stray call placed OLDEST, plus a dictation_complete compose placed NEWEST | 1 read, 325. The stray row reads `… QA-STRAY`. The pending call is not mounted. 0 empty | 2 reads, 325+104 = 429 | PASS |
| r5-counts-stray-pending | 1 read, 331. 0 empty | 3 reads, 331+104+65 = 500 (row cap) | PASS |
| r5-lone-pending: a pending compose plus an unlabelable call at the newest start | 2 reads, 107+110 = 217. ORPH107 (`…V1fpz9n8`) is labelled `ffxpftzlru…`. The unlabelable call keeps its stand-in. 0 empty | 4 reads, 107+110+107+107 = 431 | PASS |
| the same three without the pending compose (r5-labels-stray / r5-counts-stray / r5-lone) | 1/325, 1/331, 2/211 | 1/325, 1/331, 2/211 (identical) | PASS |

## 2. R6(b) verdict call
| scenario | head | prev | verdict |
|---|---|---|---|
| r6b-notrun-unpresent | 3 reads, 107+110+107 = 324. EARLY (`…osfMLe2d`) is labelled `rvvswwqecb…` | 3/324, labelled | PASS |
| r6b-notrun | 3 reads, 104+107+104. Labelled | same (round 4) | PASS |
| r5-early-notrun (a lone not_run compose) | 3 reads, labelled | 3, labelled | PASS |

## 2b. Other startless kinds (changed by R11's rule, see note N-a)
| scenario | head | prev | note |
|---|---|---|---|
| r6b-dictation-unpresent | 2 reads, 217. EARLY is NOT mounted | 3/324, EARLY labelled | a dictation-only compose now counts as pending, by design |
| r6b-noclock-unpresent: a clockless is_error end beside a clocked end | 2 reads, 217. EARLY is NOT mounted | 3/324, labelled | a mix of clockless and clocked ends is unreachable on the current runtime |
| r5-oldruntime-noclock-pair: all ends clockless (the pre-v0.57.0 runtime shape) | 3 reads, 324. EARLY labelled | 3/324, labelled | parity |
| r6b-dictation / r6b-noclock-end | 3 reads (104+107+104), labelled | same | parity |
| r5-early-dictation / r5-early-noclock-end / r5-early-noclock-end-ok | 3 reads each, labelled | same | parity |

## 3. Mid-round orphan join
| scenario | head | prev | verdict |
|---|---|---|---|
| r6a-boundary104 | 2 reads, 211. ORPH (`…Th77FneZ`) labelled `mpetouadfh…`. The current call is labelled. 0 empty | 2/211, labelled | PASS |
| r6a-unpresent | 2 reads, 211. ORPH labelled | same (round 4) | PASS |

## 4. Regression sweep (head)
| scenario | head (actual) | round 4 | verdict |
|---|---|---|---|
| f-noargs | 1 read, 107. Settled 36 rows, 2 stand-ins, 0 empty | 1/107 | PASS |
| f-noargs-newest / -median / -first | 1 / 1 / 4 reads (107+104+104+94) | same | PASS |
| stray-oldest | 1 read, 325. `… QA-STRAY`, 0 empty | 1/325 | PASS |
| tight-0p9 / 1p37 / 4p9 | 3 reads each. Command `bqeiwafmgb…` shown | same | PASS |
| edge-0p0 / 0p9 / 1p37 / 4p9 | 3 reads each. Command `zirbwbnifq…` shown | same | PASS |
| edge-5p5 | 2 reads. Stand-in `… nucstsgpll…`, 0 empty | same | as before (an expected miss) |
| switch-loop ×6 | 0 empty of 804 sampled frames. Every return shows 34 rows, 2 stand-ins, 0 empty | 0 of 812 | PASS |
| d-hang | Empty through t = 2977 ms. At t = 3081 ms: 26 stand-ins, 0 empty, with the read still pending | 2938 → 3061 ms | PASS |
| hold-across-switch | 30 held frames, then 34 rows / 2 stand-ins / 0 empty for 56 + 1320 frames | 30 / 1324 | PASS |
| a-labels | 1 read, 321. The first frame has 0 stand-ins. Settled 0 empty | same | PASS |
| a-counts | 1 read, 328. The first frame already shows `+91 -19`. Settled `+59`, `+19 -1`, `+91 -19` | same | PASS |
| b-finished / c-short | 0 reads, 0 stand-ins, 0 empty | same | PASS |

## 5. Session id
| check | head | prev |
|---|---|---|
| `grep -rlF <id>` / `<8-char prefix>` over the built `out/` (154 files) | 0 / 0 | 0 / 0 (the bundler strips comments) |
| `git grep -c -e <id> -e <prefix> <commit> -- .` | no hits (rc=1) | 4 lines in 3 files |
| `git diff origin/main...7b5ee49d` | 0 | — |
| PR body, issue comments, review comments, review bodies | 0 | — |

## 6. Suites (head)
| suite | result |
|---|---|
| seed-label-gap | 20/20 |
| evidence-manifest | 36/36 |
| transcript-reducer | 80/80 |
| tool-row | 67/67 |
| 7 near suites through run-desktop-tests.mjs | 231/231 |
| head's seed-label-gap cases run against prev's source | 18/20. The two new cases fail (`one page (read 2)`, `two pages (read 4)`) |
