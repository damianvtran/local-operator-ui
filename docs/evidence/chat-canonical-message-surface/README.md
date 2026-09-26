# The user message block's surface

The block's fill IS its boundary (D10's amendment, §L), so what makes it stand
out is its step against the `canvas` column. The operator's report of
2026-09-26: "the contrast between the user message background and the chat
background is quite poor on some themes, so we might want to just subtly adjust
the contrast of the user message backgrounds so that it can properly stand out
on various light and dark themes." The audit found the block wearing the shared
`surface` role, below ΔE00 4.0 off the canvas on 51 of the 59 palettes and as
low as 2.05 (`sage`). This set is the repair's own evidence, and its pair under
[`../chat-canonical-message-surface-before/`](../chat-canonical-message-surface-before/)
is the claim: a frame of the repaired fill alone cannot show that the block
used to sit at a step a reader cannot find.

**Which themes, and why these four.** Chosen from the audit's extremes rather
than taste: `sage` (2.05) and `catppuccinMacchiato` (2.08) are the two worst
steps in the fleet, `mintLight` (3.85) is a light theme the change moves only
at the margin, and `radient` (6.76) is the widest step of all and is NOT moved
- so the pair shows both that the floor moves what fails it and that it leaves
what already clears it alone.

| theme | fill before | ΔE00 before | fill after | ΔE00 after | worst ink on the new fill |
|---|---|---|---|---|---|
| `sage` | `#FAF6EB` | 2.05 | `#fdfbf5` | 4.20 | 14.01:1 |
| `catppuccinMacchiato` | `#2A2D42` | 2.08 | `#303349` | 4.02 | 5.02:1 |
| `mintLight` | `#F0F7F2` | 3.85 | `#f1f7f2` | 4.19 | 6.09:1 |
| `radient` | `#25293A` | 6.76 | `#25293A` | 6.76 | 6.03:1 |

The full 59-theme before/after table lives in the pull request's body, and the
executable half is `MESSAGE_SURFACE_DELTA_E` in `scripts/contrast-contract.mjs`
(asserted per palette, with the lightness half and the ink floors around it;
`scripts/message-surface-floors.test.mjs` proves each bound fires).

**How they were taken.**

```sh
node scripts/capture-evidence.mjs http://localhost:6043 \
  --only=chat-canonical-message-surface \
  --themes=sage,catppuccinMacchiato,mintLight,radient \
  --allow-backend --theme-settle-ms=180000
```

Storybook 8.6.12 driving the `chat-canonical-message-surface--user-turn` story
at its own 1024x560 frame, headless Chrome as the rig always runs it.
`--allow-backend` because the operator's live daemon answers on :1111 and must
not be stopped for a capture, and this story is a static fixture
(`frontend={null} gate={null}`) that never contacts the backend, so the guard's
concern - surfaces that render a server's replies - does not apply; the rig's
own theme and paint guards still ran over every frame. `--theme-settle-ms`
because this host is loaded: the guard's default 10 s does not fit it, and the
rig's own comment records that exact failure mode.

**What this set is NOT.** Component-level frames from Storybook, not the whole
app: no sidebar and no composer are in them. The claim is the block's fill
against the column it is drawn on, and the pair is read at that scope; the
`chat-shell` set is where whole-app frames live. These frames contain no data
from any machine.
