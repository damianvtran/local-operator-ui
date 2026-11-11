# New chat: choose the agent or team from the header

Operator request (2026-11-11): "Can you make it so that new chat also allows for
the selection of agent/team? Currently you can't do that from new chat and have
to start from the teams dropdown which is not as discoverable".

**What these frames are:** Storybook story frames (`Chat/Draft target`,
`chat-header-draft-target.stories.tsx`) rendered by the repo's own Electron
(`node_modules/electron`, hidden window, `webContents.capturePage()`) on
Linux/Xvfb, at 1000×452 and scale factor 1, with `TZ=America/New_York`. Fonts
differ from macOS. **These are not live-app frames.** Every story mounts the real
`ChatHeader`, `ChatDeviceSlot` and chip, fed by a story bridge that answers
`capabilities`, `profiles.list`, `teams.list`, `peers.list` and `networks.list`.
The roster has agents coder, reviewer, scout and a builtin designer, plus teams
`lopdev` (label "Local Operator Dev") and `ops`.

| frame | story | DOM read at capture |
| --- | --- | --- |
| `before-{dark,light}.png` | `Before`: the change absent, the header `origin/main` draws for a New chat | no chip; device chip "New on this device" |
| `default-closed-{dark,light}.png` | `DefaultClosed` | chip "Default agent" |
| `menu-open-{dark,light}.png` | `MenuOpen` (opened by Enter on the trigger) | rows `default, agent:coder, agent:reviewer, agent:scout, team:lopdev, team:ops`. The builtin `designer` is excluded |
| `team-picked-{dark,light}.png` | `TeamPicked`, which is also what the sidebar's "New chat with <team>" arrives as | chip "Local Operator Dev"; title "New chat with Local Operator Dev" |
| `agent-picked-{dark,light}.png` | `AgentPicked` | chip "reviewer"; title "New chat with reviewer" |
