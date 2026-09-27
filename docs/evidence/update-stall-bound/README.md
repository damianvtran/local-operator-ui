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

WHY THE SIMULATION RATHER THAN A BEFORE/AFTER STILL: what this pass bounds is
WHEN the frame leaves, and no still can show a wait. The frames it does move
(remediation round 1) are named below; none of them discriminates the bound on
its own.

- THE HONEST NUMBER, per attempt and per check: the deadline abandons ONE
  attempt at 30s, and the ladder retries to three attempts total (+1s and +3s
delays), so a fully stalled manual check rejects - and a silent one resolves
  `null` - at ~94s, not 30s. The download's no-progress bound is 90s, and the
  two registry reads 10s each. The tests pin `attempts == 3` and the shipped
  values; quote the ladder's ~94s when reading "bounded".
- The alert's own stills are committed under
  `docs/evidence/common-updatenotification/error-state-retrying/` and the other
  `error-state*`/`install-*` sets. REMEDIATION ROUND 1 moved frames the way it
  moved pixels: `error-state-download/` was re-shot at the stall's own message
  (`Error downloading update: cancelled`, design D1 - the classifier used to
  hand that string back at reading weight, so the stage's sentence never
  rendered), and the checking card, the settings button and the download panel
  add a delayed still-working line after 12s (UX U1). The three stories render
  the shipped components now rather than forks of their markup, so the frames
  cannot drift from what those surfaces draw.

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
node --test --test-name-pattern="a feed that never answers|a check the user asked for gets the deadline|an expired sequence settling late|one updater-deduped fetch|a stalled download|download progress resets|the PyPI and npm registry reads|switch silences the watchdog|without the switch the watchdog|skip-list" \
  scripts/update-robustness.test.mjs
node --test --test-name-pattern="the checking frame clears|says a long check|says a stalled download" \
  scripts/update-affirmation.test.mjs
```

(TUI/desktop suites want `env -u NO_COLOR TERM=xterm-256color` in front on this
machine, and neither command may run with a `NODE_TEST_CONTEXT` in its
environment.)
