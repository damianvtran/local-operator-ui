# Mention row highlight removed; Settings titlebar strip filled

Captured 2026-11-04 with the harness `browser` tool (the operator's app browser host) against
Storybook dev on this worktree (`iframe.html?id=<story>&args=theme:<theme>[;glass:on]`),
downscaled to 1280px wide.

- `before-*`: base `d4fa5c45ff1`. For Settings, only `settings-page.tsx` was swapped back to
  the base revision; the new `SettingsMacChrome` story was used for both halves.
- `after-*`: this branch.

| File | Story | Theme | Shows |
|---|---|---|---|
| `before-mention.png` / `after-mention.png` | `team-bridge-thread-row--list-mentioned-unread` | LO dark | wash + 2px accent bar at rest → none; yellow `@Damian` token unchanged |
| `after-mention-hover.png` | same | LO dark | pointer over the row: ordinary `surface` hover, no wash |
| `before-settings.png` / `after-settings.png` | `shell-app-shell--settings-mac-chrome`, `glass:on` | LO dark | 32px strip above the content column unpainted (stand-in desktop stripes at full strength) → continuous |
| `before-settings-light.png` / `after-settings-light.png` | same | LO light | same |

The striped background is a deliberate stand-in desktop: Storybook paints an opaque canvas behind
every story, which hides the hole. Geometry readback (`browser` styles), dark, glass on:

- before: `[data-settings-content]` (the only `canvas-content` painter) `rect 500,32 780x688`,
  `margin-top: 32px`. Nothing painted y 0-32 over x 500-1280.
- after: `[data-glass-region="canvas-content"]` `rect 500,0 780x720`, `padding-top: 32px`,
  background `canvas @ 0.62`. Scroller `rect 500,32 780x688`, transparent.

Fixture data is synthetic.
