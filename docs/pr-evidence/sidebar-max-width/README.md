# Sidebar drag ceiling 320 → 560

Frames from Storybook, story `Chat sidebar/Agent-opened rows` → `AgentOpenedTeamBound`
(`chat-sidebar-agent-opened-rows--agent-opened-team-bound`), which mounts the real
`ChatLayout` and its `ResizableDivider`. Window 1280x720 @2x, dark theme.

State: focus the sidebar separator and press `End`, which moves it to the divider's
`maxWidth` (`sidebarDockCapacity(viewport)`) - the same stop a pointer drag hits.

| frame | tree | separator rect (x, width) | sidebar width |
| --- | --- | --- | --- |
| `before-max320-1280.png` | origin/main 5013566d21a (`SIDEBAR_MAX_WIDTH = 320`) | 314, 12 | 320 |
| `after-max560-1280.png` | this branch (`SIDEBAR_MAX_WIDTH = 560`) | 554, 12 | 560 |

The separator's 12px hit band is centred on the seam, so seam = x + 6. At 560 the
rows fill the column (story probe: row 536px, every title un-truncated; the section
toolbar stays right-aligned), so no inner element caps the width.
