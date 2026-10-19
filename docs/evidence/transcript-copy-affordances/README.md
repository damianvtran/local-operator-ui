# Transcript copy affordances

Evidence for the fix that removed the reserved action line under every settled
response and replaced it with overlays: a trailing gutter control on message
rows, a right-click menu on every transcript line, and the shared selection
toolbar on the transcript column.

## The defect, measured on `main` (`bf24fa9e54`)

Story: `chat-canonical-message-actions--multi-answer` (1024 x 560 story frame,
2560 x 1440 capture).

| Surface | Before |
| --- | --- |
| Intermediate answer row height | **54.4px** — prose 22.4 + `mt-1` 4 + the 28px `h-8` action row |
| Next record's start below the invisible toolbar | **12px** (`GAP.item`) |
| Visible prose-to-next-block gap | **44–66px**, against the 12px step the rhythm asks for |
| Cost of the invisible row | 32px per settled response (28px row + 4px margin), present at rest and while shown |

The before frame is [`before-multi-answer.png`](./before-multi-answer.png).

## The after shape

The action row under an intermediate response is gone; the closing answer keeps
its footer-line actions, which already existed. Every message-level row gets an
**absolutely positioned** gutter control instead, and the selection/menu surfaces
are overlays.

| Surface | After | Mechanism |
| --- | --- | --- |
| Intermediate answer row height | **22.4px** — its prose height, no toolbar | `AnswerActionRow overlay` (`absolute`), zero flow height |
| Prose-to-next-block gap | **12px** (`GAP.item`) | no reserved line between the prose and the next record |
| Saved vertical space | **32px** per settled response | 4px margin + 28px row no longer in flow |
| User row control | **0px layout**, in the 32px turn boundary above the bubble | `overlay` + `-top-8`, revealed by the focusable row's `group` |
| Selection toolbar | **0px layout** | one absolute strip per highlight: `QuoteToolkit` (Copy + Quote + Speak) on a quotable turn, shared `TextSelectionControls` (Copy + Speak) elsewhere; the outer gutter wins when it fits, otherwise the strip flips above the first line or below the last |
| Context menu | **0px layout** | Radix portal; mounted only while open |
| Focus indicator | ring around the **message block** | row wrapper draws no ring (`focus-visible:outline-none`); the bubble/answer box draws the 2px accent ring |

### Rendered-frame index

All after frames were captured from the branch head in the running Storybook
(a fresh instance; 6006 for the round-2 re-captures), through the production `CanonicalTranscript`; the
menu, selection and focus states are driven by the stories' own play steps
(real `contextmenu`, focus and selection events), not by a CSS class.

| Frame | Story | What it shows |
| --- | --- | --- |
| [`before-multi-answer.png`](./before-multi-answer.png) | `chat-canonical-message-actions--multi-answer` (main `bf24fa9e54`) | The invisible 28px row under the intermediate answer; the 44-66px prose-to-next-block gap |
| [`after-multi-answer.png`](./after-multi-answer.png) | `chat-canonical-message-actions--multi-answer` (branch) | The same turn at the same position with the row gone and the 12px `GAP.item` gap |
| [`after-focused-gutter.png`](./after-focused-gutter.png) | `chat-canonical-transcript-copy--focused-gutter` | The user message focused: Copy/Speak in the 32px turn boundary above the bubble, ring on the bubble only |
| [`after-response-gutter.png`](./after-response-gutter.png) | `chat-canonical-transcript-copy--resting`, `a1` clicked | An intermediate response focused: Copy-only gutter at the trailing edge, zero flow height |
| [`after-context-menu-prose.png`](./after-context-menu-prose.png) | `chat-canonical-transcript-copy--context-menu-on-prose` | Right-click on prose: Copy text / Copy as Markdown / Copy selection (disabled) |
| [`after-context-menu-tool.png`](./after-context-menu-tool.png) | `chat-canonical-transcript-copy--context-menu-on-tool-row` | Right-click on an expanded ledger row |
| [`after-selection-toolbar.png`](./after-selection-toolbar.png) | `chat-canonical-transcript-copy--selection-toolbar` | A partial assistant selection raises ONE strip: Quote, Copy and one Speak |
| [`after-selection-response-focused.png`](./after-selection-response-focused.png) | `chat-canonical-transcript-copy--selection-toolbar-response-focused` | The intermediate response is focused AND selected: one strip; its own Copy gutter is `visibility: hidden`, `pointer-events: none`, inert/aria-hidden |
| [`after-selection-narrow.png`](./after-selection-narrow.png) | `chat-canonical-transcript-copy--selection-toolbar-narrow` (480px) | A two-line selection: the 90x32 strip sits above the selected paragraph (bottom 201.7 vs selected top 207.2), not over it |
| [`after-selection-forced-below.png`](./after-selection-forced-below.png) / [`after-selection-forced-below-settled.png`](./after-selection-forced-below-settled.png) | `chat-canonical-transcript-copy--selection-toolbar-top-edge` (long transcript, scrolled to the top) | The top-edge case: the selected line starts at y≈17 and the 90x32 strip is BELOW it at y≈43-74.5 (CSS coordinates read from the committed 2560x1440 frame); two consecutive captures are byte-identical (SHA-256 prefix `46a40275`), so the placement does not reflow after paint |
| [`after-selection-user.png`](./after-selection-user.png) | `chat-canonical-transcript-copy--selection-toolbar-user` | A user-message selection: a 62x32 Copy+Speak strip at x=919, no Quote, and no duplicate gutter |

### Measured in the browser (same run that produced the frames)

| Reading | Value |
| --- | --- |
| Intermediate answer row (`[data-record-id="a1"]`) | **22.4px** high; no `[data-lo-response-actions]` |
| Next record's top (`a2`) | 12px below `a1` — the `GAP.item` step |
| Response gutter (`[data-lo-gutter-actions]`) | `position: absolute`, **38x32px**, at x=919 while the prose box ends at x=917 (entirely in the outer gutter), `opacity: 0` at rest, `1` once the row holds focus |
| User gutter (`[data-lo-user-actions]`) | `position: absolute`, **70x32px**, sits at y=44 while the bubble starts at y=76 (fully inside the 32px turn boundary) |
| Selection strip (`[data-lo-quote-toolkit]`) | **90x32px**, at x=918 while the prose box ends at x=917 (no overlap), with Quote, Copy selection and one Speak; while it owns the highlight the row marks `data-lo-selection-active` and its gutter overlays are hidden |
| Context menu | 224x104.5px portal, opened on the pointed line |
| Focus ring | `outline: none` on the row; 2px accent ring on the bubble/answer box |
| Collision state | Strip 90x32 at (107,112.9); response gutter 38x32 at (919,142.4) is `visibility: hidden`, `pointer-events: none`, `inert` |
| Narrow selection (480px) | Strip 90x32 at (32,169.7); selected paragraph top 207.2 — the strip is above the two-line selection, covering only the preceding line |
| User selection | Strip 62x32 at (919,88.5) — Copy + Speak, no Quote; the user gutter is suppressed |
| Forced-below (top edge) | Selected line at y≈17; strip 90x32 at y≈43-74.5, below it. Two captures byte-identical (`46a40275`) — no first-frame jump |

The pixel readings are from this Storybook run; jsdom has no layout engine. The
native app was not driven for these frames; the stories mount the production
component and the interactions are real events, and QA's report states the same
limitation.

### Placement constraint (design round 2, D2)

The user control stays **above** the bubble rather than beside it, and this is a
measured constraint rather than a preference. A user bubble is right-aligned and
ends at the row's trailing edge, so a side-anchored control has no gutter inside
the row; at the 480px pane floor a `-right-8` seat would extend 32px past a
scroller that only has 16px of padding and would add horizontal overflow. The
32px `GAP.turn` above the bubble is exactly the control's height, so the
top-trailing seat is the only zero-overlap one at every width. The intermediate
answer's Copy-only control moves to the outer 40px gutter at
`@min-[900px]/chatcol` (where the measure leaves that slack) and falls back to
the row's trailing edge below that. Both remain absolute and cost zero flow
height. The selection strip follows the same rule: the outer gutter when it
fits, otherwise the original above/below flip. That keeps it outside the
selected line's boxes whenever either side has room; a selection taller than
the pane has no free seat, so the final clamp may overlap it - the accepted
trade `quote-anchor.ts` documents. While a selection strip owns a turn,
`data-lo-selection-active` hides the user/response gutter overlays so their
shared seat cannot swallow a Quote press.

## What the automated tests cover

`scripts/transcript-copy-affordances.test.mjs` mounts the real
`CanonicalTranscript` (jsdom) and asserts:

- zero `[data-lo-response-actions]` and zero `mt-1 flex justify-end` wrappers on
  the multi-answer turn; the intermediate response's control is
  `[data-lo-gutter-actions]` and carries `absolute`;
- the user row's control is absolute, the row is focusable, named and reveals
  under `focus-within`;
- right-click opens the menu on prose, a tool row, a fold header and a peer
  receipt; Copy as Markdown writes the record's own source (a fence and a list
  survive), while Copy text writes the visible words;
- `Shift+F10` opens a focused message's menu; `Mod+Shift+C` copies the focused
  message, or the selection when no row is focused;
- a partial assistant selection raises one Quote/Copy/Speak strip and no second
  shared toolbar, marks the response row as selection-active, and keeps that
  ownership when the response row is focused; a user selection raises Copy and
  Speak but no Quote; a selection outside a quotable turn gets the shared
  Copy/Speak strip; both Copy presses write exactly the highlight.
- `Copy text` preserves inline code, fenced code and spaced operators while
  dropping only the markdown delimiters; exact-equality cases pin fence→paragraph,
  fence→fence, code→heading, block/inline HTML, ordered lists, nested lists and
  a paragraph after a nested list.
- `placeQuoteControl` is covered directly for outer-gutter, narrow-above and
  narrow-below seats.

The narrow, user and response-focused Storybook states are captured in
`after-selection-narrow.png`, `after-selection-user.png` and
`after-selection-response-focused.png`. The narrow frame is the ordinary
above-flip; the viewport-sized case where no free seat exists is the documented
clamp trade, not an ordinary placement promise.

`scripts/message-actions.test.mjs` pins the pure rule:
`transcriptRowActions` is true only for `user` and `assistant` rows.
