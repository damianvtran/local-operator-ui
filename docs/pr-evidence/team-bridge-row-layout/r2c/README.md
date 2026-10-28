# Round 2 — browser-tool evidence completion (r2c)

Captured with the harness `browser` tool (desktop app host, background tab) from the
retained story-scoped static build of PR head **9418de0044**. No new build/install.
**Local merge head 70ed973562** (9418 + origin/main 3332dfe562): the merge delta touches
no Team Bridge runtime source, no styles and no hold flags (only
`team-bridge-overflow-row.stories.tsx` and a comment-only edit in
`team-avatar-bubble.tsx`), so these frames apply to 70ed973562 by **code-only
compatibility**, not by recapture.

Holds: source keeps both `*_SHIPPED_IN_THIS_BUILD = false`. Frames marked
`HOLDS-FLIPPED` (and every picker frame) come from scratch builds that open the
hold via a runtime flag; no user can reach them in this build.

| file | what it shows |
|---|---|
| 01 / 02 | cold-open board run 2 (fresh page load, popover open; later frame) — light 1088 |
| 03 | bare picker, top of grid, settled (capture landed ~6.5 s after load) |
| 04 | bare picker scrolled to bottom — **after** the grid reached full height; NOT a mid-probe frame |
| 05 | bare picker settled |
| 06 | D3: shipped-holds hover, **dark** 1088 (no toolbar, card closed); hover ground rgb(48,45,41), row 800x40.09 |
| 07 | D2: thread pane **after**, dark 1088, HOLDS-FLIPPED; every row 416 px = pane width 416 |
| 08–11 | D4: `:focus-visible` ring paint on the draft trigger, light/dark, 640 and 420 tall. **Not keyboard modality**: focus came from the tool's background-tab click activation, which Chrome matched as `:focus-visible`. Ring geometry is real; Tab-key reachability is not proven. |

See `QA-COLD-OPEN-r2c.md` for the timings.
