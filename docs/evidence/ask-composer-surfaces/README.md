# One composer for every non-chat send: the ask page, the project strip, the mini popup

Frames from `scripts/renderer-driver.mjs` in `headless` window mode at 1380x900,
every run against an **isolated** daemon on 8080 (a scratch config root and the
run's own token; the app holds a connection to it and none to the operator's own
backend on 1111 — the driver asserts both directions on every run).

`before/` is the pristine tree at `be8acfbfe28`. `after/` is the branch head.
Three scenes, one directory each, both palettes.

## What each frame shows

**`agents-ask/`** — the Agents tab's ask page (`--scene agents-ask`, added by
this change). Four states per palette, all 1380x900:

| frame | what it shows |
| --- | --- |
| `…-empty` | the pane at rest: the heading, the standing sentence, the box on the chat column with its idle readings, the example chips, "Or add an agent by hand" |
| `…-focused` | the same, with the caret in the box and the box's focus ring drawn (the state the operator's report was about: a card's border beside a control's ring read as an inset card) |
| `…-typed` | the operator's own sentence in the box, the invitation gone and the send control armed |
| `…-settled` | the run the box started, finished: the run strip's `Finished …`, its answer, the box back at idle |

**`project-detail/`** — the project detail sheet with the `Send to` strip
(`--scene project-detail`, pre-existing). Six frames per palette:

| frame | what it shows |
| --- | --- |
| `…-sheet` | the seeded project's detail, with the strip **at rest and unfocused** — the frame D1 was measured on, and the one that shows the box's boundary off its card |
| `…-quick-send` | the strip with a message typed: the `Send to` target, the readings row, the field focused |
| `…-composer` | the page scrolled to the composer band — the **new-chat composer** this change aligns the ask page to (box on the 810px measure, `elevated` over `canvas`) |
| `…-delivered` | the strip after Send: the message admitted into the selected session (the daemon's own transcript, not the painted echo) |
| `…-linked` | the linked-sessions list after a session is created and linked from the picker |
| `…-start-session` | the picker's `Start session` control on screen, mid-flow |

**`mini-view/`** — the mini quick-send popup (`--scene mini-view`, pre-existing),
one directory per palette (the scene names its frames without a palette suffix):
`empty`, `typing`, `long`, `sheet`, `error-card`, `dictating`, `starting`,
`sent`.

## The two facts the agents-ask claim rests on, as numbers

The scene measures the DOM it photographs and prints the numbers beside the
frames; two of them are ASSERTED, so the before run fails them and the after run
passes:

| | box centre − pane centre | box.left − heading.left | checks |
| --- | --- | --- | --- |
| `before/` | **104.0px** (box 609..1111 in a pane 548..1380; centres 860 vs 964) | **37.0px** (box left 609, heading left 572) | 13 PASS, 3 FAIL |
| `after/` | **0.0px** (box 596..1332, centres 964 vs 964) | **0.0px** (both 596) | 16 PASS, 0 FAIL |

The box also grows with the column: 502px wide before (capped by the old
`max-w-xl` card), 736px after (the chat column's own measure), and the card's
border and ground are gone.

Two further after-only checks are what the before half cannot pass, and they are
the same facts the review rounds asked for: the idle box carries the readings
row (`[data-lo-session-strip]` with a `Model:` reading) and a prompt typed into
the box runs and settles. The before half reports **13 PASS, 3 FAIL** - the two
geometry checks above plus the idle-readings one, which is the change itself.

## The run, exactly

```sh
# 1. the app, built against the backend this run owns
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
  VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
  pnpm build:npm          # plain JS: this tree's bytecode step needs a babel
                          # plugin the provisioned node_modules does not link,
                          # and no frame here is about V8 bytecode

# 2. the daemon: a scratch config root, its HOSTING written into it
#    (a fresh root holds none, and every turn dies in HostingNotConfiguredError)
printf 'values:\n  hosting: test\n  model_name: mock-model\n  aida:\n    name: "Robo Damian"\n' > "$ROOT/config/config.yml"
LOCAL_OPERATOR_CONFIG_DIR="$ROOT/config" LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$ROOT/token.hex")" \
  local-operator serve --host 127.0.0.1 --port 8080 --hosting test --model mock-model &

# 3. the seed (one project titled "Rig detail", one milestone, one linked session)
python3 seed.py

# 4. one scene at a time, once per palette
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$ROOT/token.hex")" \
node scripts/renderer-driver.mjs --scene agents-ask \
  --backend http://127.0.0.1:8080 --backend-records "$ROOT/config/run/serve" \
  --seed-onboarding-complete --window-size 1380x900 \
  --theme localOperatorDark --out "$OUT/agents-ask"
```

**Which half used which driver.** `before/project-detail/` was captured at
`be8acfbfe28` with the driver as it stood then (that scene's selectors name the
hand-rolled field the base tree still mounts). Everything else — both
`agents-ask/` halves, `after/project-detail/`, and both `mini-view/` halves — was
captured with this branch's driver, because those scenes' selectors and legs are
what this change adds.

**Re-captures, and what a comparison here may claim.** The `after/`
`agents-ask` frames were re-cut twice after the first pass — once with the D6
inset fix and once, at the round-3 head, with D8 — so what is on disk is the
current head's geometry. Re-shooting a frame re-shoots the sidebar beside it, and
the sidebar's relative-time labels move between runs; a whole-frame difference
between two passes is therefore not a difference in this set's surface. Claims of
sameness in this set are scoped to the pane (`x >= 560 CSS`), where the three
non-settled states are identical across the re-shoots (0 differing pixels by
`magick compare -metric AE` in that crop; QA's reading was 4 px in the content
column). The whole-frame difference is ~292 px of sidebar chrome, ~1.5k by a
stricter crop and threshold.

## What this set does not claim

- **Not a live *running* ask-hero frame.** The settled state is framed
  (`agents-ask/…-settled`, and the scene asserts the run reaches it). The
  *working* state is not: on this rig the mock provider answers in milliseconds,
  so the window is sub-second and a capture pass would race it — an
  intermittently-present frame in a committed set is worse than a stated absence.
  The state itself is real (QA round 1 measured it end to end).
- **Not the ask page's dirty-edit refusal.** Reaching it needs a seeded
  definition to open and edit; the states photographed are the empty pane's.
- **Not the rename lane's own UI.** What IS proven: the name is RESOLVED, never
  literal. Every mini run's log carries `the frame addresses the seat by its
  resolved name`, `the placeholder names the same resolved name`, and — with
  `--backend` — `the frame renders the name the backend resolves, not a literal`,
  which cross-checks the frame against `GET /v1/desktop/aida`'s `name`. The rig's
  daemon is renamed to `Robo Damian` in its own config, so the frames read a name
  the code was never told. The app's own rename UI is not driven here.
- **Not a live dictation walk.** The mini scene's recording leg needs a Radient
  credential this rig does not have, so both halves report five `[FAIL]`s at that
  gate (`the mic is enabled before the walk presses it` and the four checks
  behind it) against 58 PASSes elsewhere — the same five in each half, which is
  why it reads as a rig precondition rather than as a finding about this change.
  The leg's own frames (`mini-view-dictating`, `mini-view-starting`,
  `mini-view-sent`) are still written, because the scene captures them before it
  fails.
- **Not the packaged app's IPC transport.** The renderer's desktop calls go over
  the dev/HTTP path, not `window.api.desktop`.
- **Not a full palette sweep.** Two palettes, as the design contract's review
  pair; the twelve-theme sweep belongs to the Storybook pipeline.

## The mini pair's readings row is HELD, not incidental

The mini's readings row is fed by a one-shot `sessions.get`, so what it shows
depends on the seat's own snapshot at capture time. Design round 1 (D3) measured
the ring reading flipping *across* the halves (`<0.1%/128k` in one, `0s` in
another) — a rig-state difference, not a code one, but one that made the
"verify-only" claim for the popup unevidenced. Both halves were re-shot for this
round with the daemon restarted over a wiped store immediately before **each
run**, so all four runs start from the same state.

The result is stronger than "held": `magick compare -metric AE` over the two
halves' mini frames returns **0 differing pixels** for fourteen of the sixteen
states, and two light-palette transients differ by 61px and 2266px of ~594k
(the `sent` flash's 2x30 sliver at x=52 and the compact sheet's 14x165 right
edge at x=1222) — neither in the readings row (x 700..1000), which is the zone
D3 measured. The popup's rendered surface is, to the pixel, the same surface in
both halves: that is what "verify-only" was claiming.
