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
| the suite's children get the switch | `scripts/run-desktop-tests.mjs`, the runner behind `pnpm test:desktop`. **No file in the suite spawns Electron** (measured across the whole `test:desktop` list); the suite's live backend is a python `serve` started directly by `scripts/submit-latency.test.mjs`, and it keeps the runner's environment |
| the app-proof rigs boot the real app | `scripts/renderer-driver.mjs`, `scripts/browser-chrome-proof.mjs`, `scripts/browser-host-proof.mjs`, `scripts/session-cookie-restart-proof.mjs`, `scripts/mentioned-files-app-proof.mjs` — each sets `VITE_DISABLE_BACKEND_MANAGER=true`, so the app they boot spawns no backend |
| the app spawns a real backend | `src/main/backend/backend-service.ts::backendSpawnEnv` spreads the environment it was launched with into that child — the hop that is **measured** below, because a `.env` in the working directory is folded over it before this runs |
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
environment.

**The switch is presence-based, and this is the one thing to get right about it.**
`notify.py` reads the key with `os.environ.get()` and silences on any non-empty
string, so `0`, `1`, `no` and `false` all mean SILENCED. There is no value that
means "banners back on"; the way back on is to unset the key:

    env -u LOCAL_OPERATOR_NO_NOTIFICATIONS <command>

That is what this PR's own harness does, and the first revision of this bundle
said the opposite (`0` "keeps your own banners on") in three places — an
instruction that, followed, produces silence while looking switched off.

A value the caller set is still passed through untouched — that is what makes
this a default rather than an override, and flipping a caller's choice silently
would be the same class of defect. An **absent or empty** value takes the default
(`1`), because an empty value is not a choice anybody made: `os.environ.get()`
returns `""`, which is falsy in `notifications_enabled()`, i.e. ENABLED. Case 1b
of the transcript measures exactly that, and case 1 is the control beside it.

The window mode is not enough on its own, and that is why this is applied at the
environment: `headless` silences the **app's** own banner (`window-mode.ts`,
`desktop-notifier.ts`) and has no reach into the backend's fallback.

The app applies the same rule to the backend it spawns, from its own LAUNCH
environment (`src/main/backend/notification-launch.ts`, applied in
`backendSpawnEnv`), so a `.env` in the working directory cannot replace the value
a launch was given — the same "empty is not a choice" reading, one runtime over,
measured in `transcript-launch-hop.txt`.

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

=== 1b. the same call with the switch PRESENT but EMPTY (the shape a stale export leaves) ===
$ LOCAL_OPERATOR_NO_NOTIFICATIONS= "$LO_PYTHON" "$LO_PROBE_SCRIPT"
    LOCAL_OPERATOR_NO_NOTIFICATIONS=''
    notifications_enabled()=True
    osascript invocations for this call: 1

=== 2. the same call through the suite's own runner (the fix) ===
$ node scripts/run-desktop-tests.mjs "$SCRATCH/probe.test.mjs"
desktop tests: 1 file, concurrency 4 (memory budget 0.9 GB of 3.9 GB available at 192 MB per worker; cpu share would allow 7)
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

Four things make that a measurement rather than a claim:

- the before case prints the banner that used to arrive, verbatim, so "would
  have bannered" is a line in a log and not an inference;
- case 1b prints the value that the app's own `.env` fold produced in the
  measurement below, and shows it ARMED — which is why an empty value is treated
  as "not a choice" rather than as "off";
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

## The app → backend hop, measured

The hop the harness above does not cross — the app handing the backend it spawns
the environment it was launched with — is measured on the app itself, in
[`transcript-launch-hop.txt`](transcript-launch-hop.txt), with
`harness/hop-probe.cjs` loaded into the Electron main process
(`NODE_OPTIONS=--require`, which Electron honours). Both trees carried the same
`.env` line in the EMPTY shape and the launch value `pnpm app:headless` sets:

| tree | `launch` | the app's own env after the `.env` fold | the serve launch is handed |
| --- | --- | --- | --- |
| `f69a59971` | `1` | `""` | **`""`** — armed, `notify.py`-speaking |
| this head | `1` | `""` | **`"1"`** — silenced |

The fold wins in both trees, which is the defect; what changed is where the value
the backend gets is decided. "The serve launch" is the `bash -c 'exec "$@"' …
serve --port N` row of the transcript, i.e. the backend itself; the `python3 -c`
row beside it is the identity probe, handed the same object. In both runs the
child is a real backend (its own log shows `GET /health 200`), spawned with a
scratch HOME, config dir, log dir and `--user-data-dir` on a scratch port. **That
capture's stop was by exact pid on the `node_modules/.bin/electron` SHIM, and it
leaked** — two headless trees of eight processes each, roots at `ppid 1`; the
transcript's closing section records it. `scripts/notification-hop-proof.mjs` is
the same measurement with the teardown fixed (the runtime binary, `detached`, a
GROUP signal and a profile-match reap by exact pid), and it is what a re-run
should use.

Two other measurements of the same path are recorded here because they came from
the two independent rounds on this PR and neither is reproducible from this
repository alone:

- a peer review session read `ps -E` on a live suite run and found every
  `node --test` child carrying `LOCAL_OPERATOR_NO_NOTIFICATIONS=1` while the
  runner process itself carried nothing special — the runner→child hop, observed
  from outside both processes;
- QA round 1 on #206 (`### QA report — round 1`) read the variable from inside
  every Electron main process it booted, at launch AND after the fold, and
  measured **0** `display notification` invocations across the full desktop suite
  and all five app-booting rigs against **1** for the same call through the shipped
  runner on unmodified `main`.

## The pin

`scripts/run-desktop-tests.test.mjs` runs the real runner over a throwaway test
file that reports the environment it *received*, so the assertion is about the
child's environment and not about the runner's source. The ambient value is
removed first, which is what makes the case about the default. Checked by
neutralising the call in the runner: the two cases redden (`2 fail`), and pass
again when it is restored. `scripts/notifications-off.test.mjs` (registered in
the desktop suite) pins the defaulting rule itself, including the empty value and
the env name, because a typo in the constant would disable the fix silently.

Three more files keep the coverage a checked property rather than a claim, all
registered in `test:desktop`:

- `scripts/notification-spawn-sites.test.mjs` enumerates every call in `scripts/`
  and `bin/` that starts the Electron runtime and fails on one that is not in
  its table, so a seventh rig cannot be added unguarded. Checked in both
  directions: deleting `withNotificationsOff` from `renderer-driver.mjs` reddens
  it, and so does a new rig that boots Electron;
- `scripts/notification-launch.test.mjs` pins the app-side rule and the fact that
  `backendSpawnEnv` applies it AFTER the shell environment it would otherwise
  lose to;
- `scripts/notifications-off.test.mjs`'s env-name case is cross-checked against
  the TypeScript constant, so the tooling and the app cannot spell the key
differently and stay green.

## What this pin does not cover

Two folds and one rename sit outside this repository, and each of them can put
the banners back with every test here green.

**The rename, which is the one nothing can catch.** The consumer is
`local_operator/tui/notify.py`, in a **separately installed** backend package that
this repository does not pin — `src/main/update-install.ts` installs it with
`pip install --upgrade local-operator`. Nothing here reads that file, so if
upstream ever renames `_ENV_DISABLE`, every switch this repository sets becomes a
variable nobody reads and the incident returns with all of these tests green.
That is the honest edge of this change: it guards the local spelling, not the
contract. A cheap pin would have to assert the installed backend's own **name**,
which is the part that matters — a version assertion would not close it, because
the contract is the name rather than the number — and nothing in this repository
can reach that name today.

**The consumer's OWN `.env` fold, one hop past the app.** `local_operator/env.py`
folds a `.env` at the python package root with `override: true` when it is
imported:

```python
dotenv_path = Path(__file__).parent.parent / ".env"   # env.py:18
load_dotenv(dotenv_path, override=True)               # env.py:19
```

which is `…/site-packages/.env` for a wheel, uv or pipx install, and the SOURCE
CHECKOUT ROOT for an editable one — inside the backend process the app has just
handed `1` to. Reproduced against the shipped consumer with the package root in
scratch: inherited `1` → `''` after the import → `notifications_enabled() ==
True`. It is latent rather than live on the machine this was written on
(`…/site-packages/.env` and `~/local-operator/.env` both absent, and neither the
backend's own `AGENTS.md` nor its `.env.template` mentions the key), but it is the
same class as the fold this PR fixes, one layer further in: what this change
makes true is that a `.env` in the APP's working directory cannot replace the
launch, not that nothing downstream of the app ever can.

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
