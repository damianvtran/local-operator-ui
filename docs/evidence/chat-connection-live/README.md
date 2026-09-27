# `chat-connection-live` — the connection states, in the real app, on this branch

Three live PNG sets, carried here so the round-3/round-4 review closures (and
the notice-band pass's change) rest on bytes in the tree rather than on a lane's
scratchpad. None of the sets is a sweep capture: they are frames of the BUILT
app paired with a real isolated daemon, shot at 1380x900 with
`devicePixelRatio: 2` (2760x1800 on disk).

## `lane-round3/` — the qa-tester lane's frames

Shot by the qa-tester lane's own driver copy (`driver-qa2.mjs`, scenes
`qa3-conn` and `qa3-refused`) against a live isolated daemon on
`127.0.0.1:18943` and the built app at head `11f39c00f5`, 2026-09-26 00:17-00:25
local. The build gate in both logs reads `assets 2026-09-26T04:09:30Z >=
sources 2026-09-26T03:55:25Z`. Design round 4 judged D27/D29/D30 from these
files in the lane's scratch; this directory is the carry into the tree.

| file | state | answers |
| --- | --- | --- |
| `qa3-conn-before-send.png` | attached, list mounted, composer live | the baseline the two below are read against |
| `qa3-conn-failed-send.png` | daemon killed, a send failed while offline | D27 (one notice, one band, geometry), D30 (`caption: null` - the list caption stands down while the strip speaks) |
| `qa3-conn-reconnected.png` | daemon revived, the strip cleared | D27's reconnect half: the claim resolves and the composer stops stating the failure |
| `qa3-refused.png` | wrong-bearer daemon (HTTP 401 on the desktop plane) | D29: ONE band, the strip's own sentence, the banner's second sentence gone, one enabled `Retry` |
| `qa3-conn.log`, `qa3-refused2.log` | the driver's own records: every check and every instrument reading cited in the review round | |

## `fix-head/` — the coder's re-shoot on the remediation tree

The same scenes re-driven on the tree that answers rounds 4's findings, via the
repository's own rig:

```sh
cd <worktree>
# 1. an isolated daemon this run owns, on a scratch config root, with a bearer
#    of this run's own choosing (values: {hosting: test, model_name: mock-model})
LOCAL_OPERATOR_CONFIG_DIR=<scratch>/root LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  lop serve --host 127.0.0.1 --port <port> &
# 2. the worktree's .env points the build at that daemon; rebuild
# 3. the scene: it kills the run's own daemon mid-flight and revives it
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene connection-drop --backend http://127.0.0.1:<port> \
  --backend-records <scratch>/root/run/serve --backend-revive '<cmd>' \
  --out <frames> --clean --seed-onboarding-complete
```

`run.log` is that run's full record: **ALL CHECKS PASSED**, 24 checks,
including the §F3 row (`the failure attaches to the message: Not delivered ·
Send again · Edit`), the single-voice checks, and the reconnect resolution.

| file | state | note |
| --- | --- | --- |
| `connection-1380x900-attached.png` | attached, a turn answered | baseline |
| `connection-1380x900-server-gone.png` | daemon gone | the strip states the root cause, one voice, one Retry |
| `connection-1380x900-held-message.png` | the failed send, AFTER the remediation | §F3's row restored (`Not delivered · Send again · Edit`); the composer's notice now STANDS DOWN while the strip speaks (§F2's single voice - compare `lane-round3/qa3-conn-failed-send.png`, which still carries it) |
| `connection-1380x900-reconnected.png` | revived daemon | the strip clears, the message's fate is stated, not blank |

D31 (the view popover's width) does not touch any surface in this set; the
remediation's other changes (R16's composer debris, R15's pins) do not render
here either. The delta between the two sets is the composer's notice, by
design, and both states are kept so a reader can see the before and after
rather than one of them.

`fix-head/` was re-shot once more after the fold onto `601a9d5032` (the tip this
ships on): the same scenes, `run.log` again ALL CHECKS PASSED (24/24). The
fold's resolution of the composer region keeps this branch's structure and
carries main's approval semantics into the dock, which none of these states
photographs - the frames were re-taken rather than argued across the fold.

## `band-pass/` - the notice-band pass's re-shoot

The same scene re-driven on the tree that carries the notice-band change (the
strip's row 1 gated on main's pairing CAUSE, the banner's yield, both bands on
the shared `NOTICE_BAND` band grammar), via the repository's own rig, so the
live surface set is not left describing the pre-change bands:

```sh
cd <worktree>
RIG=<scratch>/rig-live
# 1. an isolated daemon this run owns, on a scratch config root (values:
#    {hosting: test, model_name: mock-model}), its bearer written to a file so
#    it never enters argv
LOCAL_OPERATOR_CONFIG_DIR="$RIG/root" LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  lop serve --host 127.0.0.1 --port 18991 &
# 2. the worktree was rebuilt against that daemon
#    (VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18991)
# 3. the scene: it kills the run's own daemon mid-flight and revives it
LOCAL_OPERATOR_CONFIG_DIR="$RIG/root" LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
  node scripts/renderer-driver.mjs --scene connection-drop \
  --backend http://127.0.0.1:18991 --backend-records "$RIG/root/run/serve" \
  --backend-revive "lop serve --host 127.0.0.1 --port 18991" \
  --out "$RIG/frames" --clean --seed-onboarding-complete
```

`run.log` is that run's full record: **ALL CHECKS PASSED**, 24 checks,
including the one-voice pair this change is about - `ONE live region states the
connection (U3b)` and `no OTHER live region stands beside the strip` - the
single `Retry` control, and the reconnect resolution. The four states are the
same as `fix-head/`'s; the visible delta is the band's grammar (the strip's row
1 sentence, its filled remedy, the 14px mark), which is the change a reader of
this directory can see rather than argue.

| file | state | note |
| --- | --- | --- |
| `connection-1380x900-attached.png` | attached, a turn answered | baseline |
| `connection-1380x900-server-gone.png` | daemon gone | the strip states the root cause; ONE live region; one `Retry` |
| `connection-1380x900-held-message.png` | the failed send | the message carries `Not delivered · Send again · Edit`; no second connection voice |
| `connection-1380x900-reconnected.png` | revived daemon | the strip clears; the message's fate stays on the message |

The daemon this run started was stopped by the scene itself (`revived daemon
stopped` in `run.log`), and no process from the run outlived its boot. The
change's 56-still pair and the twelve-palette sweep live in
`docs/evidence/chat-status-bands/`.

### Re-driven for the review-round remediation (2026-09-26)

The same scene was driven once more from the remediated tree (the refusal's
reachability gate, the fact-keyed dismissal, the kind-aware Retry outcome and
the two banner stand-downs - the commit this directory ships in). `run.log` is
that run's record: **ALL CHECKS PASSED**, 25 checks, including the same one-voice
pair and the reconnect resolution the section above reports.

ONE ENVIRONMENT NOTE, recorded rather than smoothed over: the operator's `lop`
was updated to a newer generation (`7dd016e34536`) mid-round, and **two
re-drives against it did not complete the scene's mock-turn baseline** - no mock
answer in 60s, so the §F3 and reconnect checks fell through with it, and no turn
request reached that daemon at all (verified in its own request log). The
frames here were therefore taken against `20260926T212703Z-0.63.3`, the same
generation the committed set was shot against, so this pair stays comparable
state-for-state; current-generation live behaviour is for QA to drive rather
than to assert from here. The renderer's own notice-band delta is the
story-provided set's to prove (`docs/evidence/chat-status-bands/` either way).

## `refusal-band/` - the wrong-bearer refusal, driven live (2026-09-27, head `9493b5792`)

The scene QA round 2's Q-1 reconstructed, committed as the pass's own live
record: **the refusal while the daemon answers, the death, and the revive**.
The construction is a WRONG-BEARER pair, and it is the app's own pipeline that
produces the refusal - no fixture, no stub:

- the daemon (`lop serve`, v0.63.6, generation `20260927T031704Z-700dfc4518bd`)
  was started with `LOCAL_OPERATOR_DESKTOP_TOKEN=<D>` of its own, so its serve
  record publishes `claim_key: ""` and `desktop: true` - an env-governed plane;
- the APP was given a DIFFERENT token (`<A>`) in its environment, so discovery
  admits the record as a candidate, the claim path is skipped (no key on disk),
  and the desktop read is made with `<A>` - which the daemon refuses with a 401
  while `/health` answers 200 throughout;
- the kill is the scene's own (`SIGTERM` to the pid the record names), and the
  revive starts an ACCEPTING daemon (token `<A>`) on the same address, whose
  fresh record the run re-links into the app's config root.

`run.log` is the run's full record: **ALL CHECKS PASSED**, 23 checks, including
`the pane's strip states the REFUSAL while the daemon answers /health`,
`ONE live region ... it is the REFUSED row - not the unreachable row over a
running daemon`, `the press's outcome says the server is RUNNING and the
credential is still refused (U2)`, `the death moves the band: the unreachable
copy, and the refusal's stale sentence gone (Q-2/U1)`, `the dismissal re-armed`,
and `the revive clears the band`. Two re-runs were needed and the first's two
FAILs are worth naming: both were the instrument's, not the app's - a screen-wide
Retry count that caught the composer's unrelated "Model ... Retry" line, and a
pill assertion that read `textContent` where the sentence lives in the button's
`aria-label`. Both were fixed in the scene, and the passing run is the one here.

| file | state | note |
| --- | --- | --- |
| `refused-1380x900-refused.png` | daemon answering, credential refused | the danger band, the refusal's own title, ONE `Retry` + dismiss; the sidebar foot line is silent |
| `refused-1380x900-retry-outcome.png` | after the press | the outcome speaks the refusal: "The server is running, but this app's credential is still refused." - "Still unreachable." appears nowhere |
| `refused-1380x900-dismissed.png` | after dismiss | the pill; its `aria-label` keeps the sentence AND the outcome (U12) |
| `refused-1380x900-rearmed.png` | daemon killed | the band moved to the absence - "Can't reach the Local Operator server", the stale "The daemon is running." gone - and the dismissal re-armed (strip expanded, no pill) |
| `refused-1380x900-cleared.png` | accepting daemon revived | the app attaches; the band clears |

Every daemon this run started was reaped by exact pid (the run script's own
reaper, by the pids its records name); no process outlived the run (`no process
from this run outlived its boot` in the log).
