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
this set (`ac810cefd59`; its legend check tightened by the round-1 remediation,
which re-captured this set at `298eb389124`). `run.log` is its full output at
the head the frames were taken at - **29 `[PASS]` lines and no `[FAIL]`** (a
`grep -c PASS` reads one more: the run's own `ALL CHECKS PASSED` trailer) - and
`stub-requests.log` is the daemon's own request log beside it (the catalogue
read the pin draws on:
`GET /v1/desktop/sessions?limit=500&include_archived=true -> 200 rows=6`; the
typed pass's `sessions/search?q=release&limit=100 -> 200 rows=1`).

One theme (`localOperatorDark`), 1380x900 at dpr 2 - the committed `.webp`
files are `cwebp -q 90` conversions of the run's PNGs, un-resized.

## The frames

| file | md5 | what it shows |
| --- | --- | --- |
| `switcher-unread/localOperatorDark.webp` | `9789f06986cd0e0a067a6cac8a7bd403` | The switcher's empty state - what Cmd/Ctrl+P opens, reached here by typing its `#` seed. The query field reads `#` and the scope chip `# Chats`. The **Unread** section is pinned at the top, holding the fixture's one unseen conversation ("Quarterly retention sweep and the transcripts it dropped") with the selection on it (its ground and the `Open ↵` verb). Below it, **Chats** lists the other five conversations in catalogue order, and the pinned row does NOT repeat there. Behind the scrim, the sidebar draws the same conversation with its unread mark; the scene asserts that mark is painted BEFORE the palette opens (and nowhere else in the list), so this frame is one fact read twice rather than a palette drawn over nothing. |
| `switcher-ctrl-n/localOperatorDark.webp` | `53cb5912d04d948336aea4dc119c9401` | The same state after a real CDP `Ctrl+N` (a `keydown` through `Input.dispatchKeyEvent` with the Control bit and no text, the way a command chord travels): the selection has moved one row DOWN - off the pinned row and onto the first Chats row ("Invoice reconciliation", its ground and `Open ↵` now). The pair is what carries the step; the run log's `aria-activedescendant` readings (`chat-b3f1a09c7d52` -> `chat-2d5ad5da0025`) are what discriminate it, and a check asserts the same press did NOT also start a new chat. |
| `legend-typed/localOperatorDark.webp` | `9c4de08fbdb37018d09458fd74605201` | A typed query (`release`): the pin is gone - it belongs to the `#`-seeded (chats-scoped) switcher state alone, not to every empty query - and the footer's key legend is the typed-search variant: `↑ ↓ Ctrl N` to move, `↵` to run, `esc` to close. The legend teaches `Ctrl+N` alone on purpose (design round 1, D1): `Ctrl+P` is bound - it steps wherever it arrives, and the QA/UX rigs measured that - but unreachable in the packaged app, where main's `before-input-event` owns the press and answers it with the switcher seed; advertising it as a movement key would promise something the app does not do. The footer draws ONE legend at a time - scope in a browse, this movement legend in a typed search - and that split is a recorded trade-off, not an oversight (design round 1, D2; the measured widths are in `docs/command-palette.md`). This frame was re-taken over the remediation's copy and is the design round's artifact of record. |

A repeat run of the same command at the same head reproduced both switcher
frames' PNGs byte for byte (`md5 3b2a3189a90271a73beef852bdd5d135`,
`c1a237af0b24adeec4c3b02fb676d6aa` - the run's PNGs, un-resized; the table
above lists the committed `.webp` conversions of them, a different pair for the
same frames) - and they also stand byte-identical to the original capture, so
their md5s in the table above are unchanged through this remediation. `legend-typed` carries a small re-render variance floor: the two
runs' PNGs differ in 68 pixels of 4,968,000, all of them one 2x34px vertical
glyph edge in the footer's key legend (antialiasing; RMSE 0.27%). The committed
legend frame is one of two equivalent settled states, not a byte-diff
measurement.

## What these frames cannot prove

- **`Ctrl+P` is not pressed anywhere in this set, and the footer no longer
  teaches it.** While the window is focused and visible, main's
  `before-input-event` owns that chord (it re-seeds the palette to the
  conversations view rather than closing it; unchanged by this change), and a
  `headless` window is by construction neither focused nor visible - so a press
  here would reach the renderer over a path the operator's app never takes. The
  renderer binding is still pinned in `scripts/palette-shortcut.test.mjs` (bound
  but not advertised), and the two bindings' coherence is stated where the
  change is reviewed rather than photographed here.
- **A still cannot show a press.** The chord's effect is carried by the PAIR of
  switcher frames plus the `aria-activedescendant` readings in `run.log`; the
  pixels alone could not separate "the chord moved the selection" from "the
  selection was somewhere else". The walk's arithmetic - wrap at both ends, the
  shift/alt refusals, and the still-refused modified arrows - stays in the
  pure-function tests, not in these pixels.
- **`#` is TYPED, not seeded by the Cmd/Ctrl+P door.** The seed state is the
  state the hook produces (`CONVERSATION_SWITCHER_SEED`); the hook itself is
  unreachable in a headless run, per the previous point.
- **The pin LEAVING once its mark clears is unreachable here by design.** A
  clear is a foreground-only receipt (`FOREGROUND_RECEIPT_OPS =
  {"sessions.seen","attention.seen"}`, `src/main/desktop-ipc.ts:52-55`; the
  guard refuses while the window is `!isVisible() || !isFocused()`, `:87-121`),
  and a headless window is neither. QA's round-1 attempt drove it as far as it
  goes here: the sidebar's bulk control rendered (`Mark all 1 read`), the press
  reached it (`hitTest: true`), and the app answered with its own refusal
  sentence - no receipt request left main, the mark stayed drawn, and no window
  was raised. QA's matrix carries the attempt; this set records the limit.
- **This is not QA's walk.** The checks in `run.log` are this rig's own
  assertions; the independent end-to-end pass over the live app is QA's round,
  and this set is the design round's artifact of record.

The run is isolated from the operator's state - scratch `HOME`, config dir,
profile and log directory; its own backend on 8080 - and its own log carries
the readings that prove it (`the app holds NO connection to the operator's own
backend (http://localhost:1111)`), which is what makes these frames
publishable.
