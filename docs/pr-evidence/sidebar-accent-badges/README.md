# Sidebar accent badges: evidence

Every sidebar attention count now goes through the shared `AttentionBadge`.
That badge is the filled accent pill Notifications introduced. This reverses
notifications decision D5 (2026-10-25) by operator decision on 2026-10-28.

## How the frames were made

- **Before/after pairs** (`*-before-after.webp`; left is `origin/main`, right is
  this branch): `node scripts/capture-evidence.mjs http://localhost:6231
  --only=shell-sidebar-attention-badges-- --themes=localOperatorDark,localOperatorLight`
  ran against this worktree's Storybook at a 1024x900 viewport. The "before"
  run used the same story and rig, with `origin/main`'s rail sources checked out
  for the duration. Both runs passed the rig's per-row readiness expectation
  (each seeded row's own `nav-<row>-badge` is present at shutter time).
- **Window glass** (`glass-*`) and **Team Bridge** (`tb-*`): the harness
  browser on the same Storybook (`args=theme:<theme>;glass:on`). A query
  confirmed `html[data-glass]` was set. `capture-evidence.mjs` has no args path
  for glass.

The story is `Shell/Sidebar attention badges`
(`src/renderer/src/shared/components/navigation/sidebar-attention.stories.tsx`).
It renders the real `SidebarNavigation` inside `ChatLayout` and feeds each row
through that row's real read:

| Row | Source | Small | Overflow |
| --- | --- | --- | --- |
| Aida | unseen completion receipt on her catalogue row | 1 | 1 |
| Notifications | `notifications.count` | 6 | 128 -> `99+` |
| Browser | live consent requests on the browser projection | 2 | 12 |
| Mesh (in More) | waiting `approvals.list` rows | 1 | 40 |
| Team Bridge (in More) | `team_bridge.unread` account total | 3 | 75 |
| More | `moreAttentionCount`, the sum of hidden rows | 4 | 115 -> `99+` |

## What the frames show

- `counts-*`: every row with a count shows the accent pill. More's `4` is the
  sum of Mesh `1` and Team Bridge `3`. Before, only Notifications was filled.
- `more-open-*`: Team Bridge `3` and Mesh `1` show under More in the same
  register, and every badge ends at the same right edge as More's chevron column.
- `overflow-*`: `128` reads `99+` and two digits fit without clipping. Before,
  More printed `115` uncapped in the quiet register.
- `collapsed*`: in the 56px strip, each count is a 14px corner mark. A collapsed
  `99+` covers much of the icon. That geometry comes from main's Notifications
  corner mark, which already did the same, and now applies to every row.
- `glass-*`: the same frames with window glass on, in both themes.
- `tb-invitation-waiting-*`: inside Team Bridge, the invitation, channel and
  direct-message unread counts show the same pill.
