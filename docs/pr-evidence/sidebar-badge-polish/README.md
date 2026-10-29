# Sidebar badge polish: evidence

Follow-up to #1465 (design round 1 D1–D3, code review m1/m2/n1).

## How the frames were made

All frames come from Storybook `Shell/Sidebar attention badges`
(`sidebar-attention.stories.tsx`) in this worktree. They were shot in the
harness browser at a 1280x720 viewport (2x device pixels), with
`args=theme:localOperatorDark|localOperatorLight`. The "before" frames use the
same stories with `origin/main`'s `sidebar-navigation.tsx` and
`attention-badge.tsx` checked out for the run. A one-line export shim kept the
new stories importable and does not change rendering. The branch sources were
restored afterwards (`git status` clean).

- `collapsed-5-12-125-<theme>-before-after.webp`: top row is before, bottom row
  is after. Columns are stories `collapsed-5`, `collapsed-12` and
  `collapsed-125`. Notifications, Browser and Mesh (in More) carry N, and Aida
  carries 1.
- `more-open-<theme>-before-after.webp`: left is before (More shows `4` while
  open, beside Team Bridge `3` and Mesh `1`). Right is after (More draws nothing
  while open, and the rows keep their pills).
- `more-closed-vs-open-<theme>.webp`: the branch with More closed (`4`) and
  open (no mark).

## Icon overlap, measured

Badge rectangles come from the light frames' accent pixels, in CSS px. The
glyph box is the 16px icon centred in its 28px anchor (x 20–36), and the
anchor sits where main's -2px corner offset puts it. Each value is overlap
area divided by the icon's 256 px².

| Count | Before (`-top-0.5 -end-0.5`, cap 99) | After (`-top-1 -end-1.5`, cap 9) |
| --- | --- | --- |
| 5 | 14×14 mark, 6×6 = 14.1 % | 14×14 mark, 2×4 = 3.1 % |
| 12 | 20.5 wide, 12.5×6 = 29.3 % | `9+` 20.5 wide, 8.5×4 = 13.3 % |
| 125 | `99+` 27.5 wide, 16×6 = **37.5 %** | `9+` 20.5 wide, 8.5×4 = **13.3 %** |

The values are the same for the Bell (Notifications) and More (ellipsis), as
both rows carry the same N. The mark's right edge moves from x=44 to x=48,
which is still inside the 56px strip.
