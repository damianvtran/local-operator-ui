# The chat sidebar's sections — the merged panel's resting states

The operator asked for one scroll in the sidebar (report, 2026-09-26): the entity
sections and the chats list are the flow of a single scroller, with no boundary
between them, no collapse controls and no order swap. `docs/design/sidebar-sections.md`
is the split-era design contract, kept as the record; this directory is what the
merged panel looks like when it renders.

## What produced these frames

Storybook, from this branch. **Round 1 of this remediation (agent review R2, QA's
Q3) retired the split's own states**, because the merged panel cannot draw them:
the boundary, the collapse cluster, the stored list height and the swap are gone
from the app, and three of the old stories' plays could only throw against it.
Three stories remain — `resting-default`, `narrow-240` and `query-while-collapsed`
— and the readout beside each panel now prints the merged panel's own numbers.
The six frames on disk were taken in earlier passes, under the old readout; this
round did NOT re-capture, so they remain the record of their own heads, and the
next capture pass over this surface re-shoots the three surviving stories.

```
pnpm check-types && pnpm lint && pnpm check-themes
pnpm build-storybook
npx http-server storybook-static -p 6031 --silent
node scripts/capture-evidence.mjs http://localhost:6031 \
  --only=chat-sidebar-sections --themes=localOperatorDark,localOperatorLight \
  --allow-backend
```

Three states, `localOperatorDark` and `localOperatorLight` — the two palettes the
brief requires as a minimum, so six frames. `--allow-backend` because another
session's `local-operator serve` may be answering on 1111 for the whole pass, which
the rig refuses by default; this surface talks to nothing, since
`window.api.desktop.request` is stubbed by the story, so no frame here can be a
picture of that backend's replies.

The width is the panel plus the 380px readout beside it (`741` at the panel's
360, `621` at its 240), and the height is declared above each state's content, so
the harness's resize is a no-op and the caption describes the viewport the
shutter opens on.

## What each frame is

| story | what it is |
| --- | --- |
| `resting-default` | no stored state: both regions drawn inside the one scroller, the entity sections above the chats list, nothing collapsed. **This is the frame the parity claim is judged on** — it is what an upgrading user sees on first launch. |
| `narrow-240` | the panel at its own width clamp (`chatSidebarWidth`), where the rows wrap hardest. |
| `query-while-collapsed` | a query that finds one agent and one conversation, both regions drawn. (The name is the split's; the collapse it names is gone, and the query's own claim is what the frame carries.) |

**Retired with the split — frames deleted, stories deleted, in one commit round
(agent review R2, QA's Q3):** `dragged-split` (a stored drag height),
`entities-only` and `chats-only` (the collapse modes), `short-window` (a stored
height the render clamped), `chats-first` and `chats-first-narrow` (the order
swap). Each photographed a state the merged panel cannot reach; the reasons are
stated here so a later reader meets the deletion rather than a surprise.

## What these frames do NOT prove

- **They are not a gesture.** The split's drag had nothing left to size; the
  states here are resolved layouts, and the panel's own interactions (the view
  popover, the page ladder) are the view-menu set's frames.
- **They are not focus-dependent rendering.** A hidden window has no focus, so no
  `:focus-visible` ring is photographed here.
- **They are not the eleven palettes this set does not carry.** Two palettes are
  the brief's minimum; a design round that wants the other ten can re-take this
  set with `--themes=` naming them, which is a narrowed run like this one.

## The numbers in the frames

The readout beside the panel is part of the evidence, not decoration: it prints
the regions actually mounted (read off their own markers), the scroller's own
`scrollHeight`/`clientHeight`, the chats list's drawn height and the drawn row
counts, every one of them read out of the DOM rather than typed by hand.

It is a 200ms sample of the DOM, so each story's `play` ends by waiting for the
sampled numbers to EQUAL the live ones (`readoutSettled`) before the shutter
opens. Without that a frame can be one poll behind the panel it captions, which
is a caption that would disagree with a layout that is fine.

## The pair

`resting-default` has no "before" in this directory — the story does not exist on
the base tree — so the parity claim is carried by
`../chat-sidebar-sections-baseline/`, which is the same already-committed story
(`chat-sidebar-status-feed--completion-in-place`) captured on both sides. That
directory's README states the method and the result.
