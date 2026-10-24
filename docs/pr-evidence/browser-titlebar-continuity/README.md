# Browser titlebar colour continuity

## What changed

The Browser route root remains a flush, full-height elevated pane. A route-only chrome wrapper now owns `panel-top-pad`, the sunken/chrome material, and the complete y0–69 lane-plus-tab-track box. The existing `stripRef` wrapper remains inside that padding, so the address popout still anchors at the tab row rather than the native titlebar lane.

Matching the lane to the tab track removes a horizontal tone seam without moving tabs into the 32px traffic-light/drag lane. Raising the tabs would trade a paint defect for a geometry and interaction regression.

The nested strip retains its established `data-glass-region="chrome"` role, but a glass rule clears its background. This preserves the segmented-track exclusion and active-tab stacking while preventing a second chrome alpha layer over the wrapper.

## Rendered evidence — headless only

All final captures used the real built Electron app with `--window-mode=headless`, scratch HOME/config/profile/log roots, and renderer `Page.captureScreenshot`. No visible/inactive/normal Electron window was used for the final evidence.

- `before.png`: clean base `f6b9aae9ce5594e79dddb0d654edc4b4a0862331`, full glass (`enabled=true`, `coverage=full`, `intensity=50`, `material=window`). The white/elevated horizontal band is visible above the tab track.
- `after.png`: final change, renderer SHA-256 `c1faf8bd273e39a188aea6940bad08f2a91ab20aa80846431900e9a65fea8b1c`. The same glass material continues from y0 through the tab track.
- `narrow.png`: direct narrow neighbour; the address trigger collapses to its 28px icon and the overflow chip/rule gap remains 9px.
- `overflow.png`: nine tabs with three off screen; the overflow chip/rule gap remains 9px.
- `popout.png`: the raised address editor covers the tab row at the same rect.

The fixture page was really loaded and scrolled (`scrollY=1200`, `innerHeight=831`, page marker `y=300`). The large black page region in renderer captures is expected: `capturePage` does not include the separate native `WebContentsView`. These are renderer frames, not native composite screenshots.

### Geometry and paint ownership

`before-geometry.json` and `after-geometry.json` are the actual DOM/computed-style reads.

| Measurement | Before | After |
| --- | --- | --- |
| Tab strip rect | x=260, y=32, 1120×37 | x=260, y=32, 1120×37 |
| Page content rect | x=260, y=69, 1120×831 | x=260, y=69, 1120×831 |
| Active tab rect | x=545, y=37.25, 166×31.5 | x=545, y=37.25, 166×31.5 |
| Strip→page band | 0px | 0px |
| Painted chrome owner | strip only, y=32–69 | outer wrapper, y=0–69 |
| Outer chrome material | none | `surface` at alpha 0.82 |
| Nested strip background | `surface` at alpha 0.82 | `rgba(0, 0, 0, 0)` |

The sidebar implementation was not touched; its rendered material is visually unchanged in the before/after pair. The active tab and hairline implementations were not changed.

## Real-path matrix

Command:

```sh
node scripts/browser-chrome-s4b-probe.mjs --out <scratch>/rebased-matrix-after
```

`matrix.md` is the final rebased run's actual output: **28 PASS, 0 FAIL, 14 BLOCKED, 1 pending**. All rows direct to this change passed, including:

- R1/R2: rest geometry and a 0px strip→page band;
- P1/P2/D1: popout at x=260, y=32, 1120×37, with page rect and scroll unchanged before/open/after;
- V8: narrow icon trigger;
- V14/V15: nine-tab overflow and 9px narrow/filled chip-to-rule gaps.

The history scene stopped early with `no address input`, leaving H4 and several other history rows BLOCKED and `R2-notices` pending rather than exercising them. No history-navigation code was changed or fixed here; independent QA should rerun that scene on this head. Every row the final run did exercise has PASS status.

Main moved before the PR was opened. The rebase produced a `git range-diff` `=` result, both worktrees were rebuilt, and every before/after frame plus `matrix.md` in this directory was recaptured on the rebased commits.

The matrix's D2/F1/BL1 blocked rows are its existing native-focus/fault-injection/composite limitations. No traffic-light pixels, native drag-lane hit routing, native composite pixels, or physical native interactions are claimed from this headless evidence.

## Focused automated checks

Actual commands run in the feature worktree:

```sh
node scripts/run-desktop-tests.mjs scripts/lane-leading.test.mjs
# 11 passed, 0 failed

node scripts/run-desktop-tests.mjs \
  scripts/lane-leading.test.mjs scripts/window-glass.test.mjs scripts/window-glass-renderer.test.mjs
# The two window-glass files passed all 17 tests; the lane test's then-missing
# local stylesheet variable was fixed and its final standalone result is above.

pnpm check-types:renderer
# passed

node_modules/.bin/biome check \
  src/renderer/src/features/browser/components/browser-surface.tsx \
  src/renderer/src/features/browser/components/browser-tab-strip.tsx \
  scripts/lane-leading.test.mjs
# exit 0; 20 lane-leading useTopLevelRegex warnings, no errors
# The clean base reports the same 20 warnings.

pnpm lint:scripts
# passed; one changed script lint-clean against the origin/main fork point

pnpm check-themes
# passed; 186211 contrast assertions across 59 themes, generated CSS current,
# design-kit parity and both localOperator palettes verified

pnpm build
# passed; final renderer identity above; existing CSS pseudo-element and chunk-size warnings
```

Full CI was not duplicated locally.
