# S6b approvals card frames — round-4 head

**Document-only frames.** These are cropped screenshots of the BUILT card
document (`out/renderer/browser-approvals-overlay.html`) loaded in an iframe
over a page-coloured ground, with a model injected through
`window.__approvalsCard` (the same seam main uses). They are cropped to the
document so the card is legible; the dashed edge is the harness iframe, not the
native ring. Native composite, transparency over a live page, the ring's hit
routing and VoiceOver are **not** shown and are recorded BLOCKED in
`docs/evidence/browser-approvals-s6b/`.

| File | State |
| --- | --- |
| `card-264-dark.png` | request · 264 · dark · fr |
| `card-264-light.png` | request · 264 · light · fr |
| `card-368-dark.png` | request · 368 · dark · fr |
| `card-368-light.png` | request · 368 · light · fr |
| `list-264-light.png` | queue list · 264 · light (footer anchored at the card foot) |
| `list-368-dark.png` | queue list · 368 · dark |
| `palette-368-latte.png` | catppuccinLatte (a light palette whose name has no "light") |
| `expired-264-light.png` | expired: colour-based disabled decisions, no opacity |
| `error-264-light.png` | stale action: the error line in the sticky footer |

What they show: one request sentence with the origin inline; the broad grant as
`allow_all_of` + the queue's registrable-domain key; a single gloss line; all
five decisions plus the footer above the fold at 264 and 368; the footer's
hairline, with a scrim only while the body actually scrolls; the count-labelled
list action with an action aria-label and chevron; the unnamed-row discriminator; the list footer at the card
foot without changing the pinned height; the exact app palette; disabled states
as colour, not opacity; the stale/error line above the footer.

The native rows (and the ring) come from `scripts/browser-approvals-s6b-probe.mjs`,
not from these frames; its four cells at this head are in
`docs/evidence/browser-approvals-s6b/`.
