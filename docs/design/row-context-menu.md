# The chat row's context menu — composition, states and copy

**Issue:** #694. **Design round:** 2026-09-30, `design/row-context-menu-694`.
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
context menu holding the row's own acts, at most **three rows**:

| # | Row | Chord | Withheld when |
|---|---|---|---|
| 1 | `Archive conversation` / `Unarchive conversation` | `⌘⇧A` · `Ctrl+Shift+A` | `archiveEnabled` is false |
| 2 | `Pin conversation` / `Unpin conversation` | `⌘⇧P` · `Ctrl+Shift+P` | `row.pinned === undefined` |
| 3 | — reserved — | — | — |

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
"Delete asks, and never on the row"), move controls (#693, §6 below), and the
four acts with no product ask anywhere in #694/#693 (duplicate, copy link, open
in new window, mark unread). The reserved row is reserved so that the next act
that earns a place has somewhere to go without a redesign.

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
  row's strip is now four controls and takes **108px** (§ 7's shipped
  measurements; `pinned-row`). The menu's own
  rows are the panel's content rows, not the strip's 24 × 24 controls: the shipped
  panels measure **273 × 81** (two rows) and **273 × 46** (one row) -
  `pointer-open` and `pin-state-unknown` - and the pointer opens the menu over
  the whole row.

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
| archive + pin | **273 × 81** | 2 |
| unarchive + pin (the archived row's widest label) | **288 × 81** | 2 |
| archive alone (unknown pin state) | **273 × 46** | 1 |
| pin alone (archive capability withheld) | **246 × 46** | 1 |

The 273 is the archive row's own length: `px-2` 16 + icon 16 + `gap-2` 8 +
label + `pl-6` 24 + chord ≈ 60 + `px-2` 16. `Unarchive conversation` is the
widest label the menu draws, and its state measures the widest panel:
**288 × 81** (`archived-row`), the two extra characters showing up exactly
there. The floor exists so that a
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
   (`keyboard-open/localOperatorDark`: `anchor point: 12,371`, `panel: 273x81
   at 14,370`, the row's pair still drawn at 215 and 243). The panel spilling
   a few pixels past the sidebar column's inner edge is the accepted
   composition, not a collision: the anchor is the row's box and the panel is
   placed from it, and every menu in this surface has always drawn over the
   column's edge rather than being re-anchored to avoid it. The keyboard
   case's share of that straddle is measured and recorded (design round 1,
   D4): the divider hairline sits at x 279 and the keyboard panel's outer
   right edge is 286, so 7px of panel sit over the chat pane - a sliver rather
   than a contest of the acceptance, kept so a future revisit of the
   primitive's `align: start` placement starts from the number.

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
| closed | not mounted | unchanged; the pair is `display: none` at rest | `flyout-alone` |
| the row under the pointer, no menu | not mounted | reveal and hover ground as shipped | `menu-closed` |
| open at the pointer, normal row | 2 rows, archive then pin, chords drawn | reveal held, hover ground held | `pointer-open` |
| the same, the pointer moved onto the first item | 2 rows; item 1 carries `data-highlighted`, and the same `:focus-visible` outline the keyboard state draws (measured; see § 2) | reveal held | `pointer-hover` |
| the same, hold rule **not** applied (the design round's control) | 2 rows | **pair `none`, ground transparent** | `pointer-open-unheld`, on the design branch's proposal set - the shipped set does not reproduce a state the hold exists to remove |
| open at the pointer, pinned row | 2 rows, item 2 reads `Unpin conversation` | the pair is drawn at rest (the mark is the state), and #697's move pair reveals with it — four children, all held under the menu | `pinned-row` |
| open via keyboard | same 2 rows; anchored at the row's bottom-left | reveal held, no pointer needed | `keyboard-open` |
| `row.pinned === undefined` | **one row** (archive); the pin row is withheld | row draws no pin control either | `pin-state-unknown` |
| `archiveEnabled` false | **one row** (pin); the archive row is withheld | archive control absent | `archive-withheld` |
| neither capability | **no menu** — no trigger element at all | panel byte-identical to the pre-feature one | — (assertion, not a frame) |
| archived row | item 1 reads `Unarchive conversation` | row only reachable with `Include archived` | `archived-row` |
| current row | unchanged | **selected** ground kept, no hover ground added | — |

### Withheld, never disabled

Both withholdings are already written promises rather than new calls:
`chat-sidebar.tsx:3400-3406` ("An affordance that cannot act on the row it is
drawn on is withheld rather than offered broken") and
`session-archive-delete.md` § "Fail-closed, stated as a measurement" ("no menu
item" with `session_archive` absent). `data-[disabled]` styling therefore has
**no state to draw in this change** and is inherited from the primitive unused —
which is the point: a single-item menu on an unknown-pin row is correct
(`pin-state-unknown`: `items: 1 — Archive conversation⌘⇧A`).

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

**#693's move controls are not coming to this menu.** The owner's decision on
#693 (2026-09-29) took path (b), a desktop-local order, with the interaction
being "a move-up/move-down pair on the pinned row's hover strip, plus keyboard
chords and live-region announcements", and recorded that "#694's context menu
stays the future home for further actions". So the two lanes do not collide, and
the arithmetic is worth stating so #693 does not have to rediscover it:

- **The menu stays two rows** and the third row stays reserved. The menu costs
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

**The menu is declared as the row's shared act surface with a budget of three
rows.** Any act that lands here spends the reserved row; when all three are
spent, the next act either replaces one or finds another surface. The reserved
row is not a licence to grow the menu to whatever fits.

---

## 8. In scope, out of scope

**In:** the menu itself (≤3 rows, withheld when there is nothing to draw); chord
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
app does not hold. `localOperatorDark`, 280px sidebar, 780 × 520:

| | `pointer-open` | `pointer-hover` | `keyboard-open` | `archived-row` | `pinned-row` | `pin-state-unknown` | `archive-withheld` |
|---|---|---|---|---|---|---|---|
| anchor point | 140,369 | 140,369 | 12,371 | 140,362 | 140,297 | 140,401 | 140,369 |
| panel | 273 × 81 at 142,369 | 273 × 81 at 142,369 | 273 × 81 at 14,370 | 288 × 81 at 142,362 | 273 × 81 at 142,297 | 273 × 46 at 142,401 | 246 × 46 at 142,369 |
| items | 2 | 2 | 2 | 2 (`Unarchive conversation`) | 2 (`Unpin conversation`) | 1 | 1 (`Pin conversation`) |
| row | 255 × 32 at 12,340 | same (s2) | same (s2) | 255 × 32 at 12,333 (s4) | 255 × 32 at 12,268 (s1) | 255 × 32 at 12,372 (s3) | s2 |
| ground | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` |
| `data-state` | `closed` | `closed` | `closed` | `closed` | `closed` | `closed` | `closed` |
| pair | `flex` | `flex` | `flex` | `flex` | `flex` | `flex` | `not mounted` |
| pair children | pin `flex:243w24`, archive `flex:215w24` | as `pointer-open` | as `pointer-open` | as `pointer-open` | archive `flex:159w24`, up `flex:187w24`, down `flex:215w24`, mark `flex:243w24` | archive `flex:243w24` | — |
| flyout | `absent` | `absent` | `absent` | `absent` | `absent` | `absent` | `absent` |
| focus | menu; first item not highlighted | **first item, `data-highlighted`** | **first item, `data-highlighted`** | menu; first item not highlighted | menu; first item not highlighted | menu; first item not highlighted | menu; first item not highlighted |

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
`localOperatorLight`, from:

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
| `archived-row` | the row behind `Include archived`: item 1 reads `Unarchive conversation` (288 × 81, the widest state) |
| `pinned-row` | `Unpin conversation`, on the row that draws its mark at rest |
| `pin-state-unknown` | `pinned === undefined`: one row, and the row draws no pin |
| `archive-withheld` | `session_archive` absent: one row, not a disabled one |
| `flyout-dwelled` | the flyout given 1800ms to dwell, then the menu: flyout `absent` |
| `flyout-alone` | the control: the flyout drawn, no menu — and `data-state delayed-open` |
| `menu-closed` | the before/after partner of `pointer-open`: the same scene, no open |

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
