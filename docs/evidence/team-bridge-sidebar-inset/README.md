# Team Bridge sidebar: one inline inset on both sides

Operator report (2026-11-04): the Channels header and rows sat left of
Back/Drafts, and the mute bell touched the rail's end edge.

Story: `Team Bridge/Page › In Shell Sidebar Inset` (`team-bridge-page.stories.tsx`),
the docked 260px column at 1280×720, DPR 2. Frames are the first 330 CSS px of
the page (the rail plus the pane's edge).

- `before-rail.png`: `origin/main` a2fd6b2 rail source under the same story
  (the story's audit section given main's `inset="bare"` and no section inset,
  matching the hook on main).
- `after-rail.png`: this branch.
- `before-after-pair.png`: the two side by side at 50%.

Captured with the desktop app's browser host against a narrowed Storybook dev
server (one story file), and measured with that host's `styles` read (CSS px,
column at x=0, width 260).

## What these frames do not claim

The installed app (0.48.15, `/Applications`) predates restyle 406a1ce, where
sections padded `px-1` and quick rows `px-3`. That 4px leading split is what the
operator's screenshot shows. Main had already moved every leading mark to 16px,
so on main the leading side is unchanged except for the owner-audit section.
These frames show main against this branch, not 0.48.15.
