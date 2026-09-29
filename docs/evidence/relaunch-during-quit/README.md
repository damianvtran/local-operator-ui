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

So between "the window vanished" (+~230 ms after `app.quit()`) and "the process
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
session-cookie hold, which can wait), and both answer sites consult it:

- the `second-instance` path refuses the request **whole** — nothing created,
  nothing raised, nothing parked — and reports it as
  `applied=skipped+quitting` (`window-raise.ts::reportSkippedWhileQuitting`);
- the macOS `activate` handler (a Dock click on a windowless app) refuses the
  same way.

The next launch — the one that finds the process gone — opens normally, which
the rig's third instance measures.

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
   lock exactly as a second launch does;
4. instance **C** is the relaunch after the quit finished: the control that a
   refusal is a refusal, not a permanent state.

B declares `inactive` rather than going undeclared (a person's relaunch, which
is `focus`): taking the operator's focus is the one thing this repository's rigs
may not do, and the plan differs only in the presentation call the dying
instance makes (`showInactive()` instead of `show()`+`focus()`) — the same
request through the same code path. A `headless` B would be a different request
(`never` creates nothing even before the fix) and would prove nothing.

| reading | before (base tree) | after (the fix) |
| --- | --- | --- |
| A's window for B's request | created, `visible: true`, and dies with A | none (`[]`) |
| A's raise line for B | `applied=showInactive` | `applied=skipped+quitting` |
| the next relaunch (C) | opens and shows its window | opens and shows its window |
| A's own teardown | exit 0, +5228 ms | exit 0, +5136 ms |

The raw runs are [`transcript-before.txt`](transcript-before.txt) and
[`transcript-after.txt`](transcript-after.txt); the before run is the failing
one (2 failing checks — the window, and the missing refusal line), the after run
is `OK: 0 failing check(s)`.

```
node scripts/relaunch-during-quit-proof.mjs
```

The rig needs a BUILT tree (`pnpm build`), is run from the repository root, and
writes everything scratch to a `mktemp -d` tree it removes on exit (HOME,
config, logs and the Electron profile all redirected; the notification and
telemetry switches applied; `--keep` keeps the tree, `--label`/`--record` name
its artifacts). It never shows or focuses a window — the profile frame is
`capturePage()` from the app itself.

## What this does not show

- No real Cmd+Q keystroke is synthesized: the quit is driven over the main
  inspector, and the evidence for the menu path is that the chain entered is the
  same one, read from A's own log.
- It measures one machine's teardown timing. The window this bug lives in is the
  owned backend's stop — seconds here — and a machine with nothing to stop would
  have a narrower window.
- The frame is PNG, not a swept `.webp`: no supplementary set is declared and the
  manifest's `frames` count does not move.
