# The chat row's context menu — items, states, and the hold under an open menu

The frames in this set photograph the chat sidebar's row context menu
(`#694`, design of record: `docs/design/row-context-menu.md`): the menu open at
the pointer on a normal and a pinned row, the pointer moved onto an item, the
same opened from the keyboard, the two withheld-item states, the flyout
suppression pair, the archived row behind `Include archived` (its item reads
`Unarchive conversation`), and the row under the pointer with no menu open —
the before/after partner of `pointer-open`.

**#739 added Fork as the menu's third row**, so every menu-open frame below was
re-taken with it drawn (the `menu-closed`/`flyout-alone` pair, which draws no
menu, differs from the #694 set only in the capture clock and the base's own
toolbar - see the Notes), and two states were
added: `fork-withheld` and `fork-pressed`. The set is now 24 frames (twelve
states x two themes). The before is the #694 set at `26a814c2c2` (`git show
26a814c2c2:docs/evidence/chat-sidebar-row-context-menu/<state>/<theme>.webp`);
the after is this directory.

**#893 added `Copy session ID` as the menu's SIXTH row, so the set was re-taken
whole again and the panels grew a plain row.** Every state now also draws `Copy
session ID` - a chord-free row, like Fork's - so the pinned state now draws six
rows, an ordinary row four (it drew three before), and a
capability-withheld row three (two before). The set is **26 frames (thirteen
states x two themes)**: the twelve above plus `copy-pressed`. The capture head is **`7955270eb`** (the feature head
`feat/copy-session-id` reached before this evidence commit, which carries the
frames and sits on top of it). **The five-row figures this README carried
before - `296 × 184` for `pinned-row`, and the `81`/`77`/`113` heights of the
other panels - are SUPERSEDED**: they described the set at `15a7a4ed5`, and
§ "The numbers" below carries the replacements read from this head's frames.
They are kept here as the record, labelled, because a reviewer comparing heights
needs to know which generation each number belongs to.

## What produced these frames

Storybook, from this branch, with the story
`src/renderer/src/features/chat/components/chat-row-context-menu.stories.tsx`:

```
npx storybook dev -p 6751 --ci --quiet --no-open
node scripts/capture-evidence.mjs http://localhost:6751 --allow-backend \
  --only=chat-sidebar-row-context-menu-- \
  --themes=localOperatorDark,localOperatorLight
```

Round 1's two remediation states (`pointer-hover`, `archived-row`) were
captured with the same command narrowed by `--dirs=pointer-hover,archived-row`,
so no existing frame was re-taken.

**The #893 re-shoot ran the same command, unchanged** — the whole set again, since
the new row draws in every menu-open state. Both runs are APPEND mode (`--only` is
present), so nothing was cleared: the earlier generations' *files* are what this
directory replaced, not what the run rewrote from empty.

**The frames ship from the SECOND folded tip** (`009100e05`, the fold onto
`origin/main` = `054ea59fe5` - #743, the archive-confirm lane, which landed a
second change on this same menu: it moved the pinned row's move pair IN as rows
3-4, WCAG 2.5.7's single-pointer path). That fold is why the FIRST take on the
first folded tip is not what ships (`bec29a5f5`, the fold onto
`origin/main` = `490c2079fb`). The first #739 take was on this branch before the
fold, and the fold broke the pointer states' own gate rather than their pixels:
a story that opened the menu on a timer was RACING the rig's hover check, and
the larger sidebar the fold brought (a slower first paint, more rows, a fourth
toolbar control) lost that race for every state - the rig refused with "the
pointer is on `[data-session-row="s2"]` but the element does not match :hover".
The story now WAITS for the pointer before it opens the menu, which is both the
race's fix and the honest gesture (a right-click happens on a row the pointer is
already over; the menu is modal, so the row cannot be hovered once the panel is
up). The set was then re-taken in full at the filled tip, and only
`archived-row/localOperatorLight` and the two `fork-pressed` frames differed
byte-for-byte from the pre-fold take - the deterministic scenes reproduced
themselves.

**And #743's fold moved exactly ONE frame.** After the fold onto `054ea59fe5` the
set was re-taken whole a third time: **twenty-two of the twenty-four files came
back byte-identical** and only `pinned-row` (both themes) changed, because that is
the one state that draws the five-row menu - `archive`, `unpin`, `Move conversation
up`, `Move conversation down`, `Fork conversation` - in **273 × 178**, up from 273 ×
113 when the same state drew three.

**And the round-1 remediation re-took that same one frame again (D1/D2).**
`pinned-row` is now **296 × 184** in the order `archive · unpin · Fork · Move up ·
Move down`: the two Move rows print their chord through the joined sibling
(`chatPinMoveCapJoined`) like the rows above them, which widens the menu's chord
column past every label (273 → 296) and makes those rows a full chord row tall
(33 → 36), and Fork has moved to row 3. **Twenty-two** of the twenty-four files are
byte-identical to the previous take (the pair that moved is the two
`pinned-row` webps); this is the only state that draws either the
Move pair or Fork beside it. The ordinary-row states do not draw the Move
pair at all (`offersMove` is false unless the row is pinned and in the section the
order belongs to), which is why their pixels are untouched by #743.

**The story drives the real feature, not a composition over it.** The menu is
opened through the real trigger: a dispatched `contextmenu` at the row's own
box (the event the primitive's `handleOpen` anchors from) for the pointer
states, and a real `ContextMenu` keydown on the row's button for the keyboard
one. The `archived-row` state drives the search block's own controls first —
the field's `input` event, then a real press on `Include archived` — because
that is the only list an archived conversation is drawn in. Everything the
events land on is the product's — the trigger is the box
`chat-sidebar.tsx` renders, the open state is the sidebar's `openMenuRowId`,
the hold classes are the sidebar's own conditionals, the item set is drawn from
the row's real predicates, and each item presses the row's real control. The
events are SYNTHESISED because the capture rig can drive a left pointer and
Enter/Space but not a right-button press or these keys; a dispatch through the
element's own event system is the closest path the rig can take, and the QA
round can drive the real right-click over CDP.

**Two themes, not twelve.** `localOperatorDark` and `localOperatorLight` are
the brand pair the design round's proposal set used, so the two sets compare
frame for frame; every other palette's floors are held by
`scripts/contrast-contract.mjs` over the same token roles, which is a colour
claim no capture in this set makes.

**The readout beside each panel is sampled per animation frame** (rendered only
on change), so a frame cannot claim a state the app does not hold — including
the traps: the panel is mounted a frame BEFORE the popper places it, and an
earlier 200ms-cadence sampler shipped one dark frame reading `at 2,0` over
pixels that plainly showed the settled panel. The cadence is the fix; the
numbers below are what the final frames read.

## What each frame is

| story | what it is |
| --- | --- |
| `pointer-open` | the menu at the pointer on s2, reveal and hover ground held |
| `pointer-hover` | the same scene with the pointer moved onto the first item: `data-highlighted`, and the focus ring the primitive's own focus draws |
| `keyboard-open` | the keyboard opener: anchor at the row's box edge, focus in the first item |
| `pinned-row` | the six-row state on s1, in the shipped order: `Archive conversation`, `Unpin conversation`, `Fork conversation`, `Copy session ID` (#893, row 4), then `Move conversation up` and `Move conversation down` (both boundary-inked and `aria-disabled`, because the one pinned row is at both ends) — **296 × 215 at 142,297**, read from this head's frame. The five-row `296 × 184` above was the state at `15a7a4ed5`, before `Copy session ID`; #743 had moved the move pair out of the strip and into this menu, so the row's own children are two (`pin`, `archive`) |
| `pin-state-unknown` | s3, `pinned === undefined`: two rows (Archive, Fork) in 273 × 77, and the row draws no pin control |
| `archive-withheld` | `session_archive` absent: two rows (`Pin conversation`, Fork) in 246 × 77, not a disabled one |
| `archived-row` | the row behind `Include archived`: item 1 reads `Unarchive conversation`, three rows in 288 × 113 (the widest LABEL the menu draws) |
| `flyout-dwelled` | the flyout given 1800ms to dwell, then the menu: flyout `absent` |
| `flyout-alone` | the control: the same row (s2), same hover, same dwell, no menu |
| `menu-closed` | `pointer-open`'s before/after partner: same scene, same settle, no open — and the open state drops the flyout band itself (see `flyout-dwelled`) |
| `fork-withheld` | #739: s2 is a never-sent draft's conversation (`drafts` holds its id), so the row reads `Not sent yet` and the menu draws Archive and Pin only — Fork absent, not greyed |
| `fork-pressed` | #739: the menu opened on s2 and Fork pressed. There is no chat pane in the story, so no picker can open and this frame does not show one; it shows the sidebar's half — the readout prints the request in the panel-presentation store (`session.fork for s2`, the ROW's conversation), its invoker (`button[data-chat-row] in s2`) and `route: /chat`. The pane's half (presenting the NAMED conversation rather than its own, and `rebind` navigating to the fork) is `slash-dispatch.ts`'s consume effect, asserted in `scripts/panel-presentation.test.mjs` |
| `copy-pressed` | #893: the menu opened on s2 and `Copy session ID` pressed. Radix closes the menu on select, so the frame shows the sidebar's half, as `fork-pressed` does: the readout prints `copied: s2` — the string the item handed the clipboard, the ROW's own conversation id, copied verbatim — and the app's own success toast, `Session ID copied`, is held in the frame by the story's `toastDuration` (the same parameter `credential-notice` uses). The write is a RECORDING stub installed for this state (`navigator.clipboard.writeText` returns nothing in a headless capture, so the real call would photograph the REFUSAL toast); the real write path and its refusal are `scripts/chat-session-copy-id.test.mjs`'s and QA's over CDP |

## The numbers, and what they settle

Every number is read out of the DOM by the story; `docs/design/row-context-menu.md`
§ 9 carries the full table. The load-bearing ones:

- **The anchor.** Pointer states: the dispatched point (`140,369` on s2 —
  centre-x, `rect.bottom - 3`). Keyboard state: the synthesised row-box edge,
  `anchor point: 12,371` with the panel at `14,370` — `rect.left` and
  `rect.bottom - 1`, exactly what § 3 prescribes, and no code path read the
  ambient event's coordinates. The panel sits 2px right of its anchor because
  the primitive hard-codes `sideOffset: 2`; it has no caller-facing option. On
  the keyboard path that placement leaves the panel spanning 14..287 (its ink to
  286) over the sidebar divider's hairline (x 279) by **8px** of box, 7px of ink —
  the accepted straddle's smallest case, and the pointer states straddle far
  further (136px and 151px, § 3 of the design record), recorded with the findings
  that measured them (design round 1, D4/D7).
- **The hold.** `pointer-open` reads `ground rgb(48, 45, 41) · pair: flex`,
  `pair children: button[pin]:flex:243w24 | button[archive]:flex:215w24` —
  identically to `menu-closed`, the same scene with no menu under the pointer.
  The held reveal is the hover's own geometry reproduced by state, as § 4
  requires; `flyout-alone` shows what the pointer alone produces.
- **The two-trigger attribute, measured.** Every menu-open frame reads the
  row box as `data-state closed` — the value the TOOLTIP trigger composed —
  while `flyout-alone` (no menu, flyout drawn) reads `delayed-open`. The
  attribute is whichever Radix trigger wrote last, which is why no rule in the
  change is authored against it and the hold is sidebar state instead.
- **The keyboard focus.** `keyboard-open` reads
  `focus: menuitem “Archive conversation⌘⇧A”` and `first item: data-highlighted`
  (over the app's own `:focus-visible` ring) — U-D4's minimum, met. The pointer
  states read `focus: menu`, `first item: not highlighted`: the primitive's
  default, deliberately kept on the path with no keyboard place to keep.
- **The flyout.** `flyout-dwelled` (menu opened after the flyout had drawn)
  reads `flyout: absent`, and `flyout-alone` reads `present` in the same scene:
  the modal portal is what removes it, and the pair reads as the measurement.
- **The five-row panel read 296 × 184, and the round-1 remediation is why — SUPERSEDED
BY #893, WHICH DREW A SIXTH ROW (kept as the record: these are the figures the set
carried at `15a7a4ed5`).**
`pinned-row` read `panel: 296x184 at 142,297`, `items: 5 — Archive
conversation⌘⇧A | Unpin conversation⌘⇧P | Fork conversation | Move conversation
up⌘⇧↑ | Move conversation down⌘⇧↓`, the row at `255x32 at 12,268` and `pair
children: button[pin]:flex:243w24 | button[archive]:flex:215w24` — two children,
where the #697-era take read four, because the arrows left the strip for this menu
(#743). Measured A/B on the same story, one variable: with the Move rows printing
the handler's spelling they were one cap wide and the panel was 273 × 178; with the
joined sibling each prints three caps, the Move rows become the widest rows in the
menu (296, past `Unarchive conversation`'s 288) and a full chord row tall
(33 → 36). This is now the widest panel in the set.
- **THE SIX-ROW PANEL, READ FROM THIS HEAD'S `pinned-row` FRAME (#893).** The frame
reads `panel: 296x215 at 142,297`, `items: 6 — Archive conversation⌘⇧A | Unpin
conversation⌘⇧P | Fork conversation | Copy session ID | Move conversation up⌘⇧↑ |
Move conversation down⌘⇧↓`, the row at `255x32 at 12,268` and the same two pair
children. The WIDTH did not move (296, the joined Move chords stay the widest
content, and `Copy session ID` is a shorter label than `Unarchive conversation` at
288); the HEIGHT grew by one plain row. **Every panel in the set, read from its
own frame at this head** (`localOperatorDark`; the light frames read the same sizes),
with the state at `15a7a4ed5` beside it:
  - `pinned-row` — **296 × 215 at 142,297**, **6 items** (was 296 × 184, 5)
  - `pointer-open` (`pointer-hover` likewise) — **273 × 144 at 142,369**, **4 items**
    (was 273 × 113, 3)
  - `archived-row` — **288 × 144 at 142,362**, **4 items** (was 288 × 113, 3)
  - `fork-withheld` — **273 × 113 at 142,369**, **3 items** (was 273 × 81, 2)
  - `pin-state-unknown` — **273 × 109 at 142,401**, **3 items** (was 273 × 77, 2)
  - `archive-withheld` — **246 × 109 at 142,369**, **3 items** (was 246 × 77, 2)

  The row kinds (chord 36, plain 32, padding 8) reproduce all six to within the
  set's own 1px of sub-pixel rounding: `36+36+32+32+8 = 144` twice,
  `36+36+32+8 = 112` twice, `36+32+32+8 = 108`, and
  `36+36+32+32+36+36+8 = 216` against the measured 215 — the six-row panel is the
  one case a pixel under its arithmetic, where the five-row `184` was exact.
  Nothing here is an estimate: every number is the readout the frame itself draws,
  and they were read out of the DOM of the same story URL the rig loads (see the
  Notes).
- **The row kinds, measured — and the 6px that used to be called a step.** A chord
row is **36** and a plain (chord-less) row is **32**, with 8px of panel padding, and
every panel in the set reproduces from those within 1px of sub-pixel rounding
(36+36+32+8 = 112 → 113; 36+32+8 = 76 → 77; 36+36+8 = 80 → 81; 36+36+32+36+36+8 =
184). The "32-33px step" the first take recorded was the two Move rows at 33, a
single-cap row; with their chords joined they are 36 like every other chord row.

**The pointer's own highlight.** `pointer-hover` reads
  `focus: menuitem “Archive conversation⌘⇧A”` and
  `first item: data-highlighted`, in a panel measured 273 × 113 at `142,369`
  (273 × 81 when #694 shipped, before Fork) —
  the state a pointer user meets the moment they move into the menu. The item
  carries the same `:focus-visible` ring `keyboard-open` draws, and that is
  measured rather than assumed: the primitive focuses the hovered item, and
  Blink matches `:focus-visible` for focus the browser did not move itself
  (probed: the ring draws even after a real click elsewhere and a real pointer
  re-entry), so the two paths share the ring and differ in what is focused.
- **The archived row, and the widest panel.** `archived-row` reads
  `panel: 288x113 at 142,362` — 15px wider than the 273 every other state
  measures, because `Unarchive conversation` is two characters longer —
  with `items: 3 — Unarchive conversation⌘⇧A | Pin conversation⌘⇧P | Fork
  conversation` and the row
  drawn at `255x32 at 12,333` with its archived mark. A widened search (`the
  field, then Include archived`) is what puts it on screen at all.
- **The withheld rows** measure `273 × 77` (`pin-state-unknown`: Archive and
  Fork) and `246 × 77` (`archive-withheld`: Pin and Fork) — two rows each, no
  item disabled (#694 shipped them as `273 × 46` / `246 × 46`, one row each,
  before Fork was the second row of both); on the archive-withheld row the pair
  wrapper is not rendered at all (single capability), which is why its `pair`
  lines read `not mounted` while the pin control stands alone in the frame.
- **Fork's three rows, and the one state without it (#739).** Every menu-open
  frame on an ordinary row now reads `items: 3 — Archive conversation⌘⇧A | Pin
  conversation⌘⇧P | Fork conversation` in a panel of `273 × 113` (`288 × 113`
  on the archived row, whose `Unarchive conversation` is the widest label), up
  from `273 × 81` / `288 × 81`. `fork-withheld` reads `items: 2` in
  `273 × 81` — the pre-#739 panel's own numbers — and is the only state where
  the third row is withheld. Fork carries no chord, so its row has no cap and
  the panel gains 32px, not a chord row's 36.
- **The anchor and the row are unchanged by the third row.** `pointer-open`'s
  anchor (`140,369`), panel origin (`142,369`) and row box (`255x32 at 12,340`)
  read the same as before; only the panel's height moved, and the keyboard
  state's origin (`14,370`) is likewise unchanged.

## What these frames do NOT prove

- **A real right-button press, or the real OS key event.** The trigger is the
  product's and the events are the product's own event types, but the rig
  cannot originate a right-button press or a `ContextMenu`/`Shift+F10` key
  from the platform; that is QA's check over CDP against the same build — and it is
  carried for THIS head by QA round 1's report on PR #757 (its C1, C3, C3b and C7):
  real right-clicks opened the menu, and real `Shift+F10` and `ContextMenu` presses
  both opened it with focus in the first item. The sentence was written for #694's
  round, so read it as "this is QA's check, and here is the round that ran it" rather
  than as a claim that predates #757's review.
- **Latency or motion.** A hidden window has no focus; nothing here is a
  timing measurement, and `prefers-reduced-motion` behaviour is the
  components' (no entrance animation is authored anywhere in this menu).
- **Other themes, other widths, other platforms.** Two brand themes at a 780 ×
  520 window and a 280px column; the contrast floors of the other palettes are
  `contrast-contract.mjs`'s claims, and the panel's own floor (`min-w-56`) does
  not bind in any measured state.
- **The pointer's hover ground in the instant before open.** The frames show
  the held state and the un-opened state (`menu-closed`); the shared
  hover-reveal itself is already photographed in
  `../chat-sidebar-current-row/` and `../sidebar-row-space/`.

## Notes

- **Two pairs are byte-identical files, by construction — re-checked at this head
  (#893).** `pointer-open` and `flyout-dwelled` are the same file in both themes
  (dark `md5 4cfeaeb6…`, 24,630 bytes; light `a3037d74…`, 25,720 bytes) — a complete
  suppression. `menu-closed` and `flyout-alone` are the same file (dark
  `md5 be6d69be…`, 18,174 bytes; light `1135b58a…`, 18,824 bytes) — both are “hover
  settled, no menu, flyout drawn”. The coincidences are the measurement rather than
  two takes of one shot, and they held through the #739 re-take and again through
  this one (the #739 figures were dark `5e6da1cb…` 23,696 / `069a1133…` 18,324 and
  light `a9173ec9…` 24,714 / `025cf64a…` 18,972). (**Twenty-two** distinct pictures
  under twenty-six names.)
- **Byte accounting for the #893 re-shoot, measured with `md5` against
  `git show HEAD:<path>`.** All **30** re-taken frames differ byte-for-byte and
  **none came back identical** — the #739 re-take's “twenty-two of twenty-four”
  does not repeat here, because this change moves the menu itself in every state
  that draws one. The six frames that drew NO menu (`menu-closed`, `flyout-alone`,
  `fork-pressed`, both themes) are the only ones that SHRANK (−122 to −150 bytes):
  nothing in them is about the menu, and the bytes that moved are the capture
  clock's (the sidebar's own relative stamps — the class the “Capture clocks” note
  below describes). Every frame that draws the menu GREW, by +242 to +2,106 bytes,
  because the readout’s `items:` line and its `panel:` box are drawn INTO the frame
  and both changed. The two NEW files are
  `copy-pressed/{localOperatorDark,localOperatorLight}.webp` (18,554 and 19,478
  bytes).
- **Where the numbers in this README come from (#893).** The rig renders the
  readout into each frame but prints only a summary line, so the figures above were
  read out of the DOM of the same story URL the rig loads
  (`/iframe.html?id=<story>&viewMode=story&args=theme:localOperatorDark`, the rig's
  own `Emulation.setDeviceMetricsOverride` viewport), after the same gesture the rig
  makes — a real pointer move onto the row, which is what the story's `waitForHover`
  opens the menu on. The readouts reproduced the committed PRE-#893 placements
  (`pointer-open` 273 × 113 at 142,369, `pinned-row` 296 × 184 at 142,297) before
  the change was measured, which is what makes them the same instrument the frames
  draw.
- **The re-take also carries what `main` moved, and says so.** The #739 frames
  were taken at `26a814c2c2`, and the sidebar's toolbar draws a fourth icon (the
  `@` mention control) that the #694 frames, taken earlier, do not. That is the
  base moving, not this change; the frames that differ for Fork alone are the
  menu panels themselves.
- **The fixture waits for the pointer (#739, the fold's repair).** The story's
  pointer states now poll `:hover` on the row and open the menu only once the
  pointer is on it (`waitForHover`, `chat-row-context-menu.stories.tsx`); the
  keyboard state does not wait, because no pointer is involved. Recorded here
  because it changes what the frames are: the menu is now photographed opening
  under a pointer that is genuinely on the row, and the gate the rig applies
  (`the element must match :hover`) is satisfiable by construction rather than by
  winning a ~300ms race. The rig confirms the same fact independently - every
  pointer frame in this set passed that gate at the tip named above.
- **Capture clocks — the whole set is one now (#739).** Every frame was
  re-taken for #739 over rows dated minutes before, so all of them read `TODAY`;
  what follows is why the #694 half once read otherwise, kept because the
  manifest's older notes cite it (design round 2, D6). The
  round-1 half was written at 00:00:17–00:00:59 on 2026-09-30 over rows dated
  the previous local day, so its list header reads `THIS WEEK` (ink 66px); the
  two remediation states were written at 02:51 over rows dated minutes before,
  so they read `TODAY` (ink 40px); and `pinned-row` was re-shot at 05:35 on
  the fold onto `50b9daf8fe`, over rows dated minutes before, so it reads
  `TODAY` too. Each is right for its capture instant — the sidebar sections by
  the local calendar day — and no geometry, readout or claim in the set
  depends on the header.
- **This set supersedes the design round's proposal set**
  (`../chat-sidebar-row-context-menu-proposal/`), which lives on
  `design/row-context-menu-694` as the record of what was proposed — its
  `pointer-open-unheld` control reproduces a defect the shipped hold removes,
  and nothing in this set re-photographs it.
- **The fold (#739's own).** This branch folded onto `origin/main` =
  `490c2079fb` by a merge commit (`bec29a5f58`) while the frames were being
  taken; `docs/evidence/manifest.json` was the only conflicted path (main's copy
  taken whole, this branch's records re-laid by the capture pass), and
  `scripts/capture-evidence.mjs` auto-merged with this branch's two new STORIES
  rows intact. The branch also carries eight earlier merges of `origin/main` (`0044c53422`,
  `9dd18ab318`, `0f35e824ac`, `1cb4a2a8b3`, `8712e8684c`, `2e866d5d49`,
  `efca9e16fc` and `50b9daf8fe` — the round-2 and round-3 folds, the last two
  landed as `64202be19f` and `c88736f3b4`); the two remediation states were
  captured at the commit `addedAtHead` names, `pinned-row` was re-shot at the
  `50b9daf8fe` fold (see the clocks note), and the manifest's pass record
  names the commits the frames came from.
- The story renders the app's real `ChatSidebar` over a stubbed transport, so
  no frame touches a live backend; `--allow-backend` is passed because the
  operator's own backend answers on 1111 and the rig refuses a run that could
  be mistaken for driving it.
