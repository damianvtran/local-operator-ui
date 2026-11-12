# New chat: choose the agent or team from the header

Operator request (2026-11-11): "Can you make it so that new chat also allows for
the selection of agent/team? Currently you can't do that from new chat and have
to start from the teams dropdown which is not as discoverable".

**What these frames are:** Storybook story frames (`Chat/Draft target`,
`chat-header-draft-target.stories.tsx`) rendered by the repo's own Electron
(`node_modules/electron`, hidden window, `webContents.capturePage()`) on
Linux/Xvfb (1280×1024 screen), at scale factor 1, with `TZ=America/New_York`.
Fonts differ from macOS. **These are not live-app frames.** Every story mounts
the real `ChatHeader`, `ChatDeviceSlot` and chip, fed by a story bridge that
answers `capabilities`, `profiles.list`, `teams.list`, `peers.list` and
`networks.list`. The roster has nine agents (coder, reviewer, scout, architect,
qa-tester, manager, ux-reviewer, `pergamon-service-delivery-specialist` and
`pergamon-service-delivery-specialist-eu`) plus a builtin `designer` that is
excluded, and teams `lopdev` (label "Local Operator Dev") and `ops`.

**Generations.** `before-*` are the round-0 capture, kept byte-for-byte: the
round-1 re-shoot of `Before` decoded to 0 differing pixels in both themes. Every
other frame is the round-1 remediation capture (Teams-before-Agents order, the
nine-agent roster, the no-wrap draft row). The DOM facts below were read in the
same window just before each capture. "drawn" means `elementFromPoint` at the
element's centre returns the element or one of its descendants.

| frame | story | DOM read at capture |
| --- | --- | --- |
| `before-{dark,light}.png` | `Before`: the change absent, the header `origin/main` draws for a New chat | no chip; device chip "New on this device" |
| `default-closed-{dark,light}.png` | `DefaultClosed` | chip "Default agent" |
| `menu-open-{dark,light}.png` | `MenuOpen` (opened by Enter on the trigger) | rows `default✓, team:lopdev, team:ops`, then the nine agents. The list is 408px tall and scrolls (content 484px). The menu is bounded at `min(26rem, available height)`, and `team:ops` is inside the menu's box |
| `menu-open-team-current-{dark,light}.png` | `MenuOpenTeamCurrent` | the same rows, with `team:lopdev` marked ✓ |
| `team-picked-{dark,light}.png` | `TeamPicked`, which is also what the sidebar's "New chat with <team>" arrives as | chip "Local Operator Dev"; title "New chat with Local Operator Dev" |
| `agent-picked-{dark,light}.png` | `AgentPicked` | chip "reviewer"; title "New chat with reviewer" |
| `busy-{dark,light}.png` | `Busy` (a send is starting) | `aria-disabled="true"`. Computed `color` is `ink-disabled` (dark `rgb(95,90,78)`, light `rgb(154,148,136)`) and `opacity` is `1` |
| `long-agent-picked-{dark,light}.png` | `LongAgentPicked`: a 36-character slug | the chip ellipsises at 24ch. The title is untruncated at this width |
| `long-agent-menu-open-{dark,light}.png` | `LongAgentMenuOpen`, with the list scrolled to the current row by the story | the current row `pergamon-service-delivery-spe…` ✓. Both long rows carry `title` = their full name |
| `team-picked-900-{dark,light}.png` | `TeamPicked900`, 584px band: a **508px title row** | title truncated; path yields; agent chip **drawn**, device chip **drawn**, `...` drawn |
| `team-picked-800-{dark,light}.png` | `TeamPicked800`, 484px band: a **408px title row** | title truncated to "New cha…"; path at 0px; agent chip **drawn**, device chip **drawn**, `...` drawn |
| `team-picked-640-{dark,light}.png` | `TeamPicked640`, 324px band: a **248px title row** | title yields entirely; agent chip **drawn**; device chip clipped at the row edge ("New on"), so its centre is **not drawn**; `...` drawn |

**How the narrow bands were sized.** The width is the band's, not the app
window's. UX round 1 measured a 408px title row in the app at an 800px window. A
story band loses 76px to its own padding and action cluster, so band = window −
316. The 900 and 640 rows **assume** the same 392px around the row that 800 had.
Whether the app's sidebar collapses at 640 was not measured here; the live re-walk
belongs to UX round 2. At 640 (below the 800px minimum the header documents as
the device chip's fold), the device chip is the one that gives way. The row's
`overflow-x-clip` cuts it at the row edge rather than letting it paint over the
`...` actions button. An unclipped first attempt did paint over the button: the
chip spanned x 197–351, and the button sits at 276–308.
