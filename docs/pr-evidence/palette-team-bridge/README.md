# Team Bridge in the command palette: evidence

Storybook story `Command palette / Team Bridge results`
(`src/renderer/src/features/command-palette/components/command-palette-team-bridge.stories.tsx`),
captured through the harness `browser` tool (one tab, closed after capture) against a
Storybook booted by `scripts/with-storybook.mjs` and reaped by exact pid afterwards.
The stories stub only the desktop transport (`window.api.desktop.request`). The palette's
hooks, cache keys and ranking are the shipped ones. Frames are 2560×1440 device px,
cropped to the palette and stored at 50%.

- `__after` is this branch.
- `__before` is `origin/main` @ `a70a761ae47`, with the same story file copied in. The
  stub transport and fixture are identical, so the only difference is the code under test.

File name: `<state>__<theme>__<before|after>.webp`. Themes: `localOperatorDark`, `radient`.

| State | Query | What it shows |
|---|---|---|
| `product-name` (before/after) | `team bridge` | **Before:** the query was read as the `@` agent scope plus "bridge" (the `@ Agents and teams` chip), and the only hits were `manager`'s two rows. That agent's tags (`tools:read,glob,grep,...`, `delegate:yes`) spelled b-r-i-d-g-e as a loose subsequence across keywords. **After:** the `Team Bridge` destination leads under Go to, followed by the Team Bridge section. `manager` is gone, even though the fixture still carries it with the same tags. |
| `channel` | `retention` | The `#retention-analysis` channel, with its kind and organization as secondary text and its unread count (3) in the shared attention badge. |
| `person` | `ola` | Ola's person row (opens their DM; the DM has 1 unread), then her chief of staff `Aida (Ola Fagbemi)`, found by the owner's name. |
| `agent` | `aida` | Two chiefs of staff both named Aida, told apart by owner (`Aida (Ola Fagbemi)`, `Aida (Ben Okafor)`, the #1643 rule). |
| `scoped` | `tb general` | The `tb` scope word narrows to Team Bridge only. The chip names the scope, and two `#general` rows are told apart by organization. |
| `single-org` | `general` | A reader in one organization. Rows carry no organization caption. |

The fixture has two organizations (Minerva, Radient) except in `single-org`. Opening a
row is covered by `scripts/palette-team-bridge.test.mjs` (the address each row opens)
and `scripts/team-bridge-view-restore.test.mjs` (the real page, mounted on a
`?tenant=&person=` link, selects that person's rail row).
