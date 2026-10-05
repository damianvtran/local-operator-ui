# One composer for every non-chat send: the ask page, the project strip, the mini popup

Frames from `scripts/renderer-driver.mjs` in `headless` window mode at 1380x900,
every run against an **isolated** daemon on 8080 (a scratch config root and the
run's own token; the app holds a connection to it and none to the operator's own
backend on 1111 — the driver asserts both directions on every run).

`before/` is the pristine tree at `be8acfbfe28`. `after/` is this branch, built at
the same URL with the same daemon. Three scenes, one directory each:

| set | scene | frames |
| --- | --- | --- |
| `agents-ask/` | `agents-ask` (added by this change) | `empty`, `focused`, `typed` — per palette |
| `project-detail/` | `project-detail` | `sheet`, `quick-send`, `composer`, `delivered`, `linked`, `start-session` — per palette |
| `mini-view/` | `mini-view` | the popup's own states, per palette (`<palette>/` subdirectories: the scene names its frames without a palette suffix) |
## The two facts the agents-ask claim rests on, as numbers

The `agents-ask` scene measures the DOM it photographs and prints the numbers
beside the frames; two of them are ASSERTED, so the before run fails them and the
after run passes:

| | box centre − pane centre | box.left − heading.left |
| --- | --- | --- |
| `before/` | 104.0px (box 609..1111 in a pane 548..1380; centres 860 vs 964) | 37.0px (box left 609, heading left 572) |
| `after/` | 0.0px (box 596..1332, centres 964 vs 964) | 0.0px (both 596) |

The before runs report `[FAIL] the composer box is centred on the chat column…`
and `[FAIL] the box and the heading share one left edge…` (12 PASS, 2 FAIL); the
after runs report 14 PASS, 0 FAIL. A frame alone would show two pictures; these
are the readings that say what moved between them.

The box also grows with the column: 502px wide before (capped by the old
`max-w-xl` card), 736px after (the chat column's own measure), and the card's
border and `bg-surface` ground are gone.

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
mkdir -p "$ROOT/config" && printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$ROOT/config/config.yml"
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

## What this set does not claim

- **Not a live configuration run.** The ask page's own strip (`RunStrip`) and its
  settled summary need a working model behind the daemon; nothing here sends a
  prompt from that box, so `running` and `settled` have no frame on the hero
  surface. The box's live-run refusal is pinned by
  `scripts/agents-composer-mount.test.mjs` instead.
- **Not the ask page's dirty-edit refusal.** Reaching it needs a seeded
  definition to open and edit; the states photographed are the empty pane's.
- **Not a rename lane.** What IS proven: the name is RESOLVED, never literal. Every
  run's log carries `the frame addresses the seat by its resolved name`, `the
  placeholder names the same resolved name`, and - with `--backend` - `the frame
  renders the name the backend resolves, not a literal`, which cross-checks the
  frame against `GET /v1/desktop/aida`'s `name`. **The `after/` mini frames carry
  that rename**: the rig's config root was set to `values: {aida: {name: "Robo
  Damian"}}` before the after runs, so the `To:` line reads `Robo Damian` in
  frames the code was never told about (the before half reads `Aida`, its own
  daemon's default at capture time - the difference between the halves is that
  rename, not this change). The app's own rename UI is not driven here.
- **Not a live dictation walk.** The mini scene's recording leg needs a Radient
  credential this rig does not have, so both halves report five
  `[FAIL]`s at that gate (`the mic is enabled before the walk presses it` and the
  four checks behind it) against 58 PASSes elsewhere — the same five in each
  half, which is why it reads as a rig precondition rather than as a finding
  about this change. The leg's own frames (`mini-view-dictating`,
  `mini-view-starting`, `mini-view-sent`) are still written, because the scene
  captures them before it fails; the before half was re-captured with the same
  arms and the same daemon so the pair is like-for-like.
- **Not the packaged app's IPC transport.** The renderer's desktop calls go over
  the dev/HTTP path, not `window.api.desktop`.
- **Not a full palette sweep.** Two palettes, as the design contract's review
  pair; the twelve-theme sweep belongs to the Storybook pipeline.
