# QA remediation — round 6 (F1 / U22): the narrow follow-up

The rig, the scene and the numbers QA round 6's `btw-aside-evidence/qa-round-6/` and UX
round 4's `ux-round-4/` used, re-driven by the fix's author: the shipped
`scripts/renderer-driver.mjs` copied with rounds 1–6's scene layer appended
(`rig/patch-driver-r6.sh`), the REAL daemon from a local-operator worktree at
`origin/main` `679a6bc97` in its own uv venv, round 4's scripted provider stub, and the
shared 8080 lock taken and released per pass. Nothing was added to the app's source to
make a pass pass.

## The pair

| Pass | Tree | Width | Result |
| --- | --- | --- | --- |
| `r5clipnarrow-pre` | `f105c9953` (pre-fix) | 800×900 | **18 PASS / 3 FAIL** |
| `r5clipnarrow-post` | `284ae00d0` (fixed) | 800×900 | **21 PASS / 0 FAIL** |
| `r5clipwide-post` | `284ae00d0` | 1380×900 | **21 PASS / 0 FAIL** |
| `r6capnarrow-post` | `284ae00d0` | 800×900 | **16 PASS / 0 FAIL** (63 cells) |
| `r6capwide-post` | `284ae00d0` | 1380×900 | **16 PASS / 0 FAIL** (63 cells) |
| `capq-base` / `capq-fix` | `f105c9953` / `284ae00d0` | 800×900 | the mechanism, per frame |
| `r5clipnarrow-clampmutant` | `284ae00d0` with the deferral removed, the clamp attribution kept | 800×900 | **21 PASS / 0 FAIL** — the second half of the fix classified a real clamp |

The three narrow failures are QA round 6's F1, and the pre-fix numbers are QA's own to
the byte: `Q35a` at rest `scrollTop 104.5` against `maxScroll 222` → `hiddenBelowPx
117.1`, **1 of the refusal's 7 rows visible**, `discard it` 114.6 px below the clip;
`Q35c` `589` against `667` → 78.1 px hidden, 1 of 5 rows; `Q38` `1822.5` against
`turnOffset 2011.2` (**188.7 px** short) with `reachedAt: null`.

At the fixed tip the same three read `scrollTop 221.5 = maxScroll 222`, 0.1 px hidden,
**7 of 7 rows**, the phrase 2.4 px inside the clip; `Q35c` `667 = 667` with 5 of 5 rows;
and `Q38` reaches `2011` against `2011.2` **at 2216 ms** and holds for every later chunk
(`distinctAfterReach [2011]`). `Q37` and `Q38c` — the reader's own scroll — still win.

## The mechanism, on this rig

`capq-base` / `capq-fix` are scene `btw-r6-capq`, whose per-frame watch on the region is
installed before the follow-up's Enter. It reads the two caps the append straddles:
frames holding `clientHeight 232` with the inline cap spelling `+ 19.5px` (the previous,
one-line question) and `scrollTop 0`, and then the frame the measured cap lands in —
`clientHeight 251`, `+ 39px`, `scrollTop 104.5`. The cap grows one line, the browser's
clamp of the append's write has nothing left to do, and the refusal's growth re-runs the
move to the ceiling instead of finding the turn already marked done.

## Files

`logs/` holds each pass's full stdout (every `[PASS]`/`[FAIL]`, every reading), and
`frames/` the stills each pass captured. The rig itself is not committed here: the scene
layer is `btw-aside-evidence/qa-round-6/rig/` plus `qa-round-5/rig/scene-r5.js` and the
runner in `btw-aside-evidence/qa-round-6/rig/run6.sh` pointed at any worktree at the
heads above.
