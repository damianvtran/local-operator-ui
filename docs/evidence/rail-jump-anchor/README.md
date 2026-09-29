# The jump's landing: one fixed top anchor (issue #680)

Issue #680: clicking a rail tick (or a search hit) is meant to reveal a turn,
but the landing resolved at varying viewport positions — the centred scroll was
one synchronous read taken while the windowed mount and the collapse walk could
still move the layout, and the reversed axis's clamps made both content ends
ambiguous. The decided rule (recorded in the issue): **the target row's TOP at
the transcript scrollport's top**, one constant, re-measured over a bounded
settle before the jump resolves.

## The rule, exactly

- **Anchor**: `target.top == scrollport.top`, 0px inset. Zero rather than an
  inset because both boundary coincidences only hold at 0 (the oldest-end
  clamp lands the first row flush; the nearest-end clamp is the closest
  achievable with no fudge), and the invariant is then one testable identity.
  Design may revisit the constant; it is one number.
- **Settle**: after the reveal, the anchor is re-measured each frame and
  re-applied while it drifts; it resolves when the position holds for two
  consecutive frames, bounded at the loader's settle plus two frames (8). A
  reader's own `wheel`/`pointerdown`/`touchstart` during the window stops the
  re-apply (the jump never yanks a steering reader).
- **Boundaries** (reversed axis): the nearest-end clamp (`scrollTop` 0) is the
  only allowed alternative, documented; the oldest-end browser clamp IS the
  anchor for the first rows; a taller-than-viewport row anchors its TOP.
- **Headroom**: the centring era's 16-row mount margin is gone (a top-anchored
  row needs nothing above it); the mount widens to the target's exact distance.

## What produced these frames

Both builds from `damianvtran/local-operator-ui`, against a local daemon
(`local-operator serve`) seeded with the `transcript-rail` fixture
(`scripts/transcript-rail-fixture.mjs`, its 200-turn `be1a9fef0001`
conversation), driven headless by `scripts/renderer-driver.mjs`:

```sh
node scripts/transcript-rail-fixture.mjs "$RIG/config" 200
# daemon: local-operator serve --host 127.0.0.1 --port 8087 --hosting test --model mock-model
# (isolated HOME/config; the built app pointed at it via VITE_LOCAL_OPERATOR_API_URL)
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene transcript-rail \
  --scoped-case rail-jump-probe \
  --backend "http://127.0.0.1:8087" --backend-records "$RIG/config/run/serve" \
  --seed-onboarding-complete --out "$RIG/frames"
# the short-viewport pass adds: --window-size 1380x650
```

BEFORE = `origin/main` at `f9dbf8b455`; AFTER = the branch's anchor build. The
probe focuses the exact tick and presses Enter (the density-safe route), then
reads the washed row's top relative to the scroller's top (`offset`) while the
wash is up and again after the settle window.

## The numbers (scroller viewport 694px, row height 22px)

| case | before offset | after offset | before scrollTop | after scrollTop |
|---|---|---|---|---|
| deep-cold (`n0131`, cold load) | 335.6 | **0.1** | -10961 | -10625.5 |
| warm (same row re-jumped) | 335.6 | **0.1** | -10961 | -10625.5 |
| very-top (`n0001`, the oldest) | 169 | **0** | -32102 (the min clamp) | -31933 |
| near-newest (`n0200`, the clamp case) | 655.6 | 655.6 | 0 | 0 |

Short viewport (`--window-size 1380x650`, scroller 444px):

| case | before offset | after offset | before scrollTop | after scrollTop |
|---|---|---|---|---|
| deep-cold | 210.6 | **0.1** | -11086 | -10875.5 |
| warm | 210.6 | **0.1** | -11086 | -10875.5 |
| very-top | 169 | **0** | -32352 (the min clamp) | -32183 |
| near-newest | 405.6 | 405.6 | 0 | 0 |

Reading the numbers: BEFORE's deep-cold readings are `(viewport − row)/2` —
335.6 = (694−22)/2, 210.6 = (444−22)/2 — the row's centre met the viewport's
middle, the centring contract; the very-top jumps stopped at the min clamp
169px short of the top; the nearest-end jumps clamped at 0 (the documented
boundary, unchanged by the rule and now asserted). AFTER lands 0–0.1px at the
top in every reachable case, at both viewports, cold (0.2–0.3s) and warm
(1–4ms).

The probe's own checks: **after = 17 checks PASSED, rc=0**; before = rc=1 with
exactly the three anchor checks failing (the near-newest clamp check passes on
both, by rule — it has no anchor to reach).

## Frames

`rail-jump-<case>-before.png` / `rail-jump-<case>-after.png` for the four cases,
plus `rail-jump-short-deep-cold-{before,after}.png` for the short-viewport
pass. Each is the state at the wash (the row highlighted) after the jump.

## Notes

- The rail's jump and the search overlay's share this leg
  (`jumpToEntry`/`ensureReachable`), so one change covers both; no reason was
  found to keep a second landing rule for search hits.
- The hover card's text is frozen at open (the naming warm can no longer swap
  it mid-hover; the warmed text is what the next hover shows) and the tick and
  card share one `checkpointTurnLabel` formatter — the vocabulary item.
- `900x650` was dropped as the short pass: at 900px the sidebar's session row
  is not present for the scene's open flow, so the pass uses `1380x650`
  (same chrome, a 444px scroller) instead. The driver's `--window-size` takes
  the space-separated form; `--window-size=WxH` is silently ignored.
