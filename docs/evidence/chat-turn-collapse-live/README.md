# `chat-turn-collapse-live` — the collapse, driven end to end in the built app

Six frames of the REAL app on an isolated daemon, from the repository's own
driver scene `--scene turn-collapse` (`scripts/renderer-driver.mjs`). The story
set (`../chat-turn-collapse/`) photographs the states; this set is the
interaction a still cannot state: a run parked on the reader's gate, the same
run while it is live, the turn the moment its answer settles, the reader's
press, the reload, and the bar at a narrow window. Each frame is committed at
`turn-collapse-<state>/localOperatorDark.webp`: the six frames are one theme (the
dark brand palette), so the palette that would spell a light half is absent by
measurement rather than by omission.

| file | state | what it shows |
| --- | --- | --- |
| `turn-collapse-parked/localOperatorDark.webp` | parked on the approval | the question card docked above the composer, the held call's row ticking — and NO bar: a turn waiting on the gate is unsettled (the scene asserts `bars: 0` here) |
| `turn-collapse-live-no-bar/localOperatorDark.webp` | mid-run, after the approval | the user row, `Running sleep 12` ticking, the working line — and NO bar: nothing condenses while the turn is live |
| `turn-collapse-completed/localOperatorDark.webp` | completed | the same turn as one quiet line — `Took 13s · 1 action` with the turn's stamp (`4:30 AM`) and the chevron — over the answer |
| `turn-collapse-expanded/localOperatorDark.webp` | the reader's press | the bar is the toggle: the press reveals `>_ Ran sleep 12 … 13s` in place; the bar keeps its stamp and chevron. The scene measures the expansion's own step here: bar→row1 centre Δ26.8px, the ledger's rhythm (the round-1 review measured Δ57px before the fix) |
| `turn-collapse-reloaded/localOperatorDark.webp` | reload | the durable re-read arrives collapsed with the SAME run ids and the SAME `Took 13s · 1 action` — the live span (`settledAt`) and the durable span (the row's commit `ts`) agree on this run |
| `turn-collapse-narrow-completed/localOperatorDark.webp` | completed at `800x600` | the same scene at the narrow window the review asked for: the bar's clauses fit (no truncation, no stamp/chevron collision) — `Took 13s · 1 action` and the stamp on one line |

## What produced them

```sh
# an isolated daemon this run owns: scratch HOME and config root, a bearer of
# the run's own choosing kept in a 0600 file
RIG=<scratch>/rig-live
printf '%s' "$(openssl rand -hex 32)" > "$RIG/token" && chmod 600 "$RIG/token"
HOME="$RIG/home" LOCAL_OPERATOR_CONFIG_DIR="$RIG/root" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  lop serve --host 127.0.0.1 --port 8080 &
# the config values the app sessions read. The serve flags alone do NOT seed
# them (measured: hosting/model arrive empty and the composer resolves nothing);
# PATCH /v1/config is the one spelling that sticks.
curl -X PATCH http://127.0.0.1:8080/v1/config \
  -H "Authorization: Bearer $(cat "$RIG/token")" -H "Content-Type: application/json" \
  -d '{"hosting":"test","model_name":"mock-model"}'
# the worktree rebuilt against it. PORT 8080, NOT 18937: the renderer's CSP
# admits 1111/8080 only, so the 18937 recipe this README first recorded cannot
# reach the daemon from the page on this tree.
env VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 VITE_DISABLE_BACKEND_MANAGER=true \
  VITE_GOOGLE_CLIENT_ID=stub VITE_GOOGLE_CLIENT_SECRET=stub \
  VITE_MICROSOFT_CLIENT_ID=stub VITE_MICROSOFT_TENANT_ID=stub \
  pnpm build
# the scene (the wide run; the narrow frame is the same command at
# --window-size 800x600 with its own --out). TZ pinned: the stamps are the
# run's own clock, and the committed generation carries America/New_York.
TZ=America/New_York LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene turn-collapse \
  --backend http://127.0.0.1:8080 --backend-records "$RIG/root/run/serve" \
  --seed-onboarding-complete --out "$RIG/frames" --clean
```

**RE-SHOT WHOLE, 2026-10-03, at `bd4c95f7761` (the #775 fold).** The frames
this set shipped were the 2026-09-28 generation; the app has moved since on
facts the frames show (the header now carries the `On this device` control, and
the pinned recency text is the reader's clock), and the recorded recipe itself
had gone stale: it named port 18937, which the renderer's CSP refuses, and the
serve flags it leaned on do not reach the app-level config. One run per window
(wide `1380x900`, narrow `800x600`) re-took all six frames with **ALL CHECKS
PASSED** (22 checks, both windows), `TZ=America/New_York` pinned for the
stamps; the frames are lossless WebP at the same
`turn-collapse-<state>/localOperatorDark.webp` layout and the same dims
(2760x1800 wide, 1600x1200 narrow). What the frames CLAIM is unchanged, and
the run re-asserts it: the parked turn states `bars: 0`, the expansion keeps
its `barToRow1: 26.8`, and the reload read-back agrees with the live reading
(`Took 13s · 1 action` on both sides). What moved visibly is the surround: the
header control above, the recency line, and the stamp (the run's own clock -
now `4:30 AM`, still the New York zone).

`run.log` (kept with this set's working notes rather than in git — `*.log` is
ignored) is that run's full record: **ALL CHECKS PASSED**, 22 checks — the
headless/no-focus pair, the empty state, the composer resolving the daemon's
model, the message admitted, the approval card, the parked reading with its
assertion, the five wide frames above, the expansion geometry, and the
leftover-process check. The scene drives one real turn: the mock answers a
`[bash:12]` prompt with a call that sleeps twelve seconds
(`providers/clients.py`), and this config's `tool_approval_mode: ask` parks
that call on the question dock, which the scene answers the way a reader does —
option `1` typed into the composer and sent.

## The readings worth keeping, stated rather than buried

- **The parked turn does NOT condense** (the fix this set was re-shot for,
  design review round 1 D3). The working line deliberately stands down while
  the question holds the stage, so the newest run's unsettledness cannot be
  read from `working` alone; the call site composes it from the gate too. The
  `parked on the approval` note records the post-fix reading —
  `{"bars":0,"toolRows":1,…}` — and the scene asserts it: a bar appearing here
  was the pre-fix defect this frame exists to disprove.
- **The expansion keeps the ledger's step** (D2). The `expanded geometry` note
  reads `barToRow1: 26.8` — a 20px row + the body's 4px + the trace tier's
  2px — against the pre-fix 57px the review measured in the same scene.
- **The `live-no-bar` frame is `stable:false` in its own log.** A running tool
  row ticks a clock, so two captures 150 ms apart are never identical; the rig
  says so rather than pretending. `parked`, `completed`, `expanded` and
  `reloaded` are `stable:true`.

## What this set does NOT claim

The daemon ran the mock provider over a scratch `HOME`, so the frames carry a
`Hello from the mock provider!` answer and the app's `mock-model` chip. No
production data, session, or daemon was touched — the operator's own daemon on
`127.0.0.1:1111` was never contacted by either process (the driver's checks
prove it: `the app holds NO connection to the operator's own backend`).
