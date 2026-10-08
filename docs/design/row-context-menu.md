# The chat row's context menu — composition, states and copy

**Issue:** #694 (the menu); #739 (Fork - **row 3 of six** since the round-1
review's D2, § 1, § 5, § 7, and the rows marked #739 in § 4 and § 9); **#893
(Copy session ID - row 4, § 1, § 7, and the superseded figures in § 2, § 4 and
§ 9)**. **Design round:** 2026-09-30,
`design/row-context-menu-694`.
**Status:** design of record for the implementation, ported onto it with the
design round's follow-ups (U-D1…U-D8) folded in and every frame reference
re-pointed at the shipped set, `docs/evidence/chat-sidebar-row-context-menu/`.
The **proposal set** this document first shipped with (`…-proposal/`, the story
marked as a proposal) lives only on `design/row-context-menu-694`; the
implementation's own set supersedes it and is what the readouts below quote.
**UX input:** the take on #694 (U1–U10), which this document turns into pixels.

This file decides what the menu *is*: its items, its trigger, its states, its
copy, its chrome and the numbers behind it. It does not decide implementation
sequence, and it deliberately does not restate the reasons that live in
`docs/branding.md` or the sidebar design records — those are cited instead.

---

## 1. What the menu is

A right-click (or `ContextMenu`/`Shift+F10`) on a chat row opens a Radix
context menu holding the row's own acts, **six rows** - the two mirrored acts,
then the UNCONDITIONAL run (#739's Fork and, since #893, Copy session ID), then
#743's Move pair:

| # | Row | Chord | Withheld when |
|---|---|---|---|
| 1 | `Archive conversation` / `Unarchive conversation` | `⌘⇧A` · `Ctrl+Shift+A` | `archiveEnabled` is false |
| 2 | `Pin conversation` / `Unpin conversation` | `⌘⇧P` · `Ctrl+Shift+P` | `row.pinned === undefined` |
| 3 | `Fork conversation` (#739) | none - fork has no chord | the row is a never-sent draft's conversation (`unstarted`): the backend has no transcript to copy |
| 4 | `Copy session ID` (**#893** - the act that moved the cap from five to six) | none - nothing binds the gesture | never - drawn on every row the menu is drawn on, like Fork |
| 5 | `Move conversation up` (was row 4) | `⌘⇧↑` · `Ctrl+Shift+↑` | the row is not offered a move at all (`offersPinnedMove`: it is pinned AND in the section the order belongs to) |
| 6 | `Move conversation down` (was row 5) | `⌘⇧↓` · `Ctrl+Shift+↓` | the same |

**THE ROW ORDER IS THREE RULES, IN ORDER (round-1 design review, D2; the second
rule amended by #893).** Rows 1-2 are the mirrored pair in the strip's own
measured order; rows 3-4 are the UNCONDITIONAL run, so each of those slots keeps
one identity in every state - Fork on an ordinary row and Fork on a pinned one,
Copy session ID everywhere - rather than changing which act a reader finds
there; and the CONDITIONAL block (the Move pair, offered only where `offersMove`
holds) trails as a unit, so its two rows stay adjacent to each other either way.
That replaces the fold's arrangement, which appended Fork after the Move pair
and left the third slot's occupant state-dependent while never arguing the order
it produced. The principle, not the position, is what the next act applies: a
conditional act does not take a slot above an unconditional one. #893 did not
bend the rule to get its slot - Copy is itself unconditional, so it joins the
unconditional run rather than displacing a row.

**For the acts this menu carries, the order is the strip's order, left to
right, and that is measured rather than argued.** In the row, the archive
control is `order-first` and the pin control owns the right edge:
`pair children: button[pin]:flex:243w24 | button[archive]:flex:215w24`
(`pointer-open/localOperatorDark`). The menu reads Archive then Pin, so the two
surfaces present the same two carried acts in the same sequence. The sentence
is scoped to those acts because the strip and the menu are not the same list: a
future strip act the menu has no row for would not re-order the menu's two. A
menu that listed them the other way round would make the same pair of acts
read backwards depending on how the user opened them.

**Nothing else is in it, and each exclusion is a decision rather than a
ranking** — rename (an editing surface on a 280px row; its write path is the
open conversation's, `chat-header.tsx:500`), delete (`session-archive-delete.md`,
"Delete asks, and never on the row"), and the four acts with no product ask
anywhere in #694/#693 (duplicate, copy link, open in new window, mark unread).

**THE MOVE PAIR MOVED IN (2026-09-30), and it used to be in that exclusion list.**
`#693` put the act on the row - two arrow buttons in the hovered cluster - and the
operator's report on the pinned strip is that the cluster was crowded at the narrow
end; the arrows were the pair that made it so. WCAG 2.5.7 asks for a single-pointer
path to an act, so the path could not simply be dropped, and this menu is the
surface the row's other acts already live on: one door, four acts, and the row keeps
its width back. Items 1-2 keep their order (the strip's own order, left to right,
measured rather than argued); 3-4 follow them, first up then down, and #893's Copy
session ID was inserted between Fork and the pair (row 4) when it arrived.

**"COPY LINK" STAYS EXCLUDED, AND IT IS NOT #893's ACT (2026-10-08).** The
paragraph above rules out an act that copies a LINK; `Copy session ID` copies an
IDENTIFIER, and the difference is the whole reason the exclusion does not reach it.
A link is another surface's address for the conversation and duplicates a door the
user already has (open the conversation, copy its URL); an id is the value a
`sessions`/`send` call or a `lop` command takes, which NOTHING in the product
reveals - so an operator handing a session to another agent or to a terminal had no
door at all before #893. The row's id has no other door (see § 7's rule): the
header's overflow menu names the PANE's session, which is generally not the row's.

**A BOUNDARY IS A SENTENCE, NOT A DEAD ITEM.** At the first or last pinned slot the
item stays drawn and actionable, carrying `aria-disabled` and the boundary's own
ink; pressing it calls the same `movePinnedRow` the act does and answers with
`pinMoveBoundaryNote` through the live region. A real `disabled` would drop the item
out of the focus order a keyboard reader walks AND stop the activation, so the why
would be unannounceable - the trade the drafts' discard act refuses
(`chat-sidebar.tsx`'s note on the item is the authority).

**FORK IS THE FIFTH ROW (#739), and it differs from all four above in mechanism.**
Archive and Pin press the row's own control, and the two Move items call
`movePinnedRow`; Fork has no row control to press at all. It opens the register's
own `session.fork` picker (`ForkPicker`, the same one `/fork` and the palette
open) for THIS row's conversation, by writing a request to the panel-presentation
store that **names the row's conversation** - the chat pane mounts the picker and
its own conversation is generally not the row's, so the presenter reads the
request's `sessionId` before its own (`slash-dispatch.ts`). It carries **no
chord**: fork has none, so the item has no `KeyboardShortcut` and no
accessible-name suffix beyond its label.

**Completing a fork from the menu navigates to the new fork**, and that is
decided rather than inherited. The picker's `rebind` is the pane's
`openConversation`, the shipped `/fork` semantics, reused deliberately: Archive,
Pin and the two Moves do not navigate because they act on the row in place, but a
fork's whole product is a child conversation, and the picker's own receipt names
it - handing the user the child is the act finishing, not a side effect. The
original is untouched. Escape (or any dismissal) returns focus to the row's own
button, the node the menu's own close returns to.

**Fork's one withheld condition is the row's own `unstarted` statement**, not
`row.pending`: a fork copies a conversation's TRANSCRIPT, and the backend refuses
a session that has none (`fork.py::fork_session`), which is exactly the
real-but-empty session a first send that failed after allocation leaves behind -
the row the sidebar already draws as `, not sent yet`. `pending` names a parked
approval or ask, which only a session that has already run a turn (i.e. one with
a transcript) can carry, and the route does not refuse it. Read once as
`forkable` in `chat-sidebar.tsx` and pinned by
`scripts/chat-sidebar-row-menu.test.mjs`.

### The menu repeats the hover pair, and the reason has to be on the record

`chat-header.tsx:1229-1237` rules duplicates out — *"a duplicate would be a
second way to do what the row already does; these are the same door for the
widths where the row cannot carry a button for it"* — and this row never sheds
its pair (`chat-sidebar.tsx:3784-3800`; the shed and its two constants were
deleted by the row-space round). Read literally, the rule forbids this menu.

**The menu ships anyway, and the rule is met by an argument rather than by
silence.** The exception in the header is about *width*; the principle behind
it is that a second door must not be a redundant one. These two doors differ in
kind, not only in place:

- **The pair is not focusable.** Both controls are `tabIndex={-1}`
  (`chat-sidebar.tsx:3408-3430`, `:3583`), reachable only through `⌘⇧P`/`⌘⇧A`.
  So on a keyboard there is exactly one *discoverable* route to these acts, and
  it is a chord the row prints nowhere. The menu's items are focusable, named
  and labelled: **the menu is the only door a keyboard user can find by
  pressing it.**
- **The pair's target is 24px and appears after a reflow.** It is `display:
  none` at rest on an ordinary row, and revealing it takes 56px out of the
  title (`pair children … :215w24`, `:243w24` against a 255px box); a pinned
  row's strip WAS four controls and took **108px** (§ 7's shipped measurements as of
  #697); the two arrow buttons moved into this menu on 2026-09-30, so it is three
  controls and takes **80px** with the grip and **52px** without it. The menu's own
  rows are the panel's content rows, not the strip's 24 × 24 controls: the shipped
  panels measured **273 × 81** (two rows) and **273 × 46** (one row) when this
  was written, and measure **273 × 113** (three rows) and **273 × 77** (two:
  Archive and Fork) with Fork spending the third row (§ 2's table) - and the
  pointer opens the menu over the whole row.

So the rule is amended in one sentence, and the sentence belongs in the code
comment beside the menu: **a second door is a duplicate when it does not lower
the cost of the act; a menu item that names the act, anchors at the pointer and
is reachable without knowing a chord is a different cost profile.** This is the
one place this change overrides a written rule, and it is stated here so the
review can attack the argument rather than rediscover the repetition.

---

## 2. The primitive

`src/renderer/src/shared/components/ui/context-menu.tsx`, new, mirroring
`dropdown-menu.tsx` (`docs/branding.md` §9 item 1: *"Is there an existing
primitive in `shared/components/ui/`? Use it."*). It reuses the chrome class
strings **verbatim** — the panel is
`z-50 min-w-32 overflow-hidden rounded-md border border-hairline bg-elevated p-1 shadow-overlay`
and a row is
`relative flex select-none items-center gap-2 rounded-sm px-2 py-1.5 text-body-sm text-ink transition-colors duration-fast data-[highlighted]:bg-accent-wash`
plus the `data-[disabled]` colour step and the `[&_svg:not(.size-2)]:size-4`
carve-out. Consequences worth stating:

- `rounded-md` is 10px, the panel radius (`--radius-md`, `styles/index.css:658`);
  `rounded-sm` is 6px, the row radius. No new radius is introduced.
- `bg-elevated` is the top of the ground ramp, which is why the highlight is
  `accent-wash` and not a lighter ground — the reason is written at the top of
  `dropdown-menu.tsx` and is inherited rather than re-derived.
- **The highlight's two steps are inherited, and one of them is known-short
  (design round 1, D1).** The fill's step against the panel is under ΔE00 4 in
  **13 of the 59 palettes** (tokyoNight 2.04 … tokyoNightStorm 3.98; the two
  brand palettes read 12.79 and 6.84, which is why no frame in this set can
  show the problem). It is inherited rather than introduced
  (`dropdown-menu.tsx` draws the same pair) and `contrast-contract.mjs`
  deliberately does not assert `accent-wash` as a fill, and the recorded
  decision is **no primitive change in this PR**: if the pointer highlight must
  carry in those palettes, the fix belongs in the primitive as its own small
  change (the `borderControl` edge the picker and combobox marks took). What
  the new `pointer-hover` frame adds beside the wash is measured and stated:
  the item carries the `:focus-visible` outline too, because the primitive
  moves focus onto the hovered item and Blink matches `:focus-visible` for
  focus the browser did not move itself (probed: the ring draws after a real
  click elsewhere and a real pointer re-entry), so the pointer and keyboard
  states share the ring and differ in where focus lands.
- **No new fill, border or role is introduced**, so nothing is added to
  `CONTROLS` in `scripts/contrast-contract.mjs`. Measured: the contract still
  holds unchanged — `29299 assertions across 59 themes, 0 consulted
  exception(s)`.
- `data-titlebar-no-drag` on the panel, copied from `DropdownMenuContent`. The
  chat row is not in the titlebar lane (`chat-layout.tsx:552-554`), but a portal
  can land under it and `styles/index.css:123-129` makes the opt-out the rule
  for any control that does.
- **There is no `sideOffset` prop, and no `side` or `align` choice either:
  the primitive fixes the placement.** The installed
  `@radix-ui/react-context-menu@2.3.7` spreads the caller's props and then sets
  `side: "right"`, `sideOffset: 2`, `align: "start"`
  (`dist/index.mjs:134-136`), so a caller-supplied `sideOffset` is silently
  overridden. The wrapper therefore does not carry the dead prop the first
  draft of this document listed: a context menu always opens 2px to the right
  of its anchor, top-aligned, and the app's call sites cannot choose otherwise.

### Panel width, measured

The panel is **content-sized with a floor**: `min-w-56` (224px), set on the
app's own `ContextMenuContent` (`shared/components/ui/context-menu.tsx`)
rather than at the call site - the floor belongs to the app-level wrapper so
the next context menu cannot lose it by not knowing about it - and it does not
bind in any of the measured states.

| state | measured panel | items |
|---|---|---|
| archive + pin + fork | **273 × 113** | 3 |
| unarchive + pin + fork (the archived row's widest label) | **288 × 113** | 3 |
| archive + fork (unknown pin state) | **273 × 77** | 2 |
| pin + fork (archive capability withheld) | **246 × 77** | 2 |
| archive + pin (fork withheld: a never-sent row) | **273 × 81** | 2 |
| archive + unpin + fork + move up + move down (a pinned row in the moved-from section) - **the PRE-#893 five-row panel** | **296 × 184** | 5 |
| archive + unpin + fork + copy + move up + move down (**#893**, the widest state now) | **not measured here** - the re-measurement is owed to the evidence pass (see below) | 6 |

**EVERY ROW OF THIS TABLE PREDATES #893 EXCEPT THE LAST, AND THAT IS STATED RATHER
THAN LEFT TO BE INFERRED (2026-10-08).** The `measured panel` column is the pre-#893
readout and is kept as the record; each of those states now also draws `Copy session
ID`, a plain (chord-free) row - so the 3-item states draw four and the 2-item states
draw three. The one row that is new is the last: the pinned row's SIX-row panel, whose
frame and DOM readout the evidence pass on #893's head owns.

**THE FOUR-ITEM CASE IS NOT IN THIS TABLE, AND THAT IS STATED RATHER THAN IMPLIED
(2026-09-30).** A pinned row in the moved-from section draws `archive` + `unpin` +
`Move conversation up` + `Move conversation down`; with the two kinds measured above
(chord rows 36 each, 8px of padding) its height arithmetic is `36 + 36 + 36 + 36 + 8 =
152` at the archive row's own width, and its widest label is still `Unarchive
conversation` (288). No frame on this head carries it - the `row-context-menu` set is not one this
change re-shot - so the number is ARITHMETIC over this table's own rows rather than a
measurement, and the design round should read it as such: re-shooting that set is a
`docs/`-only follow-up if the height is ever in question.

**THE FIVE-ITEM CASE (#743's Move pair plus #739's Fork) IS MEASURED, where the
four-item case above is arithmetic (2026-10-01, #739's re-shoot, re-taken for the
round-1 design review's D1/D2), AND IT IS NOW SUPERSEDED BY #893'S SIX-ROW PANEL
(annotated 2026-10-08, not re-measured here).** `pinned-row` draws `archive`, `unpin`, `Fork
conversation`, `Move conversation up` and `Move conversation down` in **296 × 184 at
142,297**, anchored at `140,297`, with the two Move rows boundary-inked and
`aria-disabled` (the row is pinned and in the section the order belongs to, so
neither direction is available) and the row's own pair back to TWO children -
`button[pin]:flex:243w24 | button[archive]:flex:215w24` - because the arrows left the
strip for this menu. The ordinary-row states are unaffected by the Move pair
(`offersMove` is false unless the row is pinned and in the section the order belongs
to), which is why they keep their composition (three rows pre-#893; four since,
because `Copy session ID` is drawn unconditionally); the one-capability-withheld
states stay at two pre-#893 and three since.

**THIS IS NOW THE WIDEST PANEL IN THE SET (296), AND THE JOINED CAPS ARE WHY (D1).**
Measured A/B on the same story, same rig, one variable: with the Move rows printing
the handler's spelling they were ONE cap wide and the panel read **273 × 178**; with
the joined sibling they print three caps each and it reads **296 × 184**. The +23px
is the Move rows' chord column (≈21px → 60px) becoming the menu's widest content,
past `Unarchive conversation` at 288; the +6px is those two rows' own height (33 →
36), because a chord row's height comes from the cap and one cap three glyphs wide is
not the same box as three caps.

**THERE IS NO SINGLE ROW STEP IN THIS SET, AND THE TWO KINDS ARE THE HONEST
READING (round-1 design review, D5).** The deltas the panels give are between
panels of DIFFERENT composition, so they cannot be a step: 81 → 113 adds the plain
Fork row to two chord rows, and 113 → 178 adds TWO chord rows (+65, ≈32.5 each),
while 81 → 77 is the same two-row panel with one chord row swapped for the plain
row (-4). Read as the set's own numbers, the two kinds are **a chord row ≈ 35-36**
and **a plain row ≈ 31-32**: the direct per-item reading is the highlighted item's
painted rect in `pointer-hover`, measured at **263 × 35** (dark) and **263 × 36**
(light), and a flat 32-33 is not a value this set contains. The 273 is unchanged
and Fork's own row is the shorter of the two kinds, because a row with no
`KeyboardShortcut` is a plain text row where every chord row carries the cap that
is the tallest thing in it.

**AND THE SET NOW CLOSES, WHICH IS WHAT THAT 6px WAS.** With the two kinds the live
DOM measures - chord row **36**, plain row **32**, panel padding **8** (4 top, 4
bottom) - every panel in §2's table reproduces to within 1px of sub-pixel rounding:
`36 + 36 + 32 + 8 = 112` against the 113 the 3-row frames read; `36 + 32 + 8 = 76`
against 77 for both chord+plain two-row states; `36 + 36 + 8 = 80` against 81 for the
two-chord one; `36 + 36 + 32 + 36 + 36 + 8 = 184` exactly for the five-row state. The
previously unexplained 6px WAS the two Move rows: they measured **33** while they
printed one cap and **36** once they print three (the D1 A/B above), so the old
`178` was 176 − 6 + 8. There is no third kind and no unexplained residue.

**#893 ADDS ONE PLAIN ROW, AND THE NUMBER FOR IT IS OWED TO THE EVIDENCE PASS
(2026-10-08).** `Copy session ID` is chord-free like Fork's row, so it is the PLAIN
kind this set measured - and the six-row pinned state is therefore expected to be the
table's `296 × 184` grown by one plain row. That is ARITHMETIC over the set's own
measured kinds, not a measurement, and it is labelled the same way the four-item case
above is: the WIDTH is not expected to move, because the Move rows' joined chord
column (296) stays the widest content whatever a shorter label does, and the label
here (`Copy session ID`) is shorter than `Unarchive conversation` at 288. The six-row
FRAME and its DOM readout belong to `docs/evidence/chat-sidebar-row-context-menu/`,
which the evidence pass on #893's head owns - this document does not carry a figure it
has not seen.
The 273 is the archive row's own length: `px-2` 16 + icon 16 + `gap-2` 8 +
label + `pl-6` 24 + chord ≈ 60 + `px-2` 16. `Unarchive conversation` is the
widest LABEL the menu draws, and its state measures **288 × 113**
(`archived-row`), the two extra characters showing up exactly there — which is
no longer the widest PANEL: that is the pinned five-row state at **296 × 184**
(§ 2), where the Move rows' joined chords are wider than every label; Fork's label (`Fork conversation`) is shorter than either chord row, so
it widens nothing. The floor exists so that a
one-short-item menu is not cramped; the width above it is the content's. A menu
padded to a width it does not use would be the chrome §5 deletes — and the two
measured widths differ by 27px, which is the amount of text that is actually
there.

---

## 3. Trigger, anchoring, and the attribute the row box already carries

**The trigger is the row's box** (`[data-session-row]`,
`chat-sidebar.tsx:3857`), not the row's `<button>` — the same anchor reasoning
the flyout already took (`:3837-3855`: the button shrinks by 56px when the acts
reveal). The box is also what the acts live in, so the trigger covers them.

**With neither capability there is no trigger at all** — no element, no
attribute, no handler, so the fully withdrawn panel's class list is the one it
had before either feature existed (`:3444-3456`, `:3857-3959`).

### THE TRAP THIS CHANGE WALKS INTO, AND IT IS MEASURED

The row's box is **already a Radix trigger**: it is the shared `Tooltip`'s
trigger, and Radix writes `data-state` on its trigger. The control frame
`flyout-alone/localOperatorDark` prints the box as
`ground rgb(48, 45, 41) data-state delayed-open` — the row box carries the
tooltip's state, and it carries it while the flyout is drawn, i.e. in exactly
the state a right-click happens in.

A `ContextMenu.Trigger` on that same element writes `data-state` too, with the
menu's own values. **Two Radix triggers, one attribute.** Two consequences, and
both are requirements:

1. **No rule in this change may be authored against `data-state` on the row
   box.** `data-[state=open]:bg-row-hover`, `group-data-[state=open]:flex` and
   anything shaped like them are defects: the attribute's value is whichever
   trigger wrote last, and the frames above show it is not the menu's while the
   flyout is up.
2. **The sidebar owns the open state in React.** One piece of sidebar state —
   the id of the row whose menu is open, `openMenuRowId` — and the row's own
   consequences (the held reveal, §4) are ordinary conditional classes computed
   from it. The trigger's `data-state` is left to be whatever Radix composes.

The trigger is reached with `asChild` so that the row's box **is** the trigger:
a wrapper element would add a node to the sidebar's list and change the box's
place in its parent's layout, and `Primitive.span` around a `div[data-session-row]`
would nest flow content inside a `span`. Composition order is
`<Tooltip>` → `<ContextMenu.Trigger asChild>` → the box, so the flyout keeps
anchoring to the box that does not shrink.

### Pointer path

Opens where the pointer is — the primitive's own behaviour: `handleOpen` stores
`{x: event.clientX, y: event.clientY}` as the virtual anchor
(`@radix-ui/react-context-menu@2.3.7`, `dist/index.mjs:75-78`).

Whatever is inside the row's box is inside the trigger, so a right-click on the
title, on the timestamp, or on either of the pair's own controls opens the row's
menu. That is intended: the box is the row, and the pair's buttons are inside
it. A right-click is not a press, so the control under the pointer does not act.

### Keyboard path — open question 2, resolved by construction

**The keyboard opener does not read the ambient event's coordinates at all.**
It synthesises them from the row's box and dispatches its own `contextmenu`:

1. `event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"` on the
   row's focused button — the `use-link-subject.ts:441-448` shape, which the repo
   already trusts over the platform: `preventDefault()`, then open.
2. The anchor point is the row's own box: `clientX = rect.left`,
   `clientY = rect.bottom - 1`. The panel therefore opens at the row's
   bottom-left - its top edge 2px right of the box's left edge and level with
   the box's bottom, per the primitive's fixed placement - and the row it
   belongs to stays whole above it
   (`keyboard-open/localOperatorDark`: `anchor point: 12,371`, `panel: 273 ×
   113 at 14,370`, the row's pair still drawn at 215 and 243). The panel spilling
   past the sidebar column's inner edge is the accepted composition, not a
   collision: the anchor is the row's box and the panel is placed from it, and
   every menu in this surface has always drawn over the column's edge rather
   than being re-anchored to avoid it. **The straddle is not one number, and the
   keyboard case is the small one (round-1 design review, D7).** The divider
   hairline sits at x 279; `keyboard-open`'s panel box spans 14..287, so **8px**
   (7px of ink) sit over the chat pane - while the POINTER states are placed to
   the right of a pointer anchored mid-column and straddle much further:
   `pointer-open` spans 142..415 = **136px**, `archived-row` 142..430 = **151px**.
   The acceptance covers all three; the sentence used to read as a general claim
   about "a few pixels", which only the keyboard case is.

Why synthesise rather than forward the platform's event: the installed
primitive binds **no key handler at all** (U2 — `Primitive.span` at
`dist/index.mjs:85`, with `onContextMenu`/`onPointer*` only), so the chord's only
route in is the browser's own `contextmenu`, whose coordinates on a
keyboard-originated event are not specified and may be `0,0` — which would
anchor the panel to the viewport's top-left corner and trip the primitive's own
"position is indeterminate" path (`:30`). Synthesising also sets
`hasInteractedRef` before `open`, so that path is unreachable by construction.

**That is the design's answer, not a measurement of the platform**, and the
distinction matters: this round did **not** measure what Chromium/Electron
delivers for a keyboard `contextmenu` on macOS (the repo's capture rig can press
no key but Enter and Space, `capture-evidence.mjs:9688`). The implementation is
free of the question — it never reads those coordinates — and QA's check is
therefore structural: **no code path on the keyboard opener may consume
`event.clientX/clientY`, and the panel's anchor must equal the row box's own
edge.** The same check covers the primitive's warning: it must not fire.

### Focus on open — the first item, and the mechanism behind it

**The proposal frames could not reach this, and said so.** They printed
`focus: menu "…"` — `document.activeElement` was the menu content, not the
first item — because that is the primitive's own behaviour. The shipped set
lands the caret in the **first item** (`keyboard-open/localOperatorDark`:
`focus: menuitem “Archive conversation⌘⇧A”`, `first item: data-highlighted`),
and the mechanism is the second one this section always allowed: Radix focuses
the content during mount, and a `menuOpenedByKeyboard`-guarded handler on the
content redirects that first focus to the first `[role="menuitem"]`. One press
is again enough, which is the model the repo already chose for the same gesture
(`use-link-subject.ts:441-448`). On close the paths part again - for the
ACT-FREE close: the keyboard path returns the caret to the row's button, and
the pointer path returns whatever held focus before the press (read on
`pointerdown`'s capture phase, before the press's own default can move it -
QA round 3's Q-1); item activation instead lands on the acted control's own
destination (§ 6; UX round 2's U8, scoped in round 3's U10).

**Why the container's focus event and not `onOpenAutoFocus`:** that hook is
real at runtime, but the primitive keeps it out of its public prop types (it
lives in `MenuContentImplPrivateProps`, the same interface `MenuSubContent`
consumes with different semantics), and the wrappers in
`shared/components/ui/` take no untyped escapes to reach a private prop.

**The floor, kept because the next menu earns the same question:** the
acceptable minimum is that the **first item carries `data-highlighted`**.
Radix's default — focus on the content, no item highlighted — is **not**
`docs/branding.md` § 9 item 6 met (there is no visible focus): a frame showing
it would be a recorded shortfall, not compliance. The pointer path keeps that
default deliberately and the frames say so (`pointer-open`: `focus: menu`,
`first item: not highlighted`).

---

## 4. States

| state | what the menu does | what the row does | frame |
|---|---|---|---|
| closed (no pointer) | not mounted | unchanged; the pair is `display: none` at rest | `menu-closed` - **one image with `flyout-alone`** (§ 9): the two names are one capture, taken with the pointer on the row, and it carries the flyout because the flyout is a dwell behind the pointer |
| open at the pointer, normal row | 4 rows - archive, pin, fork, copy session ID; chords on the first two, none on fork (#739) or on copy (#893) | reveal held, hover ground held | `pointer-open` |
| the same, the pointer moved onto the first item | the same 4 rows; item 1 carries `data-highlighted`, and the same `:focus-visible` outline the keyboard state draws (measured; see § 2) | reveal held | `pointer-hover` |
| open via keyboard (`ContextMenu` / `Shift+F10`) | the same 4 rows; anchored at the row's bottom-left | reveal held, no pointer needed | `keyboard-open` |
| open at the pointer, pinned row in the moved-from section | **6 rows**: `Archive conversation`, `Unpin conversation`, `Fork conversation`, `Copy session ID` (#893), `Move conversation up`, `Move conversation down` (both Move rows `aria-disabled` and boundary-inked at this row's ends, with the boundary sentence as their `title`) | the pair is drawn at rest (the mark is the state), with nothing else revealed | `pinned-row` - the frame on this head is the PRE-#893 five-row one (`re-shot at #739's order and D1's joined caps: five rows in 296 × 184`); the six-row frame is owed to the evidence pass on #893's head |
| `row.pinned === undefined` | **3 rows** (archive, fork, copy); the pin row is withheld | row draws no pin control either | `pin-state-unknown` (273 × 77 **pre-#893**, two rows then) |
| `archiveEnabled` false | **3 rows** (pin, fork, copy); the archive row is withheld | archive control absent | `archive-withheld` (246 × 77 **pre-#893** - the widest-label-withheld state) |
| the row is a never-sent draft's conversation (#739) | **3 rows** (archive, pin, copy); Fork is **absent, not greyed** - the backend has no transcript to copy | the row reads `, not sent yet` | `fork-withheld` (273 × 81 **pre-#893**) |
| Fork pressed (#739) | closes; the request is in the store naming the row's conversation, and the route moves to `/chat` when no pane was mounted | unchanged; the picker (the pane's) opens for the row's conversation, not the pane's | `fork-pressed` |
| archived row (not pinned) | 4 rows; item 1 reads `Unarchive conversation` | row only reachable with `Include archived` | `archived-row` (288 × 113 **pre-#893** - the widest label the menu draws) |
| neither capability | **no menu** - no trigger element at all | panel byte-identical to the pre-feature one | - (assertion, not a frame) |
| current row | unchanged | **selected** ground kept, no hover ground added | - |
| the hold rule NOT applied (the design round's control) | the same 4 rows | **pair `none`, ground transparent** | `pointer-open-unheld`, on the design branch's proposal set - the shipped set does not reproduce a state the hold exists to remove |

**The withheld states are the pre-#739 shapes with Fork added, and the never-sent
row's own label is load-bearing (round-1 design review, point (e)).** On
`fork-withheld` the menu says nothing about the missing item - Fork is simply not
drawn, which is the app's rule for an act a row cannot take - so the ONLY place
the user is told why is the row's own middle slot, reading `, not sent yet`. That
sentence is not decoration on that state; removing it would leave Fork's absence
unexplained.

### Withheld, never disabled

Fork's withholding (#739) is the sidebar's own statement rather than one invented
for the menu: `unstarted` - a draft that holds the row's id - is the real-but-empty
session a first send that failed after allocation leaves behind, which is the
session the backend refuses to fork ("has no transcript to fork",
`fork.py::fork_session`). **Read it as "no draft row still holds this id", not as
"it never carried a message" (round-1 agent review, NIT 6):** `finishDraft` deletes
the draft on SEND COMPLETION, so during an in-flight first send a session whose
transcript already exists is still withheld - a narrow, self-healing window in
which the row already reads `, not sent yet`. **And the boundary (QA round 1, Q1):**
a session with no transcript and NO draft row (another client's, or one whose draft
was discarded) is not distinguishable renderer-side, so Fork is offered there and
the picker answers with the backend's refusal - the same refusal `/fork` and the
palette give. There is no cheap local signal; a transcript-presence field on the
catalogue row would be one. **`row.pending` is
deliberately not the gate:** it is the live record's "waiting for a person" word
(`approval`/`ask`, a parked gate), which only a session that has already run a
turn can carry - a session with a transcript - and the route does not refuse
it (a session mid-turn takes the fork at its next safe boundary; an idle or
cold one is cloned at once, read-only against the parent). No other state of a
catalogue row makes the route refuse, so this is the menu's only withheld
condition for Fork; it is read once as `forkable` in `chat-sidebar.tsx` and
pinned by `scripts/chat-sidebar-row-menu.test.mjs`.

The two before it are already written promises rather than new calls:
`chat-sidebar.tsx:3400-3406` ("An affordance that cannot act on the row it is
drawn on is withheld rather than offered broken") and
`session-archive-delete.md` § "Fail-closed, stated as a measurement" ("no menu
item" with `session_archive` absent). `data-[disabled]` styling therefore has
**no state to draw in this change** and is inherited from the primitive unused —
which is the point: a two-item menu on an unknown-pin row is correct
(`pin-state-unknown`: `items: 3 — Archive conversation⌘⇧A | Fork conversation | Copy session ID`, three since #893, where this read `items: 2`).

**THE ONE item that carries a disabled look is the boundary Move row, and its
CHORD FOLLOWS ITS ITEM (round-1 design review, D3).** A cap carries its own ink
role (`KeyboardShortcut`'s `ink-dim`, the one role legal on all four grounds it
renders on), so `aria-disabled:text-ink-disabled` on the item recoloured the word
and left the accessory at full strength: measured on the light `pinned-row` panel,
the Move label read `#9a9488` (**2.96:1** on `elevated`) against its chord at
`#656056` (**6.14:1**) - a 2.07x inversion (dark: 1.99:1 vs 5.25:1, 2.64x) in
which the annotation outranked the label it annotates and the item still read as
live at a glance. The fix is the item's own descendant rule
(`aria-disabled:[&_kbd]:text-ink-disabled!`), so both ends of the row drop to the
disabled step together; the disabled ink itself is NOT raised - `branding.md` makes
`ink-disabled` the floor-exempt role and caps it at 0.8 x `ink-dim`, so 1.99:1 is
the intended treatment and the defect was only the disagreement between the two.

### THE HOLD RULE, AND WHY IT IS NOT OPTIONAL

**The row under an open menu keeps its reveal and its hover ground.** Without
it the row pops back to rest under its own open menu — the exact defect the
repo already paid for once on the narrow-band control
(`session-archive-delete.md:197-200`).

This is not a stylistic preference, and the frames are the proof. The menu is
modal and its portal takes `pointer-events` off the page, so while the menu is
open the row **cannot be `:hover`ed at all**, however the pointer is parked:

- `pointer-open-unheld` (design branch only) — real pointer on the row, menu
  open, no hold: `ground rgba(0, 0, 0, 0) · pair: none`,
  `pair children: button[pin]:none:0w0 | button[archive]:none:0w0`. The reveal
  and the ground are simply gone.
- `pointer-open` — the same scene, shipped: `ground rgb(48, 45, 41) ·
  pair: flex`, `pair children: button[pin]:flex:243w24 |
  button[archive]:flex:215w24`, and the box's `data-state` reads `closed` — the
  value the Tooltip trigger composed, which is the whole reason no rule reads
  it (see § 9's note).

So a `hover:`-based hold is impossible, and the hold must be state-driven
(§3's `openMenuRowId`).

**AND THE REVEAL IS AUTHORED TWICE.** The pair wrapper is
`hidden group-hover:flex …` (`:3949`) **and each control's own glyph carries the
same pair of variants** (`:3610`, `:3792`). A hold applied to the wrapper alone
renders a `flex` box with nothing in it: the first pass of this story
photographed exactly that, and its readout said `pair: flex` while the pixels
showed an empty box. The hold is therefore two conditions, and the row keeps it
until the menu closes.

**The hold is the product's own state in the shipped set** (`openMenuRowId`),
and the geometry check the proposal's simulation was held to survives: `pair
children … :215w24`, `:243w24` measure the same under the hold (`pointer-open`)
as they do under a real pointer with no menu (`menu-closed`), so the held
reveal is the hover's own geometry reproduced by state rather than a second
design.

### The ground on the current row

Unchanged: the hover ground is dropped while the row is current
(`:3900`), and an open menu does not add one. The selected ground and the
hover ground are two steps off `surface` in the same direction, and repainting
the state the reader is *in* as the state the pointer is *in* is the
substitution `rowCurrent` exists to stop. The hold's ground is therefore
`!current`-scoped, exactly like the existing `hover:bg-row-hover`.

### The flyout — open question 3

**While a row's menu is open, that row's flyout is not drawn.** Measured, with
its own control:

| frame | menu | dwell | readout |
|---|---|---|---|
| `flyout-alone` | not opened | 3600ms hover | `flyout: present` |
| `flyout-dwelled` | opened at 1800ms | 3600ms hover | `flyout: absent` |

The control is the point: the flyout *can* be drawn in this scene (same story,
same hover, same dwell), so `absent` in the second frame is the menu's doing and
not a dead instrument.

**No suppressor needs to be built.** The menu's modality is what removes it: the
portal takes the row's pointer events, and the row's focus has moved into the
panel. The requirement is therefore an invariant rather than a feature: **the
rule must not regress.** The one way to break it is to make the menu
non-modal (`modal={false}`), after which the flyout would survive an open menu
and would need an explicit suppressor — so if anything ever sets `modal={false}`,
the flyout needs one and this note is the place it was promised.

The design reading is the same as the take's: the flyout explains the row it is
over (title, status, remedies); the menu acts on it. Two Radix surfaces sharing
a 280px band is a collision with one winner, and the menu — the surface the user
just asked for — is it.

---

## 5. Copy and chords

Sentence case throughout (branding §8). **Register: verb + object**, matching the
header menu's own per-conversation items (`Archive conversation`,
`Delete conversation…`, `chat-header.tsx:1204/1222`) rather than the row
controls' `Act "Title"` form (`chat-sidebar.tsx:3685`). The menu's subject is the
row the user just opened it on; quoting a long title inside a 273px panel would
truncate it and push the chord off the row's trailing edge.

| item | macOS | elsewhere |
|---|---|---|
| `Archive conversation` / `Unarchive conversation` | `⌘⇧A` | `Ctrl+Shift+A` |
| `Pin conversation` / `Unpin conversation` | `⌘⇧P` | `Ctrl+Shift+P` |
| `Move conversation up` | `⌘⇧↑` | `Ctrl+Shift+↑` |
| `Move conversation down` | `⌘⇧↓` | `Ctrl+Shift+↓` |
| `Fork conversation` (#739) | - | - |
| `Copy session ID` (#893) | - | - |

**AND THE MOVE ROWS PRINT THROUGH THE JOINED SIBLING (round-1 design review,
D1).** `⌘⇧↑`/`⌘⇧↓` above are the HANDLER's spellings; the menu renders
`chatPinMoveCapJoined` (`⌘+⇧+↑`, `⌘+⇧+↓`), which `KeyboardShortcut` splits into
three caps - the same shape `chatRowActCapJoined` has given the two rows above
them since the menu shipped. The two Move rows were the only place feeding the
component the un-joined form, which drew ONE 21px cap against the pair's three
caps across 52px: a chord in a different idiom in the same panel, measured from
the frames and fixed here. The non-mac form carries its separators already, so
both forms read `Ctrl + Shift + ↑/↓` as three caps either way.

**THE TWO MOVE CHORDS ARE THE SHIPPED ONES, NOT NEW ONES (2026-09-30).** `⌘⇧↑/↓`
were `#693`'s own chords for the row's arrow buttons, and they ride that change
unchanged: the menu items and the chord both call the one write path
(`movePinnedRow`), through one shared handler, so the item and the key cannot drift
about what a move is. The only thing that went with the buttons is the pair itself -
`chatPinMoveChord`, the cap drawn beside the item, the live-region announcements and
the repeat behaviour all stand.

`Fork conversation` is verb + object, the pair's register, and matches the
picker it opens (`Fork this conversation`). It has no chord because fork has
none (`/fork` and the palette are its other doors), and the item deliberately
prints no `KeyboardShortcut`: a hint for a gesture that does nothing is the
dead control § 1 refuses.

**`Unarchive`, not `Restore`.** The wire destination (`sessions.unarchive`), the
palette rows (`/archive`, `/unarchive`) and the row's own control
(`archiveControlLabel`, `chat-archived.ts:121-123`) all say unarchive; the header
menu's `Restore conversation` (`chat-header.tsx:1204`) is the odd one out. One
act, two words today — the menu takes the majority spelling and does not add a
third. The header's wording is **not** in this change's scope.

### The chord hints, and the shape `chatRowActCap` cannot render

`chatRowActCap` returns `⌘⇧P` / `Ctrl+Shift+P` (`chat-regions.ts:246-249`), and
`KeyboardShortcut` splits its `shortcut` prop on `+` and renders one `<kbd>` per
part (`shared/components/common/keyboard-shortcut.tsx`). Feeding it `⌘⇧P` gives
**one** cap three glyphs wide. `palette-shortcut.ts:86-88` records the same
constraint from the other side ("the same gesture as `KeyboardShortcut` prop
text, which splits on `+`").

**Requirement:** a `+`-joined sibling of `chatRowActCap` — `⌘+⇧+P`,
`Ctrl+Shift+P` — rendered as `<KeyboardShortcut shortcut={…} joined />`. `joined`
suppresses the printed `+` and lets the three caps sit adjacent, which is the
component's own chord idiom ("at `gap-0` … a chord reads as one key again") and
the spelling the sidebar's own rows already use (`sidebar-navigation.tsx:758`).
`scripts/chat-keyboard-regions.test.mjs:228-230` moves with the constant. The
frame shows the result: `⌘ ⇧ A` as three adjacent caps at the row's trailing
edge, measured 60px of the panel.

Two notes so a reviewer does not have to work them out:

- **`joined` is the current idiom, and the committed sidebar frames still show
  the old one.** `sidebar-row-space/after/hover-pinned-280/localOperatorDark.png`
  (2026-09-19) and `chat-sidebar-current-row/new-chat-row-current` show
  `⌘ + N`; `joined` landed on 2026-09-24 (`e938d3dfe7`) and the sidebar's rows
  have printed adjacent caps since. Read the source, not those stills.
- **The caps stay announced.** The component's own docstring is that the chord
  "stays in the accessible name of whatever control carries it" — so the item's
  accessible name is `Archive conversation ⌘ ⇧ A`, which is the discovery the
  whole change is spending. The `aria-hidden` wrapper in `sidebar-navigation.tsx`
  exists there because that row carries the chord in words *as well*; adding it
  here would remove the chord from the name instead of adding it.

The chord is ink `ink-dim` (the component's own role) and the item label `ink`:
measured **5.25:1** dark and **6.14:1** light for the caps on `elevated`, against
a 4.5:1 floor; **11.81:1** / **16.34:1** for the label. On the highlighted row
the same pair reads **5.95:1** / **5.4:1** on `accent-wash`.

---

## 6. Accessibility

Fork (#739) adds one item to the menu's roles and roving focus and changes none
of the rest: `role="menuitem"` and the arrow walk come from the primitive. Its
activation lands differently from Archive's and Pin's - it presses no control, so
the caret goes to the picker the pane opens, and **dismissing the picker returns
focus to the row's own button** (the request carries it as the invoker, because
the item unmounts with the menu; the composer is the pane's fallback when the
node is gone).

- **Roles come from the primitive**: `role="menu"` on the panel, `role="menuitem"`
  on each row, and Radix's own roving focus inside it.
- **The row stays one Tab stop.** The menu's items are reachable only while it is
  open, and the pair stays `tabIndex={-1}` behind the chords. Opening from the
  keyboard puts focus in the panel anyway (§3), so no second stop is added at
  rest.
- **Focus returns to the row's button** on the keyboard path: `onCloseAutoFocus`
  with `preventDefault()` and an explicit focus, the shape the pin's caret
  correction already uses (`chat-sidebar.tsx:3462-3475`).
- **The pointer path takes no focus of its own, and gives back what the menu
  took (UX round 2, U8).** `onCloseAutoFocus` prevents the default on both
  paths; the keyboard path focuses the row's button (above), and the pointer
  path focuses the element the open captured - because the panel itself takes
  focus on open (that is how `Escape` and the arrows work, and the shipped
  `pointer-hover` frame reads `focus: menuitem`), so a close that returned focus
  to nobody dropped the caret to `<body>`: QA round 2 measured exactly that
  (composer focused -> right-click -> `Escape` -> `activeElement` is `<body>`,
  and the next keystroke reached nothing). When the remembered node is gone the
  row's own button is the deliberate fallback, and with neither the caret is
  left alone. This is still not the row gaining focus by the pointer's doing:
  it is the focus the pointer path found, given back. The target is read on
  the press itself (`pointerdown`, capture phase): read at open time instead,
  it remembered the row's button - the press's own `mousedown` default had
  already moved focus there - so `Escape` returned the button and the next
  keystroke began the row's type-to-filter (QA round 3's Q-1, measured live).
  Read at the press, the control the reader was in (the composer) is what
  comes back, and the next keystroke lands there - U8's intent. An
  `onOpenChange` capture remains beside the press-time one for opens with no
  press (a dispatched `contextmenu`), guarded by the remembered ref's
  emptiness so it can never overwrite what the press recorded. The
  return-to-pre-open applies to closes that commit no act (round 3's U10):
  item activation has its own destinations rather than returning - `Pin
  conversation` leaves the caret on the row's pin control (or the row's
  button where the mark is not drawn), and `Archive conversation` lands the
  caret on the successor row - each through the pressed control's own focus
  correction.
- **`Escape`** closes the menu without committing an act and takes the
  act-free close paths above - the keyboard path's row-button return, the
  pointer path's return to the pre-open focus. Item activation does not take
  this path: it lands on the acted control's own destination (above).
- **The list's own `keyDown` must not consume keys while the menu is open.**
  The list treats a printable key on a row as type-to-filter
  (`chat-regions.ts:215-221`); the shipped open state closes the route
  structurally: `chat-sidebar.tsx`'s `keyDown` returns at its top while
  `openMenuRowId` is set, so no branch below can answer a key that belongs to
  the menu - without it the arrow walk would read the portal's target as "not a
  row" (index `-1`) and step to the list's first row. The guard's position
  above the walk is asserted in `scripts/chat-sidebar-row-menu.test.mjs`.
- **The trigger adds no name, so the ROW carries the announcement (U-D5).**
  Radix's context-menu trigger carries `data-state` and `data-disabled` and
  **no** `aria-haspopup` (`dist/index.mjs:87-88`), so the box gains no role and no
  announcement by itself. The shipped change therefore adds a row-scoped
  `sr-only` clause - "Right-click or press Shift+F10 for its actions", or
  `Shift+F10` with Fn on most Mac keyboards - riding the channel this row
  already uses for its remedies: an `sr-only` span beside the row's button,
  pointed at by that button's `aria-describedby` (`chat-sidebar.tsx`'s
  `rowMenuClause` / `rowMenuClauseId`). The platform split is UX round 1's U2:
  an Apple keyboard has no Menu key and sends F10 as a media key; UX round 2's
  U9 rewrote the macOS spelling to hold in BOTH of macOS's function-key modes
  (`Fn+Shift+F10` alone is exact only while the default media-key mode is on),
  the same qualifier `chat-regions.ts` carries for F6. The clause is
  withheld with the menu itself, so the fully withdrawn panel has none. It
  names the menu and how to open it, and deliberately not the chords: those
  are printed inside the menu and stay in each item's accessible name, where
  the acts are. It is announced PER ROW rather than once for the list, the
  placement UX round 1's U4 accepts and records here: a reader who lands
  mid-list never heard a list-level one, so the fact rides the row it belongs
  to.

---

## 7. #693 — the slot, and the arithmetic, decided

> **SUPERSEDED, 2026-09-30.** This section records the slot arithmetic as it stood when #693's
> controls were decided to live on the row. They later moved HERE: the menu now carries
> `Move conversation up` / `Move conversation down` (WCAG 2.5.7's single-pointer path)
> beside the two mirrored acts, which is exactly the "2 mirrored rows + 2 move rows = 4"
> case worked out below; the cap has since moved to **five rows** (#739's Fork) and
> then **six** (#893's Copy session ID, see this section's closing block), and
> is now a RULE rather than a number (§ 7's closing block). The
> reasoning that follows is kept as the record of what was weighed; its present-tense
> statements about a three-row budget and the arrow strip no longer describe the build.

**#693's move controls are not coming to this menu.** The owner's decision on
#693 (2026-09-29) took path (b), a desktop-local order, with the interaction
being "a move-up/move-down pair on the pinned row's hover strip, plus keyboard
chords and live-region announcements", and recorded that "#694's context menu
stays the future home for further actions". So the two lanes do not collide, and
the arithmetic is worth stating so #693 does not have to rediscover it:

- **The menu stayed two rows** when this was decided and the third row stayed
  reserved - and #739 has since spent it on Fork (§ 1). The menu costs
  **zero rest width**.
- **The strip went from 2 controls to 4 — the shipped measurements, not the
  forecast** (`docs/evidence/pinned-reorder/README.md:34-38`): the revealed
  cluster is **108px** (136px with the grip), the grip is shed at the shipped
  default panel **260**, and the title under the pointer reads **88px** at 260
  and **80px** at 280. The forecast's four-control count held; its arithmetic
  (`112px` of a 280 panel) did not — #693's price is the measured one, already
  paid for in its own decision.
- **Had #693 taken the menu**, the cap would have broken: 2 mirrored rows + 2
  move rows = **4**, past the reporter's own "two at most pushing it three".
  The trade at that point is not "raise the cap" — it is **drop the mirror** and
  let the menu hold only acts the row cannot otherwise reach. Recorded here so
  that whichever lane revisits it starts from the arithmetic.

**THE BUDGET IS A RULE, NOT A NUMBER (round-1 design review, ruling (b)).**

> **A row earns its place by being an act on THIS row that has no other door the
> user can find.** Archive and Pin qualify: the strip's pair is `tabIndex={-1}`,
> reachable only through chords the row prints nowhere, so the menu is their only
> discoverable door. The Move pair qualifies as WCAG 2.5.7's single-pointer path,
> which the deleted arrow buttons used to carry. Fork qualifies because it is the
> only door that names the **row's** conversation - neither `/fork` nor the palette
> can, as both act on the pane's. **Copy session ID (#893) qualifies as the sixth, and
> it passes the same test**: an id is what a `sessions`/`send` call or a `lop` command
> takes, and NOTHING in the product reveals the ROW's id today - the header's overflow
> menu names the PANE's session, which is generally not the row's.
>
> **The cap is six rows, pinned by test** (`scripts/chat-sidebar-row-menu.test.mjs`
> counts the items; five until #893 moved it, and the move is a number raised rather
> than a row replaced). A seventh act is admitted only by passing the same test;
> otherwise it replaces a row or finds another surface.
>
> **The cap's widest state is a pinned row in the moved-from section, and it now draws
> six rows.** The 296 × 184 this block used to carry is the PRE-#893 five-row
> measurement; the six-row frame and its readout are owed to the evidence pass on
> #893's head (`docs/evidence/chat-sidebar-row-context-menu/`), and no replacement
> figure is written here because this document has not seen one. On a 280px sidebar,
> somewhere around **eight rows / ~280px tall** the answer changes
> from "grow the menu" to "a submenu or another surface" - the point at which the
> panel stops being a menu and starts being a list.

**HOW IT GOT TO SIX, for the record.** It was declared at **three rows** (this section's
arithmetic) with the third reserved; #693's Move pair landed on 2026-09-30 and the
record raised the cap to **four**; #739 then spent the fifth on Fork, which the
round-1 review placed at row 3 (D2) so that the conditional block trails; and #893
spent the **sixth** on Copy session ID, placed at row 4 beside Fork so the
unconditional run stays one run. The rule that survives is the one this paragraph always carried - **an
act that lands here either replaces a row or finds another surface** - and it is
worth stating plainly that the second raise was not argued from the first's
arithmetic: the four-row case is the "2 mirrored + 2 move" case this section
worked out as the one that BREAKS the budget, and it was taken anyway for
WCAG 2.5.7's single-pointer path, with the three-row promise superseded on the
record, and the round-1 review closed it with the rule above rather than another
number: there is no open question about a seventh act, because there is a test it
has to pass. What is decided is that the count and the ORDER are explicit and
pinned - `scripts/chat-sidebar-row-menu.test.mjs` counts the items and asserts
their sequence - so a seventh, or a re-ordering, is a failing assertion rather than
a quiet addition.

---

## 8. In scope, out of scope

**In:** Fork as the menu's third row (#739) - the item, its `unstarted` withholding, the
conversation-naming request and the pane's precedence; **Copy session ID as the fourth
(#893)**, which rides the same menu (the trigger's gate is untouched by it, for the
same reason Fork left it untouched); the menu's trigger
(`menuEnabled`) is **unchanged**: Fork rides an existing menu, so a panel with
neither the archive nor the pin capability still has no menu and no Fork, and
widening the trigger is out of scope here. The menu itself (six rows, withheld
when there is nothing to draw); chord
hints through the shared `KeyboardShortcut`, which finally spends
`chatRowActCap`; the explicit keyboard opener with focus return; the state
matrix in §4 including the withdrawn-panel byte-identity guard; the two rules
the repo has already paid for once (the hold, §4; the flyout, §4); a `data-`
hook on the trigger for the driver, plus static tests that the menu's items are
drawn from **the same predicates** as the pair (`row.pinned !== undefined`,
`archiveEnabled`) so the two surfaces cannot disagree about what a row offers,
and that no rule is authored against `data-[state=…]` on the row box (U-D3) -
both shipped in `scripts/chat-sidebar-row-menu.test.mjs`, beside the
`chat-sidebar-archive.test.mjs` / `chat-sidebar-pins.test.mjs` /
`chat-sidebar-selection.test.mjs` suites whose subjects they share.

**Out:** move/reorder controls (#693, §7); rename (an editing surface and a
row-scoped write path — the header's inline rename stays the home); delete
(never on the row); a persistent per-row kebab, a tour or coach mark, a flyout
line advertising right-click; any menu inside the titlebar lane; multi-select
and bulk actions.

**Not addressed, recorded:** the header menu's `Restore conversation` against
the row/palette `Unarchive` is a real two-words-for-one-act inconsistency,
outside this change's flows.

---

## 9. The numbers behind the frames

All read out of the DOM by the story itself, so a frame cannot claim a state the
app does not hold. `localOperatorDark`, 280px sidebar, 780 × 520.

**THE PANEL, ROW AND ANCHOR NUMBERS BELOW ARE THE PRE-#893 SET (annotated
2026-10-08).** Every state now also draws `Copy session ID` (a plain, chord-free
row), so the panel heights move and the widths are expected not to - but these are
the frames THIS set measured, and the six-row panel's own readout belongs to the
evidence pass on #893's head. Only the `items` counts are given post-#893 (a row of
their own, below), and those are read off the shipped composition rather than off a
frame.

| | `pointer-open` | `pointer-hover` | `keyboard-open` | `archived-row` | `pinned-row` | `pin-state-unknown` | `archive-withheld` |
|---|---|---|---|---|---|---|---|
| anchor point | 140,369 | 140,369 | 12,371 | 140,362 | 140,297 | 140,401 | 140,369 |
| panel | 273 × 113 at 142,369 | 273 × 113 at 142,369 | 273 × 113 at 14,370 | 288 × 113 at 142,362 | **296 × 184** at 142,297 | 273 × 77 at 142,401 | 246 × 77 at 142,369 |
| items | 3 (archive, pin, fork) | 3 | 3 | 3 (`Unarchive conversation`) | **5** (`Archive conversation`, `Unpin conversation`, `Fork conversation`, `Move conversation up`, `Move conversation down`) | 2 (archive, fork) | 2 (`Pin conversation`, fork) |
| items, POST-#893 (derived from the shipped composition, NOT from a frame - the readouts above and in this table are the PRE-#893 set) | 4 (archive, pin, fork, copy) | 4 | 4 | 4 (`Unarchive conversation`) | **6** (`Archive conversation`, `Unpin conversation`, `Fork conversation`, `Copy session ID`, `Move conversation up`, `Move conversation down`) | 3 (archive, fork, copy) | 3 (`Pin conversation`, fork, copy) |
| row | 255 × 32 at 12,340 | same (s2) | same (s2) | 255 × 32 at 12,333 (s4) | 255 × 32 at 12,268 (s1) | 255 × 32 at 12,372 (s3) | s2 |
| ground | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` |
| `data-state` | `closed` | `closed` | `closed` | `closed` | `closed` | `closed` | `closed` |
| pair | `flex` | `flex` | `flex` | `flex` | `flex` | `flex` | `not mounted` |
| pair children | pin `flex:243w24`, archive `flex:215w24` | as `pointer-open` | as `pointer-open` | as `pointer-open` | pin `flex:243w24`, archive `flex:215w24` - two children, not four: #743 moved the arrow pair into this menu | archive `flex:243w24` | — |
| flyout | `absent` | `absent` | `absent` | `absent` | `absent` | `absent` | `absent` |
| focus | menu; first item not highlighted | **first item, `data-highlighted`** | **first item, `data-highlighted`** | menu; first item not highlighted | menu; first item not highlighted | menu; first item not highlighted | menu; first item not highlighted |

**The #739 states, same scene and widths** (`localOperatorDark`): `fork-withheld`
reads `items: 2 — Archive conversation⌘⇧A | Pin conversation⌘⇧P`, panel
**273 × 81 at 142,369** - the pre-#739 two-row panel, byte for byte in its
numbers - with the row reading `Migrate …· Not sent yet`; `fork-pressed` reads
`fork request: session.fork for s2`, `invoker: button[data-chat-row] in s2`
and `route: /chat`, the request naming **s2 - the row's conversation** (this
story has no pane, so no picker can open and the frame does not pretend to
show one: the pane's half is the consume effect in `slash-dispatch.ts`,
asserted in `scripts/panel-presentation.test.mjs`).

`rgb(48, 45, 41)` is `--lo-row-hover` (`#302D29`) in `localOperatorDark` exactly,
and `rgb(237, 236, 231)` = `#EDECE7` in `localOperatorLight` — the frame's
measured ground is the palette's own value, not an approximation of it.

**The `data-state` column is now the product's own, and it is the argument
rather than a defect.** Every menu-open frame above reads `closed` — the value
the TOOLTIP trigger composed, because the box is a Radix trigger already —
while `flyout-alone` (no menu, the flyout drawn) reads `delayed-open`: the
attribute is whichever trigger wrote last, which is exactly why § 3 forbids
authoring any rule against it. The proposal set's `open` values were its
simulation's stamp; nothing in the shipped rule reads them.

**On `archive-withheld`, `pair: not mounted` is the delivered state, not a
missing reading:** with only the pin capability advertised the pair wrapper is
not rendered at all (`bothControls` false) and the row's pin control stands
alone - visible in the frame - so there is no `data-session-control-pair` for
the two `pair` lines to read.

---

## 10. Frames

`docs/evidence/chat-sidebar-row-context-menu/` — **the shipped set**, captured
from the built feature: the story drives the real trigger (a dispatched
`contextmenu` at the row's own box for the pointer states, a real `ContextMenu`
keydown on the row's button for the keyboard one, the search block's own field
and `Include archived` control for the archived row), the real `openMenuRowId`
hold, and the row's real predicates. 20 frames, `localOperatorDark` and
`localOperatorLight`, from the set #694 shipped (20 frames; #739 re-took all of
them with the third row drawn and added `fork-withheld` and `fork-pressed`, 24
in total), from:

```
npx storybook dev -p 6747 --ci --quiet --no-open
node scripts/capture-evidence.mjs http://localhost:6747 --allow-backend \
  --only=chat-sidebar-row-context-menu-- \
  --themes=localOperatorDark,localOperatorLight
```

(round 1's two remediation states were captured with the same command narrowed
by `--dirs=pointer-hover,archived-row`, so no existing frame was re-taken.)

| story | what it is |
| --- | --- |
| `pointer-open` | the menu at the pointer on a normal row, reveal and ground held |
| `pointer-hover` | the same scene with the pointer moved onto the first item: `data-highlighted`, the app's focus ring (see § 2) |
| `keyboard-open` | the keyboard opener: the anchor at the row's box edge, focus in the first item (`data-highlighted`, the app's focus ring) |
| `archived-row` | the row behind `Include archived`: item 1 reads `Unarchive conversation`, three rows in 288 × 113 (the widest LABEL the menu draws) |
| `pinned-row` | `Unpin conversation`, on the row that draws its mark at rest: five rows, `Fork conversation` third, both Move rows boundary-inked, 296 × 184 |
| `pin-state-unknown` | `pinned === undefined`: **two** rows (archive, fork) in 273 × 77, and the row draws no pin |
| `archive-withheld` | `session_archive` absent: **two** rows (pin, fork) in 246 × 77, not a disabled one |
| `flyout-dwelled` | the flyout given 1800ms to dwell, then the menu: flyout `absent` - and **the same image as `pointer-open`** (byte-identical): one capture, two names |
| `menu-closed` | the before/after partner of `pointer-open`: the same scene, no open - **the same image as `flyout-alone`** (byte-identical): the two names are one capture, taken with the pointer on the row, and it carries the flyout because the flyout IS a dwell behind the pointer |
| `flyout-alone` | see `menu-closed` - one capture, two names: the flyout drawn with no menu, `data-state delayed-open` |
| `fork-withheld` | #739: the row is a never-sent draft's conversation; two rows, Fork absent rather than greyed (273 × 81) |
| `fork-pressed` | #739: Fork pressed - the readout shows the request naming the row's conversation, the row's own button as the invoker, and the route; the picker itself is the pane's and is not in this story |

**EVERY FRAME IN THIS SET PREDATES #893 (2026-10-08),** and the row descriptions
above therefore no longer enumerate what the states draw: `Copy session ID` is in
none of these images, and the `pinned-row` frame is the PRE-#893 five-row panel. The
re-shoot - the new row in every state plus the six-row `pinned-row` and its DOM
readout - belongs to the evidence pass on #893's head, which owns
`docs/evidence/chat-sidebar-row-context-menu/` and its `README.md`.

The design round's **proposal set**
(`docs/evidence/chat-sidebar-row-context-menu-proposal/`, 16 frames including
the `pointer-open-unheld` control) stays on `design/row-context-menu-694` as
the record of what was proposed and measured before the implementation
existed; the set above supersedes it, and its README
(`docs/evidence/chat-sidebar-row-context-menu/README.md`) carries the
invocation, the readouts and what the frames do not prove.

### The UX round's follow-ups (U-D1…U-D8), as folded

U-D1: § 2's `sideOffset` claim corrected (the primitive fixes the placement;
the dead prop is gone). U-D2: the `min-w-56` floor lives on the app's
`ContextMenuContent` with its why. U-D3: the hold's forbidden spelling is
pinned by `scripts/chat-sidebar-row-menu.test.mjs`, not by a comment. U-D4:
the focus fallback no longer claims branding § 9 item 6; the shipped frame
carries `data-highlighted`. U-D5: the row-scoped `sr-only` clause (§ 6). U-D6:
§ 1's row sizes reconciled to the measured panel numbers. U-D7: the order
sentence scoped to the acts the menu carries. U-D8: the panel straddling the
sidebar column's inner edge is accepted, not a defect (§ 3's anchoring note).
