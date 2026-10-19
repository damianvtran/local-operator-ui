# Team Bridge — conversation surface frames

Captured from the REAL Storybook build of the branch (stylesheet, fonts, theme
provider and i18n catalogue all loaded), not from a bare test host.

- `populated-dm.png` — a human↔agent DM: agent badge, own messages right-aligned,
  per-conversation unread on the list row.
- `empty.png` — an account with no conversations, one statement and one action.
- `error.png` — the list read failed; the pane keeps its own empty state.
- `overflow-expanded.png` — the Team Bridge row inside the sidebar's More group,
  unread badge at the row's trailing edge.
- `overflow-collapsed.png` — the same count while the group is collapsed.

Viewport: 1024 × 576 CSS px (the Storybook window), 2× device pixels. Both
frames are the `attentionQuiet` badge register: borderless, `ink-dim` numeral,
no accent wash, so the overflow row carries a count without competing with the
approvals badge.

Reproduce:

```sh
node_modules/.bin/storybook dev -p 6017 --no-open
# then open
#   /iframe.html?id=team-bridge-page--populated-direct-message&viewMode=story
#   /iframe.html?id=team-bridge-page--empty-account&viewMode=story
#   /iframe.html?id=team-bridge-page--error-state&viewMode=story
#   /iframe.html?id=team-bridge-overflow-row--expanded-group&viewMode=story
#   /iframe.html?id=team-bridge-overflow-row--collapsed-group&viewMode=story
```
