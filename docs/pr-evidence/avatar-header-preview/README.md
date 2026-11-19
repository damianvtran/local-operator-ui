# Avatar/header geometry evidence

## Provenance and limits

- Before: v0.47.0, `3fa4d1c9f02`, using the existing `verify-047` worktree. Both production files were byte-unmodified; only a fixture-only story was added.
- After: branch `fix/avatar-header-and-preview`, based on current main `023c58964e1`.
- Render path: shipped React components and shipped styles/fonts in Storybook, driven by the harness browser tool. Story data is synthetic: the same generated avatar PNG and agent records, and stubbed desktop capability/identity/device reads. No operator image was read or modified. These are component renders, not a native packaged-app or live-daemon proof.
- Band widths are measured component widths (1000 and 560 CSS px), not native window resizing. Font scale sets the root to 16 or 20px (100% / 125%). Both brand themes use the preview's documented `args=theme:...` path.
- Rectangles come directly from browser `styles` / `getBoundingClientRect`; centres are derived as `y + height / 2`, with up to 0.01px rounding discrepancy. They are flex-item/line-box centres, not optical glyph-ink centroids.
- Frames: `docs/evidence-frames/avatar-header-preview/` (ignored generated artifacts, intentionally not committed). Four `comparison-*.png` sheets contain labelled crops of those actual screenshots; the full screenshots remain beside them. Local absolute path: `~/local-operator-ui/.worktrees/avatar-header-preview/docs/evidence-frames/avatar-header-preview/`.
- All requested component geometry was measurable headlessly. Native focus, native file picker, VoiceOver and packaged rendering were not exercised by this component matrix; no claim is made for those paths. Cropper implementation and keyboard/accessibility handlers are untouched.

## Centre measurements (CSS px)

| Phase | Theme | Band px | Font scale | Avatar centre | Title centre | Agent centre | Team centre | Device centre |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| before | localOperatorDark | 1000 | 1 | 76.840 | 76.850 | 82.050 | 82.050 | 82.050 |
| before | localOperatorDark | 1000 | 1.25 | 86.060 | 86.065 | 92.440 | 92.440 | 92.440 |
| before | localOperatorDark | 560 | 1 | 76.840 | 76.850 | 82.050 | 82.050 | 82.050 |
| before | localOperatorDark | 560 | 1.25 | 86.060 | 86.065 | 92.440 | 92.440 | 92.440 |
| before | localOperatorLight | 1000 | 1 | 76.840 | 76.850 | 82.050 | 82.050 | 82.050 |
| before | localOperatorLight | 1000 | 1.25 | 86.060 | 86.065 | 92.440 | 92.440 | 92.440 |
| before | localOperatorLight | 560 | 1 | 76.840 | 76.850 | 82.050 | 82.050 | 82.050 |
| before | localOperatorLight | 560 | 1.25 | 86.060 | 86.065 | 92.440 | 92.440 | 92.440 |
| after | localOperatorDark | 1000 | 1 | 75.990 | 76.000 | 75.990 | 75.990 | 75.990 |
| after | localOperatorDark | 1000 | 1.25 | 85.000 | 85.005 | 85.000 | 85.000 | 85.000 |
| after | localOperatorDark | 560 | 1 | 75.990 | 76.000 | 75.990 | 75.990 | 75.990 |
| after | localOperatorDark | 560 | 1.25 | 85.000 | 85.005 | 85.000 | 85.000 | 85.000 |
| after | localOperatorLight | 1000 | 1 | 75.990 | 76.000 | 75.990 | 75.990 | 75.990 |
| after | localOperatorLight | 1000 | 1.25 | 85.000 | 85.005 | 85.000 | 85.000 | 85.000 |
| after | localOperatorLight | 560 | 1 | 75.990 | 76.000 | 75.990 | 75.990 | 75.990 |
| after | localOperatorLight | 560 | 1.25 | 85.000 | 85.005 | 85.000 | 85.000 | 85.000 |

The before defect grows from approximately **5.2px** to **6.38px** at the larger font. After, the maximum rounded centre spread is **0.01px** for both themes, both widths and both font scales.

## Saved-picture field

| Theme | Before | After |
|---|---:|---:|
| localOperatorDark | 40 × 40px | 80 × 80px |
| localOperatorLight | 40 × 40px | 80 × 80px |

Only `PictureProbe` and its empty fallback size token change (`size-10` to `size-20`). `AgentMark`, existing chrome, the stored image, crop/pan/zoom implementation, buttons and accessible names remain unchanged.

## Stress cases

At 560px / 125%, in both themes:
- Missing device control: avatar/agent/team centres **85.000**, title **85.005**.
- Long, normally truncated title: same centres **85.000 / 85.005**.
- Forced multiline title: avatar/agent/team/device **127.810**, title **127.815**. The story deliberately permits wrapping with a 10ch title constraint to stress the layout; normal production titles still truncate. The interactive row takes its natural height rather than clipping the title or focus to 20px.

## Repeat

From this worktree, use the repository's managed Storybook launcher and the harness browser:

```sh
node scripts/with-storybook.mjs --port 6048 -- <your-owned-wait-command>
```

Header URL: `http://localhost:6048/iframe.html?id=features-agents-agent-avatar--header-geometry&band=560&scale=1.25&args=theme:localOperatorLight`.
Vary `band=1000`, `scale=1`, theme `localOperatorDark`, and `missing=1`, `long=1`, or `long=1&wrap=1`.
Settings URL: `http://localhost:6048/iframe.html?id=features-agents-agent-avatar--editor-with-picture&args=theme:localOperatorLight`.

The header fixture asserts the actual rendered centres after fonts/picture/controls settle. Success exposes `[data-centre-spread]`; failure exposes `[data-geometry-error]`. Its Storybook `play` function uses the same assertion. The identical fixture against v0.47.0 exposes the error marker at all four width/scale combinations; the fixed source exposes success at all four. The assertion tolerance is 0.05 CSS px.

## Targeted checks

- `node scripts/run-desktop-tests.mjs scripts/avatar-layout.test.mjs scripts/agent-avatar.test.mjs scripts/header-identity-model.test.mjs scripts/header-identity-menu.test.mjs`: **90 passed, 0 failed**.
- `pnpm check-types:renderer`: passed.
- `pnpm check-types:main`: passed.
- Targeted Biome check for the three changed renderer files and test: passed.
- Full automated suite/build: delegated to CI once, not duplicated locally. Independent QA and design review are required before merge.
