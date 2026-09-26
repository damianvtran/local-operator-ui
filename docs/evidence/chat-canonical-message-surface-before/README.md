# The user message block's surface - the BEFORE half

The pair to [`../chat-canonical-message-surface/`](../chat-canonical-message-surface/),
and the half that makes the claim: these are the same four themes of the same
story on the pre-change tree, where the block's fill was the shared `surface`
role - 2.05 ΔE00 off the canvas in `sage`, 2.08 in `catppuccinMacchiato`, 3.85
in `mintLight` and 6.76 in `radient`.

**How they were taken.** With the 63 files that carry the message-surface
change reverted to `origin/main` in the working tree (58 palette files,
`palette-contract.ts`, `index.css`, `themes.generated.css`,
`canonical-transcript.tsx` and `message-paper.tsx`), the story file's title
temporarily suffixed `before` so the ids land in this directory, and the
matching temporary STORIES row added for the run - then all three restored and
verified against `HEAD` before the after frames were re-read. The capture
command is the after half's own with the id swapped
(`--only=chat-canonical-message-surface-before ... --allow-backend
--theme-settle-ms=180000`; see the after README for what those two flags are
for), and the rig's theme and paint guards ran over every frame.

**The control.** `radient` is one of the eight palettes the change does NOT
move, and its two frames are **byte-identical** across the halves - the reading
that says the pair differs by the fill alone rather than by anything the two
runs did differently. The other three themes' frames differ, and each pair is
the same fixture at the same 1024x560 pane.
