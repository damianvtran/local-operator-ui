# Team initials bubble — before/after frames

Frames for the pull request that replaces the drawn team NAME in the chat
sidebar's session rows with a compact initials mark, and leads the chat header's
team chip with the same mark. They live on this branch so the PR body can inline
them; they are **not** in the PR's diff and not on `main`.

| file | tree | state |
| --- | --- | --- |
| `before-sidebar-resting-default.webp` / `after-sidebar-resting-default.webp` | `origin/main` `af6fffa899` / the PR branch `52860d87fb` | the sidebar's resting panel at its default width (360): pinned and running rows bound to five different teams, plus the `data-quality`/`delphi-quality` collision pair |
| `before-sidebar-narrow-min-220.webp` / `after-sidebar-narrow-min-220.webp` | same | the same panel at the app's TRUE minimum width — `SIDEBAR_MIN_WIDTH` is 220 (`chat-sidebar-layout.ts`), where the rows wrap hardest. (`chat-sidebar-sections--narrow-240`, the width the older change was priced at, is left exactly as it was and is not re-photographed here.) |
| `before-sidebar-query-while-collapsed.webp` / `after-sidebar-query-while-collapsed.webp` | same | the panel with a query applied — see *what the frames do not show*: this state's play cannot reach its own state on EITHER tree, so both frames are the unfiltered panel and this pair is not evidence about the search surface |
| `before-header-team-bound.webp` / `after-header-team-bound.webp` | same | the chat header's identity chip at rest, on a team-bound session (`LD · Local Operator Dev`) |
| `before-header-long-label.webp` / `after-header-long-label.webp` | same | the chip against an eighty-character label at the 560 band, where the cap truncates and the title reads whole |
| `before-header-narrow-fold.webp` / `after-header-narrow-fold.webp` | same | the chip in the narrow fold, where the block clips its second line |
| `after-sidebar-team-mark-hover.webp` | `52860d87fb` | the pointer resting on the first row's mark: the mark's name is up, the row's flyout is NOT (after-only: old code has no mark and its tooltip cannot be photographed) |
| `after-sidebar-team-mark-focus.webp` | `52860d87fb` | the same claim by keyboard: real Tab presses reach the mark and open the name (after-only, same reason) |
| `after-bubble-marks.webp` | `52860d87fb` | the mark itself, at the size it ships (20px), for every shape its rule has plus the three image states (after-only: the component does not exist on old code) |
| `after-header-long-label-min-width.webp` | `52860d87fb` | the chip at the app's 800 minimum window width (after-only) |

## The fixture trick, and what each pair is allowed to claim

The **same story files** are on both trees: `chat-sidebar-sections.stories.tsx`
carries the eight-conversation / seven-team roster this change draws its marks
from (copied verbatim onto a worktree of `origin/main`; storybook does not
typecheck, and the new fixture fields are ignored extras on the old code). One
variable changes between the two columns: the renderer. A pair therefore shows
exactly what the mark changed, and nothing else.

WHAT A PAIR DOES NOT SHOW, stated rather than smoothed over:

- **The search-results surface is not photographed at all.** The
  `query-while-collapsed` state's play types a query into the sidebar search, and
  that play could not reach its own state on either tree: `getByLabelText("Search
  chats and agents")` matches TWO elements (the sidebar's search icon button and
  its field, `chat-sidebar.tsx`), so it threw "Found multiple elements" at its
  first interaction — which the rig's pre-shutter play guard does not read, which
  is why this state's shipped frame has always been the UNFILTERED panel with an
  empty box. Re-cut by role (press the control that opens the field, then type
  into the one `textbox`) the query DOES apply, and the list then draws ZERO rows
  for the word used here — measured, the play's own wait for the matching row
  timed out, and the state's play was left as it was rather than half-fixed. So
  the mark's presence on a query-matched row rests on the code path and on the
  row's own tests, not on a frame here.
- **The mark's own story is after-only**, for the obvious reason: `TeamAvatarBubble`
  does not exist on the old tree, so there is no before half to take.
- **The hover and focus frames are after-only** for the same reason, and their
  claims are asserted rather than left to the eye: each entry requires
  `[role="tooltip"][data-side="top"]` present (the mark's name — our `Tooltip`
  defaults to `top`) AND `[role="tooltip"][data-side="right"]` absent (the row's
  flyout, which the row sets to `side="right"`). A run that loses either half
  fails instead of filing a frame whose caption is wrong.
- **One theme** (`localOperatorDark`) and one size per state; a theme this branch
  does not photograph is a theme this pair says nothing about.
- **A `:focus-visible` ring is not visible in a hidden window** (the story's own
  limit, declared there); the focus frame is evidence about the tooltip and the
  mark's reachability, not about the ring's pixels.

## How they were taken

Both trees served Storybook through the repo's own capture rig, from a direct
binary invocation (never `pnpm run`, whose dependency verification would try to
reinstall the shared tree):

```sh
# on the PR branch (worktree team-avatar-1001-73f8, head 52860d87fb)
./node_modules/.bin/storybook dev -p 6142 --ci --disable-telemetry --no-version-updates
# and, in a worktree of origin/main (af6fffa899) holding the same story file and
# the same rig, the same command on -p 6143

node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=<story id> --dirs=<the frames to take> \
  --themes=localOperatorDark --allow-backend
```

`--dirs` is what keeps a before run off the states that cannot exist on old code
(the mark's hover and focus frames, and the bubble's own story). The rig writes
into `docs/evidence/`; that tree was restored after every shoot
(`git checkout -- docs/evidence && git clean -fd docs/evidence`) and no frame
here comes from it.

## What the pairs show, in one line each

- **resting-default**: `LD`, `RD`, `HD`, `DQ`, `HE` marks where `· Local Operator
  Development`, `· Radient Development` … used to be drawn, and the collision pair
  (`data-quality` and `delphi-quality` both `DQ`) visible in one frame.
- **narrow-min-220**: the same at the width where the old drawn name cost the
  title almost everything.
- **header**: the chip leads with the mark and keeps its label, chevron, bounds
  and `Label (slug)` title.

## The measurements behind them

Read from the frames' own captions — the story's readout prints them, sampled from
the DOM every 200ms and asserted to equal the live panel before the shutter
(`readoutSettled`), so a caption cannot be one poll behind its pixels:

| measurement | panel 360 (default) | panel 220 (`SIDEBAR_MIN_WIDTH`) |
| --- | --- | --- |
| first chat row's title clip box, `origin/main` | 161px | 26px |
| first chat row's title clip box, this branch | **217px** | **77px** |
| first chat row's box height, both | 32px | 32px |

That is +56px and +51px of title, at an unchanged row height — the operator's
report was that the name was taking the width the title needed, and the row it
was taking it from is the first row of the pinned section (the long realistic
title `Install the pinned uv on Windows arm64 via the bootstrap script`).

The frames also caption `Team marks drawn: 7` on this branch against `0` on
`origin/main` — seven rows carry a mark, one per team the fixture binds, with one
team-bound row in each list section and one agent-bound row that keeps its text.

## The flyout collision, and how it was resolved (measured)

The mark sits INSIDE the row's flyout trigger (the row's own box), so one hover
opens two panels unless something stands one down. Measured, in order:

1. **Both stand.** With no stand-down, hovering the mark leaves
   `[role="tooltip"][data-side="right"]` (the row's card) AND
   `[data-side="top"]` (the mark's name) on screen — proved by running the hover
   entry with `expectGone` pointing at the card, which failed with "…is still on
   screen", and photographed.
2. **`disabled` is the wrong instrument.** Mirroring the pin drag's suppression
   (`disabled={pinDrag !== null}`, which renders the box unwrapped) suppresses the
   card AND LOSES the mark's name: the run reported the card gone and
   `[data-side="top"]` missing, because `disabled` replaces the trigger's subtree
   — the mark included — so the mark's own `Tooltip.Root` is remounted away on the
   very hover that opened it. That is worse than the doubling it fixed.
3. **`suppressed` is the instrument that holds.** A new additive prop on the app's
   `Tooltip` keeps the trigger mounted and passes `open={false}` down it, so the
   DOM node is the same before and after. The committed hover and focus entries
   assert the resolved state: the mark's name present, the row's card gone.

The row reports the engagement itself (`teamBubbleHot`, the sidebar-level state
the mark's wrapper sets on pointer-enter/leave and focus/blur), so only the row
under the reader stands down and every other row keeps its card.
