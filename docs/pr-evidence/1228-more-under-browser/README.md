# The More group, before and under Browser (PR #1228)

Rendered stills for the sidebar change in PR #1228: the "More" overflow
group moved out of the column's footer region into the destinations list,
directly under the Browser row.

## What these frames are

One pair per story, in the same session, against the same Storybook
server, at the same viewport and theme. `before-` is `origin/main`
(`0b03782952`, the change stashed in the worktree); `after-` is the branch
`feat/sidebar-more-under-browser`. The pairs are byte-for-byte comparable
because nothing but the sidebar changed between them.

| Story id | Theme | What the pair shows |
| --- | --- | --- |
| `shell-app-shell--nav-more-collapsed` | light | the expanded column with the group CLOSED: the More row's new seat under Browser |
| `shell-app-shell--nav-more-expanded` | light, dark | the expanded column with the group OPEN: the More row under Browser, with the revealed destinations below it |
| `shell-app-shell--nav-more-strip-collapsed` | light, dark | the collapsed strip with the group CLOSED: the ellipsis's new seat under the Browser glyph |
| `shell-app-shell--nav-more-strip-expanded` | light, dark | the collapsed strip with the group OPEN: the ellipsis under the glyph, the revealed glyphs under it |

In every frame the account foot (the profile row and the settings gear)
stays pinned at the bottom of the column. That is the point the geometry
below measures: the move took the group out of the footer region, and the
foot did not move with it.

## How they were captured

The repo's own rig mechanics, from `scripts/capture-docs-library.mjs`: a
PRIVATE `--headless=new` Chrome over raw CDP (Node's built-in
WebSocket), Chrome's argv routed through `scripts/chrome-keychain.mjs`'s
`withMockKeychain` so the run never reaches the keychain, a fresh
`--user-data-dir` removed on exit, the same readiness gate (no Storybook
preparation furniture, no `data-capture-pending` hold, fonts loaded, the
theme applied), the same animation freeze before the shutter, and a
process-group reap by exact pid on the way out.

Viewport 1280x900, `deviceScaleFactor` 2, captured at 2560x1800 and
resized here to 1280x900 for the pull request. The frames are NOT in
`docs/evidence/`: that set is a committed contract with its own manifest
and fold window, and this is a per-pull-request pair.

## The geometry the frames are evidence about

Read off the live DOM, not off the picture (CSS px, `nav-item-more`'s own
box; the Browser row's box ends at 300 in the expanded column and at 360
in the collapsed strip):

| Story | More row BEFORE | More row AFTER | Account foot BEFORE | Account foot AFTER |
| --- | --- | --- | --- | --- |
| expanded | top 754, bottom 784 | top 302, bottom 332 | top 856, bottom 888 | top 856, bottom 888 |
| collapsed strip | top 780, bottom 812 | top 364, bottom 396 | top 816, bottom 848 | top 816, bottom 848 |

The foot's box is unchanged in both widths: the column's body is the
flexible part, and it absorbed the 4px the removed footer block used to
hold, so no spacing tier moved and the foot's own padding was not
touched.
