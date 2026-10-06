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
**220..320**, default **260**) and not a function of the window. Contrast this with
`docs/evidence/session-archive/README.md`'s "the shipped 320px panel" - that
record corrected itself to 280, and 320 is a width the panel really can be put
at, so all three are photographed here.

The panel is `p-2` (8px), so on this document's ORIGINAL basis a 280px panel gives a
264px row - and the SHIPPED row box measures **248px** there, because the list carries an
inset of its own on top of the panel's (`panel - 32`, not `panel - 16`). Round 3's design
review (D12) is why both are named from here on: the `Row box` column in the table below is
the measured element and the columns beside it are on the original basis, so read the DELTA
down a column and never a number across the two. Inside the row:

```
row box   "flex h-8 items-center gap-1 rounded-md"          264   <- original basis; 248 measured
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

Identical in both palettes, and on the two bases this section now names (round 3, D12):
the `Row box` column is the MEASURED `[data-session-row]` element (`panel - 32`, the reading
`docs/evidence/pinned-reorder/measurements/` carries, and §3's basis), and every other column
is this document's original basis (`panel - 16`), so those columns read 16px wide against it.

| Panel | Row box (MEASURED) | Button | Title | Tail after the title | Pair | Pin | Archive | Shared trigger |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 240 (a below-default step) | 208 | 196 | **168** | 32 | `0x0` shipped shed | `0x0` | `0x0` | 24, unpainted |
| 280 (widened past the default) | 248 | 208 | **180** | 60 | 52 | 24, painted iff pinned | 24, unpainted | `0x0` |
| 320 | 288 | 248 | **220** | 60 | 52 | 24, painted iff pinned | 24, unpainted | `0x0` |

What that costs, at rest, inside the row (264px on this document's original basis, 248px on the measured one at a 280px panel):

| Row class | Painted in the trailing 60px | Paints nothing |
| --- | --- | --- |
| unpinned | - | **56px (21.2% of the original-basis row, 22.6% of the measured one)** |
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

The constants the whole scheme is an arithmetic over: a control box is **24px**; a
gap between controls, or between the button and the cluster, is **4px**; and the
row's own leading slot before the title is **24px** measured (`title.left − row.left`,
the reading the scene prints). The arithmetic below states that as 28 + the row's own
4px gap - the same 32px from the row's left edge to the title, split differently - so
**one control costs the title 28px** and **the pair costs it 56px**.

**THE STRIP AFTER THE CHEVRONS GO (2026-09-30).** The pinned row's revealed cluster is
`archive + mark` = **52px**, and the grip joins it - **80px** - only when at least two
pinned rows are SHOWN. The two arrow buttons `#693` added are deleted: their act moved
to the row's own menu, which is where WCAG 2.5.7 asks for a single-pointer path and
where the row's other two acts already live (§4 below, and
`docs/design/row-context-menu.md`).

| Row class | State | Title box at 240 | at 280 | at 320 | What is drawn to its right |
| --- | --- | --- | --- | --- | --- |
| **unpinned** | rest | **180** | **220** | **260** | nothing - unless the row carries a trailing statement, which takes its own width instead |
| **unpinned** | hover / focus-within | **124** | **164** | **204** | the archive, then the pin: **52** (24 + 4 + 24), and the 8px between the title's edge and the cluster |
| **pinned** | rest | **152** | **192** | **232** | the pin mark: **28** (24 + the row's 4px gap) |
| **pinned** | hover / focus-within | **124** | **164** | **204** | the archive, then the mark: **52** |
| **pinned** | hover, two or more pinned rows shown | **96** | **136** | **176** | the archive, the grip, then the mark: **80** (3 × 24 + 2 × 4) |
| **current** | rest | as its class | as its class | as its class | as its class; the ground stays `rowSelected` |
| **current** | hover / focus-within | as its class | as its class | as its class | both acts reveal; the hover ground is still dropped |
| any | narrow (panel <= 278) | - | - | - | **the same rule as every other width** (D9): the grip is no longer shed anywhere |

**THE MEASUREMENTS BEHIND THE TABLE, from the scene's own run at this change's head**
(`docs/evidence/sidebar-row-space/after/`, and
`row-space-geometry-localOperatorDark.json` in the same tree), on a row box of
**208 / 248 / 288px** at the 240 / 280 / 320 panel settings:

- **the hovered column reads exactly the arithmetic, at every width**: the unpinned
  long row and the pinned row both measure **124 / 164 / 204**. That is §3's AFTER
  column, and it is the number this change is answerable for.
- **the cluster is 52** (`archive` 168..192, `mark` 196..220 on a 208 row) - six
  controls' worth of row given back, and the title's leading edge is 24 from the row's
  left in BOTH states, so what moves is the clip's right edge and nothing else.
- **at rest the fixture's own rows read 146.4 / 186.4 / 226.4** (unpinned) and
  **118.4 / 158.4 / 198.4** (pinned), each **33.6px below the arithmetic** - the
  trailing statement (`56y, last active 56 years ago`) the fixture's rows carry and a
  hovered row does not. The rest column above is the arithmetic rather than those
  readings, deliberately: the statement's width is the fixture's, not the design's.

What the change buys on the row the operator's report is about, read against what
shipped before it: at 240 the pinned row's title under the pointer goes **68 -> 124**
where the grip is not drawn (+56, the arrow pair's own cost) and **68 -> 96** where it
is (+28), and the move is still reachable - from the row's menu and from `⌘⇧↑/↓` -
with no resting cost on the row. On an unpinned row nothing changes at rest and the
hovered title gains nothing: the pair it reveals was already 52.

**THE GRIP'S OWN COST (issue #697, measured, unchanged).** The handle is **28px** -
its 24px box plus the cluster's 4px gap - and it is drawn at **every width**, when at
least two pinned rows are shown. What changed on 2026-09-30 is the last clause: the
shed that used to hide it at or below a 278px panel is DELETED (§8), because the two
controls that made the clamp crowded are gone. The 240 hover now has **96px** of title
with the grip drawn, against the **40px** the five-control cluster left - measured, not
derived.

**Which control is drawn FIRST in the pair is part of the design, and the code
orders the ARCHIVE first** (design round 2, folded here as D12; the sentence this
paragraph replaces said "pin, then archive" and never recorded the decision). A
pinned row's mark must keep the row's RIGHT EDGE: it is the state that has to read
without hovering, so it must sit where the eye already is and where the pointer
leaves the row last, and the control revealed by the pointer - the archive - takes
the inner position beside it. Reversing the two puts the revealed, destructive act
on the edge the mark owns, which is the U6 hazard in one line: the box a reader
aims at for the state becomes the box that archives the conversation.

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

**THE SAME READING ON THIS CHANGE'S OWN ROW BOX (2026-09-30): 248 -> 192 at the
280 panel, a 22.6% reduction** - the paragraph above is on the document's earlier
224-based basis, and the shipped row measures 248 at the same panel, so the DELTA
(56, one pair) is the number that travels and the absolutes do not. Per slot: on an
unpinned row the pointer reveals the archive and the pin (56); on a PINNED row the
mark is already paid for, so only the archive arrives (28). The pair on a pinned row
is `archive + mark` = 52 where no grip is drawn, and 80 where two or more pinned rows
are shown - the cluster the deleted arrow buttons used to make 108/136.

**D3 - at rest the acts are ABSENT FROM THE LAYOUT, not transparent in it.** The
`display` switch replaces the opacity pairing on these two controls:

- the pair wrapper (`data-session-control-pair`) keeps `flex items-center gap-1`
  and gains `hidden group-data-[session-hover-intent]:flex group-has-[:focus-visible]:flex`
  **while the row is unpinned**; on a pinned row the wrapper is always `flex`,
  because the mark inside it is the state;
- the archive control gains
  `hidden group-data-[session-hover-intent]:flex group-has-[:focus-visible]:flex`
  unconditionally, and the pin control gains it while the row is unpinned; the
  grip, which has no focus term by design, gains the pointer half alone;
- **the pointer's half is a DWELL, and the keyboard's is not (2026-10-06, issue
  #840).** `group-hover` was the first frame the pointer was on the row; it is
  now `group-data-[session-hover-intent]`, an attribute written by the row's own
  mounted gate (`chat-row-hover-intent.tsx`) only after the app's
  `HOVER_INTENT_MS` (200ms) has elapsed, and cleared on `pointerleave` so a
  re-entering pointer waits a fresh interval. The constant is imported from the
  panel divider rather than restated - it is the one the panel's divider and the
  chat's measure handle already reveal on (the sidebar's collapse cluster used to
  be named here as a third; it is no longer drawn, agent review round 1's M1) -
  and it is deliberately
  NOT the pan's `TOOLTIP_DELAY_MS` (400ms): the order between the two is
  load-bearing, because the pan measures the HOVERED box and so must run after
  the acts have taken their 56px. The keyboard's door is
  `group-has-[:focus-visible]` and stays immediate - keyboard-only by the
  browser's own definition of it, which is a CORRECTION rather than a
  refinement: the bare `group-focus-within` it replaced is raised for a
  mouse-driven focus too, so a press inside the trailing band focused the row's
  button, the acts arrived inside the gesture and the click that followed was
  retargeted to the row's wrapper and lost - the press neither pressed a control
  nor selected the row (QA round 1's Q-1, UX's U1; measured on the head before
  the fix, both palettes: `location.hash` unchanged, `btn 12..260` -> `208..260`
  mid-gesture, control 40px further left selects). A Tab into the row's button
  still reveals the acts with no pointer on the row. The trailing time gives way
  on the same clock as the acts - it
  is the other half of one swap - so it is gated on the same attribute;
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
property survives without it: `group-has-[:focus-visible]` fires when a KEYBOARD
focus is anywhere inside the row, and the row's button is the first thing Tab
reaches there, so the
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

### Deleted again (2026-09-30): the shed goes with the arrows

Round 1 reinstated ONE width query for the grip alone, and that reasoning was sound on its
premise: with the five-control cluster revealed at the 240 clamp the title had **40px** of the
row's 208, and the grip is the only member of that cluster which is an ACCELERATOR rather
than a path - the pair was WCAG 2.5.7's single-pointer alternative to the drag, the grip is a
faster way to do what the pair already did - so shedding it bought the pair's own cost back
and the title read **68px**.

**THE PREMISE IS GONE WITH THE ARROW PAIR §3 DELETES.** The two controls that made the clamp
crowded are no longer drawn; the move is offered by the row's own menu and by `⌘⇧↑/↓`. So the
arithmetic that justified the query no longer holds, and it is measured on this change's head
rather than reasoned: at 240 the revealed cluster is **52px** where no grip is drawn -
**124px** of title, against the 68px the shed existed to protect - and **80px** where the grip
is drawn, which leaves **96px**. BOTH are above the number the shed was buying, so the query
has nothing left to protect and the grip is drawn at **every width**.

So `@max-[263px]/chatsidebar:hidden!` is deleted, **and the `@container/chatsidebar`
declaration on the panel root goes with it**: the container name was declared to give that one
class a query to live in, so a named container with no reader is a name the panel carries for
the next reader to check before using. Verified before deleting - the only remaining mentions
of either spelling in `src/` and `scripts/` are the comments recording this removal, and
`scripts/sidebar-pin-order.test.mjs`'s D3/D5/D6 block asserts the negative from now on (the
class is gone, no width break has reappeared on the container query, and the grip is drawn at
every width).

**The width this leaves the drag at, restated, because round 1's product consequence is now
retired with it:** the handle is drawn at every width, so the **260** default carries it -
the state round 1 could not draw - and the drag is no longer a width-gated accelerator.
`docs/evidence/pinned-reorder/grip-hover-260` is re-shot for exactly that reason: on the
round-1 tree it photographed the grip ABSENT at the default width, and on this head it
photographs it drawn.

The grip is still drawn only when **at least two pinned rows are shown** (design D3, whose
premise held up: measured, a one-row drag can be started, always lands on slot 0 and writes
nothing), and it is `aria-hidden` because it is pointer-only (agent review R5). It is still
the accelerator rather than the path, and the path is now the MENU rather than the pair -
which is why the boundary sentence lives on the menu's own Move items (they stay drawn and
actionable, carrying `aria-disabled`, and pressing one answers with `pinMoveBoundaryNote`).

### Round 2 (PR #697, design D7 + UX U6, agent N1): the held row is marked by a ring, not a fill

**THE HELD ROW'S CUE MOVED OFF THE TWO FILLS THE LADDER HAS.** A held row that is ALSO the
current one used to take the `rowHover` ground, and that is the exact fill the row under the
pointer wears: the two are on screen together for the whole gesture (row boxes are contiguous,
so a drag pointer is always over some row), and the held row also LOST the `rowSelected` fill
that says "this is the conversation you are in". Measured in both palettes: held current
`rgb(48,45,41)` dark / `rgb(237,236,231)` light - the hover role - against the drop target's own
hover ground, one reading for two rows.

The held state is now carried by a **1px inset outline** off `[data-dragging]`
(`outline outline-1 outline-offset-[-1px] outline-ink-dim`) and the fill underneath is the row's
own role, unchanged: the drag's `rowSelected` step. A held row is therefore distinct from a
merely hovered one in both row states, and "you are here" survives the gesture. Inset by 1px, so
there is no layout shift and nothing hangs outside the row's own rounded box; a role rather than
a hex, so both palettes resolve it from one declaration (`ink-dim` is the role the panel's own
rounded-row ring reads - `#a6a091` dark, `#656056` light).

**WHY IT IS AN OUTLINE AND NOT AN INSET `ring-1` (round 3, design D10).** The first spelling was
a box-shadow, and a box-shadow is painted UNDER the element's children: the CURRENT row's own
button carries `rowCurrent`'s opaque `bg-row-selected`, so it erased the mark everywhere it
reached. An outline paints after the element's descendants, so the button cannot cover it, and the
`-1px` offset keeps it inside the box.

**THE ONE SET OF COVERAGE NUMBERS (design round 4, D13 - every place that quotes them quotes
these).** The measurement is the ink within ±6 per channel of the mark's colour, inside the
outermost 3 device px of the held row's box (device x24-519, y1123-1186 on these frames): a
**complete outline** on a held row that is NOT current reads **60.2%** of that band (the 66%/55%
per-edge figures are below 100% because the band includes the rounded corners), the held CURRENT
row read **5.3%** before this fix - a fragment along the right-hand slot, which is exactly the
state round 2's D7 was filed about - and reads **32.1%** after it, in both palettes. The 32.1% is
three of the row's four edges: the top edge is where the drop indicator sits, so it is the
insertion line's, not the mark's.

**AND THE GRIP REVEALS ON HOVER ONLY (agent review round 2, N1).** It is `aria-hidden` and
`tabIndex={-1}`, so a `group-focus-within` term was showing a sighted keyboard reader a handle
they can neither focus nor operate - the two decisions pointed opposite ways and the reveal
yields. The PAIR keeps its own focus-within term: the chords press it, and it is the 2.5.7
single-pointer path.

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

## 10. The archive offer becomes a sidebar-lane toast (D11 - superseded 2026-09-27; see the end of this section)

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
- **How it is placed, concretely - and it is a BAND now, not an overlay** (design round 4,
  D14; the ruling that settled Q-2 with measurement). A second `ThemedToastContainer` is
  mounted by the chat sidebar's panel root as the panel flex column's LAST CHILD (the global
  one in `main.tsx` keeps every other toast exactly where it is), and the app wraps it in a
  band whose inline box is `position: relative; width: 100%; flex-shrink: 0; overflow: hidden;
  max-height: calc(100% - 56px)` with `height: 0` at rest and `card height + 8` while a message
  stands - measured from the drawn card, because the offer is one line at every width and the
  refusal is not. The container's own `position` is `static` (an inline value, the same
  mechanism `themed-toast-container.tsx` already relies on for colour, since sonner's
  stylesheet cannot beat an inline one). THE `position` ARGUMENT IS NOT WHAT CONTAINS IT, and
  this paragraph used to say that it was: sonner 2.0.3 draws every mounted container's copy of
  every toast (the reading is recorded in `styles/index.css` beside the two rules that narrow
  it), so what confines the message to the panel is the app's own rule - the marker class these
  two messages carry, scoped to `nav[aria-label="Chats"]`. The offer is
  `toast.info(..., { position: "bottom-left" })` so nothing else changes, not because the
  argument routes it.
- **Why the band replaced the overlay - the trade, recorded as the designer stated it.** As an
  absolutely positioned container the card was drawn OVER the list, and that single fact was
  the subject of four independent findings: the covered-row scan (Q-1 and three review streams
  on one selector), QA's press loop finding no conversation archivable from a row for the
  card's whole life (Q-2), and D11. The designer settled it with measurement rather than taste:
  the acts column is the row's last 52px (392..444 at 240, 432..484 at 280, 472..524 at 320)
  and the card's right edge is 8px beyond the row's, so the column sits wholly inside the
  card's span - a left-anchored card would need width <= 148/188/228 to clear it, a
  right-anchored one <= 8px, and the card's own ink floor is 208. **A control under a card
  cannot be aimed at, whatever the card does with presses** - so the card takes its own height
  out of the column instead, and the ROWS DO NOT MOVE: the band's height is spent by the column's
  BOTTOM-MOST region - the one immediately above the band, whose top edge is the only edge that
  moves - which in the measured assembly is the chats list, forced to a definite box of its
  band-0 height less the band, so it goes BELOW its content and what the band hides is the
  overflow at its bottom (an empty tail in a short list, the formerly-hidden bottom rows when it
  overflows), with `scrollTop` never written and the region above it keeping its box to the
  pixel. In the other order that bottom-most region is already the `flex-1` one and it yields by
  itself, which is why the rule names the region and not the list. There is no transition on the band, because a
  band that animated would move rows under the reader's pointer. The price the designer
  accepts and this document records: **58px of list viewport for the offer's eight seconds, or
  the refusal's height plus eight for its ten**, spent at the moment the list is already
  rearranging - against a wrong write or a dead control on every archive made while a message
  stands. The `pointer-events` rules stay (they now buy only the wheel: a wheel over the card
  reaches the list behind it, while the action and the close keep taking their presses), and
  the two things they were written for - Q-1, Q-2 - lose their subject to the geometry.
- **Width:** the band's toasts are capped to the band's content box
  (`--width: min(248px, 100%)` on the card), so a long title wraps instead of running
  out of the column, which is also what keeps the disjointness above true.
  **AND THE CARD'S OWN WIDTH IS CAPPED TO THAT LANE, not set to a literal** (design
  round 3, D10, fixed 2026-09-22): the card's rule carried `--width: 248px` - the
  lane's width at the 280 panel - while the lane itself is
  `min(264px, 100% - 32px)` of the panel, so at the 240 clamp minimum the lane is
  208 and the card was 40px wider than its own lane and about 32px past the
  sidebar's right edge with nothing clipping it. It is `min(248px, 100%)` now: the
  same card wherever the lane is wide enough, never wider than the lane. THE CAP
  THE PARAGRAPH PROMISED WAS EFFECTIVELY DROPPED FOR THESE CARDS by that literal,
  which is why the fix is on the card rather than on the lane.
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
  is stated rather than left to be discovered - **216x170 over eight wrapped lines
  at the 280 panel**, covering four rows and two section headers, and that is the
  trade this design takes: a refusal that is readable beats a smaller one that is
  not. The larger figures this paragraph used to carry (216x206, nine lines) are the
  LONG-title case, measured on the operator's own 55-character conversation name;
  the default title wraps to eight (design round 3, D8: the two were quoted as one).
  **Also recorded rather than fixed** (design round 3, D9): the row's flyout starts
  2px inside the panel's own content box - the anchor clears the acts, which is what
  § 6 requires of it, and the 2px is the panel's border - so it is stated here as a
  measurement of the shipped geometry rather than churned for two pixels.
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

### Superseded, 2026-09-27: the lane is deleted; the messages are ordinary sonner toasts again

The operator: "Can you fix the local-operator-ui chat sidebar notifications,
instead of having a separate sidebar notification, we should probably just use
the normal sonner toast. These don't properly show up and look janky" - with a
screenshot of the in-sidebar card reading «Draft discarded. [Undo] ×».

**What is deleted.** The whole lane: the band wrapper and its height
(`ARCHIVE_TOAST_BAND_GAP`/`ARCHIVE_OFFER_BAND_HEIGHT`/`ARCHIVE_TOAST_BAND_STYLE`),
the second `ThemedToastContainer` and its inline position/style, the
`lo-archive-toast` marker class and the confinement block in
`styles/index.css`, the band-height observers and the list's yield
(`listYield`), the wheel forwarding, the app-armed clocks
(`ARCHIVE_TOAST_PERSISTENT` plus the 8s/10s dismiss effects), and
`ARCHIVE_UNDO_CEILING_MS`/`DRAFTS_UNDO_CEILING_MS` with them.

**What replaces it.** `<UndoToasts />` in `src/renderer/src/main.tsx`, mounted
beside the app's ONE container for the app's whole life: the archive offer and
its refusal, and the draft-discard offer, are raised by the app's ordinary
`showInfoToast`/`showWarningToast`/`dismissToast` into the bottom-right
container, at sonner's standard width, with the icon, the close button,
hover-pause restored, and their lifetimes as sonner's own `duration` (offer 8s,
refusal 10s). The bottom-right position is what D12 measured as an obstacle and
the operator has now re-accepted: the flag this section raised against it - "a
toast confined to the sidebar's column cannot touch Send" - is no longer a
constraint anyone is holding, and the live geometry of the overlap is recorded
with the frames under `docs/evidence/undo-toasts-lane-retired/`. Because the
raise lives on an always-mounted surface rather than in the panel, the failure
class the operator named ("these don't properly show up") goes with it: the
panel is the expanded half of the sidebar column and the acts that raise the
messages are reachable while it is not mounted (the chat pane's header menu, a
typed `/archive`, the composer's own Clear all).

**What survives, stated because it is the load-bearing part.** The archive offer
and its refusal keep ONE stable id (`ARCHIVE_TOAST_ID`) so an answer REPLACES
the message it answers in place rather than stacking; the store still raises the
offer in the update that settles the archive write (D27); the retirement rule is
still `undoOfferStands`'s, watched by `useArchiveUndoRetirement` while the
surface carries the offer, and the unanswered-fact guard is kept; action presses
still `preventDefault()`, still send the desired state, and still settle only on
their own answer; the drafts offer keeps "N key snapshot + Undo restores the
store AND the pane" (the staged key moved from a panel ref to the store's
`stagedByDiscard`, because the press now lives one surface over).

**One decision this section makes rather than inherits:** the draft-discard
offer gets its own id (`DRAFTS_UNDO_TOAST_ID = "drafts-undo"`). The single id
existed to fit one lane holding one message; ordinary toasts stack, a discard is
not an archive, and cross-feature replacement would be a lie about the newer
message. The store's single slot still means a second discard replaces the
first, and each offer retires on its own terms.

**Consequences to the record and the rigs.** The `session-archive` and
`row-space` driver scenes now assert the new placement (one container, bottom-
right, outside the panel, no band element anywhere) and that a standing message
reserves no space (every row's top, both scrollTops and the list's own box are
byte-equal to the message-free reading); the old band-yield assertions and the
covered-rows loop's expectation are superseded, and the Drafts/drafts-ack
evidence sets' lane-era frames are marked as such in their READMEs.

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
| The controls are `size-6 shrink-0` "so the reserved slot cannot reflow the row"; the reveal is "`opacity` and `pointer-events` only, so the reveal cannot reflow the row" | **Replaced (D3).** There is no reserved slot. The row's box, its height and the title's leading edge still never move; what moves is the title's clip, by 52px (28 on a pinned row), at the only moment the controls exist. The invariant the old rule protected - nothing shifts under the pointer that the pointer is aiming at - survives where it matters, and is now STRONGER than this row could claim when it was written: the controls do not move when they appear, and they appear only after the pointer has DWELLED on the row for the app's hover-intent constant (200ms, `HOVER_INTENT_MS`; issue #840, 2026-10-06), so a press on its way to selecting a row never meets a control that has just arrived. The keyboard path stays immediate (`group-has-[:focus-visible]`, its door on how the focus ARRIVED rather than on focus alone - agent review round 1's Q-1). |
| "A hidden control is inert" (`opacity: 0` + `pointer-events-none`) | **Strengthened (D3).** `display: none` cannot receive a press at all, so this stops being a rule to remember. The opacity/pointer-events pairing comes off these controls. |
| "The pin's state must read WITHOUT hovering" (a pinned row's glyph is filled `text-ink`) | **Kept, and now true at every width (D4).** Measured broken at 240 today (D1). |
| "Nothing lifts, scales or translates on hover" (`branding.md` § 5) | **Extended by the operator's own instruction, and bounded.** The pan translates the title's *text* by up to the overflow, one way, after a dwell, stopping at the end; the row, its controls, its box and its ground do not translate, lift or scale. The one property that moves is `transform`, which § 5 admits "for entrances" - this is a marquee rather than an entrance, and it is stated here as the deliberate exception, with reduced motion as its off switch. |
| The narrow band swaps the pair for one shared 24px menu "because the pair's cost is not payable at the clamp minimum" (`ROW_CONTROLS_PAIR_SHED`, D15, D10) | **Deleted (D9).** The cost it guarded was a rest cost and there is no rest cost. |
| The archive offer is a panel register, not a toast (D12) | **Replaced (D11)**, with both of D12's constraints met structurally rather than by a numeric offset. **Then superseded again (2026-09-27):** the lane D11 chose is deleted at the operator's request and the messages are ordinary bottom-right sonner toasts; see §10's supersession entry for what survives and why the D12 overlap is now an accepted trade. |
| The row's `title` attribute carries the pointer's copy of the row's facts | **Replaced (D7)** by the app's own tooltip, carrying the same content, so there is one pointer surface rather than two. |

## 13. What the coder must also touch

**THIS CHANGE (2026-09-30) - the pinned strip's de-crowding, and the checks it moves:**

- `src/renderer/src/features/chat/chat-pin-order.ts`: `CHAT_PIN_MOVE_ATTR`,
  `chatPinMoveControl` and `chatPinMoveAttr` are deleted with the two arrow buttons.
  `chatPinMoveChord` (the chords), `chatPinMoveCap` (the hint the menu items draw),
  `canMovePinnedRow`, `movePinnedOrder`/`-To`, `pinDragSlot` and the live-region
  announcements all stay - the move is unchanged, only the door the pointer uses.
- `src/renderer/src/features/chat/components/chat-sidebar.tsx`: the two arrow buttons go,
  the grip stops shedding (one class plus the panel root's `@container/chatsidebar`),
  and the row's context menu gains `Move conversation up` / `down` with `aria-disabled`
  at a boundary. The chord is re-pointed at the same single write path the items call.
- **The tests that assert the old shape**, each read BEFORE editing and re-pointed rather
  than deleted: `sidebar-pin-order.test.mjs` (the chord used to press a control; the
  keyboard census drops by two), `chat-sidebar-selection.test.mjs` (the hover-half count),
  `chat-keyboard-regions.test.mjs` (the tabIndex census 7 -> 5),
  `chat-sidebar-row-menu.test.mjs` (the copy/order list gains two items, and the
  "nothing in this menu is `disabled`" rule gains its one deliberate exception),
  `chat-sidebar-archive.test.mjs` (the row's press now stages a dialog),
  `chat-sidebar-pins.test.mjs`, `session-archive-delete.test.mjs`,
  `chat-archive-press.test.mjs`.
- `scripts/renderer-driver.mjs`: every archive press in the scenes is answered at the
  confirmation, the `row-space` scene's stale width and acts expectations are re-derived
  from the row the run measured, and its keyboard walk is re-pointed at `⌘⇧P` (the Tab
  stop it used to walk is gone by design).

**ROUND 1 (2026-09-30, PR #697) - the reservation removal, kept because the files below are
still the ones a later change to this row will touch:**

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
# The renderer's backend URL is INLINED at build time and the driver refuses a mismatch,
# so the build and the stub must name the same port. `<scratch>` is this session's own
# scratch directory (`$LOCAL_OPERATOR_SCRATCHPAD`), never `/tmp`: that tree is shared across
# every session on this machine and files in it get clobbered mid-run.
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18234 pnpm build
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs \
  --port 18234 --records <scratch>/row-space-stub-records
LOCAL_OPERATOR_DESKTOP_TOKEN=[redacted] node scripts/renderer-driver.mjs \
  --scene row-space --backend http://127.0.0.1:18234 \
  --backend-records <scratch>/row-space-stub-records --seed-onboarding-complete \
  --theme localOperatorDark --out <scratch>/row-space-dark --window-size 1380x900 --clean
# …then --theme localOperatorLight --out <scratch>/row-space-light
```

**The archive scene needs ITS OWN harness** (`docs/evidence/session-archive/harness/`), not
this set's: the two fixtures differ in a way the refusal steps depend on - the archive set's
row carries `live_claim: true`, which is what makes the daemon answer 409 to that row's
archive and delete, and this set's stub has no such flag at all. A run of `--scene
session-archive` against the row-space stub boots, draws and then fails on the first
refusal, which reads as an app defect and is not one.


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
  and the title's leading edge is **24px** from the row's left (the leading slot
  the row always pays) while the button keeps the row's whole width - the title's
  own REST length is not a constant, because a row that draws a trailing statement
  spends part of its box on that instead;
- at rest on a pinned row, the pin's box is 24 and PAINTED at **all three**
  widths (this is D1's fix, and 240 is the width that fails today), it takes
  exactly **28px** off the button, and the archive's box is 0;
- under the pointer, both controls are painted and `titleWidth` is **124 / 164 /
  204** - the §3 AFTER column, which is the number this change is answerable for;
- the acts' own cost is read on the BUTTON, not on the title: the row's button
  gives up **56px** on an unpinned row and **28** on a pinned one, at every width
  (a title-based reading is polluted by the trailing statement, and measured
  `22.4 / -5.6` on this fixture before the instrument was corrected);
- the flyout clears the row's own acts: **`flyout.left >= row.right + 4`**, the
  bound the consult spec set (T3). Measured on this head: **+6 at every width** - the
  card is anchored to the row's box, which does not shrink when the acts reveal - so
  the bound is met rather than newly enforced, and it is PINNED here so a later move
  of that anchor fails a check instead of shipping;
- the pan is serialised behind the reveal (T2), read rather than argued: a pointer
  that crosses the row inside the dwell leaves **no transform and no mask**
  (`pan-swept-280`), and the reveal itself is a display switch with no transition -
  so there is no frame in which text moves while the cluster is arriving;
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

- **T1 - deferring the grip to the trailing band, or to a dwell: the DWELL IS ADOPTED
  (2026-10-06, issue #840); the trailing band stays DEFERRED.** The stretch item from
  the consult spec, and the entry this document reserved a revisit for. Its revisit
  trigger fired: a report that the acts get hit while a reader is selecting a row, which
  is exactly the hazard the deferral's own reasoning named and could not price. So the
  dwell is no longer a proposal - the row's pointer half reveals on the app's existing
  `HOVER_INTENT_MS` (200ms, the panel divider's constant, not a new number), written as
  an attribute by the row's mounted gate and cleared on leave, with the keyboard's
  door moved to `group-has-[:focus-visible]` - keyboard-only by the browser's own
  definition, because the bare `group-focus-within` let a mouse-driven focus raise the
  acts inside a press and swallow the click (agent review round 1's Q-1). What the
  deferral got WRONG was its parting claim: "a
  CSS-only version cannot express 'after the pointer has dwelt here', and the JavaScript
  version is per-row pointer state" reads as two dead ends, and the second is only a
  dead end inside `sessionRow` - a plain render function, where a hook would run a
  different number of times per render. It is a MOUNTED COMPONENT instead, the shape
  `chat-row-title.tsx` already uses for the pan's own per-row listeners, so the state
  lives where per-row state can live and the reveal stays CSS (the component writes one
  attribute; Tailwind's `group-data-[session-hover-intent]` variant reads it).

  The BAND half stays deferred, unchanged and for the reasons below. The crowded state it
  was written about is
  gone, but the honest baseline is what a reader with two or more pinned rows gets, not the
  40px the five-control cluster once left. The grip is drawn at every width when two or more
  pinned rows are shown, so the title under the pointer reads **116px at the 260 default and
  96px at 240** (measured: `pinned-reorder/README.md`'s three-pin table; the 124 / 164 / 204
  readings are the single-pin case, where there is no grip and the cluster is 52px). A band
  for the grip would give back **28px - about 29% of a 96px title, and 24% of a 116px one**,
  which is not a marginal amount, and the case for it is real. What it costs is a second place
  for the same handle to live (a trailing-band variant the drag and the flyout both have to
  know about). The reveal is still a single step, the cluster's arrival
  cost fell 108 -> 80 at 260 and 136 -> 80 at 280 and above, and the operator's complaint (the
  pop-out) is answered by the dwell above at every width.

  **REVISIT WHEN**: a title reading under about **100px at the default width** (260) with two
  or more pins, or under about **80px at the 220 floor** (`grip-hover-220` is the reading), or
  a report that the grip is still hit by accident in the trailing band. Until then the next
  step stays what it was: a band for the grip ALONE (one control, one more position), not a
  redesign of the reveal.

  **THE 220 TRIGGER FIRED, AND DESIGN ROUND 2 RULED: KEEP THE DEFERRAL (measured 2026-10-01;
  adjudicated in design round 2, D8).** The reading is in (`pinned-reorder/grip-hover-220`, both
  palettes, scene 56 PASS / 0 FAIL): at the 220 floor with two or more pinned rows the title under
  the pointer measures **76px** (a 188px row; 106px at rest), under the "about 80px at the 220
  floor" this section named, and equal to the prediction `188 - 4 - 80 - 28` to the pixel. At the
  default (260) the same reading is 116px, so only the 220 trigger fired. The trigger was not edited
  to avoid that; the design round answered it, and the reasons are written here so a fired trigger
  is not a silently ignored one:
  1. **A band that exists only at narrow widths moves the handle.** If the grip lived in the
     trailing band at 220 and in the cluster at 240 and up, a reader dragging the panel edge would
     watch the grip change place mid-resize, which is worse than 28px of title at the floor. The
     only consistent band is one drawn at EVERY width, and that is the second home for the same
     handle this section already prices.
  2. **The title under the pointer is not the reading surface.** The reader is acting on the row;
     the flyout gives the whole title after its dwell and clears the acts (T3). 76px is about 12
     characters at the measured 6.31px per character.
  3. **220 is reached by a deliberate drag to the clamp's end**, and the pop-out complaint is
     already improved there (arrival cost 80, one step).

  **The spec, if a report ever triggers it**: the band applies at ALL widths (never a narrow-only
  variant), gives back 28px at each (the title under the pointer reads 104 at 220, 124 at 240 and
  144 at 260 with two or more pins), and nothing else about the reveal changes. **Re-arm on a
  REPORT, not on the arithmetic alone**: the grip hit by accident in the band, or a pinned title a
  reader cannot identify at 220. The number was already true and already weighed, so it is not
  itself the trigger any more.

  **Frame limit, stated (design round 2, D9).** `grip-hover-220` uses the fixture's eight-character
  titles (`Chat 005`), so 76px looks roomy in it; the call rests on the verified arithmetic, not on
  a frame of a long title clipped at 220. A 220 frame with a realistic long pinned title was not
  taken in this round. The connection-error card behind the `archive-confirm-settings` dialog is
  fixture noise of the same class as the earlier stub banners (D13), not a state of the product.
- **T3 and T2 are NOT deferred - they are met, and their readings are pinned in §14.** T3's
  bound (`flyout.left >= row.right + 4`) measures **+6 at every width** on this head, because
  the card is anchored to the row's BOX, which does not shrink when the acts reveal; the
  consult spec's 226/266/306 reading IS that +6, so there was no change to make. T2's claim
  (no text moves while the cluster arrives) holds because the reveal is a display switch -
  measured: no transform and no mask for a pointer that crosses inside the dwell.
- The pin's own failure line (see D11) - the same class of in-panel line, left to
  the pin feature.
- Row height, the leading status slot's cost, and the archived marker's 14-18px
  indent on archived rows (`session-archive-delete.md` D4): unchanged.
- The rail's own width, and the chat column's padding: unchanged, and both are
  load-bearing constants in §10's proof.
- Any change to what a row's click does, to the pin's or the archive's semantics,
  or to the delete confirmation - the archive's own confirmation is
  `session-archive-delete.md`'s, and this document only records that the row's control
  now ASKS (the five doors are listed there).
