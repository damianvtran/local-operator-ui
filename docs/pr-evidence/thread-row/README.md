# Thread row: before/after Storybook frames

Captured 2026-11-04 with the harness `browser` tool (the operator's app browser host), through the
tokened Storybook manager URL `/?path=/story/team-bridge-thread-row--<story>&args=theme:<theme>&full=1`.

- `before-*`: origin/main `a70a761ae47`, with an uncommitted copy of the four `List*` stories
  (same fixtures, rendered through the real `TeamBridgeMessageList`, so the old pill is drawn).
- `after-*`: this branch, stories in `src/renderer/src/features/team-bridge/team-bridge-thread-row.stories.tsx`.

| State | Story | Dark | Light |
|---|---|---|---|
| No replies (row absent) | `list-no-replies` | before/after `-no-replies-dark.png` | `-no-replies-light.png` |
| Read thread | `list-read` | `-read-dark.png` | `-read-light.png` |
| Unread (12 of 18) | `list-unread` | `-unread-dark.png` | `-unread-light.png` |
| Many participants (5, 3 shown, one agent) | `list-many-participants` | `-many-participants-dark.png` | `-many-participants-light.png` |

Themes: `localOperatorDark`, `localOperatorLight`. Fixture data is synthetic (no hub involved).
