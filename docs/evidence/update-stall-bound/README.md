# The stalled feed, bounded: the checking frame's way out

The operator's report: after the app self-updated, the "Checking for updates /
Please wait while we check for available updates..." frame (the check phase of
`src/renderer/src/shared/components/common/update-notification.tsx`) stayed up
while the network was stalled; it cleared only when they reset their wifi. The
log timeline (`~/Library/Application Support/Local Operator/logs/update-service.log`):
the mount check started at 10:40:31.184 and hung; the first settle was
`net::ERR_CONNECTION_RESET` at 10:43:00, 2m29.6s in, when the wifi died.

Root cause, verified at `v0.31.4`: the app-feed fetch —
`autoUpdater.checkForUpdates()` through Electron's `net` module — has no
timeout anywhere, and electron-updater exposes no cancel for it, so a
stalled-but-established connection never settles and the renderer's `checking`
state has nothing to clear it. This pass bounds the three unbounded waits
around that frame; see the PR for the full path list.

## The money evidence: the simulation

No pixels move in this change. The checking frame and the failure alert are the
same pixels before and after — what changes is WHEN the frame leaves and what
it is replaced by — so a before/after still pair would not discriminate the
fix, and none was taken. (The checking frame's story
(`update-notification.stories.tsx`'s `Checking`) has no committed frame and is
not registered in the capture sweep; adding a registered set is a capture pass
of its own, and it would render the same frame this pass ships no change to.
The alert's own stills are committed under
`docs/evidence/common-updatenotification/error-state-retrying/` and the other
`error-state*`/`install-*` sets.)

What does discriminate, and is the evidence, is a stalled-feed simulation run
against the SHIPPED code on both sides of the IPC boundary:

- `main-process-simulation.txt` — the main-process half
  (`scripts/update-robustness.test.mjs`), driven with a feed fetch that never
  settles: the deadline abandons the attempt, the retry ladder retries it as
  the transient it is classified as, an app-initiated check resolves `null` (no
  report), a check the user asked for rejects with
  `net::ERR_TIMED_OUT` and is NOT filtered into "no updates available"; an
  expired sequence's late settle cannot unpin a successor check (the epoch
  guard); a stalled download is cancelled through a real
  `CancellationToken` and reports; progress resets the stall watchdog. The same
  run pins the shipped bounds as values (30s per feed attempt, 90s of no
  download progress) because every case above narrows them to milliseconds.
- `renderer-frame-simulation.txt` — the renderer half
  (`scripts/update-affirmation.test.mjs`), which mounts the SHIPPED component
  against the SHIPPED `window.api.updater` bridge, takes the checking frame up,
  answers the check with the deadline's rejection, and asserts the frame is
  gone and the failure surfaces as the copy's own sentence with the machine's
  code subordinate ("The app could not reach the update server. Check this
  machine's connection, then try again." / `net::ERR_TIMED_OUT`), not as the
  raw message.

Re-run either half with:

```sh
node --test --test-name-pattern="a feed that never answers|a check the user asked for gets the deadline|an expired sequence settling late|a stalled download|download progress resets|skip-list" \
  scripts/update-robustness.test.mjs
node --test --test-name-pattern="the checking frame clears" \
  scripts/update-affirmation.test.mjs
```

(TUI/desktop suites want `env -u NO_COLOR TERM=xterm-256color` in front on this
machine, and neither command may run with a `NODE_TEST_CONTEXT` in its
environment.)
