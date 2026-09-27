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

## The bound, the filter and the recents band (operator, 2026-09-26, second report)

The first pass made the identity line two controls. The operator's next report
is about what the controls OPEN: "on the agent/team dropdowns, the height is
unbounded and goes past the height of the screen, make sure there's a reasonable
height bound and it might be good to add a search filter to each to make it
easier to find especially if there becomes a large number, and have recents
separated from all with well designed header/dividers."

So each control now opens a bounded, filterable PANEL instead of a flat menu:
a search field pinned at the top, a scroll viewport that never leaves the
window, and - when this app has switched profiles before - a `Recent agents` /
`Recent teams` band above the `All agents` / `All teams` one. Both controls
render the same component, so the two panels cannot drift apart.

| frame | what it is |
| --- | --- |
| `long-roster-agent-open` | The operator's own failure at scale: a 150-name roster, 560x640. The panel stops 352px down and the list scrolls inside it, with the footer stating the roster's full size - the bound, photographed, and the difference between a bound and a truncation stated on screen. |
| `long-roster-short-window` | The same panel at 560x220, where the 352px ceiling is no longer the binding term and Radix's available height is. The panel measures 173px and its bottom sits 8px inside the window. A fixed `max-height` renders a panel taller than the window here. |
| `menu-near-window-bottom` | The band pinned to the BOTTOM of the viewport (`LongRosterAtTheBottom`, 560x520), so the panel has to flip: it opens upward, 352px, wholly on screen. The story moves the band because the app's header cannot be at the bottom of the window - the frame is about the placement, and it says so. |
| `search-results` | `rev` typed into the field of the same 150-name roster: four rows, panel 276px, nothing scrolls, footer `4 of 150 agents match`. This is the composition the operator asked about - the search is what keeps the bound from biting. |
| `search-no-results` | `zzzz`: the panel shrinks to its field plus one sentence, `Nothing matches "zzzz".`, and the footer stays away rather than claiming a count over an empty result. The state most likely to be ugly, photographed. |
| `recents-agent-open` | The recents band with history (agent menu): `Recent agents` (reviewer, coder, qa-tester) above `All agents`, each headed by a label on a hairline. All 150 roster rows are still in the DOM underneath - the band REPEATS rows, it never removes them. |
| `recents-team-open` | The same band in the team menu, so the two pickers are shown agreeing rather than one frame plus an assurance about the other. |
| `no-recents-team-open` | The fresh install: an empty ring, and therefore NO band and NO heading at all - not an empty `Recent teams` strip. The entry asserts `expectGone` on the heading so a regression fails the run. |

## What the measurements behind the second report's frames say

From the same private headless Chrome (the rig's launch shape, mock keychain
included), pressing the chip by real mouse events and reading live geometry:

- **The bound is two numbers, and both bind.** The panel's ceiling is 352px
  (22rem). At 560x640 the panel measures **352px** - the ceiling - with the
  list viewport 272px against 7,334px of content, i.e. 150 two-line rows and a
  scrollbar. At 560x220 the same panel measures **173.3px** (`max-height`
  resolves to `173.297px`, Radix's available height), bottom at 212 - inside
  the window, with the 8px collision padding. With the band at the bottom of a
  520px viewport the panel **flips above the chip** (top 91, bottom 443) and is
  352px there. So a chip near the top of a tall window gets the ceiling, a chip
  at the bottom of a short one gets the room that exists, and neither escapes
  the window.
- **The bound is a viewport, not a slice.** All 150 rows are rendered in every
  one of those cases (`options: 150`) and the viewport scrolls to them; nothing
  caps the list. The footer names the roster's own size (`150 agents in all -
  scroll, or type to filter`), which is what distinguishes this from a
  truncation: a cut row has a cue, and the sentence says how many rows there
  are.
- **The search is what makes the bound rare.** `rev` narrows the same roster to
  4 rows, the panel shrinks to 276px and the scrollbar disappears; the footer
  becomes `4 of 150 agents match`. A user with 150 agents therefore types two or
  three characters and never meets the bound at all - and the 151st, or the
  150th, is reachable by scrolling inside the bound when they would rather
  browse. Both paths exist in every state; neither is a fallback for the other.
- **The recents band is a shortcut that cannot hide anything.** With a ring of
  3, the panel holds 153 rows - the 150 roster rows plus the 3 repeats in the
  band - so the band reorders nothing and removes nothing. The ring holds at
  most 4 names (`PROFILE_RECENTS_LIMIT`), which is what fits above the `All`
  band's heading inside the ceiling; a remembered name the catalogue no longer
  offers is dropped rather than rendered as a dead row.
- **"Recent" is a switch the owner confirmed, app-wide.** The ring is written
  only when the command answers with a `notice` - `toResult`'s `success` - so a
  warning, an informational block or a failed transport never earns a row. It
  is keyed per menu (an agent name is never a team name) and persisted with the
  rest of the UI preferences, so it survives a reload; a fresh install has two
  empty rings, which is the `no-recents-team-open` frame.
- **The keyboard contract, measured rather than asserted.** The field takes
  focus on open (`document.activeElement` is the combobox, not the chip - and
  the COLD open is the case that needed the fix: the first frame of a cold open
  renders the field over a `Loading teams...` line, and Radix's own autofocus
  had been landing on the panel's box, which is why the busy frame's
  keyboard-first pick stopped running). Arrows move the active row with focus
  staying in the field; Enter commits that row; Escape closes and returns focus
  to the chip. One press on the sibling chip still swaps in one gesture
  (`agent=true, team=false` after a team press then an agent press), which is
  UX round 1's U4 re-measured against the popover.
- **A closed picker takes no typing.** The chip is a `button`, not a field:
  there is no path by which a keystroke opens a menu the user did not ask for.

## How the second report's frames were produced

    node scripts/capture-evidence.mjs http://localhost:6117 \
      --only=chat-header-identity \
      --themes=localOperatorDark,localOperatorLight --allow-backend

The same Storybook and rig as the first pass, with one addition to the rig:
`type: "<text>"` on an arm, which inserts text into whatever holds focus
(`Input.insertText`) so a frame can be about a FILTER rather than about a
state. The two new stories (`LongRoster`, `LongRosterAtTheBottom`) and the
`Recents` one answer a 150-name roster built in the story file; every story
declares its recents ring through `Band`'s `rings` prop, so no frame depends on
what a previous run left in `localStorage`.
