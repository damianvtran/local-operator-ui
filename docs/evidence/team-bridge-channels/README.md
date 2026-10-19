# Team Bridge — discoverable channels and notification preferences

Frames for the discoverable-channel slice: the preview state of a channel the
reader has not joined, the muted-row register, and the conversation menu.

## How they were taken

- Storybook dev server from this branch (`npx storybook dev -p 6018 --ci
  --config-dir .storybook`, the shipped `.storybook` config, theme provider and
  i18n catalogue).
- Driven in the operator's own browser (the `browser` tool). Captures are
  1024×576 CSS px at 2× device pixels (source frames 2560×1440).
- Themes: `localOperatorDark` and `localOperatorLight`, through Storybook's
  `theme` arg (`?args=theme:<id>`).
- Each state was loaded fresh; no previous palette's variables survive.

## Frames

| file | story | state |
| --- | --- | --- |
| `preview-channel-{dark,light}.png` | `team-bridge-page--preview-channel` | a discoverable non-member: `Preview` chip in the rail, header metadata from `member_count` (24 members), join banner with its primary action. The story attaches message bodies on purpose; none are rendered, and the composer is absent. |
| `muted-channel-{dark,light}.png` | `team-bridge-page--muted-channel` | a joined channel whose `notify` is `mute`: quiet bell beside the unread count, populated thread and composer unchanged. |
| `notify-menu-{dark,light}.png` | `team-bridge-page--notification-menu` | the header menu open: `Mute conversation`, then `Notification preferences` with All messages checked. |

## What the frames do not prove

- The writes themselves: `team_bridge.conversations.join` and
  `team_bridge.conversations.notify` are pinned as wire shapes in
  `scripts/desktop-contract.test.mjs`, but the desktop routes that accept them
  land in separate PRs (agent-server #148 supplies the list's discoverable /
  member fields and the read route's `notify`; the desktop proxy forwards both).
- Optimistic update and rollback are exercised through the hook's cache
  snapshots, not through these stills; the menu's keyboard behaviour (roving
  focus, Escape, focus return) is Radix's and is reviewed in the open story.
- These are presentational frames against the contract above, not a live
  non-member backend.
