# The canvas workspace — the Files view, as a list

These frames are the rendered evidence for the canvas's Files view and the blank
canvas that leads into it. Every directory here is one state, twelve files
each — the twelve sweep themes (`manifest.json`'s `THEMES`).

| directory | the state |
| --- | --- |
| `files/` | the list at rest: twelve rows, a basename clash, a missing-file receipt, an image |
| `files-narrow/` | the dock's 400px floor: directories kept on the clash, no size column |
| `files-dock-default/` | the dock's OWN default width, 450px (`chat-content.tsx`) — where the clash keeps its directory and the size column is already hidden |
| `files-filtered/` | a query typed into the real field, and the count saying what it hides (`3 of 12 files`) |
| `files-filtered-clear-hover/` | the field's clear control under a real pointer |
| `files-no-matches/` | a query that matches nothing, and the escape hatch in the body |
| `files-filtered-empty/` | the type filter emptying the list, through the real menu |
| `files-single/` | a one-row list, and the singular count |
| `files-no-files/` | no files yet, no scan running: the static body |
| `files-media/` | a media row's leading visual both ways — a resolvable thumbnail, and an image that is gone (the glyph, no box) |
| `files-scrolled/` | forty-eight rows at maximum scroll: the last row whole, with the scroller's own padding below it |
| `files-scanning/`, `files-scan-stopped/`, `files-scan-stopped-empty/` | the scan's three states, including the one that used to read "No files yet" over unread messages |
| `files-row-hover/`, `files-row-hover-narrow/` | the pointer over a plain row: the row's own `row-hover` ground, with its `⋯` revealed in the trailing 28px it reserves |
| `files-row-actions-hover/` | the pointer on the `⋯` ITSELF: the control carries its own ground and the row's stays with it, because the ground is the row's rather than the button's (design round 2, D11 — before it, this frame showed the row un-highlighted under its own menu button) |
| `files-row-focused/`, `files-row-focused-narrow/` | a row under the keyboard's ring |
| `nothing-open/`, `nothing-open-empty/` | the blank canvas with files to browse, and with none — both at the `CanvasFrame` default, 720px (the row box measures 718px inside it), where the action row has room and never wraps |
| `nothing-open-narrow/` | the blank canvas at the dock's 400px FLOOR, with files: the width where its three actions wrap inside the 351px content box instead of painting into their own `p-6` padding (design round 2, D9) |
| `variables*/` | the variables panel beside it, unchanged by this work |

The six `files-row-*` and `files-filtered-clear-hover` states are driven by the
capture rig's own CDP input rather than by a story's play function: `:hover` is set
only by real pointer input and a `:focus-visible` ring only by a real keyboard
interaction, so a story that dispatched its own events would photograph the resting
row and file it under a hover.

**The app-level picture of this surface is not in this set, and that is a
statement rather than an omission.** These frames are Storybook, which renders the
app's own `Canvas` component, its own store and its own fixtures at a
height-bounded size — but it is not the built application. The repo's one
app-level picture of the panel is
[`../mentioned-files-app/files-panel/`](../mentioned-files-app/files-panel/), and it
is the TILE GRID this work replaced (kept as the record of the producer path it was
taken for). Re-shooting it from a real session would put the operator's own file
names and paths into a committed frame; re-shooting it from a fixture session needs
the shared rig to get past the app's first-run dialog, which is its own piece of
work. The geometry claim itself — the one this surface's defect was about — is
asserted against the built app by `scripts/mentioned-files-app-proof.mjs
--geometry`, so the numbers come from the application even where the picture does
not.
