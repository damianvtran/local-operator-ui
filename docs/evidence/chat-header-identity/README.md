# The chat header's identity slot, as controls

The chat header's identity line - the joined `manager · lopdev` string under
the conversation title on `origin/main` - becomes two controls that open the
team and agent menus, plus a rename pencil the title reveals on hover. This
directory is the "after" half of the pair; `before-main/` is the "before"
half, captured from `origin/main`'s header under this branch's stories (its
README carries the exact recipe, and the set is declared in the manifest so a
sweep cannot rewrite the base-tree claim).

The operator's report of 2026-09-26 ("only happens when you hover to the right
of the conversation title but not on the title itself") turned out to be about
the window DRAG REGION, not the reveal logic: the header is a titlebar drag
surface, and points over the title text belonged to the OS, so the renderer
never saw the pointer there. The title block now opts out with
`data-titlebar-no-drag`, and the pencil opens an INLINE editor in the title's
own slot - Enter or blur saves, Escape or the X cancels - instead of the
`RenamePicker` dialog (`/rename` keeps its picker; both submit through the same
`sessions.command` path). A submitted save is committed: while the write is in
flight the field is read-only and the slot shows a busy spinner in the X's
place, and Escape / the X no-op rather than promising an abort they cannot
make. The seven `rename-*` frames below are that interaction; the region
readings behind them are in "The drag region" section.

## How these frames were produced

This worktree's own Storybook (a session-unique port), the production
`ChatHeader` mounted on the band it really sits on:

    node scripts/capture-evidence.mjs http://localhost:6237 \
      --only=chat-header-identity \
      --themes=localOperatorDark,localOperatorLight --allow-backend

The run's manifest record reads `refreshedAtHead` `d8a85eebd` with
`dirtyWorkingTree: true`: the running tree was that commit plus this round's
source edits (the inline rename and its marker, the hit-zones and capture rows
shipped with them) - nothing that renders a pixel was changed after the
capture, and the files added afterwards are this README, the manifest's
re-derived stamps, the tests that bind them, and one WHY comment on the
rename pin's `Math.ceil` (added once its effect was measured, below; it
changes no behaviour). The pass wrote 46 frames (23
states x 2 themes) and removed none: `addedFrames: 308` is `partialCapture`'s accumulated count of frames added by partial passes since the head last moved (twelve of them are this round's). `--allow-backend` is required
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
| `title-hover` | The pencil revealed by hovering the TITLE, opacity only (nothing reflows). The story frame cannot show the fix this round is about - the drag region exists only in the Electron window - so the reveal's real-window claim is the region walk in "The drag region" below. |
| `rename-edit` | The pencil press opens the editor: a real input in the title's own slot with the name select-all, and the pencil is an X (`aria-label` `Cancel rename`, asserted at shutter time). |
| `rename-edit-dblclick` | The same editor from the title's own double-click - the report's second ask, asserted present rather than photographed from a hover. |
| `rename-edit-typed` | Typing lands in the editor (`Input.insertText`, selection replaced); the input carries no chrome of its own by design - the type ramp and the X are the whole affordance. |
| `rename-save` | Enter: the editor closes and the title repaints from the story's canonical-stream stand-in with the name the command CARRIED (`Rename round trip (rig)`) - no optimistic label; the pencil carries the focus ring. |
| `rename-saving` | The save in flight (round-1 remediation): the story holds the receipt for six seconds, and the slot carries the busy spinner in the X's place with `aria-busy="true"` on the control and the field `[readonly]` - all asserted at shutter time, so a frame taken after the receipt resolved fails. |
| `rename-cancel-x` | The X click cancels: editor gone, the old title stands, the pencil is back (`Rename conversation`). |
| `rename-cancel-esc` | Escape cancels the same way. |
| `no-team-no-agent` | The assign affordance both controls fall to: subdued `No team` / `No agent` with chevrons. |
| `assign-team-menu` | The assign affordance's menu, press-opened. |
| `agent-and-team` | Both bound, agent first - the order the joined string had. |
| `before` | Today's plain string, rendered by the same story on this tree (the pair's third check: it must be byte-comparable to main's). |
| `wide` | The same arrangement at 1380, the width the operator's screenshot was taken at. |
| `narrow-fold` | The operator's own 49-character title at the 560 band: the identity line sits on the clipped second line. The D3 boundary frame - the fold is the trade, photographed. |
| `team-menu-empty` | The catalogue answering with no rows: `No teams are registered.` |
| `team-menu-refused` | The registry's refusal in its own words (`The profile registry is unavailable`). The story holds the rig's `capturePending` latch until `[data-header-identity-error]` is in the DOM, and the entry asserts that row - the first capture of this frame raced the query's retry window and photographed `Loading teams…` (design D1). |

## The drag region, and the marker that takes the title out of it

Why the pencil only appeared to the RIGHT of the title: the chat header is the
window's titlebar drag surface (`data-titlebar-drag`, `styles/index.css`), and
Chromium hands every point inside a drag region to the window manager - the
renderer gets no pointer events there. Interactive descendants opt out
automatically (`:is(button, a, input, …)` -> `no-drag`), which is why the
pencil's own points always worked and the title text's never did: the pencil
was a `<button>` all along, and the title was not.

`data-header-title` now answers the same question with the explicit marker
(`data-titlebar-no-drag` on the title's block), so the title is a client-area
surface - and the trade is real: the title no longer drags the window while the
LANE beside it and the rest of the bar still do (asserted in the same walk, so
a future edit that quietly drops the marker fails). The region walk is a
RUNNING check (`renderer-driver.mjs --scene hit-zones`, surface
`chat-header-title`), not a one-off reading - its before/after, from the same
built app either side of this branch:

- BEFORE (origin/main's app, this branch's walk - the driver script is node-side,
  not built into the app): the title line FAILED its assertion - `5 swallowed
  sample(s)` out of 5 sampled on the title, with the region's 27 entries (6
  drag, 21 no-drag) covering the overlay at `x=260 w=1120`; the pencil's points
  were already `no-drag`, which is the operator's observation in one
  measurement.
- AFTER: `0 swallowed sample(s)`, the region's drag entries 6 -> 4 (the title's
  rect carved out), and the title's own assertion PASSES; the lane outside the
  overlay and the row 8px left of the title text still drag (their own
  assertions), which is the trade as a reading.

The OS-level half - a real cursor over the title - was attempted (a Swift
`CGWarpMouseCursorPosition` probe against an `inactive` window) and is PARKED
by the manager's instruction after two runs' evidence showed a visible window
in any mode is not acceptable for agent runs on this host; the region walk and
the frames are the sanctioned evidence, and the parked probe's scripts are not
run again.

## What the measurements behind the frames say

From a private headless Chrome driving these stories over raw CDP (the same
launch shape the rig uses), reading live geometry:

- **Focus cannot move the header** (UX U1). With the wrap-clip block on
  `overflow-clip`, `scrollTop` stays `0` across focus of the agent control,
  focus of the team control and blur, at the 560 band, the app's 220px
  pane-open width, and 800; the title's `y` stays `10` throughout. Before the
  fix the block scrolled 0->3 at rest and 22px at the fold, and blur never
  restored it.
- **Entering the edit moves nothing** (measured over raw CDP against this
  worktree's Storybook, headless Chrome, the story the frames capture): the
  header's box is identical before and during (`0,0,560,40`); the title
  cluster grows by the ceil pin - 0.14px at this story's title, and up to 1px
  by construction (0.97px measured at the 1380 story's 49-character title,
  design round 1's D2: `ceil(w)-w` of the h2's fractional width; accepted as
  a bound rather than pinned to zero, because the alternative is the clipped
  glyph tail below); the identity trigger reads inside the same-state jitter band -
  two reads of ONE unchanged box, 400ms apart, moved 0.17px and shrank
  0.16px - and the during-edit readings sit inside that band. The input's ramp
  equals the h2's (`14px/500/system-ui`); the trigger keeps its own
  (`Geist Mono 12px`).
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
