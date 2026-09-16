# The chat sidebar's Agents section — the built-ins shortcut

`profiles.list` includes the packaged profiles beside the user's own, so a fresh
install listed six built-ins under a heading that reads "Agents": the section
said "agents you have" while showing agents the user had never installed, and
nothing told the two apart. The change is a grouping, an empty state and an
action, and all three are renderings — which is what these frames are for.

## What produced these frames

Storybook, from this branch:
`node scripts/capture-evidence.mjs http://localhost:<port>
--only=chat-sidebar-agents --allow-backend`, twelve themes per story, `420x760`
per story (the sidebar's own 360px column inside a little ground, because the
section is three rows and an action and a 1280px frame of it would be a picture
of the app's empty right-hand side).

| story | what it is |
| --- | --- |
| `empty-with-shortcut` | no agents of the user's own, six built-ins waiting |
| `empty-without-shortcut` | the same empty section on a server with no packaged profiles — the shortcut is absent, not broken |
| `installed-with-builtins` | three agents of the user's own, three built-ins still available |
| `all-installed` | nothing left to offer: no line, no action |
| `installing` | the batch in flight, determinate |
| `install-summary` | the end of a mixed batch: one already present, one name the user already holds |

The last two are driven by their stories' own `play` functions — a real click on
the action, then a wait for the state under test — so they are pictures of the
component reacting rather than of a prop that fakes a state.

## What these frames do NOT prove

- **Not that the local backend answers any of this.** The catalogue and install
  responses are stubbed at `window.api.desktop.request`, shaped from
  `server/routes/desktop_profiles.py` (`profiles.list`, `profiles.install` and
  its `NameTakenError` → 409 branch).
- **Not that a real install copies a seed.** The per-name outcomes are fixtures;
  the counting and reporting rules they drive are held by
  `scripts/install-builtin-batch.test.mjs`, which runs the shipped batch module
  against a scripted installer.
- **Not `already_installed`.** That field is additive, and a backend older than
  it omits it — read as "installed", which is the honest reading of a response
  that does not distinguish and never a failure the user would chase.
- **Not the rest of the sidebar.** These frames carry the section inside the real
  `ChatSidebar`, so the rows above and below it are real too, but the claims here
  are about the Agents section alone.
