# The desktop suite no longer banners the operator

A `pnpm test:desktop` run posted roughly **46 notifications in six minutes** into
the operator's real macOS Notification Center while he was working on something
else, and they buried what he needed to see. They arrived as **Script Editor**
(`com.apple.ScriptEditor2`), which is the giveaway: nothing in this app posts
through Script Editor, `osascript -e 'display notification'` does, because the
osascript process carries no bundle identity. A Notification Center is not a
sandbox, and a test suite that writes to one is a defect in the suite.

## The path, because it is not visible from this repository

| Step | Where |
| --- | --- |
| the suite boots the real app | `scripts/run-desktop-tests.mjs`, `scripts/browser-chrome-proof.mjs`, `scripts/renderer-driver.mjs` and the other app-proof rigs |
| the app spawns a real backend | `src/main/backend/backend-service.ts::backendSpawnEnv` spreads the app's own environment into that child |
| a session parks on a gate and announces it | `session/runtime/serving.py::_announce_pending` |
| which ends at the OS | `local_operator/tui/notify.py::detached_notify` → `osascript -e 'display notification ...'` on macOS |

Every step was already there and correct; what was missing is that the switch
that path is gated by — `LOCAL_OPERATOR_NO_NOTIFICATIONS`, `notify.py`'s
`_ENV_DISABLE`, read by `notifications_enabled()` — was set by **nothing** in
this repository. Depending on each agent and human to remember an incantation is
how it happened at 3 a.m. to somebody who had never heard of the variable.

## What the fix is

`scripts/notifications-off.mjs` is the switch applied to a child environment, and
the paths that spawn the app or the suite call it when they build that
environment. An **explicit** value is preserved: someone who sets `0`, or sets
`1` for a specific run, means it. An absent or empty value takes the default
(`1`), because an empty value already reads as "not disabled" in the backend and
treating it as a deliberate choice would leave every banner armed behind a
variable that looks switched off.

The window mode is not enough on its own, and that is why this is applied at the
environment: `headless` silences the **app's** own banner (`window-mode.ts`,
`desktop-notifier.ts`) and has no reach into the backend's fallback.

## The evidence

`harness/run.sh` — re-runnable, and the raw capture is
[`transcript.txt`](transcript.txt). It stands a **shim** where `osascript` would
be, records the argv, and touches nothing: the one way to test "this run cannot
reach the Notification Center" that is not allowed to fail is to try.

```
=== 1. the same call with the switch ABSENT (the pre-fix environment) ===
$ env -u LOCAL_OPERATOR_NO_NOTIFICATIONS "$LO_PYTHON" "$LO_PROBE_SCRIPT"
    osascript resolves to: .../bin/osascript
    LOCAL_OPERATOR_NO_NOTIFICATIONS=None
    notifications_enabled()=True
    osascript invocations for this call: 1
    detached_notify() returned: True
  osascript log:
    -e display notification "Waiting for approval" with title "Scratch session"

=== 2. the same call through the suite's own runner (the fix) ===
$ node scripts/run-desktop-tests.mjs "$SCRATCH/probe.test.mjs"
desktop tests: 1 file, concurrency 7 (cpu share 0.5 of 14 cores; 4.8 GB available)
    osascript resolves to: .../bin/osascript
    LOCAL_OPERATOR_NO_NOTIFICATIONS='1'
    notifications_enabled()=False
    osascript invocations for this call: 0
    detached_notify() returned: False
    osascript resolves to: .../bin/osascript
    LOCAL_OPERATOR_NO_NOTIFICATIONS=None
    notifications_enabled()=True
    osascript invocations for this call: 1
    detached_notify() returned: True
✔ the suite's environment silences the backend's notification path
✔ and the same call banners once the switch is removed (the control)
```

Three things make that a measurement rather than a claim:

- the before case prints the banner that used to arrive, verbatim, so "would
  have bannered" is a line in a log and not an inference;
- the after case is the **real runner**, so the environment under test is the one
  `pnpm test:desktop` builds rather than one the harness set by hand;
- the second run inside that same case is a **control**: the identical call with
  the switch removed from the runner's environment still banners. Silence from a
  shim that was never reached would be the same log with no way to tell.

Two harness bugs had to be fixed before this transcript was honest, and both
posted a real banner while they existed, so they are worth naming rather than
quietly fixing: the python child's `PATH` did not contain the shim (it resolved
`/usr/bin/osascript` and posted through it), and `notify.py` prefers a small
identity bundle it BUILDS into the config dir within the run, which bypasses
`PATH` entirely. The harness now prepends the shim itself and pins the bundle
build closed with a read-only `notifier` directory, which is also the state a
cold machine — the state the incident happened in — is in.

## The pin

`scripts/run-desktop-tests.test.mjs` runs the real runner over a throwaway test
file that reports the environment it *received*, so the assertion is about the
child's environment and not about the runner's source. The ambient value is
removed first, which is what makes the case about the default. Checked by
neutralising the call in the runner: the two cases redden (`2 fail`), and pass
again when it is restored. `scripts/notifications-off.test.mjs` (registered in
the desktop suite) pins the defaulting rule itself, including the empty value and
the env name, because a typo in the constant would disable the fix silently.

## Deliberately not changed

- `scripts/notification-evidence.mjs` raises real banners on purpose: it exists
  so a reviewer can photograph the shipped notifier. Suppressing it would produce
  no evidence at all.
- `pnpm start` and `pnpm dev` are a person's own app at their own screen, run
  interactively. Their banners are the feature. The agent-driven headless
  variants (`app:headless`, `dev:headless`) do set the switch.
- `scripts/session-cookie-electron.test.mjs` boots a bare Electron scenario
  bundle — no app, no backend, no `Notification` — so the notification path is
  not reachable from it.
- `notify.py` is not changed. Defaulting that leg to off "when not attached to a
  TTY" is wrong in both directions: reaching a user who is NOT attached is the
  whole purpose of `detached_notify`, and the desktop app's backend is a
  windowless `serve` process with no TTY whose parked-gate banner is exactly what
  tells a user their session is waiting. The invariant that belongs here is
  narrower: a test, harness or evidence run must not touch the operator's
  Notification Center.

`pnpm check-evidence` is **DEFERRED** on the machine this was written on (its
one-sweep lease is held elsewhere); nothing here was validated by it.
