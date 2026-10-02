# Team initials bubble — before/after frames

Frames for the pull request that replaces the drawn team NAME in the chat
sidebar's session rows with a compact initials mark, and leads the chat header's
team chip with the same mark. They live on this branch so the PR body can inline
them; they are **not** in the PR's diff and not on `main`.

| file | tree | state |
| --- | --- | --- |
| `before-sidebar-resting-default.webp` / `after-sidebar-resting-default.webp` | `origin/main` `af6fffa899` / the PR branch `52860d87fb` | the sidebar's resting panel at its default width (360): pinned and running rows bound to five different teams, plus the `data-quality`/`delphi-quality` collision pair |
| `before-sidebar-narrow-min-220.webp` / `after-sidebar-narrow-min-220.webp` | same | the same panel at the app's TRUE minimum width — `SIDEBAR_MIN_WIDTH` is 220 (`chat-sidebar-layout.ts`), where the rows wrap hardest. (`chat-sidebar-sections--narrow-240`, the width the older change was priced at, is left exactly as it was and is not re-photographed here.) |
| `before-sidebar-query-while-collapsed.webp` / `after-sidebar-query-while-collapsed.webp` | `af6fffa899` / the PR branch `02fa5daa3d` | the panel with a query applied — the word `helpdesk`, one team and the one conversation bound to it: the AFTER half draws the `HE` mark on the matched row (readout `Rows drawn: 1 entity · 1 chats`, `Team marks drawn: 1`), the BEFORE half draws `· helpdesk` in the same slot. Re-taken in round 1's remediation (review R1-M2 = QA Q-F3 = design D4): the earlier before half was the unfiltered panel, so the pair read as a before/after of two different states |
| `before-header-team-bound.webp` / `after-header-team-bound.webp` | same | the chat header's identity chip at rest, on a team-bound session (`LD · Local Operator Dev`) |
| `before-header-long-label.webp` / `after-header-long-label.webp` | same | the chip against an eighty-character label at the 560 band, where the cap truncates and the title reads whole |
| `before-header-narrow-fold.webp` / `after-header-narrow-fold.webp` | same | the chip in the narrow fold, where the block clips its second line |
| `after-sidebar-team-mark-hover.webp` | `52860d87fb` | the pointer resting on the first row's mark: the mark's name is up, the row's flyout is NOT (after-only: old code has no mark and its tooltip cannot be photographed) |
| `after-sidebar-team-mark-focus.webp` | `9ca53ad356` | the same claim by keyboard: real Tab presses reach the mark and open the name (after-only, same reason). RE-TAKEN in round 1's remediation, where the frame's own pixels carried design D2: the ring around a 20px round mark was a 28x28 SQUARE (corners 4px off the object); the mark's focusable box now takes `rounded-full`, and this is the frame that shows it. This entry also answers with `[role="tooltip"]` rather than `[data-side="top"]` — see the note below |
| `after-sidebar-selected-light.webp` | `fff55b33d8` | the team mark on a SELECTED row in `localOperatorLight`, the palette where the pairing is tightest: plate `sunken` `#ece6d8` against `rowSelected` `#EBE7D8` is 1.005:1, so the mark is carried by its 1px `border-control` edge alone (design round 1, D5 — the one pairing of this component nobody had looked at). Shot through the new `chat-sidebar-current-row--team-bound-row-current` entry; `bound-row-current` beside it cannot show this, because that row binds an AGENT and an agent binding stays text |
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

- **The search-results surface IS photographed, after-only in the rig's own hands.**
  The `query-while-collapsed` entry drives the field itself (`press` on
  `[data-sidebar-search]`, then `insertText` through the real input pipeline) rather
  than relying on the story's play, and that is a measured decision: two play-driven
  mechanisms were tried against this rig — `@storybook/test`'s `userEvent` (press the
  control, then type into the field) and a direct native-setter plus `input` dispatch
  on the same field — and neither reached the filtered state; the frame came back at
  18642 bytes with `Rows drawn: 10 entity · 8 chats` and no field drawn. The entry
  also needs a **400ms settle after the press** (`pressSettleMs`), because the field
  mounts on the next frame and focuses itself in a `requestAnimationFrame`: without it
  the frame came back at 19464 bytes with the field OPEN and EMPTY beside an
  unfiltered list. The D4 assertion travels with the entry as `expectPresent:
  "[data-chat-row] [data-team-bubble]"` — the row the query matched must DRAW a mark
  or the run fails rather than filing the frame — which is the check the design round
  asked for, kept in the rig because it is the rig that owns this state.
  The BEFORE half is the same driven query on the old tree (the same story file, the
  same entry with the one `expectPresent` term dropped, since a tree without the mark
  cannot satisfy it): the old renderer draws `· helpdesk` where the after half draws
  the mark, which is what makes the pair apposite.
- **The mark's own story is after-only**, for the obvious reason: `TeamAvatarBubble`
  does not exist on the old tree, so there is no before half to take.
- **The hover and focus frames are after-only** for the same reason, and their
  claims are asserted rather than left to the eye: BOTH entries require
  `[role="tooltip"][data-side="right"]` absent (the row's flyout, which the row
  sets to `side="right"`), and the halves are asserted differently by design:
  the HOVER entry requires `[role="tooltip"][data-side="top"]` present (the
  mark's name — our `Tooltip` defaults to `top`), while the FOCUS entry requires
  `[role="tooltip"]` and does not name a side. The side is not this change's
  claim and asserting it refused a working frame: measured back to back on the
  same code and the same walk, `[data-side="top"]` found nothing and
  `[role="tooltip"]` found the panel on the very next run (the entry's own
  comment carries the measurement). A run that loses either half fails instead
  of filing a frame whose caption is wrong.
- **One theme** (`localOperatorDark`) and one size per state; a theme this branch
  does not photograph is a theme this pair says nothing about.
- **The focus frame's ring IS in the picture, and it is the frame design round 1's D2
  was measured off** (28x28 square around the 20px circle, corners 4px off the object)
  — measured off the PREVIOUS capture of this state, which this round replaced: the
  file here is the RE-TAKEN one, after the mark's focusable box took `rounded-full`,
  so its ring is a circle of the same 28x28 box and the square described above is no
  longer in the repository (the pixels differ: `after-sidebar-team-mark-focus` was
  21816 bytes then and is 22040 now). The earlier caption said the ring was not
  visible in a window without focus and that the frame claimed nothing about it; the
  numbers in that finding came from this file's own pixels, so the caption was
  instructing a reviewer to discard its strongest frame. What the frame cannot show is the ring's *appearance* under real focus
  heuristics elsewhere in the app; what it does show is this mark's ring, which is
  `rounded-full` as of round 1's remediation.

## How they were taken

Both trees served Storybook through the repo's own capture rig, from a direct
binary invocation (never `pnpm run`, whose dependency verification would try to
reinstall the shared tree):

```sh
# on the PR branch (worktree team-avatar-1001-73f8)
./node_modules/.bin/storybook dev -p 6142 --ci --disable-telemetry --no-version-updates
# and, in a worktree of origin/main (af6fffa899) holding the same story file and
# the same rig, the same command on -p 6143

node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=<story id> --dirs=<the frames to take> \
  --themes=localOperatorDark --allow-backend
```

ROUND 1'S REMEDIATION re-took four of these frames (the focus pair's after half,
both halves of the search pair, and the new light selected-row frame) on ports
6201, 6213 and 6217, one storybook at a time, each reaped by exact pid. Two
things that cost a run each and are worth not re-deriving:

- **The base worktree needs `--theme-settle-ms=60000`.** The rig waits 10s
  (shipped) for the decorator to put the theme on the document; on a worktree
  whose Vite cache is cold, the story had not mounted by then and the run refused
  the frame ("document carries theme \"\" after 10s"). The knob exists for exactly
  this - see its own note in `capture-evidence.mjs`.
- **The search state's query is driven by its entry, with a settle.** `press` on
  `[data-sidebar-search]` opens the field, which focuses itself in a
  `requestAnimationFrame` on the NEXT frame; `insertText` with no `pressSettleMs`
  types into the body and the frame comes back with the field OPEN and EMPTY
  (19464 bytes, measured). Every claim above about which frames exist and what
  they carry comes from a run whose output was read, not inferred.

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

**One caption reads a different number, and it is a different row.** The focus
frame's readout says `First title clip: 251px` where this table says 217px at the
same width. It is not a contradiction and it is not motion: the focus frame is
taken on the `query-while-collapsed` story, whose first row draws **no
relative-time label** in its trailing slot (the resting fixture's first row draws
`51w`), so that row's trailing content is 34px narrower and its clip 34px wider —
measured off the two frames' own pixels: the resting first row's title ink runs
37..233 with the mark at 264..278, the focus frame's runs 37..268 with its ring at
291..318. Two fixtures' rows, one caption shape; `before|after` for the clip
number are the two resting frames above.

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

The row reports the engagement itself — `teamBubbleHovered` and
`teamBubbleFocused`, the two sidebar-level states the mark's wrapper sets on
pointer-enter/leave and focus/blur respectively, kept separately so that a
pointer leaving the mark while the keyboard still holds it cannot re-arm the
card — so only the row under the reader stands down and every other row keeps its
card.
