# Palette keys and the Unread pin - rendered evidence

Three frames from the app's own rig for issues **#761** and **#760**, taken over
a catalogue that actually carries an unread conversation: a real Electron launch
of the built app in `headless` window mode, driven over CDP's own input
pipeline, against the sidebar row-space set's stand-in daemon (six
conversations, one carrying the unread mark's own `attention.unseen` shape).

## The command

```sh
# 1. the stand-in daemon, on a port the page's own CSP allows
node docs/evidence/sidebar-row-space/harness/stub-daemon.mjs \
  --port 8080 --records <records> > <stub.log> 2>&1 &

# 2. the app, built from this branch's tree pointed at that daemon
#    (npm_config_verify_deps_before_run=false because pnpm 12.6's preflight
#    installs into the worktree; the repo's own .env supplies the other keys)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  npm_config_verify_deps_before_run=false pnpm build

# 3. one launch, one theme
LOCAL_OPERATOR_DESKTOP_TOKEN=stub node scripts/renderer-driver.mjs \
  --scene palette-unread \
  --backend http://127.0.0.1:8080 \
  --backend-records <records> \
  --seed-onboarding-complete \
  --out <dir> --window-size 1380x900
```

The scene is `scripts/renderer-driver.mjs`'s `palette-unread`, committed with
this set (`ac810cefd59`). `run.log` is its full output at the head the frames
were taken at - **30 PASS, 0 FAIL** - and `stub-requests.log` is the daemon's
own request log beside it (the catalogue read the pin draws on:
`GET /v1/desktop/sessions?...include_archived=true -> 200 rows=6`; the typed
pass's `sessions/search?q=release -> 200 rows=1`).

One theme (`localOperatorDark`), 1380x900 at dpr 2 - the committed `.webp`
files are `cwebp -q 90` conversions of the run's PNGs, un-resized.

## The frames

| file | md5 | what it shows |
| --- | --- | --- |
| `switcher-unread/localOperatorDark.webp` | `9789f06986cd0e0a067a6cac8a7bd403` | The switcher's empty state - what Cmd/Ctrl+P opens, reached here by typing its `#` seed. The query field reads `#` and the scope chip `# Chats`. The **Unread** section is pinned at the top, holding the fixture's one unseen conversation ("Quarterly retention sweep and the transcripts it dropped") with the selection on it (its ground and the `Open ↵` verb). Below it, **Chats** lists the other five conversations in catalogue order, and the pinned row does NOT repeat there. Behind the scrim, the sidebar draws the same conversation with its unread mark; the scene asserts that mark is painted BEFORE the palette opens (and nowhere else in the list), so this frame is one fact read twice rather than a palette drawn over nothing. |
| `switcher-ctrl-n/localOperatorDark.webp` | `53cb5912d04d948336aea4dc119c9401` | The same state after a real CDP `Ctrl+N` (a `keydown` through `Input.dispatchKeyEvent` with the Control bit and no text, the way a command chord travels): the selection has moved one row DOWN - off the pinned row and onto the first Chats row ("Invoice reconciliation", its ground and `Open ↵` now). The pair is what carries the step; the run log's `aria-activedescendant` readings (`chat-b3f1a09c7d52` -> `chat-2d5ad5da0025`) are what discriminate it, and a check asserts the same press did NOT also start a new chat. |
| `legend-typed/localOperatorDark.webp` | `8abd6c43cd6b9415bd063c50621964f3` | A typed query (`release`): the pin is gone - it applies to the empty state only - and the footer's key legend is the typed-search variant: `↑ ↓ Ctrl N Ctrl P` to move, `↵` to run, `esc` to close. The `Ctrl N` / `Ctrl P` caps are what this change adds; this frame is the design round's artifact for that copy. |

A repeat run of the same command at the same head produced byte-identical PNGs
(`md5 3b2a3189a90271a73beef852bdd5d135`, `c1a237af0b24adeec4c3b02fb676d6aa`,
`9ffc2d3c34833bca83d29f9688bb30f`), so the committed frames are the settled
state rather than a phase of one.

## What these frames cannot prove

- **`Ctrl+P` is not pressed anywhere in this set.** While the window is focused
  and visible, main's `before-input-event` owns that chord (it re-seeds the
  palette to the conversations view rather than closing it; unchanged by this
  change), and a `headless` window is by construction neither focused nor
  visible - so a press here would reach the renderer over a path the operator's
  app never takes. The renderer half of the pair is pinned in
  `scripts/palette-shortcut.test.mjs`, and the two bindings' coherence is
  stated where the change is reviewed rather than photographed here.
- **A still cannot show a press.** The chord's effect is carried by the PAIR of
  switcher frames plus the `aria-activedescendant` readings in `run.log`; the
  pixels alone could not separate "the chord moved the selection" from "the
  selection was somewhere else". The walk's arithmetic - wrap at both ends, the
  shift/alt refusals, and the still-refused modified arrows - stays in the
  pure-function tests, not in these pixels.
- **`#` is TYPED, not seeded by the Cmd/Ctrl+P door.** The seed state is the
  state the hook produces (`CONVERSATION_SWITCHER_SEED`); the hook itself is
  unreachable in a headless run, per the previous point.
- **This is not QA's walk.** The checks in `run.log` are this rig's own
  assertions; the independent end-to-end pass over the live app is QA's round,
  and this set is the design round's artifact of record.

The run is isolated from the operator's state - scratch `HOME`, config dir,
profile and log directory; its own backend on 8080 - and its own log carries
the readings that prove it (`the app holds NO connection to the operator's own
backend (http://localhost:1111)`), which is what makes these frames
publishable.
