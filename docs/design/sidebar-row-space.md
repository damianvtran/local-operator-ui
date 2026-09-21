# Sidebar row space, and where the archive offer lives

The sidebar row pays for two per-row controls on **every** row, at rest, whether
or not the pointer is anywhere near it: a pinned row spends 24px on a glyph and
28px more painting nothing, and an unpinned row paints nothing in all 56px. The
title pays for all of it - 180px at the panel's default width where the row
affords 236 - and the conversation left in that box is strung out at about 28
characters.

This document is the spec for the change the operator asked for, and it is
written from the running app rather than from the source: every number below is
read from `docs/evidence/sidebar-row-space/` (24 frames, three panel widths, both
palettes, pointer off and on, plus the register state they reported), and the
boxes behind each one are committed beside them in
`docs/evidence/sidebar-row-space/measurements/`.

**The target behaviour is the operator's, not this document's.** They supplied
Codex's sidebar as the precedent and said: the row stays full width until hover;
pinned rows spend space only on the pin; the acts appear on hover; the title pans
on hover so the rest of it can be read; and the archive confirmation belongs in a
standard sonner toast rather than in a line inside the panel. What this document
decides is the geometry, the mechanics, and the numbers - and it records where
the new behaviour contradicts a rule this panel already states, because four
rules it currently follows are built on the reservation that is going away.

## 1. What is actually there today, measured

Panel widths are written through the divider's own action (`setSidebarWidth`),
because a row's width is the user's preference (`chatSidebarWidth`, clamped
240..360, default 280) and not a function of the window. Contrast this with
`docs/evidence/session-archive/README.md`'s "the shipped 320px panel" - that
record corrected itself to 280, and 320 is a width the panel really can be put
at, so all three are photographed here.

The panel is `p-2` (8px), so a 280px panel gives a 264px row. Inside the row:

```
row box   "flex h-8 items-center gap-1 rounded-md"          264
  button  rowStyle + px-1 (4+4)  "min-w-0 grow"             208
    status slot  ChatSessionStatus, size-4                  16
    gap (gap-1)                                              4
    title        "min-w-0 flex-1 truncate"                 180   <- the number that matters
  gap (the row's own gap-1)                                  4
  pair         "flex items-center gap-1"                    52
    pin                    size-6                           24   <- painted only on a pinned row
    gap                                                      4
    archive                size-6                           24   <- never painted at rest
```

Measured on the committed frames, identical in both palettes:

| Panel | Row box | Button | Title | Tail after the title | Pair | Pin | Archive | Shared trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 240 (clamp min) | 224 | 196 | **168** | 32 | `0x0` shipped shed | `0x0` | `0x0` | 24, unpainted |
| 280 (default) | 264 | 208 | **180** | 60 | 52 | 24, painted iff pinned | 24, unpainted | `0x0` |
| 320 | 304 | 248 | **220** | 60 | 52 | 24, painted iff pinned | 24, unpainted | `0x0` |

What that costs, at rest, inside the 264px row:

| Row class | Painted in the trailing 60px | Paints nothing |
| --- | --- | --- |
| unpinned | - | **56px (21.2% of the row)** |
| pinned | the 24px pin glyph | 32px |
| current | - | 56px |

And what it costs the title's *content*, from the long conversation the fixture
carries: `"Quarterly retention sweep and the transcripts it dropped"` is 54
characters and needs **341px**; it is given 180 and truncates at
`"Quarterly retention sweep a"` (6.31px per character measured on this string, so
about 28.5 of 54 characters are on screen).

**Two things the operator's report does not contain, both measured, both part of
the change:**

- **D1 (MAJOR, shipped defect). At the 240px clamp minimum a PINNED row carries
  no pin at all.** The mark lives inside the pair wrapper the shed query hides,
  so its box reads `0x0` and nothing is painted - `rest-240/*.png` in both
  palettes. This panel states as a rule that a pin's state must read without
  hovering; at its narrowest width the shipped build breaks it. The fix is
  structural (D4) rather than a second exception to the query.
- **The operator's machine is more crowded than these frames.** The frames are of
  a machine with macOS overlay scrollbars, where the list region's scroller takes
  no width. Their screenshot shows a classic scrollbar, which eats ~15px inside
  the scroller on those systems, so their rows are ~15px narrower than the same
  state here. The scheme below still fits (the numbers in §3 are the wide case;
  see D12 for the gutter decision).

## 2. The scheme, in one paragraph

At rest a row carries its title and nothing else, except that a **pinned** row
still carries its pin mark, because that is a state and not an act. The two acts
- the pin toggle and the archive control - take no space at all until the pointer
is on the row or the keyboard is inside it, at which point they appear in the
row's trailing edge and the title's box becomes exactly as wide as it is today at
rest. Because that box is narrower while the acts are showing, a title that does
not fit **pans slowly to the left, once, and stops**, with a fade at each edge so
that the text is masked rather than guillotined; a title that fits does not move.
A tooltip carries the whole title and the row's other facts, and it is also the
answer for anyone whose system asks for reduced motion. The row's box, its
height, and the title's leading edge never move; what moves is the title's clip.
The archive confirmation stops being a line in the panel and becomes a toast in
the sidebar's own lane.

## 3. Geometry, at rest and under the pointer

The three constants the whole scheme is an arithmetic over, all measured above:
the row's own content inset before the title is **28px** (`px-1` 8 + the status
slot 16 + its gap 4); a control box is **24px**; a gap between controls, or
between the button and the cluster, is **4px** - so **one control costs the title
28px** and **the pair costs it 56px**.

| Row class | State | Title box at 240 | at 280 | at 320 | What is drawn to its right |
| --- | --- | --- | --- | --- | --- |
| **unpinned** | rest | **196** | **236** | **276** | nothing |
| **unpinned** | hover / focus-within | **140** | **180** | **220** | pin, then archive (56px + the 4px row gap) |
| **pinned** | rest | **168** | **208** | **248** | the pin mark (24px + the 4px row gap) |
| **pinned** | hover / focus-within | **140** | **180** | **220** | the archive, revealed beside the mark |
| **current** | rest | as its class | as its class | as its class | as its class; the ground stays `rowSelected` |
| **current** | hover / focus-within | as its class | as its class | as its class | both acts reveal; the hover ground is still dropped |
| any | narrow (panel <= 278) | - | - | - | **the same rule as every other width** (D9) |

What the change buys, at rest, on the row the operator was looking at: **+56px at
280** (180 -> 236, about nine more characters, 28.5 -> 37.4), **+56px at 320**
(220 -> 276), **+28px at 240** (168 -> 196). On a pinned row: **+28px at 280 and
320**, and at 240 the title is unchanged while the pin becomes visible for the
first time.

**The px budget per state**, as the arithmetic a reviewer can re-check: the title
is `row - 4 (the row's gap) - cluster - 28`, where `cluster` is `0` at rest on an
unpinned row, `24` at rest on a pinned one, and `52` under the pointer; at 240/280
/320 the row box is 224/264/304.

## 4. The acts: how they take space (D2), and what they replace (D3)

**D2 - the acts SHRINK the title; they do not overlay it.** Measured consequence
at the default width: entering an unpinned row moves the title's clip edge 56px
left, i.e. **the title box goes 236 -> 180, a 23.7% reduction**, and up to about
nine characters leave the screen at the moment the pointer arrives. That is not a
cost to be hidden: it is the reason the pan exists (§5), and it is why the acts
may not be an overlay. An overlay was considered and refused for the reason the
pair itself was refused as one box: the two controls would sit on the text the
reader is reading, and the pan would be pointless because nothing would be
clipped.

**D3 - at rest the acts are ABSENT FROM THE LAYOUT, not transparent in it.** The
`display` switch replaces the opacity pairing on these two controls:

- the pair wrapper (`data-session-control-pair`) keeps `flex items-center gap-1`
  and gains `hidden group-hover:flex group-focus-within:flex` **while the row is
  unpinned**; on a pinned row the wrapper is always `flex`, because the mark
  inside it is the state;
- the archive control gains `hidden group-hover:flex group-focus-within:flex`
  unconditionally, and the pin control gains it while the row is unpinned;
- nothing about either gets a `transition`: `display` is not one of the four
  properties `docs/branding.md` § 5 lets animate, and the app's motion vocabulary
  has no entrance here to spend.

Why `display` and not a 0-width box or an absolutely positioned cluster: a
reserved-but-empty box would keep paying the 4px row gap, and `width: 0` is a
transition on a property the brand contract does not admit. `display: none` is
also strictly stronger than the old `opacity: 0` + `pointer-events-none` pairing
on the property that pairing was written for: an element that is not displayed
cannot receive a press at all, so **"a hidden control is inert" stops being a
rule someone has to remember and becomes a fact about layout**. The `opacity`
and `pointer-events` classes, their `duration-base`/`duration-fast` pairs and the
`group-hover:opacity-100 group-hover:pointer-events-auto` chains come off both
controls.

**This departs from a reveal the app uses elsewhere, and the difference is
deliberate.** The rail's collapse toggle is revealed the other way -
`pointer-events-none opacity-0` at rest, revealed on `group-hover` /
`group-focus-within`, with its own comment recording that the button "keeps its
place in the tab order" (`docs/design/sidebar-sections.md` § 9.8, from the rail's
note). Both mechanisms keep the control reachable; they differ in what they
charge for it. The rail is a fixed-width strip whose label is already shed, so a
24px box kept in the layout costs its title nothing - the reveal is free and
`opacity` is the right tool. Here the kept box IS the defect, and the same
property survives without it: `group-focus-within` fires when focus is anywhere
inside the row, and the row's button is the first thing Tab reaches there, so the
cluster is displayed before the next Tab can arrive. If a later change makes the
row button a group that is not the row (a nested group, a portal), this is the
assumption that breaks first, and it is stated here so it can be checked rather
than rediscovered.

Two properties of the old reveal are deliberately KEPT: the pointer's own
control still reads at full ink (D22's `hover:text-ink!`, whose `!` is still
load-bearing), and both controls still drop their hover ground on the current row
(`!current && "hover:bg-row-hover"`), because a child's background paints over
the row's own ground.

**D4 - the pinned mark is hoisted out of the hover-only cluster.** This is the
fix for D1 and it costs nothing extra: the wrapper is `flex` whenever the row is
pinned (D3), so the mark is drawn at rest at every width while its neighbour
stays absent. The state reads without hovering at 240 for the first time, and the
mark remains the control it is today: pressing it unpins, `aria-pressed` carries
the state, and it is pressable as drawn.

## 5. The pan (D5, D6) - one-way, delayed, masked

**D5 - the mechanics.** The operator specified the shape; these are the numbers.

- **When it starts:** pointer only, and only after a **400ms dwell** on the row.
  The dwell is the app's own hover-dwell constant - the Radix `TooltipProvider`
  default the panel already ships - so the panel has one number for "the pointer
  has decided to stay", not two. If the pointer leaves before it elapses the
  timer is cancelled and **nothing moves**: sweeping the pointer down the list
  starts no pan on any row.
- **What it does:** the title's inner text element is translated to the LEFT at a
  constant **32 px/s**, `linear`, with no easing. It runs while the pointer stays,
  reaches `X = scrollWidth - clientWidth`, **stops there and holds** for as long as
  the pointer remains. No loop, no ping-pong, no spring, no rewind. 32 px/s is
  reading speed (≈5 characters a second at the 6.31px/char measured on this
  fixture): slow enough to read along, which is the whole reason the operator
  asked for the pan rather than a cut-off.
- **How long it takes:** `max(32 px/s, overflow / 8s)`. The floor is the reading
  speed; the cap keeps a pathological title from taking half a minute. On this
  fixture, at the default width: the long row's overflow under the pointer is
  341 - 180 = **161px -> 5.0s**; at 320 it is **121px -> 3.8s**; at 240 it is
  **201px -> 6.3s**.
- **Only when it overflows.** The pan is armed only when
  `scrollWidth - clientWidth > 0.5`, read from the title's own box at the moment
  the pointer arrives (i.e. against the HOVERED box, not the rest box). The
  fixture's short row measures `168/180/220` of box for `168/180/220` of text at
  the three widths - it fits, and it must not move; the frame `hover-short-280`
  is that row, photographed so the claim is a picture and not an assertion.
- **How it ends:** on `pointerleave` the pan is cancelled, the transform is
  cleared and the mask removed **in the same frame**. The reset is
  **instantaneous, not a return animation**: motion the reader has stopped asking
  for should stop, and a 120ms rewind is a second thing moving on a row they have
  already left. It also removes a class of bug outright - there is no mid-reset
  window, so a pointer that re-enters re-arms from rest and waits a fresh 400ms.
  (If it reads as a jump in QA, the one-line alternative is a 120ms
  `transition-transform` on the return only; that is a change to make on
  evidence, not in advance.)
- **Easing:** none, deliberately. An eased pan is a title that arrives at varying
  speed, and the tail is the part being read.
- **Focus does not start it.** The keyboard's answer to a clipped title is the
  flyout (§6), which opens on focus as a Radix tooltip. A title that began
  scrolling as someone Tabs down the list would move the very text they are
  reading while they navigate; a tooltip appearing beside a focused row does not.

**D6 - the edge fade.** The mask is on the **title's own box**, as a
`mask-image` gradient, not an overlay element: an overlay would be a second box
sitting on the text that could take the pointer (the app has already been bitten
once by exactly that - `tooltip.tsx` carries the U6/U7 note about a floating panel
swallowing clicks on the composer's readings). The gradient is **12px at each
edge**: `linear-gradient(to right, transparent 0, black 12px, black calc(100% -
12px), transparent 100%)`.

- The **right** fade is the honest end of the clip: while the pan runs, the
  title also drops its ellipsis (`truncate` is the rest state), because a static
  ellipsis painted over moving text is a glyph that belongs to neither.
- The **left** fade only exists once there is something under it. Its ramp is a
  function of the pan's own offset: `leftFade = min(12px, X)`, written in the same
  frame as the transform. At `X = 0` there is no left fade at all, so the first
  character is not dimmed at the start of a pan, and by the time 12px of text has
  gone under the edge the full 12px fade is in place.
- **At rest there is no mask.** The mask is applied only while the pan is
  running. The rest state is the shipped one, ellipsis and all.

**The argument for accepting the motion at all**, since this is motion the user
did not ask for on the row they are about to act on: it is the only way the full
title can be read without leaving the row, it starts only after a 400ms dwell, so
a sweep across the list starts none of them, it moves at reading speed rather than
at animation speed, it stops rather than looping, and it is suppressed where
motion is a stated preference (§7). The alternative considered and refused is the
one the panel ships today: shorten every title so that no pan is ever needed,
which is the report this change exists to answer.

## 6. The flyout (D7) - the full title, and the row's other facts

The row's pointer channel becomes the app's own tooltip
(`shared/components/ui/tooltip.tsx`), and the row's native `title` attribute is
removed - one pointer surface, not two (a native tooltip appearing a second after
a styled one is the bug this avoids).

- **Trigger:** the ROW'S OWN BOX (`[data-session-row]`), not its button, and that is
  a correctness requirement rather than wiring (agent review round 1, R-1's sibling
  findings D1/U1/Q-1; QA Q-1). The row's `<button>` shrinks by exactly 56px when the
  acts are revealed, and Radix measures `side="right"` from the trigger, so a flyout
  anchored to the button began at 428 + 6 = **434** at the 280 panel - 50px inside the
  row, covering its archive control (460..484) entirely and its pin (432..456) for 22 of
  its 24px, at every width measured (240/278/279/280/360) and for as long as the pointer
  rested on the control it was covering. Anchored to the row's box, which never shrinks,
  the flyout's left edge is the row's right edge (484) plus the primitive's 6px
  `sideOffset` = **490** at the 280 panel, against a panel whose outer edge is x 500.
  The same 400ms dwell as the pan (`TOOLTIP_DELAY_MS`, imported rather than restated)
  applies, and it opens on keyboard focus as well (Radix does this), which is what makes
  it the keyboard's channel for a clipped title. `skipDelayDuration` stays the provider's
  300ms, so moving between two rows does not re-wait.
- **One row at a time, the row under the pointer (D2).** A flyout that is open describes
  the row the pointer is inside - opening for the row's whole box, INCLUDING the acts -
  and it closes when the pointer leaves the row and when focus leaves it (the row's own
  `onBlur` keeps it open while focus moves between the row's own controls). The close on
  leave is `disableHoverableContent`: by default Radix does NOT close on `pointerleave`
  (it waits to see whether the pointer enters the content, which is how a hoverable panel
  stays reachable), and every panel here is `pointer-events: none`, so the default left a
  flyout painted after the pointer had gone - measured still drawn 2.5s after the pointer
  left the row, and one committed frame carried another row's flyout, i.e. another row's
  facts under the pointer. Radix closes any other open tooltip when one opens, so two
  rows are never described at once.
- **Content:** everything the native string carried, so nothing is lost with it -
  the full title (untruncated, wrapped, the primitive's own `max-w-64` = 256px),
  the binding (`· <agent or team>`), the row's status label, and the tail flags
  `, not sent yet`, `, unread`, `, archived`, plus the silent-remedy sentence. The
  `aria-describedby` that already names the remedy stays exactly as it is: it is
  the keyboard/screen-reader channel and it does not move into a tooltip, and the key
  is passed only on rows that have a remedy (present-but-`undefined` would override the
  primitive's own description on every other row - R2).
- **Placement:** `side="right"`, `align="start"`, `sideOffset` 6 (the primitive's
  default). The flyout grows into the chat column from x 490, which is how it satisfies
  the brief's two constraints at once, and structurally rather than by trial:
  **it cannot cover the acts**, because they are the row's last 52px (432..484 at the 280
  panel) and the flyout starts 6px outside the row's own box; **it cannot cover the list
  below**, because every row is inside x 228..484 and the flyout is not. This is the same
  reasoning the primitive's own note reaches ("a side is a guess about what is
  nearby … a panel that cannot be clicked cannot swallow a click on ANY side"):
  the panel is `pointer-events-none`, so a flyout over the chat column cannot
  take a press meant for anything.
- **The window's edges (D4):** `collisionPadding` of 8px. At the list's last row the
  un-padded box measured **806..868.2 against an 868px viewport** - flush with the
  window's bottom edge - and 8px keeps it wholly inside. Where a clamped flyout still
  reaches over the composer's left margin (the composer's form starts at x 524, the
  bottom row sits at y 828..860, and a 62px flyout for it cannot be clear of both), the
  trade is that the flyout cannot take a press and the alternative is covering the list
  and the acts. The same trade applies to nothing else: § 10's clearance proof is about
  the TOAST, which is confined to the panel's column.
- Rows whose title FITS get the same flyout - it is a replacement for the native
  tooltip, not only an overflow affordance - and for those rows it is simply the
  facts, with the title in full as its first line.

## 7. Reduced motion (D8)

`prefers-reduced-motion: reduce` suppresses the pan **entirely**: no dwell timer,
no transform, no mask. This is not a courtesy decision, it is the only correct
implementation in this app, and the reason is in the app's own base layer:

> `styles/index.css` caps every `animation-duration` and `transition-duration` at
> `0.01ms` **and pins `animation-iteration-count` to 1**, explicitly rather than
> cancelling animations, because "a cancelled animation can leave an element at
> its `from` keyframe".

A pan written as a CSS keyframe animation would therefore land, under reduced
motion, on its **end** keyframe: the title would jump to fully scrolled and stay
there, i.e. the setting would produce a worse defect than the motion it was
supposed to remove. So the pan is javascript-driven (a `requestAnimationFrame`
loop writing `transform`, gated by the app's own hook,
`useMediaQuery("(prefers-reduced-motion: reduce)")` - the hook `working-line.tsx`
and `composer-tip.tsx` already gate their motion with).

**The fallback when it is suppressed is the flyout, and it is complete**: the
full title, the binding, and the status, on the same 400ms dwell. Nothing is
readable-by-pan alone. The mask goes with the pan (a mask with no motion would be
a fade over text that never moves, dimming the very characters the reader is on).

## 8. The narrow band: the shed is DELETED (D9)

`ROW_CONTROLS_PAIR_SHED` (`@max-[263px]/chatsidebar:hidden`),
`ROW_CONTROLS_SHARED_SHOWN`, the shared 24px trigger and its menu
(`data-session-actions`), and the container declaration that existed only for
them are **removed**. Below a 279px panel (the band the query covers) the row
follows the same rule as every other width: nothing at rest but the pinned mark,
the pair under the pointer.

The shed's stated reason is entirely a REST cost - the source comment and D15
both argue from "56px off EVERY title, on every row, at rest, whether or not the
pointer is anywhere near it". That cost is now zero, so the rule has no premise
left. What the shed still buys at 240 is a smaller HOVER cost (one 24px trigger
instead of the pair: 28px of title rather than 56), and that is real - but it is
paid for with two clicks on every act at the width where the acts are hardest to
hit, it would still need the pinned mark hoisted out of the shed wrapper to fix
D1, and it leaves two behaviours to verify instead of one. The decision is one
rule at every width, and the reversal is cheap if QA finds the 240 hover busy:
restoring the query and the menu is one constant plus one control, and the frames
of it are already committed (`docs/evidence/session-archive/row-controls-shared*`).

**What this retires, named rather than left to be discovered:** the two constants;
`sharedActions` and the whole `DropdownMenu`; `data-session-actions`; the
`@container/chatsidebar` declaration on the panel root (whose only reader was the
shed); D10, D15 and D22's narrow-band arm in
`docs/design/session-archive-delete.md`; the six `row-controls-shared*` frame
directories; and the narrow steps of `scripts/renderer-driver.mjs`'s
`session-archive` scene with the assertions behind them
(`scripts/chat-sidebar-archive.test.mjs`: the D10 shared-control test and the
container-query test both read text that will no longer exist).

## 9. Accessibility (D10)

- **The acts are reached by keyboard through the row, not by hunting.** They exist
  in the layout only under the pointer or under focus, and `group-focus-within` is
  what makes the second true: Tab reaches the row's button (the row's only tab
  stop at rest), which puts focus inside the row, which reveals the cluster, and
  the NEXT Tab reaches the pin and then the archive. The member order never
  changes and nothing moves under the keyboard: the cluster is to the right of the
  button, so revealing it clips the title rather than pushing the focused element.
- **What a screen reader hears is unchanged.** The controls keep their action-named
  labels (`Pin "<title>"` / `Unpin "<title>"`, `Archive "<title>"` /
  `Unarchive "<title>"`), the pin keeps `aria-pressed` as its state channel, the
  archived marker keeps its `sr-only`, `, archived`, and the silent remedy keeps
  its `aria-describedby`. The one fact that must not depend on hover - a row's pin
  state - is carried by `aria-pressed` on a mark that is drawn at rest on every
  pinned row (D4).
- **A STATE CHANGE INSIDE THE ROW MUST NOT TAKE THE KEYBOARD'S PLACE AWAY (U2).**
  Unpinning from the keyboard used to end with `aria-pressed true->false`, the pair
  `display: none` and `focus: body`: the mark's own box leaves the layout when it is
  unpinned, a `display: none` element cannot hold focus, so Chromium blurred it to
  the document body, `group-focus-within` went false and the cluster stayed hidden -
  self-sustaining, and a regression the `opacity`-based reveal could not have (a
  reserved box can hold focus). **The rule: a keyboard press that UNPINS puts focus back
  inside the row, and where inside follows what is drawn** - the mark when the row is
  pinned, the row's own button when it is not. It is the panel's row-move correction that
  does it, not the press handler: unpinning re-renders the row under a different section
  parent, so the element a handler holds is destroyed by the very commit that moves the
  row. Measured on the first run of the `row-space` keyboard walk: the state moved
  (`aria-pressed "false"`) while the reading stayed `pairDisplay "none"`,
  `focusInsideRow false`, `activeTag "BODY"`, until the correction chose its target by
  the mark's box rather than by its presence. Focus stays inside the row, the cluster
  stays revealed, and the next Tab reaches the pin's neighbour rather than restarting
  from the top of the document. A POINTER press does not take this path
  (`event.detail === 0` is the keyboard): moving focus into the row would keep the cluster
  drawn by `group-focus-within` after the pointer had left.
- **Focus-visible** is the app's existing `:focus-visible` outline, unchanged: the
  ring is drawn on the control the keyboard is on, and revealing the cluster is
  what makes the ring's target visible before it is focused. `data-chat-row`
  arrow-key traversal continues to exclude these controls, exactly as it does
  today.
- The hidden-at-rest controls are removed from the accessibility tree at rest too
  (`display: none`), which is the honest state: on an unpinned row there is no
  pin control to announce. A pinned row announces its pressed pin at rest.

## 10. The archive offer becomes a sidebar-lane toast (D11)

The operator: the confirmation "shows up in a weird awkward spot in the sidebar
with a gap below it … Maybe just a toast makes sense using the standard sonner
toast". The measurement agrees with them about the placement and disagrees with
nothing: the offer is a 264 x 25.4px line whose top is at y 493.6, 8px above the
split line and **117px above the first row of the list it is about**, positioned
by the flex column between the two regions rather than by the list. It is not
merely "mid-list": its position moves with the split and with the region above
it, which is why it can read as floating in a gap.

**The register is deleted and replaced by a toast - in the sidebar's own lane.**
D12's finding is not ignored; it is answered, and its conclusion is superseded:

- **D12's constraint 1, "never overlap the composer's interactive controls", is
  now structural.** Measured: the sidebar's outer box is x 220..500 at the default
  panel width and the composer's form begins at x 524 - the chat column's own 24px
  of padding is the whole gap - and the two cannot overlap at any selectable width,
  because they are siblings in one flex row and the chat column begins where the
  sidebar ends: the rail is 220px expanded and 48px collapsed, the sidebar clamps
  at 240..360, and Send sits at x 1307..1339 inside the composer. Whatever the
  settings, a toast confined to the sidebar's own box is confined to a column the
  composer is never in. **A toast confined to the sidebar's
  column cannot touch Send at any panel width and at any composer height** -
  which is the property the 2026-09 measurement turned on (a bottom-right toast
  spanned x 1001..1360.5, y 789..842.5 and landed exactly on Send).
- **D12's constraint 2, "it must sit on the surface that performed the action", is
  now satisfied too**: the archive is performed from the sidebar, and the offer
  appears in the sidebar. That was the half a bottom-right toast could not have.
- **How it is placed, concretely.** A second `ThemedToastContainer` is mounted by
  the chat sidebar's panel root (the global one in `main.tsx` keeps every other
  toast exactly where it is), with `position="bottom-left"` and an inline
  `position: absolute` - the same mechanism `themed-toast-container.tsx` already
  relies on for colour (sonner's stylesheet cannot beat an inline value) - so the
  lane is the sidebar's own box rather than the viewport's corner. THE `position`
  IS NOT WHAT CONTAINS IT, and this paragraph used to say that it was: sonner
  2.0.3 draws every mounted container's copy of every toast (the reading is
  recorded in `styles/index.css` beside the two rules that narrow it), so what
  confines the message to the panel is the app's own rule - the marker class these
  two messages carry, scoped to `nav[aria-label="Chats"]`. The offer is
  `toast.info(..., { position: "bottom-left" })` so nothing else changes, not
  because the argument routes it.
- **Width:** the lane's toasts are capped to the sidebar's content width
  (`--width: min(264px, 100% - 32px)`), so a long title wraps instead of running
  out of the column, which is also what keeps the disjointness above true.
  **The offer's card is one line, and only its NAME may be truncated** (design D3;
  UX U5; the truncation's own correction in agent review round 2, R2-3): at 216px of
  content box a 45-character title wrapped to three lines inside its own quotation
  (`“Migration` / `checklist”` / `archived.`), and the card stood 80px tall - 134px for
  the longest fixture title - over the row it had just archived. The sentence is now TWO
  elements: the quoted name inside its own truncating box, and `archived.` as a fixed tail
  outside it. A single ellipsised STRING loses its tail, and the tail here is the verb -
  the first version of this rule rendered the operator's own longest title as
  `“Quarterly retention sweep and the transc…`, a card that no longer said what had
  happened. The full name is one dwell away in the row's own flyout. **A refusal is
  deliberately still whole**: it
  carries the daemon's own sentence about why the write was refused, and truncating
  that would hide the reason the reader is being asked to retry. Its measured cost
  is stated rather than left to be discovered - 216x206 at the 280 panel, nine
  wrapped lines covering four rows and two section headers - and that is the trade
  this design takes: a refusal that is readable beats a smaller one that is not.
- **Duration:** 8000ms for the offer (sonner's 4000ms default is short for an
  Undo), 10000ms for a refusal, which carries its Retry. **The panel runs that clock, not
  sonner** (agent review round 2, the re-assertion): sonner's per-toast life resets only
  when the `duration` passed to an already-mounted entry CHANGES, so a message re-asserted
  by an answer - the refusal a refused Retry puts back - kept the clock of the message it
  replaced and left the lane seconds later (measured: dark 5068ms / light 5096ms after the
  press, `painted false` with the store's refusal unchanged). Every draw is therefore
  persistent to sonner and the panel arms the life per message, which also re-arms it on
  every re-assertion. The cost, stated rather than hidden: sonner's hover-pause no longer
  applies, since sonner is no longer what ends a message.
- **Dismissal:** the app's close button is already on (`toastOptions.closeButton`
  in `ThemedToastContainer`), so the offer can be put away without acting;
  pressing Undo dismisses it immediately through the app's own channel
  (`dismissToast` in `shared/utils/toast-manager.ts`, which exists for exactly
  this "an offer is only honest while the state it was taken from still holds"
  reason - the goal confirmation's U7).
- **ONE ID FOR BOTH MESSAGES, `ARCHIVE_TOAST_ID = "archive"`** - this section said
  one id per kind (`archive-undo`, `archive-failure`) and the implementation
  deliberately did not (agent review round 1, R-5; the id is what makes one message
  at a time true, because the second message arrives as an UPDATE of the mounted
  toast). A second archive therefore replaces the first rather than stacking, which
  matches the store's single-value model (`archiveUndo`/`archiveFailure`). The
  consequence is stated rather than hidden: only the most recent offer is
  pressable, and an older restore is still reachable where it always was - the
  row's own Unarchive control, the header's Archived pill, and `/unarchive`.
  **Replacement is required, not merely tidier:** a message created on this id
  inside sonner's own unmount window (a dismissal's `requestAnimationFrame` plus
  its 200ms delay) is merged into the entry being removed and destroyed with it.
  Measured three ways on 2026-09-21 (the running app: the retry's `dismissToast`
  and its re-create 2-4ms apart, `showWarningToast` called, no toast element ever
  mounted, lane empty at +2.5s; the installed sonner 2.0.3 in jsdom: created on a
  dismissed id, painted at +50ms and gone by +600ms, while the same create 600ms
  later mounts; the store: the write does set `archiveFailure`, so the effect ran).
  Nothing in the lane dismisses a message it is about to replace, and after agent review
  round 2 that is structural rather than a property of the paths somebody happened to
  check. ONE effect settles the lane out of the store's two values, so no pair of effects
  has a declaration order that decides which message wins a commit (R2-4), and neither
  action dismisses anything before its own answer (R2-1): a refusal that follows a refusal
  is an update, an accepted archive raises the offer in the same update that clears the
  refusal (`offerArchiveUndo`), and only a message with no successor is dismissed (an
  accepted unarchive). **A press that has not been answered also decides nothing** - the
  retirement subscription skips a conversation whose own fact is still unanswered
  (`ArchiveFact.answered`), so pressing Undo cannot retire the offer it was taken from and
  then raise its refusal on the id that dismissal took down. That was R2-1, the same
  mechanism as U3 on the control beside the Retry.
- **Retirement is unchanged, and it waits for the answer it is a rule about.** The
  register's rule - the offer stands while the conversation still holds the state the
  offer was taken from (`undoOfferStands`) - is kept, implemented with `dismissToast(id)`
  the moment the client knows the state has moved; a press still in flight is not
  knowledge (`ArchiveFact.answered`), so the rule is not asked while the answer that would
  decide it is outstanding. That is the same rule, in the mechanism the toast lane already
  has for it. **What retires a message is the LANE's own record of what it is showing**,
  not a fact about the store (agent review round 1, R-1): the store's `archiveFailure`
  outlives its message (it is cleared only by an answer to a press on that conversation),
  and gating the offer's retirement on it let one refused archive disable retirement for
  the rest of the session - a still-pressable Undo offering to re-archive a conversation
  the reader had just restored. **And one effect draws both messages** (agent review round
  2, R2-4): "which message the lane shows" is one decision per commit rather than a race
  between two effects whose declaration order is what decides it.
- **Not in scope, named:** the pin's own failure line (`pinFailureLine`) is the
  same class of in-panel line and could move to the same lane; it belongs to the
  pin feature and is left alone here rather than changed in passing.

## 11. The list region's scrollbar (D12)

`docs/evidence/sidebar-row-space/` was taken on overlay scrollbars, where the
list's scroller takes no width. On a system set to always show scrollbars - the
operator's own setting, visible in their screenshot - a classic scrollbar eats
~15px **inside** the scroller, i.e. off every row's width, and it appears and
disappears as the list crosses the scrollable threshold (which the archive,
unarchive, pin and unpin flows all cross).

**Decision: the list region reserves the gutter** (`[scrollbar-gutter:stable]`,
the idiom `canonical-transcript.tsx` and `picker-host.tsx` already opt into).
Every row on such a system pays 15px permanently - at the default width that is
236 -> 221 of title at rest, still 41px more than today - and in exchange a title
never re-truncates because a row was added or removed. The alternative (leave it)
keeps those 15px and pays for them with a layout shift on exactly the flows this
change is about. It is one class if the operator prefers the other trade.

**What the reservation costs even where it was said to be free (design round 1,
D5).** The earlier reading of this was that a machine on overlay scrollbars pays
nothing, "the gutter is zero" - and the change's own measurement refutes it:
`listGutter: {offsetWidth: 264, clientWidth: 256, reserved: 8}` in both
`docs/evidence/sidebar-row-space/measurements/row-space-geometry-*-after.json`
files, which is why EVERY title width in § 3 is asserted minus 8 rather than as
written. The visible cost is a de-alignment the operator can see: a row is
228..484 while the panel's content box is 228..492, so the selected ground and
the section-header counts stop 8px short of the search field above them, and the
rest title is 228 rather than the 236 this section's arithmetic promises (on
always-on classic scrollbars, ~15px and 221). **The trade is kept**: 8px of a
256px row is 3%, one re-truncation of every title on every archive is not, and
the alignment is one class to revisit with the operator if the 8px edge reads
worse in the frames than the re-truncation would.

## 12. Where this contradicts what the panel already states

Each of these is a rule written into the source with its own rationale, and
none is being quietly abandoned:

| The rule today | What replaces it |
| --- | --- |
| The controls are `size-6 shrink-0` "so the reserved slot cannot reflow the row"; the reveal is "`opacity` and `pointer-events` only, so the reveal cannot reflow the row" | **Replaced (D3).** There is no reserved slot. The row's box, its height and the title's leading edge still never move; what moves is the title's clip, by 52px (28 on a pinned row), at the only moment the controls exist. The invariant the old rule protected - nothing shifts under the pointer that the pointer is aiming at - survives where it matters: the controls do not move when they appear, and they appear on pointer-enter, before any press can be aimed. |
| "A hidden control is inert" (`opacity: 0` + `pointer-events-none`) | **Strengthened (D3).** `display: none` cannot receive a press at all, so this stops being a rule to remember. The opacity/pointer-events pairing comes off these controls. |
| "The pin's state must read WITHOUT hovering" (a pinned row's glyph is filled `text-ink`) | **Kept, and now true at every width (D4).** Measured broken at 240 today (D1). |
| "Nothing lifts, scales or translates on hover" (`branding.md` § 5) | **Extended by the operator's own instruction, and bounded.** The pan translates the title's *text* by up to the overflow, one way, after a dwell, stopping at the end; the row, its controls, its box and its ground do not translate, lift or scale. The one property that moves is `transform`, which § 5 admits "for entrances" - this is a marquee rather than an entrance, and it is stated here as the deliberate exception, with reduced motion as its off switch. |
| The narrow band swaps the pair for one shared 24px menu "because the pair's cost is not payable at the clamp minimum" (`ROW_CONTROLS_PAIR_SHED`, D15, D10) | **Deleted (D9).** The cost it guarded was a rest cost and there is no rest cost. |
| The archive offer is a panel register, not a toast (D12) | **Replaced (D11)**, with both of D12's constraints met structurally rather than by a numeric offset. |
| The row's `title` attribute carries the pointer's copy of the row's facts | **Replaced (D7)** by the app's own tooltip, carrying the same content, so there is one pointer surface rather than two. |

## 13. What the coder must also touch

- `scripts/renderer-driver.mjs`: the `session-archive` scene's pair/shared steps
  assert the reservation that is going away (`row-controls-pair-rest`'s "the
  slots are RESERVED with nothing drawn in them", the `[data-session-actions]`
  press, `shared-rest`/`shared-hover`/`shared-menu`) - they must be updated with
  the change, not left to fail.
- `scripts/chat-sidebar-archive.test.mjs`: the D10 shared-control test and the
  container-query test read source text that is being deleted; the D22 ink test
  survives (the `!current && "hover:bg-row-hover"` and `hover:text-ink!` rules
  stay).
- `scripts/chat-sidebar-pins.test.mjs`, `scripts/chat-sidebar-selection.test.mjs`:
  both read this row's class lists; they will need the same edit.
- `docs/design/session-archive-delete.md` and
  `docs/evidence/session-archive/README.md`: D10/D15/D22 and the
  `row-controls-shared*` / `row-controls-pair-rest` rows are superseded by this
  document. Point at it rather than editing history.
- `docs/evidence/manifest.json` needs **no** change for this set: the sweep's
  frame walk counts `.webp` files, and these are `.png` like the archive set's.

## 14. How the result is verified (and what "verified" means here)

The scene added for this spec is the repro, and it is the same instrument before
and after, so the two sets are comparable frame for frame:

```sh
set -a; . ~/local-operator-ui/.env; set +a
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18234 pnpm build
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs \
  --port 18234 --records /tmp/row-space-stub-records
LOCAL_OPERATOR_DESKTOP_TOKEN=[redacted] node scripts/renderer-driver.mjs \
  --scene row-space --backend http://127.0.0.1:18234 \
  --backend-records /tmp/row-space-stub-records --seed-onboarding-complete \
  --theme localOperatorDark --out /tmp/row-space-dark --window-size 1380x900
# …then --theme localOperatorLight --out /tmp/row-space-light
```

Per state, the label that reproduces it (labels are the frame filenames and the
committed directory names, one launch per palette):

| State | Label |
| --- | --- |
| the panel at rest, all row classes, at each width | `rest-240`, `rest-280`, `rest-320` |
| the long title under the pointer (the pan's own case) | `hover-long-240/280/320` |
| the pinned row at rest and under the pointer | inside `rest-*`, and `hover-pinned-240/280/320` |
| a title that FITS and must not move | `hover-short-280` |
| the current row under the pointer (ground must survive) | `hover-current-280` |
| the archive offer's replacement (the toast) | **owed**: a new label, e.g. `offer-toast-280`, taken with the offer on screen and the pointer parked, asserting the toast's box is inside the sidebar's column and disjoint from the composer's form |

The scene already writes `measurements/row-space-geometry-<theme>.json` - the
derived table (`states`) and the raw boxes it came from (`boxes`), plus the panel
box, the register's box, the split line, the first list row and the composer/Send
boxes. The coder should turn the numbers this change promises into assertions in
the same read, so the change cannot land with the geometry it claims:

- at rest on an unpinned row, `pairWidth === 0` and neither control is painted,
  and `titleWidth` is **196 / 236 / 276** at 240 / 280 / 320;
- at rest on a pinned row, the pin's box is 24 and PAINTED at **all three**
  widths (this is D1's fix, and 240 is the width that fails today), while the
  archive's box is 0;
- under the pointer, both controls are painted and `titleWidth` is **140 / 180 /
  220**;
- the row's `h-8` box and the title's `left` are identical at rest and under the
  pointer for the same row (nothing reflows but the clip);
- on the row whose title fits, the title's `scrollWidth === clientWidth` and its
  transform is `none` after the dwell has elapsed (the pan did not start);
- on the long row, the transform is non-zero after the dwell and equal to the
  overflow - clamped - once it has stopped;
- and for the offer, the toast's box is inside the panel's own box and its
  bottom is above the composer's form, which is the pair of numbers that says
  D12 is still met.

QA drives the same states through the same scene plus the real flows the spec
touches (hover-enter/leave, Tab into the acts, archive → Undo, a second archive
replacing the first, and the 240 pinned row), and the visual claims (the mask,
the pan's end, the fade's absence at rest) come from consecutive frames rather
than from a green test.

## 15. Not addressed

- The pin's own failure line (see D11) - the same class of in-panel line, left to
  the pin feature.
- Row height, the leading status slot's cost, and the archived marker's 14-18px
  indent on archived rows (`session-archive-delete.md` D4): unchanged.
- The rail's own width, and the chat column's padding: unchanged, and both are
  load-bearing constants in §10's proof.
- Any change to what a row's click does, to the pin's or the archive's semantics,
  or to the delete confirmation.
