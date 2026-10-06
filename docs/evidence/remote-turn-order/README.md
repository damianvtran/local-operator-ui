# remote-turn-order — the inverted remote turn, before and after

**What these are.** Hand-driven frames and row logs for the defect in which a
REMOTE (mesh) session's turn renders inverted — the assistant's answer drawn
ABOVE the user message that prompted it, tool traces below it — live-only, and
healed only by a remount. The lane's report is `UI bug: remote session turn
arrives inverted` (session 2197cee0a558); the fix adds the tail block's closure
rule in `src/renderer/src/features/chat/canonical/transcript-reducer.ts`.

**The frames are PNG screenshots from the live built app**, driven over CDP by
the committed harness in `harness/` (`rig.mjs`), in the documented `headless`
window mode with a scratch profile, against the machine's own daemon at
`127.0.0.1:1111` (which carries the mesh). Their stems name no theme, so
`check-evidence.mjs`'s walker judges none of them and the set is declared: the
frames are accounted as unjudged frames inside a declared set (the
`ask-badge-quiet` and `read-ack-skew` precedent) rather than read as undeclared
sweep output. Each half's row log (`rows-*.jsonl`) is the rig's own dump of the
`[data-record-id]` elements in DOM order, sampled every 300 ms — the
mechanical record beside the pixels.

## The halves

| half | tree | what it shows |
| --- | --- | --- |
| `frames/before-base/` | base build, `origin/main` at `46fd032ed59` | the defect, end to end: `base-turn-user-tool-correct.png` is the order the viewer watched during the turn (user, then tool); `base-turn-flip-answer-above.png` is the flip — the answer row admitted ABOVE the held echo; `base-turn-settled-inverted.png` is the settled state the operator photographed (answer → stamp → user → action group). `rows-83253.jsonl` carries the sequence (`g-11` correct → `g-12` flipped → `final` still inverted). |
| `frames/after-local/` | this branch's build | the local path, user → tool → answer, and its remount stability: `fixed-user-tool-running.png` mid-turn, `fixed-user-tool-answer.png` settled, `fixed-reopen-stable.png` / `fixed-reload-stable.png` the same order after a switch away-and-back and after a full reload. `rows-82092.jsonl` and `rows-88367.jsonl` are their row logs. |
| `frames/after-remote/` | this branch's build | the remote flow re-taken on the fix against the peer that produced the base flip (same `cloud-node-1`, same `What's your current OS?` question — an independent re-run, **not the same session instance**: the titles and answer wordings differ): `fixed-remote-user-tool-running.png` mid-turn (user, then the running call below it), `fixed-remote-user-tool-answer.png` the answer admitted BELOW the call, `fixed-remote-settled.png` settled. `rows-70390.jsonl` is the DOM-order log and the turn's order evidence (user → tool → answer, no inversion over 188 samples). **This run's own SSE stream was not captured** — see the attribution note below; the stream committed beside the frames belongs to a different session. |

The base half was captured by the lane manager's session (2197cee0a558) with
the same flow `plan-remote.json` reproduces — nav `/chat`, pick `cloud-node-1`
on the device chip, send `What's your current OS?` — against the base build.
The after halves were captured by this branch's session
(assignment `turn-order coder`), against a build of this branch's tree:
the remote half on 2026-10-06 ~13:37 local, once cloud-node-1's relay
returned (a second remote run of an engineered `sleep` turn also came back
order-correct; its artifacts stay in the session scratch), and the local half
with its remount checks.

**SSE attribution (round-1 QA Q-1 / design D2).** The daemon SSE log
committed beside the after-remote frames is NOT the pictured turn's stream.
The capture process, racing a concurrent lane's rig, latched that lane's
engineered `sleep 15` attempt (session `880d42ac4018`); its log is committed
renamed as `sse2-880d42ac4018-engineered-attempt.txt` — kept as a second
after-fix remote stream, correctly labelled — and the pictured run's arrival
mode therefore rests on its row log and frames, plus the mechanical pins,
not on a stream (its own capture was never taken; the capture's sidecar,
`sse-capture2-70356.log`, shows the latch).

The flip and its fix are also pinned mechanically: of the six added pins, the
base-discriminating set — the snapshot-seed raw start, the seed raw-start/page
pair, the delta inversion, the page convergence and the seed-past-frontier
pins — fails on the base reducer (the delta one with exactly
`[ans-1, req-1, tool:call-1]`), while the carriage, anchored-settle and
idempotence pins hold on both trees.

## The commands

```bash
# The remote flow (plan-remote.json), on any worktree whose out/ is built:
LOCAL_OPERATOR_UI_WORKTREE=<worktree> LOCAL_OPERATOR_SCRATCHPAD=<scratch> \
  node harness/rig.mjs --plan harness/plan-remote.json --out <out>

# The daemon SSE capture that records the frames the app consumes, alongside
# the rig (polls the sessions list for a NEW remote session, then subscribes):
node harness/sse-capture.mjs <out> <known-ids-file>

# The local path and its remount checks (plan-local.json, plan-remount.json):
node harness/rig.mjs --plan harness/plan-local.json --out <out>
# ... then navigate the remount plan at the session id the run created:
node harness/rig.mjs --plan harness/plan-remount.json --out <out>
```

The rig reads the daemon's desktop token from its own file
(`~/Library/Application Support/Local Operator/desktop-token`) and never prints
it. Teardown kills the app by exact pid and reaps any process whose command
line names the run's scratch profile.

## What to look for in the row logs

A row log line is `{ t, note, rows: [{id, kind, ...}], stop, working }` — the
`[data-record-id]` elements in DOM order at instant `t`. The defect is the
order [assistant, user, tool]; the fixed order is [user, tool, assistant] and
stays that way across remounts. `g-11`/`g-12` in the base log are the last
correct sample and the first flipped one; the local log's `f-14` → `f-39` are
the equivalent transitions (tool admitted, then the answer below it).
