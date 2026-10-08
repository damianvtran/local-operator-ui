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
| `team-menu-open` | The team menu after a real press: the search field, rows `lopdev` / `minerva` as the app's own two-line picker rows, the current row carrying the `Check` (the authored dot is gone). The entry asserts the menu's own hook at shutter time - a closed menu fails the run. |
| `agent-menu-open` | The agent panel on a team-bound chat: the team's rule as a caption, a leaf row disabled with its reason, the accepted seats settable beside it, and the highlight seeded onto the current settable row (issue #861's CONSTRAINT; the seed is review round 1's D2/U1, re-shot here). The 560x640 sibling `constrained-agent-open` shows the whole rule at once. |
| `team-menu-keyboard-highlight` | One `ArrowDown` after a pointer-open: the arrows keep focus in the field and move `aria-activedescendant`, so the active row is the one carrying `aria-selected` - `[role="option"][aria-selected="true"]` is asserted present (Radix's roving focus, `data-highlighted`, is what a menu would set and this listbox does not). |
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
| `agent-and-team` | Both bound, agent first - the order the joined string had, and a LEGAL pair now (a delegating profile under the team): no cue. |
| `before` | Today's plain string, rendered by the same story on this tree (the pair's third check: it must be byte-comparable to main's). |
| `wide` | The same arrangement at 1380, the width the operator's screenshot was taken at. |
| `narrow-fold` | The operator's own 49-character title at the 560 band: the chips sit ON the painted line with the title truncated around them (UX round 1's U2 - the block no longer wraps while the controls are its second half; the frame used to record the fold as a decision). |
| `narrow-fold-agent-menu-open` | The same band, a real press at the agent chip's own centre: the panel opens. U2's fix as an `expectPresent` claim - a press that lands on the band (the old wrap-clip) opens nothing and fails the run. |
| `team-menu-empty` | The catalogue answering with no rows: `No teams are registered.` |
| `team-menu-refused` | The registry's refusal in its own words (`The profile registry is unavailable.`). The story holds the rig's `capturePending` latch until `[data-header-identity-error]` is in the DOM, and the entry asserts that row - the first capture of this frame raced the query's retry window and photographed `Loading teams…` (design D1). |

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
- **The controls stay on the painted line** (UX round 1's U2; design D3's boundary
  is `narrow-fold`): at the operator's 49-character title both chips sit on line
  one at every width the review named - 560 / 480 / 400 / 320 / 220 -
  `elementFromPoint` at each chip's own centre hits the chip, and a real press
  opens its panel, with the title truncating around them (262.4px at 560; it
  yields entirely at the app's own narrowest 220, where the chips keep their
  room). Before the fix the identity line's top sat 21.7px below the block's top
  (the clipped second line) at 560 and at 220: every chip off the paint, the
  band the topmost element at its centre, and a press opening nothing. The
  one-line clip band is 20px, which is why a 24px control cannot live in it
  (see the PR's Judgement calls on design D5).
- **The current-row dot** (design D2): 8x8 CSS px after the `size-2`
  carve-out; 15-16px before it.
- **The first-click swap** (UX U4): one press on the sibling trigger leaves
  `team: false, agent: true` - the swap opens in one gesture. The trace
  without the guard: agent `aria-expanded` true at t, team's close-autofocus
  refocuses its trigger at t+~2ms, the just-opened agent menu reads that as
  focus-outside and dismisses itself at t+4ms.

## The before half: the same roster on `origin/main`'s menu

`before-bound/` is the other side of the pair, and it is the operator's own
report. It holds the three states above rendered by the UNFIXED tree - this
branch's stories, whose bridge answers the same 150 names, against
`origin/main`'s identity module - which is the combination the first pass used
for `before-main/` and the recipe that set's README documents.

What they show, and why they are the frames to open first:

| frame | what it shows |
| --- | --- |
| `long-roster-agent-open` | The 150-name roster as main draws it: one flat menu, no bound, no filter, no grouping - and its last name, `tui-designer`, half off the foot of a 640px window. This is the failure the 352px ceiling and the search field answer. |
| `long-roster-short-window` | The same list at 560x220, where main has no answer at all: the menu runs past the window and the window keeps nothing. |
| `menu-near-window-bottom` | The band pinned to the bottom of the viewport: main's menu is drawn ABOVE the chip with its head clipped at the window's top edge - main has no bound, so `shift` slid an unbounded menu up; the flip and the ceiling are this branch's answer. |

One working-tree-only edit was needed to take these, and it is worth recording
because it is the honest difference between the two halves: the arms assert
`[role="option"]`, which is THIS branch's combobox listbox, while main's rows
are Radix `menuitemradio`. That assertion was re-pointed for the run and the rig
was restored from HEAD afterwards (`git hash-object` against `HEAD:<path>`,
byte-identical), and the module was restored the same way - verified in the same
run, which is what `scripts/...` prints as `module restored=identical` /
`rig restored=identical`.

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

The agent-panel frames in this section also carry issue #861's constraint now
(see the section at the end): the caption above the list and the disabled
near-miss rows. The bound, the filter and the band mechanics each row
describes are unchanged - only the settability of a near-miss row is.

| frame | what it is |
| --- | --- |
| `long-roster-agent-open` | The operator's own failure at scale: a 150-name roster, 560x640. The panel stops 352px down and the list scrolls inside it, with the footer stating the roster's full size - the bound, photographed, and the difference between a bound and a truncation stated on screen. |
| `long-roster-short-window` | The same panel at 560x220, where the 352px ceiling is no longer the binding term and Radix's available height is. The panel measures 173px and its bottom sits 8px inside the window. A fixed `max-height` renders a panel taller than the window here. |
| `menu-near-window-bottom` | The band pinned to the BOTTOM of the viewport (`LongRosterAtTheBottom`, 560x520), so the panel has to flip: it opens upward, 352px, wholly on screen. The story moves the band because the app's header cannot be at the bottom of the window - the frame is about the placement, and it says so. |
| `search-results` | `rev` typed into the field of the same 150-name roster: four rows, every one refused by the team's rule - so since review round 1's D1 the footer carries the resolution rather than the count (`No profile here can take the seat — clear the search, or switch the team.`), and each row keeps the short per-row reason. |
| `search-no-results` | `zzzz`: the panel shrinks to its field plus one sentence, `Nothing matches "zzzz".`, and the footer stays away rather than claiming a count over an empty result. The state most likely to be ugly, photographed. |
| `recents-agent-open` | The recents band with history (agent menu): on this ring every remembered row is refused by the team's rule, so since review round 1's U6 the band and its heading are GONE - a band of refusals is not the shortcut it exists to be - while `All agents` still lists every row with its reason and the highlight lands on the settable `architect`. The frame is byte-identical to `long-roster-agent-open` BY CONSTRUCTION (this ring has nothing settable to show), which is why review round 2's D8 asked for the mixed ring beside it: `recents-agent-mixed-open` is that frame, and the membership rule is pinned in `header-identity-menu.test.mjs`. |
| `recents-agent-mixed-open` | The MIXED ring (review round 2, D8): `manager` (settable, remembered) is up in `Recent agents` while `coder` (refused, remembered) is absent from the band and still listed, greyed with its reason, under `All agents` - the band as a FILTER rather than a fault. |
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

## The team's constraint on the agent slot (operator's issue #861)

The third report (2026-10-06): the agent picker stayed fully selectable while a
team was set, so one press could assemble `scout ▾ lopdev ▾` with nothing
saying who answers - the runtime keeps BOTH briefs (its own half is
damianvtran/local-operator#2014). The rule this round lands: a team-bound chat
is run by the team's MANAGER, and the agent slot is CONSTRAINED - settable to
the team's manager and to profiles that can delegate (`delegate === true`),
mirroring the runtime's acceptance predicate through one function
(`identityAgentSettable`). Every other roster row is still LISTED, disabled,
with the reason in its description; the rule is stated once as a caption above
the list. An explicit agent the rule refuses - the legacy pair, which core-i
normalises at attach - stays visible on its chip, because it is in the
prompt, with a warning mark and one normal pick as the resolution; the cue
waits for the roster's own `delegate` datum before it can fire, so no warning
is computed from names alone while `commands.entities` is still answering. The
copy shown in these frames is the design round's candidate to weigh.

| frame | what it is |
| --- | --- |
| `constrained-agent-open` | The small roster at 560x640, where the whole rule fits: the caption, `manager` (current) and the delegating `ops-lead` settable, `coder` and `reviewer` disabled with the reason. |
| `agent-menu-loading` | The roster has not answered (`IncompatiblePairLoading`, a bridge that never settles): `Loading agents…`, no caption, and the chip carries no cue - the false-cue guard as a frame. |
| `agent-menu-refused` | The registry's refusal, through the agent trigger. |
| `agent-menu-empty` | `No agents are registered.`, through the agent trigger. |
| `conflict-chip` | The incompatible pair at rest (`coder · Local Operator Dev`): the persona stays visible, the warning mark says the pair needs resolving. |
| `conflict-agent-open` | The panel where one pick resolves it: the caption, the current refused row disabled with its reason, the manager and delegating profiles settable beside it. |
| `conflict-chip-loading` | The same pair before the roster answers: no cue, asserted at shutter time. |
| `refused-enter` | `rev` typed, then Enter on the refused row the filter left active: the footer's live region answers (`copy-reviewer cannot take the seat.`) instead of the silent no-op review round 1 measured (D2/U1). Since review round 2's D7 the answer is an ADDITION - the exits line stays rendered under it - and the answer clears the moment the highlight moves, so the footer never names a row that is no longer active. |
| `no-settable-agent` | The manager-less roster (review round 2, D9): every row refused because no row carries the manager's name or a delegate flag, so the footer renders the UNTYPED resolution - `No profile can take the seat — switch the team.` - the branch the typed sentence cannot reach. |

### Review round 1's remediation (the frames re-shot at this head)

Round 1's consolidated findings changed this panel's behaviour, so its frames
are re-shot rather than re-used: the highlight is SEEDED onto the current or
first settable row - and re-seeded when a cold open's rows arrive - so the
first Enter acts; Enter on a refused row ANSWERS through the footer's live
region (`refused-enter`); a filtered view whose every match is refused swaps
its count for the exits that exist; the recents band drops refused rows and
collapses when none remain; the per-row reason is short (`Needs a delegating
profile here.`) and the caption's vocabulary is `profiles that can delegate`;
the refused row's reason steps down to `ink-dim`, its current check wears
warning ink, and it no longer paints the hover wash; the caption is
associated with the list via `aria-describedby`; and the overflow measure was
fixed - the footer had silently stopped rendering on the wide roster because
the measure effect could read a null scroller ref on its only run with the
panel open (Radix mounts the portal a commit after `open` folds; proved live,
then fixed with a callback ref; QA's Q-1). The command was the same narrowed
shape as above,
`--dirs=agent-menu-open,constrained-agent-open,conflict-agent-open,long-roster-agent-open,long-roster-short-window,menu-near-window-bottom,search-results,recents-agent-open,narrow-fold-agent-menu-open,refused-enter`,
ten states x two palettes on port 6457, every claim asserted at shutter time.

### Review round 2's polish (three states added, one re-shot)

The convergence round's minors changed three surfaces, so three frames join the
set and one is re-shot: `refused-enter` now shows the announcement and the
resolution together (D7 - the exits line survives the key, and the answer
clears the moment the highlight moves), `recents-agent-mixed-open` frames the
band as a filter rather than a fault (D8 - `manager` kept in the band, `coder`
dropped from it and still listed below with its reason), and `no-settable-agent`
renders the untyped resolution (D9). The command was the same narrowed shape,
`--dirs=refused-enter,search-results,recents-agent-mixed-open,no-settable-agent`,
on port 6459 with the settle budget raised for the loaded host
(`LOCAL_OPERATOR_UI_THEME_SETTLE_MS=30000` - a cold preview took longer than
the shipped 10 s to apply the theme, and the raised budget is the knob the rig
documents for exactly that), every claim asserted at shutter time.

`before-constraint/` is this round's before half, shot the way `before-main/`
and `before-bound/` were: this branch's stories - whose bridge answers the
same rosters and `delegate` flags - rendered by `origin/main`'s identity
modules (all four restored at once, then reverted; all five edited files - the
four modules and the rig - verified byte-identical to `HEAD` afterwards, and
the rig's three arms re-pointed to claims that tree can satisfy). What it
buys: `conflict-agent-open` reproduces the reporter's own state - `coder`
listed and freely selectable under a team, no caption, no rule (the issue's
attachment is the no-team menu; the team case is stated in its prose) - and
`agent-menu-open` is the unconstrained panel the constrained one replaced.

The frames came from three narrowed runs against this worktree's Storybook
(the section recipes above, port 6413): the fifteen recaptured and new states
(`--dirs=agent-menu-open,agent-menu-empty,agent-menu-refused,agent-menu-loading,conflict-chip,conflict-agent-open,conflict-chip-loading,long-roster-agent-open,long-roster-short-window,menu-near-window-bottom,search-results,search-no-results,recents-agent-open,narrow-fold-agent-menu-open,agent-and-team`),
a second pass for `constrained-agent-open`, and the before run's three states.
Every claim was asserted at shutter time; the manifest's `partialCapture`
records the runs.

## The runtime's strict rule (issue #861, second slice)

The runtime half (damianvtran/local-operator#2050 at `f98240bd42`) is stricter
than the rule above: while a team is attached, `/agent` is refused for EVERY
name, the manager's own included, and the session's frontend state carries
`effective_identity: {speaker, team, role_of_speaker}` (all three keys whenever
the host knows the field; `{}` or absent is a host that predates it). The header
reads that field and nothing else to decide: when it is published AND a team
owns the session, the agent control is CLOSED (the speaker on the chip, a lock
where the chevron was, a note instead of a list, no roster fetch), and the note
is the runtime's own refusal sentence. An older host keeps the rule above
exactly. The way out is `/team clear`: this app's team menu lists teams only and
ships no detach row, so the sentence names the slash command and promises no
button.

| frame | what it is |
| --- | --- |
| `strict-team-chip`, `strict-team-wide` | The speaker statement at rest, 560 and 1380 bands: `manager` with the closed mark, the team chip beside it, no warning cue. |
| `strict-team-open`, `strict-team-wide-open` | The press: the closure note, byte-for-byte the runtime's sentence, no field and no rows. |
| `strict-team-stale-agent` | A leftover `coder` on the frame under a strict host: the chip names the speaker and the cue is dark. |
| `strict-team-no-speaker-open` | The ladder's last rung: a team no catalogue row names a manager for reads `its manager` on the chip and in the sentence. |
| `older-host-chip`, `older-host-agent-open` | `effective_identity: {}`: byte-identical to `conflict-chip` / `conflict-agent-open` (md5), the #866 behaviour. |
| `before-strict/` | The same six strict states rendered by `origin/main`'s identity modules (declared supplementary set): the constrained list that still offers `manager`, and the stale `coder` with its warning cue. |


Round-1 remediation frames (both palettes): `strict-team-focus` (the closed chip with keyboard focus), `strict-team-long-speaker` (a 47-character speaker at 560, truncated with the lock still in its slot), `strict-team-catalogue-loading` (the closed note while `teams.list` has not answered), `strict-team-cold-frame-open` (a `{}` frame with only the durable binding, on a host the app has seen publish the field: still closed; its before is in `before-strict/`) and `strict-team-promoted-while-open` (an open #866 list replaced by the closed note mid-open: the rig asserts focus is on the chip afterwards - the same arm FAILS that assertion with the focus-return effect removed). `strict-team-open`, `strict-team-wide-open` and `strict-team-no-speaker-open` were re-taken for the note's lead line.
