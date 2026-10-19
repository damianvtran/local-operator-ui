# Team Bridge — discoverable channels and notification preferences

Frames for the discoverable-channel slice: the preview state of a channel the
reader has not joined, the muted-row register, and the conversation menu.

## How they were taken

- Storybook dev server from this branch (`npx storybook dev -p 6022 --ci
  --config-dir .storybook`, the shipped `.storybook` config, theme provider and
  i18n catalogue).
- Driven in the operator's own browser (the `browser` tool) at a 1280×720 CSS
  viewport, 2× device pixels. The committed PNGs are 2560×1440 — the source
  frame, with no downscale.
- Themes: `localOperatorDark` and `localOperatorLight`, through Storybook's
  `theme` arg (`?args=theme:<id>`).
- Each state was loaded fresh; no previous palette's variables survive.

## Frames

| file | story | state |
| --- | --- | --- |
| `preview-channel-{dark,light}.png` | `team-bridge-page--preview-channel` | a discoverable non-member: `Preview` chip in the rail, header metadata from `member_count` (24 members), join banner with its primary action. The row's title keeps its full name because the relative timestamp yields first. The story attaches message bodies on purpose; none are rendered, and the composer is absent. |
| `muted-channel-{dark,light}.png` | `team-bridge-page--muted-channel` | a joined channel whose `notify` is `mute`: quiet bell beside the unread count, populated thread and composer unchanged. The header counts the two ACTIVE member rows even though the fixture's server-shaped `member_count` is 3 (it includes the invited member). |
| `notify-menu-{dark,light}.png` | `team-bridge-page--notification-menu` | the header menu open: `Mute conversation`, then `Notification preferences` with All messages checked. |

## What the frames do not prove

- The writes themselves: `team_bridge.conversations.join` and
  `team_bridge.conversations.notify` are pinned as wire shapes in
  `scripts/desktop-contract.test.mjs`. The desktop routes that accept them land
  in separate PRs (agent-server #148 supplies the list's discoverable / member
  fields and the read route's `notify`). The UI's join body is `{tenant_id}`;
  carrying that tenant through the desktop/server join handler is the U1
  blocker being fixed in those layers, not in this UI PR.
- The optimistic patch and its rollback are exercised in
  `scripts/team-bridge-channels.test.mjs`: the exact options object
  `useSetTeamBridgeNotify` passes to `useMutation` is driven through `onMutate`
  and `onError` against a real QueryClient, asserting both scope-keyed pages
  return to their snapshots. The hook wrapper itself is not mounted, and the
  refused-write banner state is server-rendered rather than photographed.
- The menu's keyboard behaviour (roving focus, Escape, focus return) is Radix's
  and is reviewed in the open story; these stills show only the settled panel.
- These are presentational frames against the contract above, not a live
  non-member backend.
