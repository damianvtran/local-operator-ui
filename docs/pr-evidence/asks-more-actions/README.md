# The ask card's action row: Send answer + More actions

Rendered stills of the `Chat/Asks/Queued asks` stories, 1280x720 viewport, one
ask with four questions (two answered), main's confirmation sheet offered.

Before: at the 400 px drawer floor the pinned row wrapped to two lines
(`Send answer`, `Confirm and send…` / `Decline`, `Dismiss…`). After: one row,
`Send answer` and a `More actions` menu holding `Confirm and send…`, `Decline`
and `Dismiss…`, each with its old gate. The hint line and the foot (progress
count, copyable id) are unchanged.

| File | Story | Theme |
|---|---|---|
| `before-400-light.png` | `cleanup-confirm-offered` on the previous head `2d31015d4` | light |
| `after-400-light.png` | `cleanup-confirm-offered` | light |
| `after-400-light-menu-open.png` | same, menu open | light |
| `after-400-dark-menu-open.png` | same, menu open | dark |
| `after-640-light.png`, `after-640-dark.png` | `cleanup-wide` | light, dark |

Known: in dark the disabled `Confirm and send…` item is low contrast; it comes
from the shared dropdown-menu primitive and is left for a follow-up. There is no
dark "before" frame.
