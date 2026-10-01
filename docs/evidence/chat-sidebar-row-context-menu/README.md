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
| `pinned-row` | `Unpin conversation` on s1, the row that draws its mark at rest — re-shot at the #697 fold with its revealed move pair (both arrows boundary-inked while one pinned row is shown), the pair held under the open menu. Evidence basis: the hold's five clauses are the code plus the suite's five-clause assertion, and the grip-under-menu combination is code-and-test only — the grip is shed at this width, so no frame photographs it |
| `pin-state-unknown` | s3, `pinned === undefined`: one row, and the row draws no pin control |
| `archive-withheld` | `session_archive` absent: one row (`Pin conversation`), not a disabled one |
| `archived-row` | the row behind `Include archived`: item 1 reads `Unarchive conversation` (288 × 81, the widest state) |
| `flyout-dwelled` | the flyout given 1800ms to dwell, then the menu: flyout `absent` |
| `flyout-alone` | the control: the same row (s2), same hover, same dwell, no menu |
| `menu-closed` | `pointer-open`'s before/after partner: same scene, same settle, no open — and the open state drops the flyout band itself (see `flyout-dwelled`) |
| `fork-withheld` | #739: s2 is a never-sent draft's conversation (`drafts` holds its id), so the row reads `Not sent yet` and the menu draws Archive and Pin only — Fork absent, not greyed |
| `fork-pressed` | #739: the menu opened on s2 and Fork pressed. There is no chat pane in the story, so no picker can open and this frame does not show one; it shows the sidebar's half — the readout prints the request in the panel-presentation store (`session.fork for s2`, the ROW's conversation), its invoker (`button[data-chat-row] in s2`) and `route: /chat`. The pane's half (presenting the NAMED conversation rather than its own, and `rebind` navigating to the fork) is `slash-dispatch.ts`'s consume effect, asserted in `scripts/panel-presentation.test.mjs` |

## The numbers, and what they settle

Every number is read out of the DOM by the story; `docs/design/row-context-menu.md`
§ 9 carries the full table. The load-bearing ones:

- **The anchor.** Pointer states: the dispatched point (`140,369` on s2 —
  centre-x, `rect.bottom - 3`). Keyboard state: the synthesised row-box edge,
  `anchor point: 12,371` with the panel at `14,370` — `rect.left` and
  `rect.bottom - 1`, exactly what § 3 prescribes, and no code path read the
  ambient event's coordinates. The panel sits 2px right of its anchor because
  the primitive hard-codes `sideOffset: 2`; it has no caller-facing option. On
  the keyboard path that placement leaves the panel's outer right edge (286)
  over the sidebar divider's hairline (x 279) by **7px** — the accepted
  straddle's smallest case, recorded with the findings that measured it
  (design round 1, D4).
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
- **The pointer's own highlight.** `pointer-hover` reads
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
  from the platform; that is QA's check over CDP against the same build — and
  QA round 1 carried it: real right-clicks opened the menu, and real
  `Shift+F10` and `ContextMenu` presses both opened it with focus in the first
  item (round 1's QA report, on the PR).
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

- **Two pairs are byte-identical files, by construction.** `pointer-open` and
  `flyout-dwelled` are the same file in both themes (dark `md5 5e6da1cb…`,
  23,696 bytes; light `a9173ec9…`, 24,714 bytes) — a complete suppression.
  `menu-closed` and `flyout-alone` are the same file (dark `md5 069a1133…`,
  18,324 bytes; light `025cf64a…`, 18,972 bytes) — both are “hover settled, no
  menu, flyout drawn”. The coincidences are the measurement rather than two takes
  of one shot, and they held across the #739 re-take. (Twenty distinct
  pictures under twenty-four names.)
- **The re-take also carries what `main` moved, and says so.** The #739 frames
  were taken at `26a814c2c2`, and the sidebar's toolbar draws a fourth icon (the
  `@` mention control) that the #694 frames, taken earlier, do not. That is the
  base moving, not this change; the frames that differ for Fork alone are the
  menu panels themselves.
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
- **The fold.** The branch carries eight merges of `origin/main` (`0044c53422`,
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
