# Round 2 — capped translated card and direct regression repairs

**Scope of every frame and native result here: card + approvals controller in producer-bound rig, NOT a whole-app artifact.** Every PNG carries this caption. Source-mounted announcement/focus tests are a separate proof lane. No updated whole-app smoke or fresh toolbar/badge/dialog/dock capture is claimed; previous app frames remain historical, not silently carried forward as current compiled-app evidence.

## Findings and repair

- **Q2-1 / D2-1:** reproduced the ordinary-requester, long-authority clipping at 264×600 in French, Spanish and Russian, both themes. Merely re-reading the clamped card or removing the hover fix is insufficient. The host now pulls `window.__approvalsCard.measure()` in its existing after-model `setTimeout(0)` read. That method removes the provisional viewport clamp, measures the actual localized intrinsic layout, restores it, and returns the height for the existing native rounding/clamping path. No resize IPC channel was added.
- The measured tallest gloss is a **shrinkable flex basis, not a hard minimum**. At the cap its text scrolls internally; hover/focus does not change the allocated basis or move decision targets. The origin/expiry keep their space. The footer is a non-shrinking sibling of the content body, not sticky over denial. At pathological smaller sizes the body can scroll independently of the footer.
- **R2-1:** `focus:true` is consumed on model receipt, not on every render. Ending the 700ms arming window changes disabled state only; it neither replays focus nor replaces focused Review-all rows.
- **Q2-2 / U2-1:** arrival announcements occur only on a count increase. A decrease clears the live region instead of replacing it with another positive count; 2→1 and 1→0 are silent DOM updates. A subsequent increase still announces. No catalogue change.

## Actual geometry

All values below are card-local DIP. Before column is denial overdraw / body overflow. The fixture uses `Fix the login flow on the staging dashboard`, `https://docs.example-company.test`, broad key `example-company.test`. These are not the shorter round-1 fixture.

| Cell | Before stale: overdraw / overflow | After stale: overdraw / overflow | Denial bottom < footer top | Intrinsic / rendered height |
|---|---|---|---|---|
| 264/en, both themes | not re-run | 0 / 0 | 381.07 < 387.07 | 454.47 / 454.47 |
| 900/en, both themes | not re-run | 0 / 0 | 329.77 < 335.77 | 403.17 / 403.17 |
| 264/fr, both themes | 15.86 / 22 | 0 / 0 | 406.6 < 412.6 | 501.86 / 480 |
| 900/fr, both themes | not re-run | 0 / 0 | 329.77 < 335.77 | 403.17 / 403.17 |
| 264/es, both themes | 15.07 / 21 | 0 / 0 | 391.2 < 397.2 | 501.06 / 480 |
| 900/es, both themes | not re-run | 0 / 0 | 345.77 < 351.77 | 419.17 / 419.17 |
| 264/ru, both themes | 16.26 / 22 | 0 / 0 | 391.2 < 397.2 | 502.26 / 480 |
| 900/ru, both themes | not re-run | 0 / 0 | 329.77 < 335.77 | 403.17 / 403.17 |

`facts/after-*.json`: **16 cells, 304 PASS, 0 FAIL, 16 BLOCKED** (one ring row per cell). Each has:
- normal, stale, unavailable and long-requester stale geometry;
- every decision's hover/focus rects unchanged, zero overlap, original centre still hits that button;
- **real `sendInputEvent` hover→mouseDown→mouseUp at denial's original centre**, normal and stale: exactly one `deny` response each;
- existing Tab order, Escape leaving requests pending, sender/sequence rejection, no auto-present focus, page click/typing and bounds regression rows;
- compiled-document focus remains on Back after the arming timer (`R2-focus-not-replayed-after-inert-window`). This is DOM focus, not OS focus.

## Artifact provenance and resource limits

Base source head: `46d9b6651a50c7a4d0ba3b0253f18be3ceb40db7` plus the frozen repair patch. `r2-card-build-receipt.json` records exact per-source hashes, build-time dirty patch SHA-256 `8d216d07e02aaf4869498a10290e345c1f958ab9e396d33fdc863cb5476fdb84`, resolved repository config/plugins/input, and before/after hashes of every `out/main` and `out/preload` file. `validation-receipt.json` identifies the later source/test patch (test/probe-only additions after artifact production); all compiled source hashes were rechecked byte-identical after the matrix.

The native rig bundles its own Electron main entry and **current source approvals controller** with installed esbuild for each cell. It never loads `out/main`; no claim is made that that application's main is current. The sandboxed card preload is source-unchanged and byte-identical to the known-good before artifact:
`9497956e0e76f8cabd4d840cdf11f3351553963482c354bf09f54a5117602ffe`.

After card hashes:
- HTML: `59b880b01a2fade137c8d10a521f69aeaeed4458cbe837db392f3fd54924e07b`
- JS: `89799ac8acfe12f5a1dad45532dd46d54e1b3262f331ed160ccff182b5f2b844`
- CSS: `f9c98754140b600d907bb0b91aa43c55bc49417a187409ce1b1c514d1828fc22`

A full build first completed (32.5s). Its native smoke found Chromium's implicit scrollport Tab stops; explicit `tabindex=-1` restores the decision-only order without hiding descriptive text from accessibility. The additional full build was killed by the **host-wide** guard during renderer compilation (parent's report: group5823 at 2.7GiB while host34.3/36GiB). No capture used that incomplete output. After parent approval, a single targeted renderer repair used the real resolved repository Vite config, only the card HTML input, `emptyOutDir:false`; **rc0, 3.1s**, with main/preload bytes asserted unchanged. See `card-only-build.mjs` and its log. This is not a whole-app rebuild.

Target build and final probes: heap1536MiB, `run_bounded.py --memory-mb 3000`; tool ceiling3500MiB. Build timeout240s, cell timeout180s. Successful peak RSS was **not recorded**; the cap is not represented as a measured peak. Disk before target:10,670,292KiB; after matrix:13,252,808KiB. Every cell checked >2GiB before launch (stop if insufficient). Each probe reaps its owned detached Electron group by exact PID; final process check found no rig-root processes. The native slot was then released.

## Commands and source tests

From the worktree root, with existing dependencies only:

```sh
# Native-card artifact recovery only. RECEIPT must point to session scratch.
NODE_OPTIONS=--max-old-space-size=1536 \
VITE_GOOGLE_CLIENT_ID=x VITE_GOOGLE_CLIENT_SECRET=x \
VITE_MICROSOFT_CLIENT_ID=x VITE_MICROSOFT_TENANT_ID=x \
RECEIPT="$LOCAL_OPERATOR_SCRATCHPAD/card-build-receipt.json" \
python3 ~/local-operator/scripts/run_bounded.py --timeout 240 --memory-mb 3000 -- \
  node docs/pr-evidence/browser-approvals-s6d/round-2/card-only-build.mjs

# Sequentially: width=264,900; locale=en,fr,es,ru; theme=dark,light.
NODE_OPTIONS=--max-old-space-size=1536 \
python3 ~/local-operator/scripts/run_bounded.py --timeout 180 --memory-mb 3000 -- \
  node scripts/browser-approvals-s6b-probe.mjs --out "$OUT" \
    --width "$WIDTH" --locale "$LOCALE" --theme "$THEME" --review-fixture --frames
```

Source test invocation, heap2048MiB, cap3000MiB, timeout240s:
`node --test --test-concurrency=1` with the following `scripts/*.test.mjs` paths:

| File stem | Pass | Fail |
|---|---:|---:|
| approvals-card-document | 10 | 0 |
| approvals-overlay | 32 | 0 |
| browser-approvals-route | 12 | 0 |
| browser-startup | 8 | 0 |
| browser-queue-expiry | 5 | 0 |
| browser-page-menu | 9 | 0 |
| browser-page-menu-focus | 2 | 0 |
| browser-approvals-dock-width | 2 | 0 |
| notification-spawn-sites | 3 | 0 |
| telemetry-spawn-sites | 4 | 0 |
| test-inventory | 1 | 0 |
| **Total** | **88** | **0** |

The failing announcement control initially left the test's mounted surface alive; a test-only `t.after` teardown fixed that harness leak. The final negative control substitutes only the two pre-repair source modules from HEAD, with copies restored in an EXIT trap (no git stash): **0 pass/3 fail, rc1**. Actual failures: focus `approvals-card` instead of `approvals-back`, replaced focused list row, and `Approvals, 1 waiting` instead of an empty live region. Restored source: **3 pass/0 fail, rc0**. Logs are included. Both tsc projects passed bounded; added-string check passed with no new copy and duplicate check reported889 files/0 duplicates. These are actual document/BrowserSurface module tests, not updated native app proof.

## Frames inspected

All 16 `sheets/after-{width}-{locale}-{theme}.png` were viewed. Columns are normal, stale, denial hover, and long-requester stale. All decisions including refusal are visibly clear of the footer in every sheet. The 900 cells retain generous spacing. The narrow Russian stale gloss needs internal scrolling (visible in the sheet); this is deliberate bounded descriptive overflow, **not a claim all explanatory copy fits at once**. Requested origin and expiry remain visible. `sheets/before-stale-six-cells.png` was also viewed: denial is obscured in each before cell. Full-resolution, captioned individual frames are in `frames/`; numeric evidence is in `facts/`.

## Limits retained

- **Native composite/transparency, ring hit-routing, VoiceOver and OS-level focus remain BLOCKED.** Default-on still requires an attended check or an explicit named release owner's limitation. This coder does not assume that ownership.
- No updated whole-app toolbar/badge/dialog/dock frame or smoke is claimed. Existing app evidence is historical; source-mounted tests cover direct announcement and route regressions separately. The source hashes here do not turn a card-only build into a current whole-app artifact.
- Original design and QA reviewers must check the final repair head. The focus-timeout and announcement deltas also need narrow code/UX convergence; no review gate is self-approved here.
- Implementer ran under `openai/gpt-6-astra` after the runtime reported a quota fallback from `anthropic/claude-sonnet-5-5`.
