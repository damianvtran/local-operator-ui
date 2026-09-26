# The chat header's identity slot, as controls

The chat header's identity line - the joined `manager · lopdev` string under
the conversation title on `origin/main` - becomes two controls that open the
team and agent menus, plus a rename pencil the title reveals on hover. This
directory is the "after" half of the pair; `before-main/` is the "before"
half, captured from `origin/main`'s header under this branch's stories (its
README carries the exact recipe, and the set is declared in the manifest so a
sweep cannot rewrite the base-tree claim).

## How these frames were produced

This worktree's own Storybook (a session-unique port), the production
`ChatHeader` mounted on the band it really sits on:

    node scripts/capture-evidence.mjs http://localhost:6117 \
      --only=chat-header-identity \
      --themes=localOperatorDark,localOperatorLight --allow-backend

The run's manifest record reads `capturedAtHead` `2a50f2e64` with
`dirtyWorkingTree: true`: the running tree was that commit plus this round's
source edits (the U4 swap guard, the formatting pass), which are the edits
this evidence ships with - nothing that renders a pixel was changed after the
capture, and the files added afterwards are this README, the manifest's
records and the records test's entry for them. `--allow-backend` is required
because the operator's live daemon answers on `127.0.0.1:1111` on this host;
every story here answers `desktop.request` from its own bridge (`teams.list`,
`commands.entities`, `sessions.command`), so no frame can show a live reply.

## What each state is, and what makes it falsifiable

| frame | what it is |
| --- | --- |
| `team-bound` | The operator's own case: team bound, no `/agent`, so the agent control reads the team's manager. The band at 560. |
| `team-menu-open` | The team menu after a real press: rows `lopdev` / `minerva`, the current row marked with the authored 8px dot. The entry asserts the menu's own hook at shutter time - a closed menu fails the run. |
| `agent-menu-open` | The agent menu, same terms, from the agent trigger. |
| `team-menu-keyboard-highlight` | One `ArrowDown` after a pointer-open: Radix's roving focus on the first row, `[data-highlighted]` asserted present. |
| `team-trigger-hover` | The team trigger under the rig's real pointer (asserted `:hover`), the pre-click state. |
| `team-trigger-focus` | The same trigger reached by real Tab presses, `:focus-visible` (a programmatic `.focus()` would not match - which is why the entry walks). |
| `pencil-focus` | The pencil revealed by `group-focus-within` on the title block, reached by Tab. |
| `team-busy` | A switch in flight: the story holds the receipt for six seconds, the entry picks over the keyboard, and `aria-busy="true"` is asserted on the trigger - the spinner takes the chevron's slot and the box does not move. |
| `title-hover` | The pencil revealed by hovering the TITLE, opacity only (nothing reflows). |
| `no-team-no-agent` | The assign affordance both controls fall to: subdued `No team` / `No agent` with chevrons. |
| `assign-team-menu` | The assign affordance's menu, press-opened. |
| `agent-and-team` | Both bound, agent first - the order the joined string had. |
| `before` | Today's plain string, rendered by the same story on this tree (the pair's third check: it must be byte-comparable to main's). |
| `wide` | The same arrangement at 1380, the width the operator's screenshot was taken at. |
| `narrow-fold` | The operator's own 49-character title at the 560 band: the identity line sits on the clipped second line. The D3 boundary frame - the fold is the trade, photographed. |
| `team-menu-empty` | The catalogue answering with no rows: `No teams are registered.` |
| `team-menu-refused` | The registry's refusal in its own words (`The profile registry is unavailable`). The story holds the rig's `capturePending` latch until `[data-header-identity-error]` is in the DOM, and the entry asserts that row - the first capture of this frame raced the query's retry window and photographed `Loading teams…` (design D1). |

## What the measurements behind the frames say

From a private headless Chrome driving these stories over raw CDP (the same
launch shape the rig uses), reading live geometry:

- **Focus cannot move the header** (UX U1). With the wrap-clip block on
  `overflow-clip`, `scrollTop` stays `0` across focus of the agent control,
  focus of the team control and blur, at the 560 band, the app's 220px
  pane-open width, and 800; the title's `y` stays `10` throughout. Before the
  fix the block scrolled 0->3 at rest and 22px at the fold, and blur never
  restored it.
- **The fold's arithmetic** (design D3): at the 49-character title, the
  identity line's top sits 21.7px below the block's top - the clipped second
  line - at 560 and at 220, while the title and its pencil stay on line one.
  The one-line clip band is 20px, which is why a 24px control cannot live in
  it (see the PR's Judgement calls on design D5).
- **The current-row dot** (design D2): 8x8 CSS px after the `size-2`
  carve-out; 15-16px before it.
- **The first-click swap** (UX U4): one press on the sibling trigger leaves
  `team: false, agent: true` - the swap opens in one gesture. The trace
  without the guard: agent `aria-expanded` true at t, team's close-autofocus
  refocuses its trigger at t+~2ms, the just-opened agent menu reads that as
  focus-outside and dismisses itself at t+4ms.
