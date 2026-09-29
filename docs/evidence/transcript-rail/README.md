# `transcript-rail` — the checkpoint rail, driven end to end against a real manifest

Fourteen frames (seven states, two palettes) of the REAL app on an isolated
daemon, from the repository's own driver scene `--scene transcript-rail`
(`scripts/renderer-driver.mjs`). Nothing on screen is stubbed: every tick is
the daemon's own derivation (`sessions.checkpoints`, BE-1) from transcript
journals written into the run's config root before its daemon started, in the
journal's own row format — `scripts/transcript-rail-fixture.mjs`, in the shapes
`local-operator`'s `tests/unit/session/test_transcript_index.py` pins against
the S3 spike. Two conversations: 200 turns (402 checkpoints, one steered turn
at 120, two non-complete outcomes, ~1,400 rows) for the rail's own states, and
320 turns (~2,240 rows) for the refusal, whose oldest tick is beyond the near
path's budget from a fresh read.

| file | state | what it shows |
| --- | --- | --- |
| `transcript-rail-density-{dark,light}.png` | the rail at 402 ticks | the density case: ticks are seq-proportional down the scroller's reserved right gutter, overlap allowed at this size (v1) and the frame is the "must not look broken" reading |
| `transcript-rail-hover-user-{dark,light}.png` | a user tick's card | the press-free hover card, anchored side-left: the message text, bounded with internal scroll |
| `transcript-rail-hover-completion-{dark,light}.png` | a completion tick's card | fallback name (`Turn N`) + `Turn N of M` + the naming line. Naming is BE-2's and is not on this backend, so `Generating name…` is the honest state the card shows |
| `transcript-rail-jump-before-{dark,light}.png` | before the jump | the newest view, the target ~560 rows back and not loaded |
| `transcript-rail-jump-after-{dark,light}.png` | the cold jump's landing | the wash (`data-jump-highlight`) on the STEER row `s0120` — a row the collapse hides inside its bar, so the landing is the expand-first walk's own proof; the scene asserts the highlighted record is exactly `s0120` |
| `transcript-rail-reduced-motion-{dark,light}.png` | the wash under `prefers-reduced-motion: reduce` | the static ground (the scene reads `animationName: none` back off the row), emulated through CDP rather than assumed |
| `transcript-rail-refusal-{dark,light}.png` | the deep conversation's oldest tick | the INFO toast with the shipped sentence. The first refusal walks from a fresh read and refuses on the PAGE budget (the row never arrives); the second, on a store that has walked, refuses on the MOUNT budget (the row arrives, too far back) — both arms of D7's refusal, one per palette |

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
# the worktree rebuilt against it (the four auth vars to placeholders is
# enough for a local build: scripts/vite-plugins/replace-backend-config.ts
# refuses to compile without them set, and a placeholder satisfies it)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build
# the scene
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene transcript-rail \
  --backend http://127.0.0.1:8080 --backend-records "$RIG/config/run/serve" \
  --seed-onboarding-complete --out "$RIG/frames"
```

## What the run measured

The scene's own log: **ALL CHECKS PASSED, 51 checks**, 14 frames. Press → the
`data-jump-highlight` attribute appearing, taken driver-side around the press
(the scene's `[note] jump timings` lines):

- `localOperatorDark` — cold **331 ms** (the loader's pages + the 243-row
  mount, from a 36-row window), warm **5 ms** (a loaded row: reveal + scroll
  alone), reduced-motion arm **3 ms**;
- `localOperatorLight` — cold 15 ms, warm 6 ms, reduced-motion 4 ms. The light
  pass's "cold" is load-free by construction: the restructure that fixed an
  interleaving flake keeps the first conversation open across both passes, so
  its store is already loaded — the loader's own number is the dark pass's.

Two knocks worth recording, both from the scene's own construction rather than
the product: (1) a physical pointer press on a tick at this density fired
nothing in the first clean pass, so the refusal leg presses through the DOM's
own `click()` with the real pointer, the driver's synthetic `press` and the
keyboard as recorded fallbacks; (2) the first runs drove the refusal on the
200-turn conversation, whose oldest row the near path can still reach — the
detail there was `rows 36->601` and a landing, not a refusal — which is why
the refusal has its own deeper conversation.

## Notes

- The warm op (`sessions.checkpoints.warm`, BE-2) is not on the backend this
  ran against; the rail's hover warms, the daemon answers 404, and the hook
  degrades with ONE warn per conversation (`checkpoint naming is unavailable;
  the cards keep their fallback text`) — the console line is in the run log,
  and the cards' fallback text is what the hover frames show.
- The daemon's route resolves a session by its 12-hex id; a journal under any
  other directory name lists but refuses (`Requested session … not found`) —
  measured while preparing this set, and the reason the fixtures' ids are
  `be1a9fef0001` / `be1a9fef0002`.
