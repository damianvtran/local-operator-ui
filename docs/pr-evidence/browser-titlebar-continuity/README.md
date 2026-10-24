# Browser titlebar colour continuity

## S5 convergence and what changed

Current `origin/main` (`75a5d07eba077d8dc7cf1538a7b3c3a03ebf9183`, package version 0.42.1) still paints the elevated route root through the reserved lane while the tab strip starts its chrome material at y32. The seam therefore remains present upstream; this PR is not superseded.

The Browser route root remains a flush, full-height elevated pane. A route-only chrome wrapper now owns `panel-top-pad`, the sunken/chrome material, and the complete y0–106 lane + tab strip + permanent address row box. S5's `BrowserUrlBar` stays in flow immediately below `BrowserTabStrip`; the find row and page remain outside the wrapper.

Matching the lane to the tab track removes the horizontal tone seam without moving tabs into the 32px traffic-light/drag lane. The nested strip and address row keep their established `data-glass-region="chrome"` roles, but a selector keyed to the wrapper's dedicated `data-browser-route-chrome` attribute clears their backgrounds so only the wrapper paints the shared alpha. In flat mode the strip and row retain their existing materials; the lane intentionally moves from elevated to the tab track's sunken rung.

The retired popout-anchor assertions/evidence were dropped. Q-2 remains relevant because S5 focus raises still feed the history scene: its named `HistorySceneRigError` now propagates through both catches, and the process-level regression checks the real exit and matrix. Q-1's same-layout test was removed from this PR and remains with its separate follow-up; no Q-1 production fix is claimed here.

Q-3 exposed a non-atomic row/page resize: a valid narrow anchor could be refused against the preceding page rect, leaving the hidden native child at its old width. Main now applies that deferred geometry when the matching rect arrives, using a synchronous visible–resize–hide sequence because hidden `WebContentsView` renderers do not deliver resize. The final dismissal and main's consistency guard are unchanged. See `q3-remediation.md` for the RED/GREEN controller test and real H8 results.

## Rendered evidence — headless only

All captures used the real built Electron app with `--window-mode=headless`, scratch HOME/config/profile/log roots, and renderer `Page.captureScreenshot`. No visible/inactive/normal Electron window was used.

- `before.png`: clean base `75a5d07eba077d8dc7cf1538a7b3c3a03ebf9183`, full glass (`enabled=true`, `coverage=full`, `intensity=80`, `material=window`), renderer SHA-256 `07e69c29ace307c3440a7adefb25f0baf68c85237226b4c31ffca2b87bca0420`.
- `after.png`: remediated change, renderer SHA-256 `1542f7961d63c2abb6532abd3ae275753a588671b6e7811dac715a4a941e897d`. The same chrome material continues from y0 through the permanent address row.
- `before-light.png` / `after-light.png`: the glass light pair (`localOperatorLight`).
- `before-flat-dark.png` / `after-flat-dark.png` and `before-flat-light.png` / `after-flat-light.png`: glass-off pairs. The lane intentionally takes the strip's sunken material in both themes.
- `narrow.png`: direct 560px narrow neighbour on the same after build.
- `overflow.png`: nine tabs with three off screen on the same after build.

`frame-metadata.json` records each frame's actual theme, glass settings and attribute, viewport and DPR. Every entry names its reviewed head `79684fb4f4589229fb49fa6a6d4a4bc612b742d4` and capture timestamp; `file` maps published captures to the exact repository filename, while unpublished base neighbour captures explicitly use `file: null`. Standard frames are 1380×900 at DPR 2; narrow is 560×900 at DPR 1. All six before/after states keep strip y32, row y69 and page y106.

The fixture page was really loaded and scrolled (`scrollY=1200`, `innerHeight=794`, page marker `y=300`). The large black page region is expected: renderer capture does not include the separate native `WebContentsView`. These are not native composite or traffic-light screenshots.

### Geometry and paint ownership

`before-geometry.json` and `after-geometry.json` are actual DOM/computed-style reads.

| Measurement | Before | After |
| --- | --- | --- |
| Tab strip rect | x=260, y=32, 1120×37 | x=260, y=32, 1120×37 |
| Permanent address row rect | x=260, y=69, 1120×37 | x=260, y=69, 1120×37 |
| Page content rect | x=260, y=106, 1120×794 | x=260, y=106, 1120×794 |
| Active tab rect | x=545, y=37.25, 166×31.5 | x=545, y=37.25, 166×31.5 |
| Sidebar rect | x=0, y=276, 260×576 | x=0, y=276, 260×576 |
| Painted chrome regions | strip y32–69 + row y69–106 | wrapper y0–106 + two transparent nested regions |
| Chrome material | `surface` at alpha 0.73 on each region | `surface` at alpha 0.73 only on the wrapper |

The sidebar, active-tab, and hairline implementations were not changed. Their measured rects are identical before and after.

## Real-path S5 results

Bounded command, run separately in clean-base and rebased-head worktrees after rebuilding each:

```sh
node scripts/browser-chrome-s4b-probe.mjs --out <scratch>
```

`base-matrix.md` and `matrix.md` are actual full-matrix outputs. Neither is represented as clean:

- Base (same result twice before remediation): **31 PASS / 8 FAIL / 6 BLOCKED / 0 pending**.
- Remediated head: **32 PASS / 7 FAIL / 6 BLOCKED / 0 pending**.
- Seven FAIL rows are shared by base and head: T1, T3, V4, V8, V13, V14, V15. They are upstream S4b-era assertions against retired S5 trigger/popout behaviour; this PR does not claim to repair them.
- Base H4 failed twice (`vpnCommitted=false`); remediated head H4 passed. No Q-1 fix is claimed from that timing difference.
- Before remediation, head H8 repeatedly retained `viewport=1120`, `titleWidth=874` and timed out on capture. Two post-fix isolated runs each passed **13/13**, with H8 at `viewport=360`, `titleWidth=114`, `geometryOk=true`, `captureError=null`. The terminal full matrix also passes H8 and has no downstream pending cascade. See `q3-remediation.md` and `history-only.md`.

Direct geometry rows R1/R2/R2-NC and page preservation P1/P2/D1 passed on base and head. D2/F1/BL1 retain their existing native-focus/fault-injection/composite limitations. No native drag-lane hit routing, native composite pixels, traffic-light pixels, or physical native interactions are claimed.

`forced-h2.md` records the actual S5 negative control: process exit **1** with `history scene: H2 search: address row did not take focus`, the outer failure matrix, and no pending H*/R2-notices, `visual-states-error`, or `no address input` cascade.

## Focused automated checks

Actual terminal results on the rebased tree:

```sh
node scripts/run-desktop-tests.mjs \
  scripts/lane-leading.test.mjs scripts/browser-address-overlay.test.mjs \
  scripts/browser-chrome-s4b-probe-rig.test.mjs scripts/browser-start-page.test.mjs \
  scripts/browser-address-raises.test.mjs scripts/browser-chrome.test.mjs \
  scripts/browser-tab-strip-focus.test.mjs scripts/browser-page-menu.test.mjs \
  scripts/browser-page-menu-focus.test.mjs scripts/browser-address-history.test.mjs \
  scripts/browser-address-autocomplete.test.mjs scripts/browser-chrome-gaps.test.mjs
# 223 passed, 0 failed

pnpm lint:scripts
# passed; 3 changed scripts lint-clean against origin/main

pnpm exec tsc --noEmit -p tsconfig.node.json
pnpm exec tsc --noEmit -p tsconfig.app.json
# both passed

pnpm check-themes
# passed; 186211 contrast assertions across 59 themes, generated CSS current,
# design-kit parity and both localOperator palettes verified

pnpm build
# passed on clean base and rebased head with inert evidence-only OAuth placeholders
# and dead backend URLs; existing CSS pseudo-element/chunk-size warnings only
```

Full CI was not duplicated locally.
