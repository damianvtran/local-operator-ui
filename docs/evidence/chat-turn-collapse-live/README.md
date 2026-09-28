# `chat-turn-collapse-live` — the collapse, driven end to end in the built app

Four frames of the REAL app on an isolated daemon, from the repository's own
driver scene `--scene turn-collapse` (`scripts/renderer-driver.mjs`). The story
set (`../chat-turn-collapse/`) photographs the states; this set is the
interaction a still cannot state: a run while it is live, the same run the
moment its answer settles, the reader's press, and the reload.

| file | state | what it shows |
| --- | --- | --- |
| `turn-collapse-live-no-bar.png` | mid-run, after the approval | the user row, `Running sleep 12` ticking, the working line — and NO bar: nothing condenses while the turn is live |
| `turn-collapse-completed.png` | completed | the same turn as one quiet line — `Took 13s · 1 action` with the turn's stamp (`12:26 PM`) and the chevron — over the answer |
| `turn-collapse-expanded.png` | the reader's press | the bar is the toggle: the press reveals `>_ Ran sleep 12 … 13s` in place; the bar keeps its stamp and chevron |
| `turn-collapse-reloaded.png` | reload | the durable re-read arrives collapsed with the SAME run ids and the SAME `Took 13s · 1 action` — the live span (`settledAt`) and the durable span (the row's commit `ts`) agree on this run |

## What produced them

```sh
# an isolated daemon this run owns, scratch HOME and config root, a bearer of
# this run's own choosing (values: {hosting: test, model_name: mock-model})
RIG=<scratch>/rig-live
HOME="$RIG/home" LOCAL_OPERATOR_CONFIG_DIR="$RIG/root" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  lop serve --host 127.0.0.1 --port 18937 &
# the worktree rebuilt against it
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18937 pnpm build
# the scene
LOCAL_OPERATOR_CONFIG_DIR="$RIG/root" LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene turn-collapse \
  --backend http://127.0.0.1:18937 --out "$RIG/frames" --clean --seed-onboarding-complete
```

`run.log` is that run's full record: **ALL CHECKS PASSED**, 15 checks — the
headless/no-focus pair, the empty state, the composer resolving the daemon's
model, the message admitted, the approval card, the four frames above, and the
leftover-process check. The scene drives one real turn: the mock answers a
`[bash:12]` prompt with a call that sleeps twelve seconds
(`providers/clients.py`), and this config's `tool_approval_mode: ask` parks
that call on the question dock, which the scene answers the way a reader does —
option `1` typed into the composer and sent.

## Two readings worth keeping, stated rather than buried

- **The parked turn condenses.** While the call waits on the approval card the
  working line stands down (the question is the state), so to the collapse's
  live rule (`working !== null`) the newest run reads as finished and gets a
  bar — the `parked on the approval` note in `run.log` records it:
  `{"bars":1,"barText":"1 action",…}`. It is the state the design round should
  judge beside `completed`: the bar is quiet and the card above it states the
  question, but the bar's span claims a turn that has not handed over an answer.
  The same run's truth is visible three notes later — once the call RUNS, the
  working line returns and the bar goes (`{"bars":0,"toolRows":1}`).
- **The `live-no-bar` frame is `stable:false` in its own log.** A running tool
  row ticks a clock, so two captures 150 ms apart are never identical; the rig
  says so rather than pretending, and the frame is the state the tick's own log
  line names (`running bash 2s`). `completed`/`expanded`/`reloaded` are
  `stable:true`.

## What this set does NOT claim

The daemon ran the mock provider over a scratch `HOME`, so the frames carry a
`Hello from the mock provider!` answer and the app's `mock-model` chip. No
production data, session, or daemon was touched — the operator's own daemon on
`127.0.0.1:1111` was never contacted by either process (the driver's checks
prove it: `the app holds NO connection to the operator's own backend`).
