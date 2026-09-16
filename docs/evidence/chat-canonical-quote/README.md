# The transcript's quote control, raised by a highlight

Eleven surfaces × twelve themes, Storybook, on the production transcript beside
the production composer, for the operator's three asks in his own words:

> 1. "The quote button should only show up when highlighting a section, not just
>    on hover, as it can look a bit out of place and confusing."
> 2. "The quote button should hover above the highlighted frame and not at the
>    edge of the whole message block so that from a UX perspective we properly
>    broadcast that you're only quoting the selected section."
> 3. "Make sure that when deselecting it also goes away, etc instead of sticking
>    around."

## The frames

```
sent-turn-quote/                       12   the transcript at rest, one sent quote painted
hover-no-highlight/                    12   the pointer ON the assistant turn, nothing highlighted
highlight-mid-turn/                    12   a sentence highlighted inside the assistant turn
highlight-hover/                       12   the same highlight, the pointer ON the control: its hover ground and tooltip
highlight-across-turns/                12   one highlight from the user turn into the answer
highlight-then-press/                  12   the press: the highlight staged, the control gone
highlight-dismissed/                   12   the highlight, then a click into the composer
keyboard-highlight-focused/            12   a keyboard-made highlight, the control focused
scrolled-to-oldest-turn/               12   the tall fixture at rest, for the pair below
selection-at-pane-top/                 12   a highlight ON the pane's top edge: the control flips below it
selection-at-pane-top-across-turns/    12   the same flip with the highlight LEAVING its turn
```

`highlight-hover/` and `selection-at-pane-top-across-turns/` are round-1
remediation (design D3, and the fix for review M1 / UX U9 / QA Q27): the
control's own hover and tooltip were in no frame anywhere in the set, and
neither was a flip whose anchor has to be the highlight's last line in the NEXT
turn. Both are measured rather than asserted - see the entry table's
`expectText`, `select.hover` and `select.tooltip` - and the second is the state
the defect lived in, so it is the frame the fix has to be judged on.

Each one is a claim about what the reader gets, so each one is checked before
the shutter. The rig throws - rather than filing a frame under a name that
claims something else - when the gesture produced no highlight, when the
highlight's endpoints are not in the elements the entry names, when the string
the gesture selected is not the one the entry names, when the arrow
walk changed the highlight by some other number of characters than it claims,
when a hover is claimed and the pointer is not on the element (or the tooltip
never opened), when a press left the highlight lit or the control painted, or
when a dismiss left a control the reader could still press.

## What moved, in pixels

The before half (`../chat-canonical-quote-before/`) is the same entries on the
unmodified `origin/main` tree, so every pair is measurable:

| pair | measurement |
| --- | --- |
| hovering a turn with nothing highlighted, after vs the resting frame | **0 differing pixels, both themes** - nothing is raised, and the frame is byte-identical to the transcript at rest |
| the same two frames on the before tree | **5,872** dark / **2,302** light differ - the strip the pointer used to raise |
| a sentence highlighted mid-turn, before vs after | **15,222** dark / **10,312** light - from the far right edge of the block to the highlight's own first line |
| a highlight across two turns, before vs after | **13,107** dark / **20,232** light - one control, at the turn the highlight begins in |
| a highlight on the pane's top edge, before vs after | **13,466** dark / **14,115** light - and after, the control has flipped below it |
| `sent-turn-quote` and `scrolled-to-oldest-turn`, before vs after | **0 differing pixels, both themes** - the resting surfaces did not move |
| `highlight-dismissed` after vs the resting frame | **0** in the dark theme. The light-theme pair differs by 17,410 pixels laid along the composer's own outline and the pane's rules, which the diff shows to be a one-pixel shift of the layout the DRAG left behind - the frames that involve a gesture carry the same residue (a highlighted frame differs by 66,358, the gesture-free `hover-no-highlight` by 0), so it belongs to the gesture and not to anything painted. In both frames the control and the highlight are gone |

## What produced these frames

Storybook driving the **production components** - `CanonicalTranscript` with the
production composer below it, and the production `conversation-input-store`
behind the press - captured over raw CDP by `scripts/capture-evidence.mjs`
(a private headless Chrome on a fresh `--user-data-dir`, killed on exit), one
narrowed run:

```sh
pnpm storybook --port 6403 --ci --no-open
node scripts/capture-evidence.mjs http://127.0.0.1:6403 \
  --only=chat-canonical-quote      # 12 themes x 9 entries = 108 frames
```

**These frames were RE-TAKEN after the fold onto `2d80b51f9` (the 0.25.13 window),
and that is why.** `main`'s `#238` moved the composer band that sits under every
frame of this set: the resting transcript frame differed by **18,454 pixels**
across the rebase with no quote code involved. The set was therefore re-taken on
the merged tree in four narrowed runs (three themes each, because the Storybook
dev server died twice mid-sweep on a loaded box) rather than carried across, and
the before half was re-taken with it so each pair still differs only in the three
files under repair. Every number in the table above is the merged tree's.

`--allow-backend` is stated because this machine has a backend answering on the
app's configured port, and the rig refuses to sweep while one does. These
stories reach it for nothing: the rows come from fixture records and the composer
is handed a static sentinel, so the frames are a function of the tree. Declaring
the flag is the honest option rather than a way round the guard.

**The gestures are real input, and that is the only way these frames can exist.**
The control is ABSENT from the DOM until a highlight exists, so no story can
place it and no `play` function can drive it - `userEvent` dispatches synthetic
pointer events, and a synthetic `mousedown` does not make the browser build a
selection. The rig's `select` option therefore drives the browser's own input
pipeline: `Input.dispatchMouseEvent` between the two points the range's own
client rects report (a real drag), a real click plus a real Shift+click for the
keyboard path, N real `Shift+ArrowLeft` presses to extend it, a real
`Input.dispatchKeyEvent` Tab walk to land focus on the control, a real click
elsewhere to dismiss, and a real press.

Two things that measurement forced, recorded here because both are properties of
the surface rather than of the harness:

- **Shift+ArrowLeft cannot make a highlight from a bare caret in a non-editable
  document.** A click leaves `rangeCount: 1` and an empty string, and 26
  Shift+ArrowLeft presses leave it empty - that is caret browsing (F7), a browser
  mode this app cannot turn on. What the arrows DO do is extend a highlight that
  exists (`keyboard-highlight-focused/` is 50 characters before the walk and 58
  after it, asserted by the rig), and what a keyboard reader can do from nothing
  is a caret plus Shift+click, which is what the frame shows.
- **A drag made at the pane's own top edge makes the browser autoscroll the pane
  under the pointer** - measured on this surface, 73px during a single drag,
  which moved the text under the release point and landed the highlight on the
  transcript's "Start of conversation" caption one row above the turn the entry
  names. That is why `selection-at-pane-top/` is highlighted where the pointer is
  safe and THEN scrolled, and why the rig asserts the highlight's endpoints: the
  order is the state, not a convenience.

## What the frames show, and what they cannot

`hover-no-highlight/` is the first ask as an absence: the pointer is on the
assistant turn (the rig moves it there with a real `mouseMoved`) and nothing is
raised. `highlight-mid-turn/` is the second: the control floats 8px above the
highlight's own first line, left-aligned with where the highlight begins,
because that is where the reader began. `highlight-across-turns/` is the
one-control rule: the highlight runs from the user turn's question into the
answer, and exactly ONE control is up, anchored at the turn the highlight begins
in. `selection-at-pane-top/` is the flip: the highlight's first line is at the
pane's top edge, so there is no room above and the control sits below the
highlight instead. `selection-at-pane-top-across-turns/` is the flip the round-1
defect lived in, and the reason it exists: the highlight begins in the user turn
and runs into the answer, so the flip's anchor has to be the highlight's LAST
line - which is in the next turn - rather than the owner turn's own end. Measured
before the fix, in that state: 40px of drift per re-measuring event while the
pointer was down and 43px per 3px of scroll, ending 128-210px below the highlight
and, in one trace, painted ON it. After: 8px of clearance on every event and 1:1
tracking with the scroll. `highlight-hover/` is the control under the pointer:
the colour step its hover takes, and the tooltip, which opens ABOVE the control
and so covers neither the highlight nor the line the control is anchored to.
`highlight-then-press/` and `highlight-dismissed/` are the
third ask on its two exits - a press that stages the highlight (the composer's
chip in the frame carries the highlighted sentence, not the turn) and a click
into the composer, after which nothing is left on screen.
`keyboard-highlight-focused/` is the pointer-free path: a keyboard-made
highlight, the control then reachable by a real Tab, wearing its focus ring.

What these frames CANNOT show:

- **A frame cannot show the absence of a tab stop.** That the control leaves the
  DOM with no highlight - rather than being hidden at `opacity-0`, which keeps
  its place in the tab order - is why the keyboard walk that UX round 1 (U4) and
  QA round 1 (Q5) recorded is gone. `scripts/message-quote.test.mjs` pins the
  rules, and the component's own render is the statement; no still carries it.
- **Colour, in the frames that show a highlight.** The selection paint is the
  BROWSER's, not the app's: `::selection` is drawn by Chromium and is not one of
  the twelve palettes. The control's own ground and hairline are the app's, and
  `pnpm check-themes` carries the structural pin on them
  (`STRUCTURAL_CALL_SITES`, "transcript quote toolkit floating shell").
- **The clamps, at their own edges.** The horizontal clamp cannot be photographed
  from these fixtures: `quote.stories.tsx`'s `Frame` is a fixed 1024 wide, so a
  narrower viewport crops the fixture rather than narrowing the pane, and the
  right wall is never reached (round 1, design D3; UX round 1 measured the same
  wall from the other side). The vertical clamp IS now reachable and is in
  `selection-at-pane-top-across-turns/` whenever the highlight's tail runs under
  the fold. Both are asserted as arithmetic in `scripts/message-quote.test.mjs`.
- **The pointer.** The rig leaves the pointer where the gesture ended, and
  Chromium does not draw a cursor in a captured frame. Where the control ended up
  relative to the transcript is a measurement (`quote-anchor.ts`, asserted in
  `scripts/message-quote.test.mjs`), not something a reader can count off the
  picture.
- **The gestures themselves.** One frame per state: this set shows where the
  control IS in each state, not that a fling of the pointer, a double-click or a
  drag that starts outside the transcript behave. The rules those hit are
  asserted as rules, and a QA round is where the gestures get driven end to end.

## The before half

`../chat-canonical-quote-before/` holds the same eight surfaces from the
unmodified `origin/main` tree, where the strip was revealed by the row's own
hover and pinned to the turn's top-right corner. Its README states what each
pair measures and why a sweep cannot re-derive it - including why its ninth
surface, `highlight-then-press`, is deliberately absent there: on that tree the
strip is still up after the press, and the harness refuses to photograph a state
it is not in.

`highlight-hover/` and `selection-at-pane-top-across-turns/` have no before
counterpart either, and the reason is the same shape: on that tree the control is
revealed by the row's hover rather than by a highlight, so "hovering the control"
is not a state it has, and a cross-turn highlight is answered by a pill at the
block's own corner - a different object in a different place, which the five
paired surfaces already show. A pair is only a claim when the two frames differ
in the thing under repair, and for these two states the before tree has no
version of the thing at all.
