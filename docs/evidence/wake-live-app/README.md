# The wake chip and the Wakes section, on the real app

Seven frames from the **built app**, driven headless against a **real isolated
backend** with **real wakes armed by the real CLI**. This is the set
`docs/composer-wakes.md` § 9 points at for the one thing a story structurally
cannot show: the PRESS, and the reveal landing in the pane.

**Re-shot at `c7793869e`, and why that matters.** The previous version of this set
photographed a composer band the tree had already stopped drawing — the seven
centred bordered chips (`Trending stocks on WallStreetBets`, `MNIST`, …) that
`#228` retired. Design review's convergence round measured it: the frames were a
picture of two different windows, with the chip correct and the band behind it a
release old. Every frame here was re-taken on this head, so the band around the
chip is the band that ships.

## How it was taken

```bash
# an isolated store, a real daemon, real schedules
LOCAL_OPERATOR_CONFIG_DIR=/tmp/wakes-live2 HOME=/tmp/wakes-live2/home \
  LOCAL_OPERATOR_DESKTOP_TOKEN=<rig token> \
  ~/local-operator/.venv/bin/python -m local_operator.cli serve --port 8801

# the rig: the shipped driver with one extra scene, driving the built app at this
# head against that daemon. Not committed - it is a rig for this one set, and the
# repository's three scenes stay the three it documents.
WAKE_RIG_API_URL=http://127.0.0.1:8801 WAKE_RIG_HOME=/tmp/wakes-live2/home \
  WAKE_RIG_CONFIG=/tmp/wakes-live2 WAKE_RIG_TOKEN=<rig token> \
  LOCAL_OPERATOR_UI_WINDOW_MODE=headless \
  node scripts/wake-rig.mjs --scene wakes --out /tmp/wakes-live3
```

Frames are `webContents.capturePage()` through the app's own dev-driver bridge —
the app photographing itself. The press is the driver's own hit-tested `press`
verb on the chip's selector, so it is a real event on a real control rather than a
synthesised one in the page; the keyboard focus is a real `Shift+Tab` through
CDP's input pipeline; the hover is a real pointer move through it.

**The onboarding modal has to be answered first.** With no provider connected the
launch opens "Connect a provider" over the composer, so the first version of this
re-shoot captured seven frames of that dialog. The rig sets the app's own
persisted flag (`onboarding-storage`, `isModalComplete`) in the isolated profile
and reloads, rather than pressing through six steps or hiding a surface with CSS.

`run-facts.json` is the run's own report: `hello` says **`viewport 1380x868`, dpr
2**, `apiBaseUrl http://127.0.0.1:8801` — the isolated daemon, not the operator's —
and `facts` says `windowMode: headless`, `visible: false`, `focused: false`.
Nothing here took the operator's focus. The three sessions come from that isolated
store: `38729b6c9750` with nothing armed, `209652f679c8` with one schedule and
`b7a48cc57f6f` with eight, all armed by the real CLI.

## What each frame is

| Frame | Session | What it shows |
| --- | --- | --- |
| `live-wake-chip-absent` | `38729b6c9750`, nothing armed | The composer, and **no wake chip**: the run's own DOM read is `noChip: { present: false, row: false }`. Note what the second field is saying: at this head a session with nothing to report grows NO status row at all, so the absence of a chip is not a chip drawn empty — which is the gate the frame isolates (`[data-status-wakes]` absent, not present-and-blank). |
| `live-wake-chip-one` | `209652f679c8`, one one-shot | `1 wake armed` with the `AlarmClock` mark, at the row's content edge with no goal and no plan — the run records the row's chips as `{wakes: true}` and every other chip false. |
| `live-wake-chip-hover` | the same | The same chip under a real pointer, tooltip open: `Open the wakes in run details — 1 wake armed` (the run reads the tooltip element and finds the label). |
| `live-wake-chip-focused` | the same | The chip reached by a real `Shift+Tab` from the composer, with the focus ring the app gives a keyboard user. `document.activeElement` is the chip. |
| `live-wake-pane-press` | the same | **The press.** The driver's hit-tested `press` on the chip, and the pane open at **Wakes** with `1 wake armed`, `Sep 15 11:44 PM EDT · once`, the prompt, and the footer `To stop a wake, ask the agent to cancel it.` The run records `{ runPanelOpen: true, rows: 1 }`. |
| `live-wake-chip-many` | `b7a48cc57f6f`, eight armed | `8 wakes armed`, with the run pane still open from the press in the row above (the pane is identical to the frame below; only the composer's focus ring differs, so the chip-alone-at-eight state is not in this set). |
| `live-wake-pane-many` | the same | The section with **all eight** schedules, soonest first, no marker — `{ rows: 8 }`, the count the chip states and the list the chip opens agreeing on one payload from a real store. |

**What the band around them is now.** At 1380px this head draws its product chips
borderless with the tip line where the retired errand chips were, and the wake chip
is the only chip in the row on these sessions — which is why these frames are also
the cleanest record of the row's one-chip state.

## What it does not show, and cannot

A wake **retiring**. The isolated store has no provider signed in, so the
supervisor's engage dies at construction
(`HostingNotConfiguredError: Hosting platform is not configured`) and a due
schedule is RETAINED rather than consumed — measured, not assumed. Neither "the
chip clears while the reader watches" nor "the receipt row arrives" is reachable
from here, and `docs/composer-wakes.md` § 11.5 says so instead of implying
otherwise.
