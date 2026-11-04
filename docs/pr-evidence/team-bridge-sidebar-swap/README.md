# Team Bridge sidebar swap: PR evidence frames

The operator asked that on Team Bridge "the left sidebar becomes the team bridge
view and then there's an arrow back", so the window no longer shows two sidebars.

## How these were taken

- Storybook was run in dev mode (`storybook dev -p 6106`) from this branch's
  worktree and captured through the harness `browser` tool, using one reused tab.
- The viewport was fixed at an exact size (1380x900 or 800x600, the app's default
  window and its minimum width) by the tool's `record_start width/height`, and
  each frame was a `screenshot` taken during that session. Every PNG was checked
  with `sips` before conversion: 1380x900 or 800x600 exactly.
- The `after-*` frames are the `Team Bridge/Page › InShell*` stories, which mount
  the real `ChatLayout` in route mode exactly as `app.tsx` does on `/team-bridge`.
- The two `before-*` frames, and the `after-1380-back-badge` frame, used a scratch
  edit (not committed) of `Shell/Sidebar attention badges › Counts`. That story
  mounts the real `SidebarNavigation` against its scripted desktop bridge; the
  edit put the bridge page in its `<main>`. Without `routeSidebar` it renders
  `main`'s two-sidebar shape. With `routeSidebar` it renders the swap, and the
  nav's real attention reads feed the Back badge.
- Theme `radient` is the operator's live theme. `localOperatorDark` and
  `localOperatorLight` are also included for the main frame.

## Frames

| Frame | What it shows |
|---|---|
| `before-1380-two-sidebars-radient` | `main`: app nav + bridge rail (288px) side by side |
| `before-800-two-sidebars-radient` | `main` at the 800px minimum: nav measured `rect 0,0 280x600` plus the 288px rail leave the conversation 232px |
| `after-1380-{radient,localOperatorDark,localOperatorLight}` | One column: Back, org switcher, sections, account foot |
| `after-800-radient` | The 800px minimum: one 280px column, 520px conversation |
| `after-1380-collapsed-pref-radient` | User preference = collapsed strip: the bridge column still docks (280px); pixel-identical to `after-1380-radient` (`magick compare -metric AE` = 0) |
| `control-1380-collapsed-pref-nav-route-radient` | The same preference on a nav route: the 56px strip (measured `rect 0,0 56x900`), so the preference is kept for the way back |
| `after-1380-urdu-radient` | `ur` RTL: column on the right, Back arrow points right, translated copy |
| `after-1380-eligibility-gate-radient` | An early return (`plan_required`) still draws Back + title in the column |
| `after-1380-back-badge-radient` | Back carries the aggregate badge: 10 = Aida 1 + Notifications 6 + Browser 2 + Mesh 1 (Team Bridge's own 3 excluded); accessible name "Leave Team Bridge, 10 items waiting elsewhere" |
| `after-800-thread-radient` | Thread takeover at 800: pane measured `rect 280,0 520x600`, i.e. the whole content region |
| `control-800-thread-start72-radient` | Same story with the old `start-72` forced (scratch edit, reverted): pane `rect 568,0 232x600`, leaving a 288px canvas gap. This is the regression the `start-0` fix prevents |

## Geometry (measured with the browser tool's `styles`)

- At 1380 and at 800 the route host is `rect 0,0 280x<h>` and `<main>` starts at
  x=280. That is the one left column (280 is the width already stored in this
  Storybook's UI-prefs store; the default is 260 and the range is 220–320).
- At 800 the two-sidebar `main` gave the conversation 800 − 280 − 288 = 232px
  (nav `rect 0,0 280x600`, `<main>` `rect 280,0 520x600` holding the 288px rail).
  The swap gives it 520px.
