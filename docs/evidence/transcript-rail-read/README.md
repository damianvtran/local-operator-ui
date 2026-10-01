# `transcript-rail-read` — the reading cue's ends, before and after

Eight frames (four states, before/after) of the REAL app on an isolated daemon,
from the repository's own driver scene `--scene transcript-rail
--scoped-case rail-cue-probe` (`scripts/renderer-driver.mjs`). Dark palette
only: the probe pins `localOperatorDark`, and both fixes move which MARK is
active and how brightly it paints, not what any palette paints. The AFTER
frames are re-shot at the design round 1 fix (D1: the track's 24px block
padding), so the pair shows both rounds at once.

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

## The end-tick luma (design round 1, D1)

The rail's mask fades the frame's 24px edges to say "more above/below" — and
before the fix they dimmed the END MARKS themselves: the end-active dash read
**luma 73** (bottom) and **77** (top) against **238** for an interior active
mark, dimmer than its own rest neighbours (111) and dim in 59/59 palettes. The
fix is 24px of block padding on `[data-rail-track]` INSIDE the masked frame
(`py-6`), so the fades sit over padding rather than over marks — at scroll
maximum no follow pad alone can move the last tick off the edge, because
`scrollTop` is already clamped, which is what makes the padding the fix for
both ends. The follow effect's own pad rose 12 → 24 (the fade's depth) and its
tick offset is now derived from the scroller's boxes (rect + `scrollTop`) rather
than from `offsetTop` chains against the padded track.

The probe carries the acceptance as four checks and prints its readings
(`[note] luma`); the sampler averages a 3x3 patch at each dash's centre in the
captured PNG (`sharp`), so its absolute numbers differ from a single-pixel
reading while the terms compare like for like:

| reading | before the padding | after |
| --- | --- | --- |
| end dash at the bottom (6-turn) | 73 | **238** |
| first dash at the top (6-turn) | 77 | **238** |
| end dash at the bottom (402-mark) | 73 | **238** |
| interior active mark (reference) | 238 | 238 |
| rest neighbour | 111 | 160 |

The four checks FAIL on the pre-padding build (`end=73 active=238`) and pass
after it (`end=238 active=238`, `|end - active| <= 16`, and the end dashes read
at least 40 above their rest neighbours).

## The frames

| file | state |
| --- | --- |
| `transcript-rail-read-sparse-bottom-{before,after}.png` | the 6-turn fixture at the bottom: before, the active mark sits four ticks above the rail's end and paints at luma 73; after, the end tick itself is active at full strength (238) |
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
only — the same reason the rail's own `docs/evidence/transcript-rail/` set did
not enter its counts when this run was taken (that set has since been re-encoded
to lossless WebP on the canonical layout — 2026-09-30, `8b9b827d70`). The full
`check-evidence` sweep itself stands DEFERRED at capture time (another sweep
held the machine lease), which is its own documented state; the manifest suite
runs on this head and is green.
