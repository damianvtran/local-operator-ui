# Team Bridge visual restyle — evidence

Storybook (`team-bridge-*` stories), captured through the harness `browser` tool
(one tab, closed after capture). Story frames are 2560×1440 device px stored at 50%,
and the InShell frames are true 1380×900 and 800×700 viewports. `__before` is
`origin/main` @ `34a83080e6a` and `__after` is this branch.

File name: `<state>__<theme>__<before|after>.webp`.

| State | Story |
|---|---|
| `channel-selected` | Team Bridge/Page › ChannelSelected |
| `populated-dm` | Team Bridge/Page › PopulatedDirectMessage (shows the "N new messages" divider, D10) |
| `hovered-row` | Team Bridge/Page › HoveredMessageRow (inset hover tint + overlay toolbar, D7) |
| `mention-row` | Team Bridge/Message mentions › Dark (C3 bar + wash on rows naming the viewer only) |
| `thread` | Team Bridge/Page › ThreadAtMinimumWindow |
| `thread-pane` | Team Bridge/Thread pane › Populated (`surface` plane + PanelEdge) |
| `reactions` | Team Bridge/Reactions › RealRowReactions (own pill = accent on accent-wash, D11) |
| `composer-focused` | ChannelSelected with the field focused (outline ring) |
| `loading` | Team Bridge/Page › Loading (rail + timeline skeletons) |
| `empty` | Team Bridge/Page › EmptyAccount (glyph, title, line, New message) |
| `error` | Team Bridge/Page › ErrorState (one copy of the failure, one Try again) |
| `in-shell-1380` / `in-shell-800` | Team Bridge/Page › InShellChannelSelected at 1380×900 and 800×700 |

The unread state (bold name, accent badge only for mentions/DMs, `#` channel
unread = weight only) is visible in every rail frame: `launch` has 3 unread and
`Ada's agent` has 2.

Themes: localOperatorDark, radient, localOperatorLight, dracula, nord.

`operator-live-vs-after__radient.webp`: the operator's live radient frame (left;
a DM with production data) beside the after InShell 1380 radient frame (right).
Storybook has no fixture that reproduces the live data, so the composition (shell,
rail, pane, composer) is the comparison here, not the conversation shown.
