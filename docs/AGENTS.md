# Agent notes — interface panels

These are the panel rules an agent changing a desktop surface must follow.
They are part of the visual system in `docs/branding.md`; that file owns the
colour and ground rationale, this file is the short enforceable checklist.

## Panels

A **panel** is a region that owns a ground beside the canvas: the app sidebar,
a route's leading rail, a roster, a detail/dock pane. It is not a card, an
input, a menu or a popover.

- **A panel runs edge-to-edge to the top of the content area**, under the
  title-bar lane. It is never inset below a header and never starts below its
  own scroll content. Route-owned leading columns hand themselves to the shell
  with `useLaneLeadingColumn("surface")` so the lane paints the same ground
  above them (`scripts/lane-leading.test.mjs`).
- **A panel has no border.** Separation comes from the ground ladder
  (`canvas` / `surface` / `elevated` / `sunken`) and spacing. Do not add a
  `border-r`, `border-l`, `border-t` or `border-b` to a panel root; a 1px rule
  is a second, redundant mark and it cannot reach the top through the shell's
  clipped columns. `border-control` stays the boundary of an input, select,
  checkbox or outlined button — not a panel edge.
- **Chrome controls are borderless too.** A grouped segmented control (for example the Library grid/list toggle) may keep one shared `border-control` boundary around the group; the edge belongs to the group affordance, not to each button. The Library search, sort and filter controls take the `elevated` ground on a `surface` panel and the shared accent focus ring; no resting stroke. Reserve `border-control` for a form field or an actual boundary a ground cannot express, never as decoration on a toolbar control.
- **A scrolling panel fades at its top edge.** Put
  `data-lo-sidebar-edge-cues` on the panel's scroller; the shared scroll-driven
  mask in `styles/index.css` dissolves content under the top spacing instead of
  clipping it against a hard boundary.
- **The padded box is the grounded box.** The element that wears
  `panel-top-pad` must be the same box that paints the panel's ground. A padded
  wrapper with no ground of its own is the inset band the rule forbids, and a
  content column inside a grounded, `panel-flush` ancestor needs no ground of
  its own.
- **Keep the composer/panel footer outside the scroller.** The scroll container
  ends above it; content never paints underneath it.
- **Narrow windows replace, they do not overlay.** When the detail rail cannot
  fit beside the content at its minimum width, the selected asset becomes the
  full-width route view; the content column and filter rail step aside. The
  filter rail itself collapses into the Filters sheet below 1200px. A panel never
  floats over another panel's content.

The Library filter rail is the reference implementation: full-height
`bg-surface` column, `data-lo-sidebar-edge-cues`, no edge rule, with the
preview dock separated by the `surface` ground rather than a line.
