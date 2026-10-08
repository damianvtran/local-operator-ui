# The chat header's action cluster, and its overflow menu

These frames photograph the chat header's action cluster
(`src/renderer/src/features/chat/components/chat-header-cluster.stories.tsx`,
title `Chat/Header cluster`): the **`...` menu** — the keyboard door to the panel
entries — and, in the five brand-pair frames, the header itself in its 56px band
with the Asks trigger in each of its states. The four panel triggers left this
cluster for `panel-rail.stories.tsx` (#872), so `at-cap`, `one-approval`,
`trigger-dot`, `canvas-open-badge` and the `console-blip*` pair predate that move
and are not re-shot here.

The `before/` subdirectory is the other half of the cluster-spacing change
(3f1f4e5a3): the same five stories rendered by the tree before the reservation
became conditional, with its own README and its own reason for not being
sweepable. Nothing in this file changes that set.

## What produced these frames

Storybook, from this branch, with the story file above:

```
npx storybook dev -p 6751 --ci --quiet --no-open
node scripts/capture-evidence.mjs http://localhost:6751 --allow-backend \
  --only=chat-header-cluster-- \
  --dirs=conversation-actions-open,transcript-display-submenu-turn,transcript-display-submenu-response \
  --themes=localOperatorDark,localOperatorLight
```

`--dirs=` is the narrowing that matters here, and it is not decoration: all three
states are the SAME story (`chat-header-cluster--no-approval`), each entry writing
its own directory, so `--only=` alone would also re-take `no-approval/` and the
other dirs this pass must not touch. `--only=` also makes the run APPEND mode —
nothing is cleared.

## #893 — the three menu dirs re-shot, and why only three

**#893 adds `Copy session ID` at the TOP of the overflow menu**, above the
transcript-display submenu and therefore above the first separator. The
`ChatHeader` mount in the story now passes a `sessionId` (a fixed 12-hex fixture,
`4b7f2c9a1e05`), because the item is drawn ONLY when the header receives one: a
mount without it renders a menu that silently contradicts the feature, and the
three dirs below would have shown the submenu as the first row.

**Re-shot dirs** (both themes each, 6 frames): `conversation-actions-open`,
`transcript-display-submenu-turn`, `transcript-display-submenu-response`. Their
before images are the same paths at `15a7a4ed5`
(`git show 15a7a4ed5:docs/evidence/chat-header-cluster/<dir>/<theme>.webp`).

**What did NOT change:** every directory that shows the menu closed — `at-cap`,
`no-approval`, `one-approval`, `trigger-dot`, `canvas-open-badge`, the `console-blip`
pair, and the whole of `before/`. `sessionId` is read only by the menu item
(`chat-header.tsx`); with the menu shut it draws nothing, so those frames are
untouched and were not re-taken.

**One rig change this needed.** The two submenu entries walk the menu by keyboard
(`ArrowDown`, then `ArrowRight`). With `Copy session ID` as the menu's first item,
one `ArrowDown` lands on Copy and `ArrowRight` opens nothing — the entry's own
`expectPresent` on `[role="menuitemradio"]` refused loudly rather than filing the
closed menu under a name that claims the submenu is open. Both entries now press
`ArrowDown` twice; that is the feature moving the submenu one slot down, and the
rig says so at the entry.

## What these frames do not prove

The menu's items are the product's own, drawn from the header's real props; the
COPY itself is not exercised here — the frame shows the item, not a clipboard
write. The write path and its refusal are `scripts/chat-session-copy-id.test.mjs`'s
and the QA round's over CDP.
