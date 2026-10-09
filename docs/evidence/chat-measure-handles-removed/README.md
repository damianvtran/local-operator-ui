# The conversation column's edges, before and after the resize handles are removed

Issue [#895](https://github.com/damianvtran/local-operator-ui/issues/895): the
conversation column carried two full-height drag handles, one 10px strip just
outboard of each edge of the 810px content column, and a persisted
`chatMeasureWidth` they wrote. In the app's two common layouts that strip sits
next to a divider that does something different. Measured here: with no panel
open the left strip starts 17px past the sidebar divider's 12px hit band; with the
run panel at its default width the column fills its 788px container to within
16px of each edge, so each strip ABUTS a divider's hit band (left strip
266-276 against the sidebar band's right edge at 266; right strip 1032-1042
against the panel band's left edge at 1042). The decision is recorded on the issue
(<https://github.com/damianvtran/local-operator-ui/issues/895#issuecomment-6067264577>):
remove the handles and the stored width; offer no Narrow/Default/Wide setting.

`before/` is the tree this branch started from (`2b05bdfb399`: `origin/main` at
v0.33.5 plus the rig and the two story arms, with the handles still mounted).
`after/` is the branch with the handles removed (`1be23c0fd04`). Each is
**3 states x 2 palettes** (`localOperatorLight`, `localOperatorDark`), one webp
per cell, plus `readings.json` with every number below.

## How to reproduce

```sh
# A Storybook per tree: the base tree from a worktree of the "before" commit, this branch's own
git worktree add --detach ~/local-operator-ui-worktrees/measure-edges-base 2b05bdfb399
(cd ~/local-operator-ui-worktrees/measure-edges-base && ./node_modules/.bin/storybook dev -p 6395 --ci --no-open)
./node_modules/.bin/storybook dev -p 6396 --ci --no-open
# One rig, run once per tree (the label picks the folder and the expectations)
env TZ=America/New_York node scripts/chat-measure-handles-removed-evidence.mjs --label before --origin http://localhost:6395
env TZ=America/New_York node scripts/chat-measure-handles-removed-evidence.mjs --label after  --origin http://localhost:6396
```

The rig launches ONE private headless Chrome per run (mock-keychain switch,
scratch profile, its own process group, reaped by exact pid), drives a real pointer
through CDP `Input.dispatchMouseEvent`, and **fails rather than printing a table**
if a reading is wrong. Every frame passes `assertFramePaints`. It imports nothing
this change deletes, which is what lets the same file run on both trees. The
stories are `shell-app-shell--chat-measure-edges` and
`--chat-measure-edges-run-panel` (`shell.stories.tsx`): the real
`CanonicalTranscript` inside the real `ChatLayout`, so the sidebar divider and the
panel divider are the app's own.

## What each frame is

The pointer is parked by a real move and held 320ms (`HOVER_INTENT_MS` is 200ms)
before the shutter, so a divider that lights on hover has lit.

| Folder | Window | The pointer is on |
| --- | --- | --- |
| `left-strip/` | 1180x900, no panel (the transcript container is 876px) | the centre of the strip the left handle occupied: the 10px outboard of the column's left edge (283-293), 17px from the sidebar divider's band |
| `right-strip-panel/` | 1512x900, run panel open at its default 420 (container 788px) | the centre of the strip the right handle occupied, next to the panel divider |
| `divider-control/` | the same 1512 scene | the panel divider itself: the control, which lights its own line on both trees |

**Reading the pair.** `before/left-strip` and `before/right-strip-panel` show the
handle's faded bar at the column edge under the pointer; the `after/` frames show
nothing there. `divider-control` is the same in both: the divider's line.

## The readings (measured in the real page, asserted as relations)

`document.elementsFromPoint` at every whole pixel of each 10px strip, at the
column's vertical middle; the top element's computed `cursor`.

| Reading | before | after |
| --- | --- | --- |
| `[data-lo-chat-measure-handle]` elements in the DOM | 2 | 0 |
| strip pixels with a handle in the hit stack, left / right (of 10) | 10 / 10 | 0 / 0 |
| computed cursor over the strips | `col-resize` | `auto` |
| 1180: container / column / column `max-width` | 876 / 810 / `810px` | 876 / 810 / `810px` |
| 1512 + panel: container / column / column `max-width` | 788 / 756 / `810px` | 788 / 756 / `810px` |
| sidebar divider centre: top element, cursor | separator, `col-resize` | separator, `col-resize` |
| panel divider centre (1042-1054): top element, cursor | separator, `col-resize` | separator, `col-resize` |
| right strip (1032-1042) against the panel divider's band (1042-1054), 1512 | adjacent | adjacent |

The two rows that did not change are the point of the control: the dividers kept
their own cursor and their own hit band, and the column is the same 810px.

## The migration, on the real path

Before the page's scripts run (`Page.addScriptToEvaluateOnNewDocument`),
`localStorage['ui-preferences-storage']` is seeded with
`{state:{chatMeasureWidth:1100,...},version:1}` and the story is loaded.

| After hydration | before | after |
| --- | --- | --- |
| column `max-width` | `1100px` (the override applied) | `810px` |
| `--lo-chat-measure-override` on the root | `1100px` | empty |
| stored blob `version` | 1 | 2 |
| stored blob has `chatMeasureWidth` | yes (1100) | no |

## What this does NOT claim

- It does not claim the removal is invisible at every width: a reader who had
  customised the column (520 to 1100) gets 810 after the migration, silently. That
  is the decision, not a side effect.
- It is one story at two window sizes in two palettes, hovering the left strip,
  the right strip and a divider. It is not a sweep: the other 57 palettes and
  other widths are not photographed. The 750px container gate in `CHAT_MEASURE` is
  inert at the shipped width and is untouched.
- The `before/` frames were taken from the base tree's Storybook at the
  `2b05bdfb399` commit, whose source is `origin/main` plus the rig and the two
  arms (the arms pass `measureHandle`, the prop the chat page passes). They show
  what the app drew, in the Storybook shell, not the packaged app.
- The `before/` frames were re-taken from a detached worktree of `2b05bdfb399`
  with this folder's rig (the version that probes whole pixels, copied in) after a
  first run showed the right strip's last pixel falling into the panel divider's
  band. The story arms and the app source on that tree are what the commit holds.
- A frame cannot show a cursor. The cursor is a reading (`readings.json`), and
  the frame is the pixels under it.
