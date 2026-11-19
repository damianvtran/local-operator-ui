# Team Bridge link-preview card: native-ratio picture, text plate rhythm

Operator report (2026-11-10): the GitHub release card's picture showed its
subtitle overlapping itself, and the text under the picture was cramped.

## Root cause

- **The overlap is GitHub's own pixels.** The og:image GitHub serves for
  `damianvtran/local-operator/releases/tag/v0.101.41` (1200x600) already draws
  the truncated title and the subtitle on top of each other; we do not redraw it.
- **The crop was ours.** The picture was `object-cover` in a box capped at
  176px. A 2:1 image in any card wider than 352px therefore centre-cropped,
  cutting GitHub's stats row and coloured language bar off the bottom.
  It is now `object-contain`: always whole, native ratio, never stretched,
  letterboxed on `media-surface` when the cap binds.

## Frames

Storybook (this branch, `pnpm exec storybook dev`), captured with the harness
browser at DPR 2 and cropped to the content. One temporary, uncommitted story
lays the four new fixture stories of `team-bridge-link-preview.stories.tsx`
(`Ready, GitHub 2:1 picture`, `Ready, no picture`,
`Ready, long title and description`, `Ready, long unbroken URL`) side by side
at the 380px measuring width. Theme and translucency come from the preview's
own `?args=theme:<id>;glass:<on|off>` seam. "Before" is the same stories with
`team-bridge-link-preview.tsx` at `origin/main` (a0464af9e0a).

The GitHub picture is a synthetic SVG drawn to GitHub's layout (the real one
carries a contributor's avatar), with the language bar flush with the bottom
edge so a crop is visible in one frame.

| Theme | Glass | Before | After |
| --- | --- | --- | --- |
| localOperatorDark | off | `before-glassoff-localOperatorDark.png` | `after-glassoff-localOperatorDark.png` |
| localOperatorDark | on | `before-glasson-localOperatorDark.png` | `after-glasson-localOperatorDark.png` |
| localOperatorLight | off | `before-glassoff-localOperatorLight.png` | `after-glassoff-localOperatorLight.png` |
| localOperatorLight | on | `before-glasson-localOperatorLight.png` | `after-glasson-localOperatorLight.png` |
