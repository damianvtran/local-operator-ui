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
| `frames/after-remote/` | this branch's build | **PENDING.** cloud-node-1's relay was down from ~10:18 local on 2026-10-06 (nothing listening on 4097; every mesh handshake refused), so the remote after half could not be re-captured in this pass. The re-capture is one command (below); until it lands, the flip and its fix are pinned mechanically — `scripts/transcript-reducer.test.mjs`'s closure-rule pins reproduce the exact inversion on the base reducer (`[ans-1, req-1, tool:call-1]`) and the fixed order after (`[req-1, tool:call-1, ans-1]`). |

The base half was captured by the lane manager's session (2197cee0a558) with
the same flow `plan-remote.json` reproduces — nav `/chat`, pick `cloud-node-1`
on the device chip, send `What's your current OS?` — against the base build.
The after halves were captured by this branch's session
(assignment `turn-order coder`), against a build of this branch's tree.

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
