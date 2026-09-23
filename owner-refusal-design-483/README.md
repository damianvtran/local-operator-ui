# Owner-refusal design frames — PR #483, design round 1

The two dispositions of a send the session OWNER refused before admission, rendered
at a column the PR's own evidence does not film: a **~476px chat column**
(1024x700 CSS at `deviceScaleFactor: 2`, `localOperatorDark`). 476px is the width
`scripts/composer-alert-geometry.mjs` already measures at 472, i.e. the column a
1440px window leaves once the sidebars are in — far short of the 890px column the
committed frames use, and the width at which the alert's own `max-h-[7.5rem]` cap
becomes a risk.

| Frame | State |
| --- | --- |
| `narrow-476-retiring-handed-back.png` | `409 runtime_retiring` — the echo is retracted, the owner's sentence stands alone, the text is back in the composer, no controls |
| `narrow-476-busy-handed-back.png` | `503 runtime_busy` with the app's own repeats spent — same, plus the app's retry hint |
| `narrow-476-unreachable-held.png` | `503 runtime_unreachable` — the CONTROL: echo kept, held claim, `Restore message` / `Discard message`, composer empty |
| `narrow-476-dispositions.png` | the two dispositions side by side, same width, same rig |

## What the numbers say (measured, not eyeballed)

DOM geometry per frame, from the same run:

| State | alert region | prose block | clipped? | send control | composer |
| --- | --- | --- | --- | --- | --- |
| `retiring`, handed back | 476x64 at y 527 | 460x60, scrollH 60 = clientH 60 | no | enabled, y 657..685 | holds the 91-char message, textarea focused, caret at the end |
| `busy-exhausted`, handed back | 476x44 at y 551 | 460x40, 40 = 40 | no | enabled, y 657..685 | holds the message |
| `unreachable`, held | 476x115 at y 500 | - | no | disabled | empty (placeholder) |

Nothing scrolls inside the cap in the new states, and the send control sits inside
the 700px viewport in all three. The whole alert is shorter in the new state than
the held one it replaces for these arms (64/44px against 115px), so the change
reduces the region's content in every arm.

Ink, sampled from the frames (the value equals the palette token in each case):

| Line | Colour | Token | Contrast on its ground |
| --- | --- | --- | --- |
| owner's failure sentence | `#EF8078` | `danger` | 6.22:1 on `canvas` `#22201C` |
| the app's held claim (held arm only) | `#C2BCAF` | `inkMuted` | 8.60:1 on `canvas` |
| `Restore message` | `#38C96A` | `accent` | 7.54:1 on `canvas` |
| restored composer text | `#F1EEE6` | `ink` | 12.80:1 on `surface` `#2B2721` |

Across all 58 palettes in `src/renderer/src/shared/themes/palettes/`, `danger` as
text never falls below **4.50:1** on any of the four elevation grounds and
`inkMuted` never below **5.53:1** (the contract's floors are 4.5:1 and 5.5:1), so
the refusal ink is not a dark-theme-only pass.

Transition, sampled inside the page every 8ms (a CDP round trip here costs ~150ms,
longer than the transition itself):

| Arm | press | box empty | echo painted | echo gone, text back | alert |
| --- | --- | --- | --- | --- | --- |
| `retiring` | +74ms | +184ms | +202ms | +220ms | 151 chars |
| `busy-exhausted` | +67ms | +75ms | +75ms | +421ms | 123 chars |
| `unreachable` (control) | \u2264+128ms | \u2264+128ms | \u2264+128ms | never | 313 chars, held |

The send control's `y` is **835 device px in every sample of every arm** — the band
is bottom-anchored and the region grows upward by its own height (48px `retiring`,
28px `busy` at the 1440 column), so nothing under the operator's pointer moves.

## What these frames do NOT prove

Everything the PR's own README lists (the packaged Electron IPC hop, a native
window, the real backend's ladder and timings, any theme other than
`localOperatorDark`), plus two of their own:

- **The transcript pane is not an instrument here.** The stub answers `/history`
  and then holds an empty event stream, so the handed-back frames paint the pane's
  shimmer skeleton and `Loading conversation…` where the admitted frames paint
  `Start of conversation` plus the echo. Whether a refusal over real history
  re-enters the pane's loading state, or keeps the history painted, cannot be
  settled from these frames.
- **The echo's trip is measured, not photographed.** The 8ms page-side timeline
  above is what says the echo paints and leaves; the frames are stills.

## How to reproduce

```sh
# from the coder's worktree, read-only; outputs go to a scratch directory
PROBE_W=1024 PROBE_H=700 PROBE_S=2 \
OWNER_REFUSAL_APP_PORT=5392 OWNER_REFUSAL_OWNER_PORT=8892 OWNER_REFUSAL_CDP_PORT=9434 \
node <scratch>/harness-probe/capture.mjs <scratch>/narrow-1024 --tree=after
```

`capture.mjs` there is the PR's `docs/evidence/owner-refusal-send/harness/capture.mjs`
with three changes: `ROOT`/`HARNESS` pinned at the worktree, the viewport read from
`PROBE_W/PROBE_H/PROBE_S`, and the probe extended with alert/composer geometry,
`activeElement` and caret position. The stub, the dev server, the arms, the message
and the shipped components are the PR's own.
