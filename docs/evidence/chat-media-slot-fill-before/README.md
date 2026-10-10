# The media tile's fill - the BEFORE half

The pair to [`../chat-media-slot-fill/`](../chat-media-slot-fill/), and the half
that makes the claim: these are the same five themes of the same story on the
pre-change tree, where the tile's well was the shared `sunken` role - 2.00 ΔE00
off the canvas in `iceberg` and `neonNoir`, 2.26 in `localOperatorLight`, 2.07
in `localOperatorDark`, 4.01 in `ayuMirage` (which the change does not move).

**Palette-space numbers, as in the after half.** Every figure here is declared
(palette-space), re-derived from the palettes rather than read off the frames.
Re-derive from the palettes or `themes.generated.css`, not from the stills.

**How they were taken.** With the 62 files that carry the media-fill change
reverted to `origin/main` (`955b79e4c82`, the branch's cut point) in the working
tree - the 58 palette files, `palette-contract.ts`, `index.css`,
`themes.generated.css` and `attachment-frame.tsx` - the story's title
temporarily suffixed `before` so the ids land in this directory, and the
matching temporary STORIES row added for the run - then all restored (the story
file and the row to the committed head, the 62 files with them) before the after
frames were read. The capture command is the after half's own with the id
swapped (`--only=chat-media-slot-fill-before ... --allow-backend
--theme-settle-ms=180000`; see the after README for what those two flags are
for), and the rig's theme and paint guards ran over every frame.

**The control.** `ayuMirage` is one of the three palettes whose well already
clears the floor at rest, so the change does NOT move it, and its two frames are
**byte-identical** across the halves (SHA-256
`91c8fd6667e6072ee2cc924603513fbf0f93ed969c29b2ce76cabef8400a7d02` in both) -
the reading that says the pair differs by the fill alone rather than by anything
the two runs did differently. The other four themes' frames differ, and each
pair is the same fixture at the same 1280x200 pane, the strip in the same
position, so nothing but the fill's step moves between them.
