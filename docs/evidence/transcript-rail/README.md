# `transcript-rail` — the checkpoint rail, driven end to end against a real manifest

Twenty-four frames (twelve states, two palettes) of the REAL app on an isolated
daemon, from the repository's own driver scene `--scene transcript-rail`
(`scripts/renderer-driver.mjs`). Nothing on screen is stubbed: every tick is
the daemon's own derivation (`sessions.checkpoints`, BE-1) from transcript
journals written into the run's config root before its daemon started, in the
journal's own row format — `scripts/transcript-rail-fixture.mjs`, in the shapes
`local-operator`'s `tests/unit/session/test_transcript_index.py` pins against
the S3 spike. Four conversations: 200 turns (402 checkpoints, one steered turn
at 120, ~1,400 rows) for the rail's own states; 320 turns (~2,240 rows) for the
refusal, whose oldest tick is beyond the near path's budget from a fresh read;
6 turns (12 discrete ticks) for the sparse rail, the bounded long-message card
and the error outcome card; and a ~200k-row conversation for the building mark.

| file | state | what it shows |
| --- | --- | --- |
| `transcript-rail-density-{dark,light}.png` | the rail at 402 ticks | the density case: ticks are seq-proportional down the scroller's reserved right gutter, overlap allowed at this size (v1) and the frame is the "must not look broken" reading |
| `transcript-rail-hover-user-{dark,light}.png` | a user tick's card | the press-free hover card, anchored side-left: the message text, bounded with internal scroll |
| `transcript-rail-hover-completion-{dark,light}.png` | a completion tick's card | fallback name (`Turn N`) + the outcome row + `Turn N of M` + the naming line. Naming is BE-2's and is not on this backend, so `Generating name…` is the honest state the card shows |
| `transcript-rail-jump-before-{dark,light}.png` | before the jump | the newest view, the target ~560 rows back and not loaded |
| `transcript-rail-jump-after-{dark,light}.png` | the cold jump's landing | the wash (`data-jump-highlight`) on the STEER row `s0120` — a row the collapse hides inside its bar, so the landing is the expand-first walk's own proof; the scene asserts the highlighted record is exactly `s0120` AND that the landed row's rect sits inside the scroller's, with the viewport actually moved (the D1 fix's own reading) |
| `transcript-rail-press-density-{dark,light}.png` | the physical pointer press at density | a mid-rail point scanned because only a point whose topmost element is the tick is pressable at 402 ticks, pressed with the REAL pointer: the wash lands on `n0092` and the scene asserts the same in-view + moved terms as the keyboard jumps |
| `transcript-rail-reduced-motion-{dark,light}.png` | the wash under `prefers-reduced-motion: reduce` | the static ground (the scene reads `animationName: none` back off the row), emulated through CDP rather than assumed, with the landing's in-view terms asserted |
| `transcript-rail-refusal-{dark,light}.png` | the deep conversation's oldest tick | the INFO toast with the shipped sentence. The first refusal walks from a fresh read and refuses on the PAGE budget (the row never arrives); the second, on a store that has walked, refuses on the MOUNT budget (the row arrives, too far back) — both arms of D7's refusal, one per palette; the press is layered (DOM click first, then the real pointer, the synthetic press, the keyboard) and the detail names the route |
| `transcript-rail-sparse-{dark,light}.png` | the sparse rail | 12 ticks at hex-pitch: the discrete-tick state the density frames cannot show; the scene asserts the count and a minimum gap between neighbours |
| `transcript-rail-card-bounded-{dark,light}.png` | the bounded user card | turn 2's ~2,000-character message in the card: the scene asserts `scrollHeight > clientHeight` on the bounded element, so the internal scroll is a measured fact |
| `transcript-rail-card-outcome-{dark,light}.png` | the outcome row | the error turn's completion card: the manifest's own outcome (`Error`) + `Turn 3 of 6`. The fixture's markers carry `details.kind` and land AFTER their `attention_started`, which is what makes the deriver emit an outcome at all |
| `transcript-rail-building-{dark,light}.png` | the building mark | the ~200k-row conversation, made STALE by the leg (one appended row) before each capture: the stale manifest's ticks stay painted and the top shimmer is up while the refresh runs. Deterministic on a warm cache because the append is the leg's own step |

## What produced them

```sh
RIG=<scratch>/be1-run
# the fixtures, into the run's own config root
node scripts/transcript-rail-fixture.mjs "$RIG/config" 200
cat >"$RIG/config/config.yml" <<'YAML'
values:
  hosting: test
  model_name: mock-model
YAML
# an isolated daemon this run owns, from local-operator's merged main
# (BE-1: `sessions.checkpoints`), a bearer of this run's own choosing
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  HOME="$RIG/home" LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" \
  "$LO_WORKTREE/.venv/bin/local-operator" serve \
  --host 127.0.0.1 --port 8080 --hosting test --model mock-model &
# the worktree rebuilt against it; the four auth vars to placeholders is
# enough for a local build (scripts/vite-plugins/replace-backend-config.ts
# refuses to compile without them set, and a placeholder satisfies it) -
# AND `VITE_PUBLIC_POSTHOG_HOST` must be exported to a real value: this
# worktree's `.env` carries it EMPTY, a build inlines "", and the renderer
# refuses to boot ("PostHog host must be a valid URL") before the driver arms
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build
# the scene
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene transcript-rail \
  --backend http://127.0.0.1:8080 --backend-records "$RIG/config/run/serve" \
  --seed-onboarding-complete --out "$RIG/frames"
```

## What the run measured

The scene's own log: **ALL CHECKS PASSED, 73 checks**, 24 frames. Press
→ the `data-jump-highlight` attribute appearing, taken driver-side around the
press (the scene's `[note] jump timings` lines):

- `localOperatorDark` — cold **613 ms** (the loader's pages + the
  mount, from a small window), warm **41 ms** (a loaded row: reveal +
  scroll alone), reduced-motion arm **32 ms**;
- `localOperatorLight` — cold 57 ms, warm 67 ms,
  reduced-motion 6 ms. The light pass's "cold" is load-free by
  construction: the restructure that fixed an interleaving flake keeps the
  first conversation open across both passes, so its store is already loaded —
  the loader's own number is the dark pass's.

Round 1's knocks, both now ROOT-CAUSED and fixed rather than worked around:

1. **The physical press "fired nothing" — two causes, both real.** (a) The
   jump itself was a no-op: `scrollRegionToCenter` clamped its offset with the
   normal-scroller bound (`Math.max(0, ...)`) while the transcript's scroller is
   `flex-col-reverse` (0 at the newest row, negative toward the oldest), so an
   above-viewport target assigned 0 and the wash painted off-screen; the fix
   names the axis at the call site (`"reversed"` → `Math.min(0, ...)`, design
   round 1's D1). The artifact-level reading: the wash band in this set's
   `jump-after-dark` measures **100,780** green-lean pixels (`g > r + 6 &&
   g > b + 10`, `24 < g < 70`) in the transcript area against **0** at the same
   filter in the committed round-1 frame. (b) The scene's own press helper was a scene-local copy that
   the module-level `clickPoint(cdp, x, y)` shadowed-across: its call sites
   passed the module's argument shape into the copy's, so the dispatched point
   was the client object in `x` and the scan's x in `y` — the press landed
   nowhere while the hit test said the tick was topmost (the at-point stack,
   added to the failing check's detail, is what named it). One helper now, one
   signature; the press leg is an assertion, not a recorded fallback, and the
   refusal's pointer route is a working second route again.
2. **The refusal's 200-turn conversation was reachable from a fresh read** —
   measured (the detail was `rows 36->601` and a landing, not a refusal), which
   is why the refusal has its own deeper conversation; that reading stands.

## Notes

- The warm op (`sessions.checkpoints.warm`, BE-2) is not on the backend this
  ran against; the rail's hover warms, the daemon answers 404, and the hook
  degrades with ONE warn per conversation (`checkpoint naming is unavailable;
  the cards keep their fallback text`) — the console line is in the run log,
  and the cards' fallback text is what the hover frames show.
- The daemon's route resolves a session by its 12-hex id; a journal under any
  other directory name lists but refuses (`Requested session … not found`) —
  measured while preparing this set, and the reason the fixtures' ids are
  `be1a9fef0001`–`be1a9fef0004`.
- The building leg appends one row to the bulk session's journal before each
  capture: it makes the index stale deterministically (a fresh build exceeds
  the backend's first-paint wait, so the read answers `building`), and each
  run rewrites all four fixtures anyway, so no state accumulates.
- The completion cards now show the OUTCOME row (`Complete` / `Error` /
  `Interrupted`) because the fixture lands `attention_started` BEFORE its user
  row and carries `details.kind` on the marker — the two facts the deriver's
  outcome rules read (`transcript_index.py`), both measured against the empty
  card this set first photographed.
