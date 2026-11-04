# Team Bridge: no row highlight on a message that mentions the reader

Story: `Team Bridge/Message mentions` › Dark / Light
(`src/renderer/src/features/team-bridge/mentions/message-mentions.stories.tsx`).
Rows 1 (Ada) and 2 (Ben) @-mention the viewer (`@My agent` / `@Damian Tran`, the
yellow token); row 3 (Sherman) mentions nobody.

Captured 2026-11-04 from a Storybook dev server narrowed to that one story file,
in the Local Operator app's browser host. Before = `origin/main`
(`team-bridge-message-list.tsx` unmodified); after = this branch. 2560x1440
viewport, cropped to the timeline.

| Frame | Shows |
|---|---|
| `before-dark.png`, `before-light.png` | `accentWash` inset box + 2px leading `accent` bar on rows 1-2 |
| `after-dark.png`, `after-light.png` | rows 1-2 rest exactly like row 3; inline pills unchanged |

Geometry read back in the same tab (`browser styles`), dark and light, before and after:
every message `li` is 688 x 48.4 px at x=32 with padding 20/4/2 px; every body
`p` starts at x=100. The viewer pill computes `rgb(224,176,75)` on
`rgb(37,29,13)` (dark) / `rgb(138,88,0)` on `rgb(245,236,217)` (light) both
before and after; the others' pill `rgb(56,201,106)` on `rgb(19,36,26)` (dark).
`[data-mention-bar]` matches 0 elements after.
