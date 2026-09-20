# The chat sidebar's split — the boundary, the collapse controls and the restore row

The operator asked for the rule between the entity lists and the chats list to be
draggable with memory, and for either region to be collapsible "so that it
doesn't take up a whole line of space at all times". `docs/design/sidebar-sections.md`
is the design contract; this directory is what it looks like when it renders.

## What produced these frames

Storybook, from this branch. **Re-taken twice: once in one pass on `d109863e2`,
with the two swapped-order states the swap's own review round (D2) asked for, and
again on this head (round 2) for `resting-default` and every state whose readout
changed.** Both palettes are now settled the same way — the caption is checked
against the DOM, then checked again after the layout stops moving, and the
viewport is declared at the content's own height so no resize happens under the
caption at all.

**What the light half of `resting-default` actually was, corrected.** Rounds 1
and 2 both read it, and the first explanation was wrong: it is not a transient
inside the panel's own chrome, and the panel's geometry was never in doubt. Both
frames are 741x691 and both draw the boundary at row 379 — the same 304px list
region, in both palettes. What was wrong was the CAPTION: it printed
`now 290 / max 484`, which is exactly the arithmetic of a **660**-tall page
(`(660 − 104) − 72 = 484`, `round(0.45 × (660 − 16)) = 290`), and 660 was this
story's declaration in `scripts/capture-evidence.mjs`. The harness resizes the
content height to `max(scrollHeight, body, declared)` AFTER the readout's last
sample, so the caption described the viewport the frame was about to leave
(agent review round 2, M-1; design round 2, D4). The fix is the declaration
(`741x691`: the content's own height) plus the stability check folding the
readout's values in, so the frame and its caption cannot disagree again.

```
pnpm check-types && pnpm lint && pnpm check-themes
pnpm build-storybook
npx http-server storybook-static -p 6031 --silent
node scripts/capture-evidence.mjs http://localhost:6031 \
  --only=chat-sidebar-sections --themes=localOperatorDark,localOperatorLight \
  --allow-backend
```

Seven states, `localOperatorDark` and `localOperatorLight` — the two palettes the
brief requires as a minimum, so fourteen frames. `--allow-backend` because
another session's `local-operator serve` was answering on 1111 for the whole
pass, which the rig refuses by default; this surface talks to nothing, since
`window.api.desktop.request` is stubbed by the story, so no frame here can be a
picture of that backend's replies.

The width is the panel plus the 380px readout beside it (`741` at the panel's
360, `621` at its 240), and the height is sized to the band each state draws —
`entities-only` is a filled column and one 28px row, and a 900px frame of it
would be a picture of ground.

## What each frame is

| story | what it is |
| --- | --- |
| `resting-default` | no stored split: both regions, the boundary at rest, nothing revealed. **This is the frame the parity claim is judged on** — it is what an upgrading user sees on first launch. |
| `dragged-split` | a height the user chose (`320px`), drawn at exactly that height: the readout's `now`, its `Chats region drawn at` and the stored value are one number. |
| `entities-only` | the chats list hidden: the entity region fills the column and a row at the bottom names what is missing *with its count*, so the collapsed state still says how many chats there are. |
| `chats-only` | the mirror: the entity region's restore row sits directly under the search field and the chats list fills the column. |
| `short-window` | a stored `900px` in a 480px window: the render clamps to `capacity - 72` (the readout shows `Stored: 900px` beside `now 344`) and the entity region keeps its own floor — the preference is not rewritten. |
| `narrow-240` | the panel at its own width clamp, where the rows wrap hardest and the boundary has the least room. |
| `query-while-collapsed` | a query with the chats list **persisted as hidden**: both regions render, the word finds one agent and one conversation, and `Stored: entities` still reads the collapse the user chose. |
| `chats-first` | the swap: the chats list above and the entity lists below, at 360px. The one state in this change where more than a number moves — the regions trade their `flex-1`/`shrink-0` roles, the boundary moves to the list region's bottom edge (`side="bottom"`), and the rule above the lower region moves from the list to the entities. Design round 1 (D2) is the reason it is photographed: it shipped uninspected. |
| `chats-first-narrow` | the same swap at the panel's width clamp, where the cluster's three glyphs have the least room. |

## What these frames do NOT prove

Stated here rather than left to a caption, because each one is a claim somebody
could otherwise read into a still:

- **They are not a drag.** The split is set through the store by each story, so a
  frame is a RESOLVED layout, not a gesture. The gesture is the driver's
  (`--scene sidebar-split`), which enters Chromium's own input pipeline.
- **They are not the reveal.** The collapse cluster is revealed on `:hover`, and a
  story cannot enter a pseudo-class: `userEvent.hover` dispatches events rather
  than hovering. The revealed cluster is a driver frame for that reason.
- **They are not focus-dependent rendering.** A hidden window has no focus, so no
  `:focus-visible` ring is photographed here.
- **They are not the restart.** That a drag and a collapse survive a second boot
  is the acceptance criterion, and only the driver's restart step can say it.
- **They are not the eleven palettes this set does not carry.** Two palettes are
  the brief's minimum; a design round that wants the other ten can re-take this
  set with `--themes=` naming them, which is a narrowed run like this one.

## The numbers in the frames

The readout beside the panel is part of the evidence, not decoration: it prints
the separator's own `aria-orientation`, `aria-valuenow`, `aria-valuemin` and
`aria-valuemax`, the regions actually mounted, the chats region's drawn height,
the restore row and its content, whether the cluster is mounted, and the stored
preference — every one of them read out of the DOM rather than typed by hand.

It is a 200ms sample of the DOM, so each story's `play` ends by waiting for the
sampled numbers to EQUAL the live ones (`readoutSettled`) before the shutter
opens. Without that a frame can be one poll behind the panel it captions, which
is a caption that would disagree with a layout that is fine — the failure this
directory is least able to afford, since "the separator announces what the region
renders" is the whole contract.

Two of these frames each show a pair of numbers that differ on purpose, and they
are the two the contract is about: `short-window` shows `Stored: 900px` against
`now 344`, and `query-while-collapsed` shows `Stored: entities` against both
regions drawn.

## The pair

`resting-default` has no "before" in this directory — the story does not exist on
the base tree — so the parity claim is carried by
`../chat-sidebar-sections-baseline/`, which is the same already-committed story
(`chat-sidebar-status-feed--completion-in-place`) captured on both sides. That
directory's README states the method and the result.
