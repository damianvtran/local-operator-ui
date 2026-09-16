# The wake chip and the Wakes section, on the real app

Seven frames from the **built app**, driven headless against a **real isolated
backend** with **real wakes armed by the real CLI**. This is the set
`docs/composer-wakes.md` § 9 points at for the one thing a story structurally
cannot show: the PRESS, and the reveal landing in the pane.

## How it was taken

```bash
# an isolated store, a real daemon, real schedules
LOCAL_OPERATOR_CONFIG_DIR=/tmp/wakes-live2 HOME=/tmp/wakes-live2/home \
  LOCAL_OPERATOR_DESKTOP_TOKEN=<scratch token> \
  ~/local-operator/.venv/bin/python -m local_operator.cli serve --port 8801
~/local-operator/.venv/bin/python -m local_operator.cli \
  wake create <session> "in 12m" "Poll the staging cluster..." --every 30m

# the built app, headless, with the app's own dev-driver armed
LOCAL_OPERATOR_UI_WINDOW_MODE=headless LOCAL_OPERATOR_UI_DEV_DRIVER=1 \
  LOCAL_OPERATOR_UI_DEV_DRIVER_OUT=/tmp/wakes-live2/drive/frames   # the path run-facts.json records; copied into this set \
  LOCAL_OPERATOR_CONFIG_DIR=/tmp/wakes-live2 HOME=/tmp/wakes-live2/home \
  LOCAL_OPERATOR_DESKTOP_TOKEN=<scratch token> \
  node <worktree>/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
    <worktree>/out/main/index.js --user-data-dir=<scratch profile> \
    --remote-debugging-port=9471 --window-size=1380x900
```

Frames are `webContents.capturePage()` through the app's own dev-driver bridge —
the app photographing itself. The click is dispatched through CDP's input pipeline
(`Input.dispatchMouseEvent`), so it is hit-tested by the browser rather than
synthesised in the page, and the keyboard focus is a real `Shift+Tab` through
`Input.dispatchKeyEvent`.

`run-facts.json` is the run's own report: `hello` says **`viewport
1380x868`, dpr 2**, `apiBaseUrl
http://127.0.0.1:8801` — the isolated daemon, not the operator's — and `facts`
says `windowMode: headless`, `visible: false`, `focused: false`.
Nothing here took the operator's focus.

## What each frame is

| Frame | Session | What it shows |
| --- | --- | --- |
| `live-wake-chip-absent` | `38729b6c9750`, nothing armed | The app's first-run surface, which carries no composer status row on any count — so this frame does NOT isolate the gate (round 2's correction: the same shrug would be drawn for a session with wakes, because this surface never draws the row). What it does carry is the fact the run recorded beside it, `noChip: { present: false }`, which is read from the DOM of a session with nothing armed. The gate's isolation lives in the fixture CONTROL band, `chat-composer-status-row/wake-chip` band 4 (plan and activity, no wake chip). |
| `live-wake-chip-one` | `209652f679c8`, one one-shot | `1 wake armed` with the `AlarmClock` mark, at the row's content edge with no goal and no plan. |
| `live-wake-chip-hover` | the same | The same chip under a real pointer, tooltip open: `Open the wakes in run details — 1 wake armed`. |
| `live-wake-chip-focused` | the same | The chip reached by a real `Shift+Tab` from the composer, with the focus ring the app gives a keyboard user. `document.activeElement` is the chip. |
| `live-wake-pane-press` | the same | **The press.** A hit-tested click on the chip, and the pane open at **Wakes** with `1 wake armed`, `11:44 PM EDT · once` and the prompt. |
| `live-wake-chip-many` | `b7a48cc57f6f`, eight armed | `8 wakes armed`, with the run pane still open from the press in the row above (the pane is identical to the frame below; only the composer's focus ring differs, so the chip-alone-at-eight state is not in this set). |
| `live-wake-pane-many` | the same | The section with **all eight** schedules, soonest first, no marker — the count the chip states and the list the chip opens agreeing on one payload from a real store. |

## The band in these frames is the previous window, and these frames do not deny it

Design review's convergence round (D1) measured it, and it is confirmed here from the tree
the branch ships: **the composer band in all seven frames is one this head no longer
draws.** The frames were taken at `d372cbf36` on that head's built app, and the band they
show — centred bordered chips reading `Trending stocks on WallStreetBets`, `MNIST`, … — is
the `#228` band. None of those strings exists in this head's `src/`
(`grep -rl "WallStreetBets" src` → 0 files), and at the same 1380px width this head draws
its product chips borderless with the tip line where they were. What the frames still show
correctly is exactly what `docs/composer-wakes.md` § 9 points at them for — the chip's real
mark, a real pointer's tooltip, a real `Shift+Tab` focus ring, the hit-tested press and the
reveal landing on the heading — and those four claims stand on their own pixels.

**Not re-shot in this pass, and here is why rather than a guess.** The wake-specific
sequence is not reachable from any committed entry point: `scripts/renderer-driver.mjs`
ships three scenes (`states`, `palette`, `none`), and none of them arms a wake or opens a
session that has one, so re-driving hover/focus/press needs the bespoke harness the frames'
own pass used and did not commit. The daemon half *is* reproducible and was re-verified in
this pass — `LOCAL_OPERATOR_CONFIG_DIR=/tmp/wakes-live2 HOME=/tmp/wakes-live2/home … cli
serve --port 8801` → `health 200` on the isolated store — so the gap is the renderer-side
sequence alone. Recorded as an open finding (design D1) rather than annotated as current;
the set's manifest entry keeps `declaredAtHead: 48296702b` and gains nothing it cannot
claim.

## What it does not show, and cannot

A wake **retiring**. The isolated store has no provider signed in, so the
supervisor's engage dies at construction
(`HostingNotConfiguredError: Hosting platform is not configured`) and a due
schedule is RETAINED rather than consumed — measured, not assumed. Neither "the
chip clears while the reader watches" nor "the receipt row arrives" is reachable
from here, and `docs/composer-wakes.md` § 11.5 says so instead of implying
otherwise.
