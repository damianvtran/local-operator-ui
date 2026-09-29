# `transcript-rail-read` — the reading cue's ends, before and after

Eight frames (four states, before/after) of the REAL app on an isolated daemon,
from the repository's own driver scene `--scene transcript-rail
--scoped-case rail-cue-probe` (`scripts/renderer-driver.mjs`). Dark palette
only: the probe pins `localOperatorDark`, and the fix moves which MARK is
active, not what any palette paints.

The operator's report: scrolled to the BOTTOM, the bottom-most tick is not the
active checkpoint — "the detection of position might be off by a screen or
something like that." It is: the cue was the last checkpoint whose row had
crossed the scroller's TOP edge, so at the bottom the final viewport's ticks can
never win (the tail is shorter than a viewport; nothing in it crosses the line).
The fix resolves the scroller's two ENDS by their own arms — bottom → the last
loaded checkpoint, top → the first — and leaves the line rule for everything
between. See `src/renderer/src/features/chat/canonical/use-active-checkpoint.ts`.

## What the probe measured (before → after)

`[note] read <state>` lines, verbatim fields; `max = scrollHeight - clientHeight`
and the scroller rests at its bottom at `scrollTop === 0` with its span above
held negative (the app's own inverted layout).

| state | scroller | before: active | after: active | last tick | note |
| --- | --- | --- | --- | --- | --- |
| `sparse-bottom` (6 turns, short tail) | `scrollTop 0`, max 790 | `qn0002` | **`qn0006`** | `qn0006` | the report itself: the last four ticks were unreachable at the bottom; the last row (`qn0006`) sat at +656 px, inside the final viewport |
| `sparse-top` (scrollTop `-790` exactly) | `scrollTop -790` | `null` | **`qu0001`** | `qn0006` | no mark at all at the top before (the first row sat 59 px BELOW the line); now the first tick |
| `sparse-mid` (scrollTop `-395`) | `scrollTop -395` | `qu0002` | `qu0002` | `qn0006` | unchanged — the line rule still decides between the ends |
| `density-bottom` (402 marks, long tail) | `scrollTop 0`, max 1344 | `u0196` | **`n0200`** | `n0200` | the same class at scale: the last ~4 ticks could not win; the last six ticks were all loaded (`state: rest`) |

The top read also pins the sign convention: the arithmetic end is exactly
`-(scrollHeight - clientHeight)` (`-790` for the sparse fixture), and the bottom
is exactly `0` — no fractional shortfall was measured, so the 2px epsilon
(`ACTIVE_CUE_EDGE_EPSILON_PX`) is a rounding tolerance rather than a measured
gap.

## The frames

| file | state |
| --- | --- |
| `transcript-rail-read-sparse-bottom-{before,after}.png` | the 6-turn fixture at the bottom: before, the active mark sits four ticks above the rail's end; after, the end tick itself is active |
| `transcript-rail-read-sparse-top-{before,after}.png` | the same fixture at the top: before, NO mark active; after, the first tick |
| `transcript-rail-read-sparse-mid-{before,after}.png` | mid-scroll: unchanged by the fix — the line rule's own reading |
| `transcript-rail-read-density-bottom-{before,after}.png` | the 402-mark fixture at the bottom: before `u0196`, after `n0200` |

## What produced them

```sh
# the fixtures, into the run's own config root
node scripts/transcript-rail-fixture.mjs "$RIG/config" 200
# config.yml: values.hosting=test, values.model_name=mock-model; the daemon is
# an isolated `local-operator serve --host 127.0.0.1 --port 8087 --hosting test
# --model mock-model` over a worktree venv, HOME/config pointed at $RIG
# the worktree built the usual way (VITE_* placeholders + PostHog host)
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene transcript-rail \
  --scoped-case rail-cue-probe \
  --backend "http://127.0.0.1:8087" --backend-records "$RIG/config/run/serve" \
  --seed-onboarding-complete --out "$RIG/frames-after"
```

Both halves ran this same probe; the BEFORE half is the pre-fix tree at the
branch's base commit, the AFTER half the fix's own build. `ALL CHECKS PASSED`
on both runs.

## Why the counts gate does not move

The frames ship as PNG, and `check-evidence.mjs`'s sweep counts `.webp` frames
only — the same reason the rail's own `docs/evidence/transcript-rail/*.png` set
does not enter its counts. The full `check-evidence` sweep itself stands
DEFERRED at capture time (another sweep held the machine lease), which is its
own documented state; the manifest suite runs on this head and is green.
