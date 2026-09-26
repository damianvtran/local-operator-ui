# `chat-connection-live` — the connection states, in the real app, on this branch

Two live PNG sets, carried here so the round-3/round-4 review closures rest on
bytes in the tree rather than on a lane's scratchpad. Neither set is a sweep
capture: they are frames of the BUILT app paired with a real isolated daemon,
shot at 1380x900 with `devicePixelRatio: 2` (2760x1800 on disk).

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
