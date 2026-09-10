# QA-102 — root cause of the desktop `503 Session owner is unavailable`

## Verdict

The 503 is **event-loop starvation in the session owner**, not a transport,
size, or contract fault. It reproduces deterministically and recovers on its
own.

An owner blocked inside a **synchronous tool call** (e.g. a bash subprocess
wait) never reaches its event loop, so the admission frame for an incoming
desktop message sits unread in the socket buffer. The client's ~15s envelope
expires, `remote.py` raises `TimeoutError`, and the `errors()` ladder in
`local_operator/server/routes/desktop_sessions.py:209` maps it to the generic
503 sentence. The owner is healthy the whole time.

## The discriminator

`blocked-vs-busy.mjs` holds session type fixed (pool-created, identical to the
clean baseline) and varies only what the owner is doing while "busy":

| Arm | Owner state | Result |
|---|---|---|
| 1 | busy **streaming** tokens, no tool call | **200** in 6.1s |
| 2 | blocked in `bash: sleep 60` | **503** in 15.0s |
| 2 | blocked, second ping | **503** in 15.0s |
| 2 | same session, after the sleep ended | **200** in 1.8s |

A streaming owner awaits between chunks, so the frame is serviced. A blocked
owner does not reach the loop at all. Same session, same payload, same size —
only the block differs.

## Hypotheses killed along the way

Each of these was a real, measured arm, and each is now exonerated:

- **Message size / the 413 budget.** `baseline.mjs`: idle owner, 95-byte body,
  fresh session per trial, 5/5 → 200 (median 5.9s). Clean control.
- **"Ping after big" / attachments.** Only looked causal because a big message
  starts a long turn, and that turn does tool work. The image is a bystander.
- **Owner busy, generically.** `busyowner.mjs`: tiny prompt starting a long
  streaming turn, pings mid-turn → 200, 200. "Busy" alone is not sufficient.
- **Sticky per-session latch.** Ping-back of previously-503 sessions looked
  like a permanent latch (4/5 still 503) — but those are long-running QA agent
  sessions that were *still* blocked in bash. Arm 2's recovery to 200 disproves
  the latch: nothing is durably poisoned.
- **Session age / owner lifetime.** `e19e959f1444`, one of the "poisoned" set,
  answered 200 at 2.4s while its siblings 503'd. Age does not predict it.

## Why the 15s is a red herring twice over

`remote.py:2326` already documents that `wait_for` races the *scheduler*, not
the work, and adds a bounded settle loop for exactly that reason. That mitigation
handles a slow-to-schedule loop; it cannot help when the loop is not running at
all. Raising the timeout buys a slower wrong answer — the block here was 60s and
would outlast any plausible envelope.

## What this means for the fix

The 503 sentence is *accurate but misleading*: "reconnect and reconcile" implies
durable breakage to a caller whose owner is merely busy in a subprocess and will
be fine in seconds. The actionable direction is to distinguish "owner loop is
starved, retry shortly" from "owner is genuinely gone" — the former is transient
and self-healing, and only the latter warrants reconcile. Deciding which
mechanism carries that (a heartbeat serviced off-loop, or running blocking tool
calls off the owner's loop so admission is always serviced) is a design call for
the desktop-transport owner, not something this QA pass should pick unilaterally.

## Reproduction

```
cd /private/tmp/qa102
QA_TOKEN=$(cat token) node blocked-vs-busy.mjs   # decisive arm
QA_TOKEN=$(cat token) node baseline.mjs          # clean control
QA_TOKEN=$(cat token) node busyowner.mjs         # streaming-busy control
```

Backend under test: `Local Operator [serve] port=8911` (pid 94847).
Transport/contract are bundled from the shipping source in
`~/local-operator-worktrees/ui-desktop-413` via `probe.mjs`, so the budget table
and 413 guard exercised are the real ones.
