# `transcript-rail` — the checkpoint rail, driven end to end against a real manifest

Twenty-four frames (twelve states, two palettes) of the REAL app on an isolated
daemon, from the repository's own driver scene `--scene transcript-rail`
(`scripts/renderer-driver.mjs`). RE-SHOT AGAIN for the round-1 remediation
(D1: the frame's own scrollbar hidden; D2/U1: the state ladder wired from the
reader's own position with the track following it; the U3 order fix's `z-10`)
at head `7ebcc07ac4`; ALL CHECKS PASSED (81) on this re-shoot - the same count
as the first re-shoot, which rode the rail rework (the dsh geometry, the
tooltip card, and the jump's loader-backed walk) at `86e4539dd7`. Nothing on screen is stubbed: every tick is
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
| `transcript-rail-density-{dark,light}.png` | the rail at 402 ticks | the density case: short HORIZONTAL dashes (20x2 px) on a fixed 10px pitch, right-aligned in the 28px frame over the scroller's reserved gutter; overlap is impossible by construction and the track scrolls internally past its band, so the frame is the "must not look broken" reading. The ladder now PAINTS (round 1, D2/U1): the turns outside the resident window wear the 40%-scale arm at 75% opacity, the loaded ones sit at rest, and the reading position's mark is at full scale with the track scrolled to it, and the frame's own scrollbar is gone (round 1, D1 - the mask's fades say "more above/below"; the wide pill at the app's right edge is the transcript scroller's own, not this band's) |
| `transcript-rail-hover-user-{dark,light}.png` | a user tick's card | the press-free hover card, anchored side-left, `role=tooltip` and pointer-events-none: the message text, clamped to three lines |
| `transcript-rail-hover-completion-{dark,light}.png` | a completion tick's card | fallback name (`Turn N`) + the outcome row + `Turn N of M` + the naming line. Naming is BE-2's and is not on this backend, so `Generating name…` is the honest state the card shows |
| `transcript-rail-jump-before-{dark,light}.png` | before the jump | the newest view, the target ~560 rows back and not loaded |
| `transcript-rail-jump-after-{dark,light}.png` | the cold jump's landing | the wash (`data-jump-highlight`) on the STEER row `s0120` — a row the collapse hides inside its bar, so the landing is the expand-first walk's own proof; the scene asserts the highlighted record is exactly `s0120` AND that the landed row's rect sits inside the scroller's, with the viewport actually moved (the D1 fix's own reading) |
| `transcript-rail-press-density-{dark,light}.png` | the physical pointer press at density | a mid-rail point scanned because only a point whose topmost element is the tick is pressable at 402 ticks, pressed with the REAL pointer: the wash lands on `n0092` and the scene asserts the same in-view + moved terms as the keyboard jumps |
| `transcript-rail-reduced-motion-{dark,light}.png` | the wash under `prefers-reduced-motion: reduce` | the static ground (the scene reads `animationName: none` back off the row), emulated through CDP rather than assumed, with the landing's in-view terms asserted |
| `transcript-rail-refusal-{dark,light}.png` | the deep conversation's oldest tick | the INFO toast with the shipped sentence. The first refusal walks from a fresh read and refuses on the PAGE budget (the row never arrives); the second, on a store that has walked, refuses on the MOUNT budget (the row arrives, too far back) — both arms of D7's refusal, one per palette; the press is layered (DOM click first, then the real pointer, the synthetic press, the keyboard) and the detail names the route |
| `transcript-rail-sparse-{dark,light}.png` | the sparse rail | 12 ticks at hex-pitch: the discrete-tick state the density frames cannot show; the scene asserts the count and a minimum gap between neighbours |
| `transcript-rail-card-bounded-{dark,light}.png` | the bounded user card | turn 2's ~2,000-character message in the card: the scene reads the computed `-webkit-line-clamp` (three lines) and `overflow-y: hidden` off the element, so the clamp is a measured fact |
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
# the local-operator checkout that serves the manifest: a worktree of the
# operator's checkout at the ref the round-1 re-shoot used,
# 12663daa283801244735f4e106c46ebcee42845a - the a5007c8e64455fd07134037e639afde0ccb189b3
# ref's own line plus two CI-hardening commits (a tui/session load fix and a
# test pin; no desktop route moves), whose first-parent carries BE-1's #1712
# and #1718. #1721's naming op is NOT on this line - which is why the hover
# cards show their fallback text and the hook logs its 404 warn.
LO_WORKTREE="$RIG/lo"
# an isolated daemon this run owns, from that ref (BE-1:
# `sessions.checkpoints`), a bearer of this run's own choosing. The port is a
# flag on all three lines below; the round-1 re-shoot used 8087 (the first
# re-shoot used 8081 because 8080 was held by the operator's live daemon,
# left untouched).
PORT=8087
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  HOME="$RIG/home" LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" \
  "$LO_WORKTREE/.venv/bin/local-operator" serve \
  --host 127.0.0.1 --port $PORT --hosting test --model mock-model &
# the worktree rebuilt against it; the four auth vars to placeholders is
# enough for a local build (scripts/vite-plugins/replace-backend-config.ts
# refuses to compile without them set, and a placeholder satisfies it) -
# AND `VITE_PUBLIC_POSTHOG_HOST` must be exported to a real value: this
# worktree's `.env` carries it EMPTY, a build inlines "", and the renderer
# refuses to boot ("PostHog host must be a valid URL") before the driver arms
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com \
VITE_LOCAL_OPERATOR_API_URL="http://127.0.0.1:$PORT" pnpm build
# the scene
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene transcript-rail \
  --backend "http://127.0.0.1:$PORT" --backend-records "$RIG/config/run/serve" \
  --seed-onboarding-complete --out "$RIG/frames"
```

## What the run measured

The scene's own log: **ALL CHECKS PASSED, 81 checks**, 24 frames
(the round-1 re-shoot at `7ebcc07ac4`; the first re-shoot, also 81 checks,
rode the rework at `86e4539dd7`). Press
-> the `data-jump-highlight` attribute appearing, taken driver-side around the
press (the scene's `[note] jump timings` lines):

- `localOperatorDark` — cold **291 ms** (the loader's pages + the mount, from a
  small window; 36 -> 257 mounted rows), warm **3 ms** (a loaded row: reveal +
  scroll alone), reduced-motion arm **3 ms**;
- `localOperatorLight` — cold **3 ms**, warm **4 ms**, reduced arm **3 ms**: the
  second pass runs on the store the first already walked, so its cold arm is a
  warm re-jump and is labelled as such rather than read as a cold number.

### What the round-1 remediation changed in these frames

- **Round-1 D1** — the 28px frame's own 8px scrollbar is gone
  (`[&::-webkit-scrollbar]:hidden`): it crossed the dash ends and its
  mask-dimmed strip sat at the band's bottom. Before/after: the earlier frame
  carried the thumb over the top ~4 marks; this set does not.
- **Round-1 D2/U1 (the ladder, wired)** — `loadedIds`/`activeId` arrive from
  the reader (`canonical-transcript.tsx`: the store's record ids, plus an
  rAF-throttled reading position), the track follows the active mark, and the
  unloaded arm composites at 75%: rest 0.6 / preview 0.9 / active 1.0 /
  unloaded 0.4 at 75%, worst light theme 3.17:1 (rosePineDawn; computed
  against `themes.generated.css` and calibrated on the review's own
  2.42/2.46 at 60%).
- **Round-1 U3 and its z** — the rail is the column's first tab stop; moving
  it first needed `z-10` (the scroller below it is `relative` +
  `translateZ(0)`, so tree order handed it every pointer), and the scene's
  hover/press legs are what caught the absence (they went dead until it
  carried z).

### The hover trace (before / after)

Both halves ran the SAME driver file (`--scoped-case hover-trace`) with only
`process.cwd()` differing: the before half is `a0cdaa759f` (the pre-rework
tree; a disposable worktree with its own build, reaped afterwards), the after
half this branch's head. Two deterministic legs over the density rail - six
dwell stations at 240ms, then forty sweep steps at 12ms - with the renderer's
rAF timeline and the rail subtree's DOM mutations sampled in-page.

| reading | before (`a0cdaa759f`) | after (this branch) |
| --- | --- | --- |
| frames collected | 308 | 310 |
| frame p50 / p95 / max (ms) | 8.3 / 9.9 / 23.8 | 8.3 / 9.9 / 16.2 |
| frames over 25 / 50 ms | 0 / 0 | 0 / 0 |
| card-up frames | 145 | 115 |
| first open after the trace began (ms) | 141 | 388 |
| rail-subtree DOM mutations, dwell / sweep | 30 / 0 | 24 / 96 |

WHAT THIS DOES AND DOES NOT SAY. At the density case (402 ticks on a 10px
pitch) neither tree puts a frame over the budget, so the memoization claim is
NOT a frame-pacing effect at this size and the trace does not report one. The
mutation column measures the two DESIGNS: the old rail had no per-mark hover
state (one aria attribute and the portal card moved per open), while the rework
repaints the previewed and active marks deliberately and holds the rest still
via the memo. The first-open latencies differ because the arms differ (a
pointermove on a 10px row at a 60ms intent against the old 24x12 row's
pointerenter at 120ms). Measured under `headless`, main-thread only
(`backgroundThrottling` is off in the non-normal modes); a shown window's
compositor cost and the operator's own transcript size are not measured here.

THE VIRTUALIZATION CALL for the 267-mark manifest: not needed on this evidence
- the track scrolls internally at a fixed pitch, 402 marks put no frame over
budget, and each mark is one 28x10 row - and it is revisitable if manifests
grow by an order of magnitude.
