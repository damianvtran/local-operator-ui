# Round 3 evidence — desktop notifications

Rendered with the harness `browser` tool against the worktree's own Storybook
(`pnpm storybook --ci --port 6031`), one reused tab, closed after capture.
Theme via `globals=theme:localOperatorDark|localOperatorLight`.

| File | State | What it evidences |
|---|---|---|
| `after-populated-dark.png` | Populated, Unread filter | The Unread chip reads **4** and the grid draws **4** rows (`[data-notification-row]` count = 4: one unread ask + three unread updates). Before this round the chip printed `unread_count` (3) while the rail badge read 4 (OD2/D16). |
| `after-populated-light.png` | Populated, light palette | Same state in light; the chip/rows agreement is palette-independent. |
| `after-empty-dark.png` | Unread filter, nothing left | "All caught up" unchanged; chip absent at zero. |
| `after-load-error-dark.png` | First read failed | Error state unchanged by this round. |
| `after-drawer-controls-dark.png` | Drawer Updates tab | Per-row **Mark read / Dismiss** controls are in the DOM and drive the writes: `[data-drawer-update] [data-row-action="dismiss"]` matched 3 buttons, and pressing one removed the row from the tab. The controls are hover/focus-revealed, so this still frame shows the resting state; the accessibility snapshot is the record of their presence and labels. |

Measured in the same session:

- Older-group disclosure target: `[data-notification-group="older"] button`
  rect `12,596.29 58.66x24` — **24px**, up from 17px (OD7, WCAG 2.5.8 minimum).
- Drawer dismiss receipt, held with `parameters.toastDuration =
  Number.POSITIVE_INFINITY`: `[data-sonner-toast]` text
  `"Dismissed 1 update Undo"` — the message and its Undo, with no zero-count
  `changed · skipped · not confirmed` suffix (OD3/OD4).

Native foreground (Electron) evidence is **not** part of this record: the positive
foreground receipt remains BLOCKED for the reason given on the PR.
