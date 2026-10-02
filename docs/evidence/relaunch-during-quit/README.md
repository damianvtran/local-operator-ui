# A relaunch during shutdown no longer opens onto a dying process

The operator's report (issue #636): **Cmd+Q closes the window at once, the
shutdown keeps running, and an immediate relaunch opens onto the app still
shutting down** — a window appears, then it is gone again about half a second
later.

## The mechanism, as measured

On macOS the window and the process are deliberately decoupled:
`window-all-closed` keeps the app alive, and the real teardown runs in
`before-quit` (the browser host's session-cookie hold, bounded at 1500 ms — and
skipped on a profile with no keychain) and then in `will-quit` (the owned
backend's stop — the seconds in the readings below). The single-instance lock is
held for the whole of it.

So between "the window vanished" (+~210 ms after `app.quit()`) and "the process
exited" (+~5.1 s in these runs) there is a real window in which the instance is
still quitting. A relaunch inside it loses the lock and forwards its request to
the dying instance, and before this fix that instance answered the request with
a **window of its own** (an undeclared relaunch resolves `focus`):

```
[FAIL] A answered the relaunch without creating or raising a window
        A's windows 3113ms after app.quit(): [{"id":2,"visible":true,"destroyed":false}]
[FAIL] the refusal is on the record (applied=skipped+quitting)
        [window-raise] trigger=second-instance mode=inactive requested=inactive pid=51304 ... applied=showInactive
```

A still exited cleanly (+5228 ms, code 0) **and the window it had opened died
with it** — that is the "opens onto the app still shutting down" the report
names, and [`doomed-window.png`](doomed-window.png) is that window, captured by
the app itself (`webContents.capturePage()`): the shell has loaded and the
backend is already stopping, so it says *"The Local Operator server did not
answer this request."* with a `List agents request failed: 503` toast — and the
process takes it away seconds later.

## What the fix does

`before-quit`'s first entry sets a quit-in-progress state (ahead of the
session-cookie hold, which can wait), and every site that would answer a request
with a window consults it:

- the `second-instance` path refuses the request **whole** — nothing created,
  nothing raised, nothing parked — and reports it as
  `applied=skipped+quitting` (`window-raise.ts::reportSkippedWhileQuitting`);
- the macOS `activate` handler (a Dock click on a windowless app) refuses the
  same way;
- the window-CREATE path itself refuses the same way
  (`setupMainWindowWithUpdateService`, plus the pre-park guard in
  `openSessionInWindow`), so a banner click, the consent toast's reopen and the
  viewer's recreate verbs cannot open a window the shutdown would take down —
  each refusal carries its own `trigger`;
- and a quit that is CANCELLED lets go of the state beside its own
  cancellation — the setup window's declined "Quit without setup?" is the one
  cancellation a running quit has — so a cancelled quit refuses nothing later.

The next launch — the one that finds the process gone — opens normally, which
the rig's final control measures.

**And the refusal is now COMPLETED — bounded taking-over (#755).** The refusal
stays whole; what changed is what happens to the request. A refusal from the two
sites that mean "the user asked for the app" — a second launch and a macOS Dock
click — is recorded in memory (`src/main/relaunch-pending.ts`), and the quit's
EXISTING terminal — the `will-quit` pass that already names itself "the
completion" — schedules exactly ONE successor instance (`app.relaunch`) before
it exits. The successor starts after this process is gone, takes the freed
single-instance lock, and opens as an ordinary launch under the recorded plan.
The refusal line says so (`reopen=deferred`); the schedule is idempotent
because `app.relaunch` starts one instance PER CALL; a quit that is cancelled
clears the record beside its own cancellation; and a quit whose return is
already owned by an in-flight update install stands the successor down (a
running instance is what Squirrel's last check aborts the install on). The
command line the successor runs is the losing launch's, minus argv[0], with
`--window-mode` pinned when that command line carried none — the loser's
ENVIRONMENT does not cross the instance boundary, so an env-born mode must be
pinned or the successor re-resolves a different plan than the request declared.
A refused DOCK CLICK names no losing launch at all, so its successor is composed
from the DYING process's own command line — and only for a packaged build is
that `[]` (macOS starts the bundle exactly as the user's own launch did); a
dev-shaped process replays its own vector, so the app path and the launch's
enclosure (`--user-data-dir`, a named mode, the inspector) travel instead of
bare Electron starting on the machine-default profile (review F1). The
completion also reaches the two exits OUTSIDE the `will-quit` pass that could
once strand a record — the headless exit deadline and the `uncaughtException`
handler call the same idempotent helper before they go (review F2).
The reporter's workaround — close it again, wait several seconds, try again —
is gone: the reopen completes itself.

## The evidence

`scripts/relaunch-during-quit-proof.mjs` is the re-runnable rig. It boots the
**built** app on a scratch profile and:

1. instance **A** (headless) starts and owns its backend — the state a real user
   has, and what makes the teardown a window wide enough to land in;
2. A quits via `app.quit()` driven over its own main-process inspector — the
   same chain Cmd+Q takes (`before-quit` → the window closing → `will-quit` →
   exit, read from A's own log);
3. instance **B** is the relaunch, anchored on the reading *"A's window is
   gone"* rather than a sleep, sharing A's scratch profile so it loses the
   lock exactly as a second launch does — and carrying an `--inspect` port,
   which the recorded request replays to the successor (#755);
4. in the #755 arm, the successor **S** — the one process A's quit terminal
   schedules — is read on that same port after A is gone: a fresh pid, the
   freed lock, one visible window, its own log lines (the replay contract is
   proven by S answering there at all). The same port is held closed as the
   negative while A still tears down;
5. in the `--activate` arm there is no B: the rig emits the `activate` EVENT
   into A mid-teardown (the Dock click, refused whole and recorded), and the
   successor is read on A's OWN port — its argv asserted to carry the app path
   and the run's scratch enclosure (the review-F1 carriage), booting under the
   replayed headless plan with one window that is never shown;
6. instance **C** is the relaunch after S has lived and quit: the control that
   a refusal is a refusal, not a permanent state.

B declares `inactive` rather than going undeclared (a person's relaunch, which
is `focus`): taking the operator's focus is the one thing this repository's rigs
may not do, and the plan differs only in the presentation call the dying
instance makes (`showInactive()` instead of `show()`+`focus()`) — the same
request through the same code path. A `headless` B would be a different request
(`never` creates nothing even before the fix) and would prove nothing. The
activate arm's dying process names `headless` for the same repo rule: the plan a
click asks for is `focus`, which no rig may boot, so the arm's command line
names a mode and the replay keeps what the line names; the pin rule (`focus` →
`normal` when a line names none) stays a suite-level pin.

| reading | before (base tree) | after (the fix) |
| --- | --- | --- |
| A's window for B's request | created, `visible: true`, and dies with A | none (`[]`) |
| A's raise line for B | `applied=showInactive` | `applied=skipped+quitting` |
| the next relaunch (C) | opens and shows its window | opens and shows its window |
| A's own teardown | exit 0, +5228 ms | exit 0, +5069 ms |

The raw runs are [`transcript-before.txt`](transcript-before.txt) and
[`transcript-after.txt`](transcript-after.txt) (the second-launch arm), with the
Dock-click arm beside them in [`transcript-activate.txt`](transcript-activate.txt);
the before run is the failing one (2 failing checks — the window, and the
missing refusal line), the after run is `OK: 0 failing check(s)`. The before
transcript predates the working-directory move described above, which is why its
`cwd=` names the checkout while the after run's names the run's scratch tree.

The #755 arm adds the successor readings, and `--no-reopen` runs its control
(the same quit with nothing refused — nothing may be spawned, so the scratch
profile stays quiet for the grace window, the designated port stays closed, and
no `reopen=deferred` line exists):

| reading (#755 arm) | the recorded run |
| --- | --- |
| A's refusal of B's request | `[window-raise] trigger=second-instance … applied=skipped+quitting reopen=deferred` |
| while A still tears down | nothing listens on B's replayed port; only A is on the scratch profile; no `[relaunch]` line yet |
| after A exits | S answers on the replayed port: a fresh pid, `hasSingleInstanceLock() = true`, one visible window, its daemon/raise/launcher lines in the log |
| exactly-once | S's window list stays at one; the lock is S's; the scratch profile carries one instance |
| S's own quit | spawns nothing (no request was refused during it) |
| `--no-reopen` control | quiet for the 5 s grace: no process, no listener, no token, no `[relaunch]` line; C opens normally |
| the click (`--activate` arm) | `[window-raise] trigger=activate … applied=skipped+quitting reopen=deferred`; A's window list still `[]` |
| while A tears down | only A on the scratch profile; no `[relaunch]` line yet |
| the successor | answers on A's own replayed port: fresh pid, the freed lock, argv carrying the app path and the scratch enclosure (`--user-data-dir`, `--window-mode=headless`, `--inspect`), one window never shown (`visible: false`), the headless launcher policy line in the log |

```
node scripts/relaunch-during-quit-proof.mjs             # the second-launch arm
node scripts/relaunch-during-quit-proof.mjs --activate  # the Dock-click arm
node scripts/relaunch-during-quit-proof.mjs --no-reopen # the control arm
```

The rig needs a BUILT tree (`pnpm build`) and is run from that tree's root; it
writes everything scratch to a `mktemp -d` tree it removes on exit (HOME,
config, logs and the Electron profile all redirected; the notification and
telemetry switches applied; `--keep` keeps the tree, `--label`/`--record` name
its artifacts). The app itself is booted with its WORKING DIRECTORY inside that
scratch tree and an absolute app path — `src/main/backend/config.ts` folds a
`.env` from the process's working directory over the launch environment
(`override: true`), so a checkout's own `.env` would otherwise override the
rig's free-port assignment (round-1 QA's Q1) — and a missing
`out/main/index.js` is refused by name before anything is launched. It never
shows or focuses a window — the profile frame is `capturePage()` from the app
itself.

## What this does not show

- No real Cmd+Q keystroke is synthesized: the quit is driven over the main
  inspector, and the evidence for the menu path is that the chain entered is the
  same one, read from A's own log. The macOS Dock-click `activate` path is the
  same class of limit: it is exercised handler-side, and the OS path is not
  synthesizable.
- It measures one machine's teardown timing. The window this bug lives in is the
  owned backend's stop — seconds here — and a machine with nothing to stop would
  have a narrower window.
- The frame is PNG, not a swept `.webp`: no supplementary set is declared and the
  manifest's `frames` count does not move.
- The #755 arm's residuals, documented rather than repaired: a hard kill
  (SIGKILL, power loss) before the quit's terminal loses the record — the lock
  is simply free and the person's next launch opens normally; and a refusal
  arriving after the successor was already scheduled (the sub-millisecond
  sliver after the last terminal call) rides the earlier request's plan — its
  line still says `reopen=deferred`, but the schedule is latched and completes
  only the request that was already on the record. The two exits outside the
  `will-quit` pass that could once strand a record — the headless exit deadline
  and the `uncaughtException` handler — now complete it through the same helper
  before they go (review F2). The successor the second-launch arm observes is
  `inactive` (visible, unfocused) — the same envelope B and C run under — and
  the activate arm's is `headless`: a `focus` successor, which is what the
  recorded click asks for, is not bootable by any rig here, so the arm's dying
  command line names its mode and the replay keeps it. A packaged plain reopen
  is `[]` (macOS starts the bundle, so its successor comes up `normal`).
