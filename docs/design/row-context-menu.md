# The chat row's context menu — composition, states and copy

**Issue:** #694. **Design round:** 2026-09-30, `design/row-context-menu-694`.
**Status:** design of record for the implementation; the frames in
`docs/evidence/chat-sidebar-row-context-menu-proposal/` are a **proposal set**
(the story is marked as one and is superseded by the PR's own evidence).
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

**The order is the strip's order, left to right, and that is measured rather
than argued.** In the row, the archive control is `order-first` and the pin
control owns the right edge: `pair children: button[archive]:flex:215w24 |
button[pin]:flex:243w24` (`pointer-open/localOperatorDark`). The menu reads
Archive then Pin, so the two surfaces present the same two acts in the same
sequence. A menu that listed them the other way round would make the same pair
of acts read backwards depending on how the user opened them.

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
  none` at rest, and revealing it takes 56px out of the title
  (`pair children … :215w24`, `:243w24` against a 255px box). The menu opens at
  the pointer over the whole row and its rows are 273 × 31.

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
- **No new fill, border or role is introduced**, so nothing is added to
  `CONTROLS` in `scripts/contrast-contract.mjs`. Measured: the contract still
  holds unchanged — `29299 assertions across 59 themes, 0 consulted
  exception(s)`.
- `data-titlebar-no-drag` on the panel, copied from `DropdownMenuContent`. The
  chat row is not in the titlebar lane (`chat-layout.tsx:552-554`), but a portal
  can land under it and `styles/index.css:123-129` makes the opt-out the rule
  for any control that does.
- `sideOffset` 6, matching `DropdownMenuContent`'s own default, so a menu sits
  the same distance from what it is anchored to whichever opener drew it.

### Panel width, measured

The panel is **content-sized with a floor**: `min-w-56` (224px), which does not
bind in any of the measured states.

| state | measured panel | items |
|---|---|---|
| archive + pin | **273 × 81** | 2 |
| archive alone (unknown pin state) | **273 × 46** | 1 |
| pin alone (archive capability withheld) | **246 × 46** | 1 |

The 273 is the archive row's own length: `px-2` 16 + icon 16 + `gap-2` 8 +
label + `pl-6` 24 + chord ≈ 60 + `px-2` 16. The floor exists so that a
one-short-item menu is not cramped; the width above it is the content's. A menu
padded to a width it does not use would be the chrome §5 deletes — and the two
measured widths differ by 27px, which is the amount of text that is actually
there.

---

## 3. Trigger, anchoring, and the attribute the row box already carries

**The trigger is the row's box** (`[data-session-row]`,
`chat-sidebar.tsx:3722`), not the row's `<button>` — the same anchor reasoning
the flyout already took (`:3258-3272`: the button shrinks by 56px when the acts
reveal). The box is also what the acts live in, so the trigger covers them.

**With neither capability there is no trigger at all** — no element, no
attribute, no handler, so the fully withdrawn panel's class list is the one it
had before either feature existed (`:3343-3360`, `:3722-3729`).

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
(`@radix-ui/react-context-menu@2.3.7`, `dist/index.mjs:63-70`).

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
   bottom-left, and the row it belongs to stays whole above it
   (`keyboard-open/localOperatorDark`: `anchor point: 14,369`, `panel: 273x81 at
   16,369`, the row's pair still drawn at 215 and 243).

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

### Focus on open — measured, and it is not what we asked for

`keyboard-open/localOperatorDark` prints `focus: menu "Archive conversation⌘A
Pin conversation⌘P"` — i.e. `document.activeElement` is the **menu content**,
not the first item. That is the primitive's own behaviour and it is not the
model the repo already chose for the same gesture: the transcript's link
toolbar opens *and* puts the caret in the first control
(`use-link-subject.ts:441-448`), so one press is enough.

**Requirement:** on the keyboard path, focus lands in the **first item** after
open. Mechanism is the implementation's; `onOpenAutoFocus` (Radix's own hook) or
focusing the first `[role="menuitem"]` after the open effect are both acceptable.
**Fallback, stated so a reviewer does not have to invent one:** if forcing it
proves brittle against the primitive's roving focus, the acceptable outcome is
Radix's default (focus on the content, no item highlighted) — it is reachable,
visible and not trapped, which is what branding §9 item 6 demands — **but the
frames then have to say so**, because the current frame's unhighlighted first
row is the default and not the intent.

---

## 4. States

| state | what the menu does | what the row does | frame |
|---|---|---|---|
| closed | not mounted | unchanged; the pair is `display: none` at rest | `flyout-alone` |
| open at the pointer, normal row | 2 rows, archive then pin, chords drawn | reveal held, hover ground held | `pointer-open` |
| the same, hold rule **not** applied | 2 rows | **pair `none`, ground transparent** | `pointer-open-unheld` |
| open at the pointer, pinned row | 2 rows, item 2 reads `Unpin conversation` | pair already drawn at rest (the mark) | `pinned-row` |
| open via keyboard | same 2 rows; anchored at the row's bottom-left | reveal held, no pointer needed | `keyboard-open` |
| `row.pinned === undefined` | **one row** (archive); the pin row is withheld | row draws no pin control either | `pin-state-unknown` |
| `archiveEnabled` false | **one row** (pin); the archive row is withheld | archive control absent | `archive-withheld` |
| neither capability | **no menu** — no trigger element at all | panel byte-identical to the pre-feature one | — (assertion, not a frame) |
| archived row | item 1 reads `Unarchive conversation` | row only reachable with `Include archived` | — |
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

- `pointer-open-unheld` — real pointer on the row, menu open:
  `ground rgba(0, 0, 0, 0) · data-state closed · pair: none`,
  `pair children: button[pin]:none:0w0 | button[archive]:none:0w0`. The reveal
  and the ground are simply gone.
- `pointer-open` — the same scene with the hold applied:
  `ground rgb(48, 45, 41) · data-state open · pair: flex`,
  `pair children: button[pin]:flex:243w24 | button[archive]:flex:215w24`.

So a `hover:`-based hold is impossible, and the hold must be state-driven
(§3's `openMenuRowId`).

**AND THE REVEAL IS AUTHORED TWICE.** The pair wrapper is
`hidden group-hover:flex …` (`:3791`) **and each control's own glyph carries the
same pair of variants** (`:3508`, `:3676`). A hold applied to the wrapper alone
renders a `flex` box with nothing in it: the first pass of this story
photographed exactly that, and its readout said `pair: flex` while the pixels
showed an empty box. The hold is therefore two conditions, and the row keeps it
until the menu closes.

The simulated hold in the proposal frames reproduces the real hover exactly —
`pair children … :215w24`, `:243w24` in both — which is the check that the
simulation is a copy of the product's own geometry and not a second design.

### The ground on the current row

Unchanged: the hover ground is dropped while the row is current
(`:3752-3757`), and an open menu does not add one. The selected ground and the
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
controls' `Act "Title"` form (`chat-sidebar.tsx:3424`). The menu's subject is the
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
- **The pointer path takes no focus**: `onCloseAutoFocus` prevents the default
  and focuses nothing, matching the pin control's documented split ("the pointer
  path deliberately does not take focus … because a row revealed by the pointer
  has no keyboard place to keep"). The panel itself takes focus on open — that is
  how `Escape` and the arrows work — and that is not the same thing as the row
  gaining focus.
- **`Escape`** closes the menu and takes the same path as item activation.
- **The list's own `keyDown` must not consume keys while the menu is open.**
  The list treats a printable key on a row as type-to-filter
  (`chat-regions.ts:215-221`); while the menu is open focus is inside the portal
  and outside the list's scroller, so the two do not meet. That is an expectation
  to verify, not a mechanism to build — and the verification is worth having,
  because a menu that swallows the first letter of a filter would be a defect in
  the other direction.
- **The trigger adds no name.** Radix's context-menu trigger carries
  `data-state` and `data-disabled` and **no** `aria-haspopup`
  (`dist/index.mjs:85`), so the box gains no role and no announcement. The row
  keeps the semantics it has.

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
- **The strip goes from 2 controls to 4** — 112px of the 280px panel. With the
  row-space contract (`Only a control slot costs title width`, 28px each;
  `title = panel − 16 − 28 × controls − 28`, `session-archive-delete.md:122-129`)
  the title goes from **180px to 124px** at the default width. That is #693's
  price and it is already paid for in its own decision.
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
hook on the trigger for the driver, plus a static test that the menu's items are
drawn from **the same predicates** as the pair (`row.pinned !== undefined`,
`archiveEnabled`) so the two surfaces cannot disagree about what a row offers —
`scripts/chat-sidebar-archive.test.mjs` and `chat-sidebar-pins.test.mjs` are the
neighbours that test belongs beside.

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

| | `pointer-open` | `pointer-open-unheld` | `keyboard-open` | `pin-state-unknown` | `archive-withheld` |
|---|---|---|---|---|---|
| anchor point | 140,369 | 140,369 | 14,369 | 140,401 | 140,369 |
| panel | 273 × 81 at 142,369 | 273 × 81 | 273 × 81 at 16,369 | 273 × 46 at 142,401 | 246 × 46 at 142,369 |
| items | 2 | 2 | 2 | 1 | 1 |
| row | 255 × 32 at 12,340 | same | same | 255 × 32 at 12,372 (s3) | s2 |
| ground | `rgb(48, 45, 41)` | `rgba(0, 0, 0, 0)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` | `rgb(48, 45, 41)` |
| `data-state` | `open` *(simulation)* | `closed` | `open` *(simulation)* | `open` *(simulation)* | `open` *(simulation)* |
| pair | `flex` | `none` | `flex` | `flex` | `not mounted` |
| pair children | pin `flex:243w24`, archive `flex:215w24` | pin `none:0w0`, archive `none:0w0` | as `pointer-open` | archive `flex:243w24` | — |
| flyout | `absent` | `absent` | `absent` | `absent` | `absent` |
| focus | menu | menu | menu | menu | menu |

`rgb(48, 45, 41)` is `--lo-row-hover` (`#302D29`) in `localOperatorDark` exactly,
and `rgb(237, 236, 231)` = `#EDECE7` in `localOperatorLight` — the frame's
measured ground is the palette's own value, not an approximation of it.

**The `data-state` row is marked *(simulation)* for a reason.** The proposal
story stamps it (and the two open-state variants) on the row box because the
implementation's `openMenuRowId` does not exist yet; §3 is the reason the real
rule must not be authored against that attribute. Everything else in the table
is the product's own DOM.

---

## 10. Frames

`docs/evidence/chat-sidebar-row-context-menu-proposal/` — **a proposal set**,
marked by its own surface id; `chat-sidebar.tsx` has no context menu at this
head, so these frames are pictures of this document’s composition and not of a
built feature. 16 frames, `localOperatorDark` and `localOperatorLight`, from:

```
npx storybook dev -p 6617 --ci --quiet --no-open
node scripts/capture-evidence.mjs --only=chat-sidebar-row-context-menu-proposal-- \
  --themes=localOperatorDark,localOperatorLight --allow-backend http://127.0.0.1:6617
```

| story | what it is |
| --- | --- |
| `pointer-open` | the menu at the pointer on a normal row, reveal and ground held |
| `pointer-open-unheld` | the same scene without the hold rule: the measured defect |
| `pinned-row` | `Unpin conversation`, on the row that draws its mark at rest |
| `keyboard-open` | the keyboard opener's anchor at the row's bottom-left, focus readout |
| `archive-withheld` | `session_archive` absent: one row, not a disabled one |
| `pin-state-unknown` | `pinned === undefined`: one row, and the row draws no pin |
| `flyout-alone` | the instrument control: the flyout drawn, no menu |
| `flyout-dwelled` | the flyout given 1800ms to dwell, then the menu: flyout `absent` |

When the implementation lands, this set is superseded: the story, the `STORIES`
rows and these frames come out together, and the PR's own evidence set — driven
through the real trigger, with the real `openMenuRowId` hold — replaces them.
