# The jump's landing: one fixed top anchor (issue #680)

Issue #680: clicking a rail tick (or a search hit) is meant to reveal a turn,
but the landing resolved at varying viewport positions — the centred scroll was
one synchronous read taken while the windowed mount and the collapse walk could
still move the layout, and the reversed axis's clamps made both content ends
ambiguous. The decided rule (recorded in the issue): **the target row's TOP at
the transcript scrollport's top, plus the transcript's own top-fade depth** —
one constant, re-measured over a bounded settle before the jump resolves.

## The rule, exactly

- **Anchor**: `target.top == scrollport.top + JUMP_ANCHOR_INSET_PX`, where
  `JUMP_ANCHOR_INSET_PX = TRANSCRIPT_TOP_FADE_PX = 24px`. The inset is not a
  taste: the scroller's mask ramps `transparent -> black` over its first 24px,
  so a landing at 0px sits entirely inside the ramp and reads dimmed — measured
  peak ink **189 against 238 unmasked** (design round 1's D1). The inset is
  derived from the fade's own constant (`shared/lib/transcript-fade.ts`), and
  `scripts/transcript-fade.test.mjs` pins the stylesheet's three carriers (the
  scroll-linked ramp's `from` stop, its `animation-range` offset, and the
  no-timeline fallback) against it, so a fade edit that forgets the jump fails
  CI rather than silently dimming every landing again.
- **The reading line moves with it**: `use-active-checkpoint.ts` resolves the
  active tick at `top + TRANSCRIPT_TOP_FADE_PX + 1` (was `top + 1`), because a
  row landed at `top + inset` fails a `top + 1` test and the rail would light
  the tick BEFORE the target (design's own correction to D1). The probe asserts
  the active tick equals the target after every jump.
- **Settle**: after the reveal, the anchor is re-measured each frame and
  re-applied while it drifts; it resolves when the position holds for two
  consecutive frames, bounded at the loader's settle plus two frames (8). A
  **newer settle supersedes an older one** (a module-level generation; the
  last jump wins, so two rapid presses cannot contend for each other's budget).
  A reader's own `wheel`/`pointerdown`/`touchstart`, or a scroll key
  (arrows, page keys, home/end, space), during the window stops the re-apply —
  the jump never yanks a steering reader.
- **Boundaries** (reversed axis): the nearest-end clamp (`scrollTop` 0) is the
  only allowed alternative, documented; the oldest-end browser clamp bounds the
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
# the light pass adds: --theme localOperatorLight
```

BEFORE = `origin/main` at `f9dbf8b455`; AFTER = the branch's anchored build.
The probe focuses the exact tick and presses Enter (the density-safe route),
captures the wash-instant still (the design frame), and reads the target row's
top relative to the scroller's top (`offset`), its peak text luma against a
same-frame painted reference row - from a POST-SETTLE capture, so a scroller
repaint lagging the DOM's landing cannot read a red for a property that holds
(UX round 1's U1) - the rail's active tick, and a 400ms sample of the arrival
wash's DOM lifetime (`fate`). The wash is re-asserted at the settle resolve
when the target arrives without one (QA round 2): a late mount commit that
strips it on a cold far jump gets the wash back at the moment the reader
arrives, and a fast jump's single wash is left alone. The card step opens a
completion's card, reads it, holds through a settle window and re-reads (the
frozen-text pin), then closes and reopens.

## The numbers (scroller viewport 694px, row height 22px)

| case | before offset | after offset | after luma (target/ref) | after scrollTop | active tick |
|---|---|---|---|---|---|
| deep-cold (`n0131`, cold load) | 335.6 | **24.1** | 238/238 | -10649.5 | n0131 |
| warm (same row re-jumped) | 335.6 | **24.1** | 238/238 | -10649.5 | n0131 |
| very-top (`n0001`, the oldest) | 169 | **24** | 238/238 | -31957 | n0001 |
| near-newest (`n0200`, the clamp case) | 655.6 | 655.6 | 238/none* | 0 | n0200 |

Short viewport (`--window-size 1380x650`, scroller 444px):

| case | before offset | after offset | after luma (target/ref) | after scrollTop | active tick |
|---|---|---|---|---|---|
| deep-cold | 210.6 | **24.1** | 238/238 | -10899.5 | n0131 |
| warm | 210.6 | **24.1** | 238/238 | -10899.5 | n0131 |
| very-top | 169 | **24** | 238/238 | -32207 | n0001 |
| near-newest | 405.6 | 405.6 | 238/238 | 0 | n0200 |

*At the tall viewport the settled frame's visible band holds no painted
reference row for this leg (mid/adj both read 32 - the rows near the fold),
so the check carries on its absolute full-ink bar (238 against the 200
threshold) and the note names it (`reference=none`); the short viewport has a
painted reference and compares 238/238.

Light palette (`--theme localOperatorLight`, default viewport): the same four
offsets (24.1/24.1/24/655.6), luma 237/237, 238/237, 237/237, 237/237 — the
fade blends toward the light canvas, and the target still reads at the
reference row's ink.

Reading the numbers: BEFORE's deep-cold readings are `(viewport − row)/2` —
335.6 = (694−22)/2, 210.6 = (444−22)/2 — the row's centre met the viewport's
middle, the centring contract; the very-top jumps stopped at the min clamp
169px short of the top; the nearest-end jumps clamped at 0 (the documented
boundary, unchanged by the rule and now asserted). AFTER lands 24–24.1px at the
scrollport's top in every reachable case — the fade's own depth, so the target
reads at FULL ink (238 against the same-frame reference; 189 was the dimmed
reading the design round rejected) — at both viewports and both palettes, cold
and warm, with the rail's active tick on the target in every leg.

The probe's own checks (the CURRENT probe runs **14 checks per pass**: offset,
peak-ink-vs-reference and active-tick for the four legs, plus the two card
steps): **after = 14 PASSED, rc=0 on all three passes** (default, short,
light). The BEFORE column is round 1's measurement, taken under the EARLIER
probe revision — 17 checks then (the same four legs, offset-only), rc=1 with
exactly the three anchor checks failing per pass, the near-newest clamp check
passing on both by rule — and the before frames therefore show the pre-anchor
build under that revision, not a re-run of today's checks.

## Frames

- `rail-jump-<case>-before.png` / `rail-jump-<case>-after.png` for the four
  cases (the before frames are the pre-anchor build's washed landings; the
  after frames are the anchored landings captured at the wash).
- `rail-jump-short-deep-cold-{before,after}.png` — the short-viewport pass.
- `rail-jump-deep-cold-light.png` — the light palette's deep-cold pass (D5).
- `rail-jump-card-open.png` — the hover card with a ready name and summary:
  "Turn 201 of 201 · Rework the retry path" plus the two-line summary (D2's
  frame; the naming was seeded into the rig's index cache, which is a fixture
  write, not an app path — the naming op is not on this daemon's ref).

## Notes

- The rail's jump and the search overlay's share this leg
  (`jumpToEntry`/`ensureReachable`), so one change covers both; no reason was
  found to keep a second landing rule for search hits.
- The hover card's text is frozen at open (the naming warm can no longer swap
  it mid-hover; the warmed text is what the next hover shows) and the tick and
  card share one `checkpointTurnLabel` formatter — the tick's accessible name
  is "Jump to turn N of M[, name]" / "Jump to your message in turn N of M,
  3:42 PM" (design D3).
- **The arrival wash's DOM lifetime is recorded, not assumed.** The wash is
  imperative (`paintJumpHighlight` sets `data-jump-highlight` and removes it
  1400ms later), and a late mount commit under load can replace or re-render
  the flashed node — the probe's `fate` timeline (per 40ms: `lit`/`alive`/
  `gone`) captures this, and the acceptance measures the LANDING (the target
  row read by id) so the geometry checks do not depend on the wash surviving
  the settle. A declarative flash that survives remounts is a transcript
  change and is recorded here as a follow-up candidate, not made in this PR.
- `900x650` was dropped as the short pass: at 900px the sidebar's session row
  is not present for the scene's open flow, so the pass uses `1380x650`
  (same chrome, a 444px scroller) instead. The driver's `--window-size` takes
  the space-separated form and now WARNS on `--window-size=WxH` (the `=` form
  used to be silently ignored; review round 1's NIT 2).
