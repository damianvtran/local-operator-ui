# The closed window: run Apple's installer, not Squirrel's launchd job

**Status.** Design note. No implementation here, and none intended in this branch:
what follows is the mechanism as the code actually has it, the options, the one
recommendation, and how the change will be proved. A spike under
`scripts/shipit-direct-spike.mjs` supports the load-bearing assumption and its raw
output is in Appendix A.

**Companions.** PR #365 (`fix/update-install-window`, open at the time of writing)
supplies the measuring instruments this note is judged by —
`scripts/update-window-report.mjs`, `scripts/sec-check.c` — and the launch-hold fix
that stops a launch from cancelling an install mid-flight. Where a symbol exists
only on that branch it is marked **(#365)**; every other citation is against
`origin/main` at `ef8ae2bfe`.

**Measured since (2026-09-19).** Two of the figures below are superseded by real
installs of the operator's app, and the change this note designs has since merged
while none of those installs carried it. **Appendix D** is an addition rather than a
revision — it says which numbers were the design's premise and which were measured
afterwards — and it is the reason §1 and §6 must not be quoted on their own. Read it
before either.

**The one-line claim.** An install spends four and a half minutes inside
`SecStaticCodeCheckValidityWithErrors` because it runs in a launchd job's
scheduling class, not because there is anything slow about the work. The same
`ShipIt` doing the same validation, spawned by us instead of submitted to
launchd, completes the install's own two phases — validate and swap — in **2.3-4.6 s**,
the span of `request -> swap landed` across Appendix A's four runs (the terminal line
follows 0.3-0.6 s later; #370's header quotes `2.3-5.2 s`, whose upper end is a
TERMINAL figure from the aside run listed under Appendix A's run 1, which is why the
two endpoints are stated separately here). (The relaunch is the third phase and is NOT
inside either figure: those runs kept `launchAfterInstallation: false` on purpose, while
the design in §5.2 leaves it `true` for the shipped app.) That is a sample rather than
a ceiling: re-run on the same 394 MB bundle since, this rig has taken **3.7 s at load
80-84**, **10.4 s at load 109-114** and **3.5 s at load 185.33** `request -> swap
landed` (Appendix D), so a future install is held against that range with the load it
was taken at. Nothing needs to be
re-implemented: the
installer is still Apple's, the validation is still Apple's, the swap is still
Apple's. The only thing that changes is who starts it.

---

## 1. The problem, as the code and the logs have it

An in-app update ends with `autoUpdater.quitAndInstall(false, true)`
(`src/main/update-service.ts:3177`), and the app is then closed for minutes. On
this machine, 2026-09-18:

```
ShipIt_stderr.log  11:59:00.991  Detected this as an install request
                   11:59:03.330  Beginning installation
                   12:03:29.903  Moving bundle from file:///Applications/Local Operator.app/
                   12:04:24.951  Installation completed successfully
                   12:04:27.173  Successfully launched application
```

`Beginning installation -> Moving bundle` is **4 min 26.6 s**, and a `sample` of
that process put 100% of its samples in
`SecStaticCodeCheckValidityWithErrors` → `Security::CodeSigning::SecStaticCode::staticValidate`
→ `Security::Dispatch::Group::wait` → `__ulock_wait` at 4.3% CPU over 4.5 minutes:
it was blocked, not computing. The same call on the same content costs
0.25-3.85 s from an ordinary process and 33.3 s as a launchd job in the same
minute (PR #365's measurements; `pnpm sec-check --background` reproduces the pair).
Measured again for this note, on the same 394 MB bundle, minutes apart: **2.3-4.6 s to
the swap landed (2.6-5.2 s to the terminal line) spawned directly, still inside
`Beginning installation` after 300 s under `taskpolicy -b`** (Appendix A, runs 1-2 and
4; the same rig has since measured 3.5 s, 3.7 s, 10.2 s and 10.4 s across loads of 80
to 185, so this is a range that moves with the machine rather than a band with a top —
Appendix D).

An install that *aborts* costs the user the whole wait as well: the 09:37 install
was cancelled after 3 min 49 s with `SQRLInstallerErrorDomain Code=-9 "App Still
Running Error"`, because the app came back while it was live. That is what PR #365
fixes from the launch side. It is also the constraint the design below has to keep
respecting, because `ShipIt` asks whether any instance of the target app is running
**once, as its last check before the swap** — so the app must be gone before that
check, and after this change the check arrives in seconds rather than minutes.

## 2. The mechanism, end to end, as this repository and this machine have it

Worth stating precisely, because the whole design is about the seam between the
last two steps:

1. **Our process downloads the zip.** `autoUpdater.downloadUpdate()` on macOS is
   electron-updater's `MacUpdater.doDownloadUpdate`, which fetches the `.zip`
   artifact itself into the updater's own cache
   (`node_modules/electron-updater/out/MacUpdater.js:99-132`; the app records the
   path at `src/main/update-service.ts:3046`). On this machine that is
   `~/Library/Caches/local-operator-ui-updater/pending/local-operator-ui-0.28.4-arm64.zip`,
   152,594,459 bytes, whose root is `Local Operator.app/` — measured.
2. **Squirrel fetches that same zip from us and unzips it.** electron-updater
   stands up a localhost HTTP proxy and hands `autoUpdater` (Electron's
   Squirrel.Mac) a feed URL (`MacUpdater.js:211-227`); the fetch is triggered from
   `quitAndInstall` when `autoInstallOnAppQuit` is false (`MacUpdater.js:240-256`).
   Squirrel unzips with **`/usr/bin/ditto`** — the framework's own strings name
   `SQRLZipArchiver`, `dittoTask`, `+unzipArchiveAtURL:intoDirectoryAtURL:` and
   `/usr/bin/ditto` — into `~/Library/Caches/com.local-operator.ShipIt/update.<random>/`.
3. **Squirrel writes the state plist and submits `ShipIt` to launchd**
   (`SMJobSubmit`, `Squirrel/SQRLUpdater.m:406`, per PR #365). This machine's own
   `~/Library/Caches/com.local-operator.ShipIt/ShipItState.plist`, written by the
   11:59 install, is the schema verbatim:

   ```json
   {"launchAfterInstallation":true,
    "updateBundleURL":"file:///Users/damian/Library/Caches/com.local-operator.ShipIt/update.j73onLx/Local%20Operator.app/",
    "useUpdateBundleName":true,
    "bundleIdentifier":"com.local-operator",
    "targetBundleURL":"file:///Applications/Local%20Operator.app/"}
   ```

4. **`ShipIt` validates, checks for running instances, and swaps.** It runs out of
   `<bundle>/Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt`
   (an ordinary executable inside the signed framework — the operator's
   `ShipItState.plist`/`ShipIt_stderr.log` and the app's own `shipItLog()`,
   `src/main/update-service.ts:1542`, both live under
   `~/Library/Caches/<bundle id>.ShipIt/`, i.e. `shipItJobLabel`/`shipItCacheDir`,
   `src/main/update-install.ts:1672-1684`).

The seam is step 3. Steps 1, 2 and 4 are all work this app or Apple already does
correctly; step 3 is the one that *chooses a scheduling class*, and it is the only
reason the window is minutes instead of seconds.

## 3. What the design has to preserve (read from the code, not assumed)

These are the app's own invariants around an install, and none of them may be
quietly dropped:

- **There is exactly one place an install starts**, and it refuses unless the
  installed bundle's seal probes clean and the staged artifact matches its
  metadata (`runInstallPreflight`, `src/main/update-service.ts:2428`;
  `ensureStagedArtifactVerified`, `:2319`, which runs `codesign` over the bundle
  and a sha512 over the artifact, and checks free space; `verifyStagedArtifact`,
  `src/main/update-install.ts:790`).
- **A marker records the attempt before the quit** and is the only reason a failed
  install is ever reported (`writePendingInstallMarker`,
  `src/main/update-install.ts:924`; read back in `recoverPendingInstall`,
  `src/main/update-service.ts:1358`).
- **"An install is in flight" is a launchd question.** `isInstallInFlight`
  (`src/main/update-install.ts:1475`) is `jobLoaded && marker is current`, and
  `launchdJobLoaded` (`:1505`) is `launchctl list <label>`'s exit status. Four
  readers depend on it: `evaluatePendingInstall`'s `in-flight` verdict
  (`:1418`), the app's live re-check, `evaluateLaunchDuringInstall` **(#365)**, and
  the relaunch watchdog's own `launchctl list` probe inside the generated script
  (`buildWatchdogPlan`, `src/main/update-install.ts:1804`).
- **A relaunch watchdog is ensured before every quit** that is only getting out of
  an install's way (`startRelaunchWatchdog`, `src/main/update-service.ts:2444`;
  `WATCHDOG_TIMEOUT_SECONDS = 600`, `WATCHDOG_HARD_TIMEOUT_SECONDS = 1800`,
  `src/main/update-install.ts:75,97`).
- **Cleanup exists for a failed install's leftovers** — the launchd job by label
  and the `update.*` staging directories (`reapFailedInstall`,
  `src/main/update-install.ts:2320`), and the staged tree removal that retries the
  race ShipIt itself wins (`removeStagedTree`, `:2232`).

The fourth bullet is the structural cost of this design and the reason it is not a
one-line change: **if we spawn the installer ourselves, there is no launchd job,
and "is an install in flight" has to be answered from something else.**

## 4. Options

**(A) Make the validation cheaper inside the launchd job.** No: the class is not
ours to change from inside the job, and nothing about the bundle moves this number
(PR #365 refuted the file-count reading: a 6× smaller write produced no fewer
Gatekeeper scans). Rejected.

**(B) Spawn `ShipIt` ourselves, in a context that gets scheduled.** Recommended.
The installer, its validation, its swap and its relaunch are all unchanged; only
the launch is ours. Measured ceiling of the win: 0.3-0.8 s foreground against
3.9-777 s in the class for the same call, and the same two phases of a whole install
in 2.3-4.6 s here (`request -> swap landed`; 3.5-10.4 s on later runs, load 80-185
— Appendix D).

**(C) Own the swap entirely.** Out of scope, and it gives up Apple's validation
and Apple's swap for nothing this note needs. If a future change wants the
`update.*` staging under our control for other reasons, B is still the step to
take first.

**(D) Submit our own launchd job with an interactive `ProcessType`.** Plausible and
untested. It would keep a job-based liveness signal (less churn in the four
readers above), but which part of the launchd context costs the time is **not
established** — the same call took 33.3 s as a launchd job and 331-777 s under
`taskpolicy -b`, and those are different contexts with different mechanisms. Until
someone demonstrates that a `ProcessType: Interactive` job is fast on this
machine, this is a bet on an unmeasured mechanism where B is a bet on a measured
one. Keep as a fallback idea, not the first move.

**(E) Do nothing, and accept minutes.** Only defensible if B were unsafe. It is
not; but note that "nothing" has a real cost already: 4.5 minutes per install, and
a launch during one throws the whole wait away (PR #365 covers that half).

## 5. The recommended design

Shape: **the app stages the update bundle itself and hands it to a small detached
spawner that waits for the app to be gone and then becomes the installer.**

```
quit-and-install handler (src/main/update-service.ts:3099)
  pre-flight            unchanged: installed seal + staged artifact (sha512, size, free space)
  stage                 NEW: ditto -x -k the staged zip, probe the staged bundle's seal
  watchdog              unchanged: ensured BEFORE the quit
  marker                written with a new installerPid
  spawn                 NEW: detached sh: wait for appPid; exec ShipIt <label> <state.plist>
  quit                  app.quit(), NOT quitAndInstall; fallback below if anything is missing
```

### 5.1 Where the staged bundle comes from

**The zip path is already authoritative and already known.** The app owns the
download (`MacUpdater.doDownloadUpdate`), records `downloadedArtifactPath`
(`src/main/update-service.ts:3046`), resolves it with the updater's own helper
cache as a fallback (`stagedArtifactCandidates`, `:2257`; `downloadHelper`,
`:2274`; `resolveStagedArtifactPath`, `src/main/update-install.ts:881`), and
verifies size + sha512 against the feed metadata's `files[]`
(`matchArtifactMetadata`, `:686`; `sha512Base64`, `src/main/update-service.ts:2301`).
All of that is reusable as-is, including the marker's `artifactPath`.

**What the app must add is the extraction**, and it should be `ditto -x -k <zip>
<staging>` — the same tool Squirrel.Mac itself uses (see §2), so the tree is the
one Apple's own path would have produced. Measured on the operator's staged
0.28.4 zip: **5.7 s**, and the result is a bundle that
`codesign --verify --strict --deep` reports as `valid on disk` / `satisfies its
Designated Requirement` (exit 0, 1.9 s), with `spctl -a -vvv` accepting it as
`source=Notarized Developer ID` and no quarantine attribute anywhere in the tree.
So the extraction does not invalidate the signature, and the design's "must not
invalidate the signature while doing it" is verified rather than hoped for.

**Where it goes.** An app-owned staging root, and the one hard constraint is
volume identity: `ShipIt` finishes by *renaming* the update bundle into the target
bundle's directory (its own log: `Moving bundle from file:///…/update… to
file:///Applications/…`), so the staging root must be on the same volume as the
installed bundle. Recommend `<userData>/update-staging/<version>-<random>/` with a
`st_dev` check against the target bundle before the spawn, falling back to today's
path when they differ. The zip itself must also stay on disk until the install
begins.

**What the app must verify before handing it over.** The new pre-flight step, in
this order: extraction succeeded; `extractedApp` is the expected bundle
(`<staging>/<AppName>.app`, architecture and version from `Info.plist`); the
staged bundle's seal passes; free space still covers what the swap needs.

**Reuse, do not re-implement.** `evaluateBundleSeal`
(`src/main/update-install.ts:258`) already turns a `codesign --verify` probe into
`sealed | unsealed | unavailable`, and `readBundleSeal`
(`src/main/update-service.ts:2056`) already runs the probe with the retry that
makes "could not ask" different from "the bundle is bad". The staged-bundle check
is `readBundleSeal(stagedAppPath)` + `evaluateBundleSeal`, exactly as the installed
one is, and it must not grow a second copy of either (AGENTS.md, "The start-up
repair"). Its refusal is `InstallBlockCode`'s existing
`download-verification-failed` (`src/main/update-install.ts:152`) — *not*
`installed-bundle-not-sealed`, whose copy is about the copy the user is running.

### 5.2 Who spawns the installer, and how

**Not the app, directly.** The obvious version of this change — spawn `ShipIt` in
the app, then `app.quit()` — has a race that this design exists to avoid: `ShipIt`'s
running-instance check comes *after* validation, and validation can be as short as
0.25 s (`sec-check` on a warm bundle). An Electron quit is not bounded by that. The
measured evidence that the race is real is the 09:37 cancellation itself, and the
app's own note **(#365)** that a quit "from a signal never reached
`will-quit` and never
completed, at 45 s and 70 s".

**So the spawner waits for the app to be gone, then `exec`s the installer** — one
process, not two:

```sh
# spawned detached by the app, in the app's scheduling class, before it quits
while kill -0 <appPid> 2>/dev/null; do sleep 0.2; done
exec "<bundle>/Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt" \
     "<bundleIdentifier>.ShipIt" "<staging>/state.plist"
```

- **`exec`, not a call**: the waiting process *becomes* `ShipIt`, so the pid the
  marker records is the installer's own for the rest of its life and no shell sits
  between the log and the work.
- **`kill -0` on the app's pid** is the same question the app's own watchdog
  already asks of a process (`buildWatchdogPlan`, `src/main/update-install.ts:1804`),
  and the 0.2 s poll is the same order as its 3 s interval.
- **The class survives.** A detached child of the app, spawned before the quit,
  inherits the app's scheduling context; `exec` preserves it. Measured
  (Appendix A, run 4): spawned by the app's stand-in at 14:16:59.74 while that
  stand-in was alive, the installer's first line is 14:17:04.839 — **0.5 s after
  the stand-in was killed** and 5 s after the spawn — and the install then
  completed in 2.6 s.
- **The state plist is the app's own file** under the staging root, with the schema
  quoted verbatim in §2: `bundleIdentifier` = the running bundle's own id (read
  from `Info.plist` as `runningBundleIdentifier` already does,
  `src/main/update-service.ts:981`), `targetBundleURL`, `updateBundleURL`,
  `useUpdateBundleName: true`, `launchAfterInstallation: true`.
- **`argv[1]` is the label, not the bundle id.** `ShipIt` keys its persisted state
  and its `SQRLShipItInstallationAttempts` counter on the label it is handed (its
  own log line is `... for app: <label>`), and the real app's domain on this
  machine is `com.local-operator.ShipIt` — which is `shipItJobLabel(bundleId)`
  (`src/main/update-install.ts:1672`) and the cache directory `shipItCacheDir`
  (`:1682`) the app and its reap already use. Pass that, and everything Squirrel's
  own naming gives us stays where it is.
- **Detached and logged**: `spawn(sh, ["-c", script], {detached: true, stdio:
  ["ignore", <fd>, <fd>]})` + `unref()`, with both streams redirected to
  `~/Library/Caches/<label>/ShipIt_stderr.log` — the same file launchd's
  redirection writes today. That is what keeps `shipItLog()`
  (`src/main/update-service.ts:1542`), its "here is why it failed" panel, and
  `scripts/update-window-report.mjs` working with no change.
- **`launchAfterInstallation: true`**, unchanged from Squirrel's own plist: after a
  successful swap `ShipIt` launches the app itself (its log: `Launching new ShipIt
  … with instructions to launch …`, 2.2 s after `Installation completed` on
  2026-09-18). The watchdog stays exactly as it is behind it, for the failure case
  — it already refuses to launch an app that is running, so the two cannot fight.
- **ShipIt path**: resolve
  `Contents/Frameworks/Squirrel.framework/Versions/Current/Resources/ShipIt`
  relative to the running bundle (`appBundleFromExecutable`,
  `src/main/update-install.ts:274`). All three spellings exist today on this
  machine; `Versions/Current` is the version-agnostic one. If it is missing or not
  executable, fall back (§5.6).

### 5.3 What replaces Squirrel's guarantees, and what the app takes on

**Stays Apple's, unchanged:** the code-signature validation against the installed
app's designated requirement, the running-instance check, the two-phase swap (and
its rollback when the second rename fails), and the relaunch.

**The app takes on**, and this is the part to get right:

1. **Deciding that the install should start** — already the pre-flight's job, now
   with a staged-bundle gate.
2. **Providing the right paths** — extraction, staging root on the target's volume,
   the state plist, the ShipIt path.
3. **Being gone when the check happens** — the spawner's wait.
4. **Answering "is an install in flight" without a launchd job** — see below.
5. **Recovering when it does not finish** — unchanged machinery (marker,
   watchdog, `recoverPendingInstall`, `reapFailedInstall`), re-pointed at the new
   liveness signal.

**The liveness replacement, concretely.** Add one field to the marker —
`installerPid: number | null` (`PendingInstallMarker`,
`src/main/update-install.ts:905`; the parser at `:936` tolerates it, and an old
marker parses with `null`) — and answer the question *pid first, job second*:

```ts
// one predicate, used by every reader that has to know
installInFlight =
  marker.installerPid != null
    ? installerIsAlive(marker.installerPid, label, stagedStatePath)   // ps -o command= -p <pid>
    : jobLoaded                                                       // a marker from an older version
```

`installerIsAlive` is `watchdogIsOurs`'s shape (`src/main/update-install.ts:2395`):
`ps -o command= -p <pid>`, and the command line must name *this* app's `ShipIt`
path and the staging state plist. That is deliberately not "a process called
ShipIt exists" — `reapFailedInstall`'s own docstring records a harness on this
machine whose capture script was called `shipit-capture.sh`.

Two rules keep this honest:

- **The launchd probe is not deleted, it is demoted.** `isInstallInFlight` keeps
  its `jobLoaded` parameter for markers written by the version that is being
  replaced, and for the fallback path (§5.6). Removing it would make a marker from
  an in-flight *old* install read as a failure, which is exactly the 2026-09-13
  incident (`evaluatePendingInstall`'s own docstring).
- **`recoverPendingInstall` must not clear or reap a live install.** Its four
  outcomes are unchanged; only the input changes. It should also reap the staging
  tree of a *superseded/failed* install (`removeStagedTree` already retries the
  race), because the app now owns that tree where Squirrel used to own
  `update.*`.

### 5.4 Failure modes and what the user sees

| Failure | What happens | What the user sees |
| --- | --- | --- |
| `ShipIt` missing/renamed by a future Electron or Squirrel | Path resolution fails before the marker is written; the handler falls back to `quitAndInstall` | An install that takes 4.5 minutes, i.e. today's behaviour — not a broken update |
| Staged bundle fails extraction or its seal | Pre-flight refuses, nothing is written, no quit | The existing `download-verification-failed` panel with "check for updates again" |
| Staged bundle fails ShipIt's own validation | `Installation cancelled` in `ShipIt_stderr.log`; the marker survives | The existing failed-install notice, with the detail line pointing at that log |
| Swap never lands (space, I/O) | ShipIt aborts; the watchdog holds on its version check and starts the app at its hard bound | The relaunch promise holds: app back, on the old version, with the failure reported |
| Install cancelled mid-flight | As today. Also: a `ShipIt` blocked in the class ignores `SIGTERM` (measured: it needed `SIGKILL` after 5 minutes), so nothing can reap a stuck install politely | The 09:37 experience — which PR #365's launch hold makes much rarer, and this change makes shorter |
| App crashes before the spawner is written | No install at all; no marker, so nothing is reported as failed | Nothing. Next launch is normal; the staged update is still on disk |
| App crashes after the marker but before the spawn | Marker with a dead `installerPid`; recovery reads it as a failure | The failed-install notice with its remedy |
| Spawn fails (`ENOENT`, permissions) | Reported, and the app quits anyway rather than opening a window into a live install | The app comes back via the watchdog; the update did not happen |
| `Too many attempts to install, aborting update` (a real `ShipIt` string) | Keyed by label in the app's own preferences domain, unchanged by this design | The failed-install notice |

### 5.5 Fallback and reversibility

The new path is **all-or-nothing and self-checking**: staging, seal probe, spawn,
and the `ShipIt` path each either succeed or hand back to the current code. The
handler becomes:

```
if (staged && installerPid) { write marker(installerPid); ensureWatchdog(); app.quit() }
else                        { write marker(null);   ensureWatchdog(); autoUpdater.quitAndInstall(false, true) }
```

so the fallback is literally `src/main/update-service.ts:3177` with its marker
already written — today's behaviour, not a degraded variant of it.

**Revertibility in one commit**: the change is one spawn/predicate module plus one
call site. Setting the staging step to return `null` restores the old path
everywhere, and the launchd probe, the watchdog and `reapFailedInstall` are all
untouched. Nothing about the marker, the watchdog or the recovery changes shape;
the new field is additive and a rollback leaves markers the old code parses.

### 5.6 Disk and cleanup

`requiredDiskBytes` (`src/main/update-install.ts:724`) must gain the extracted
tree: today it accounts for the artifact, the installed bundle and
`INSTALL_DISK_SLACK_BYTES` (`:53`), and the extraction is roughly another copy of
the installed bundle. The *net* footprint is not much worse than today's — Squirrel
already materialises that same extraction under its own cache — but it is now the
app's to check and to reap:

- check free space at the staging root's volume, not only at the artifact's;
- reap the staging tree on the next start for every marker that is not
  `in-flight` (`removeStagedTree`/`reapStagedTree`,
  `src/main/update-install.ts:2232,2289`);
- after a *successful* install ShipIt removes its own temp directories (measured:
  nothing left under `$TMPDIR`), but an aborted one leaves the old bundle there
  (measured: a 394 MB directory under `$TMPDIR` after the killed run). That is
  today's behaviour too — an aborted install leaks the same tree — so it is named
  rather than fixed here.

## 6. How the change will be proved

**The instrument.** `scripts/update-window-report.mjs` (PR #365), read-only,
against the two real logs. It parses `ShipIt_stderr.log` and the app's
`update-service.log` and prints per install: request, `Beginning installation`,
the bundle move, the swap, the terminal line, every phase's duration, both
readings of the closed window (`request -> swap landed`, `request -> app back`),
plus the machine's load and the live installer's scheduling facts. The change must
be judged by its numbers, not by the spike's.

**The before/after claim it has to show.** For installs of the real app at
`/Applications/Local Operator.app` on this machine:

```
before   request -> swap landed   4 min 28.9 s      (#11, 2026-09-18 11:59)
         Beginning installation -> bundle move  4 min 26.6 s
after    both under 10 s, with the installer's own phases present
```

with the same install also completing end to end — app back, new version running,
`Update marker: install of version X succeeded` in the app log — because a fast
window that does not install anything is not the result.

> **Superseded in part (2026-09-19).** The `before` half above is the worst case
> measured, not the typical one — three installs since have run 44.3 s to 1 min 11.1 s
> — and the `after` half is still unproven, because no real install has yet carried
> this design. The change has since merged (Appendix D says where), which is a fact
> about the repository and not a measurement of it. The requirements below are
> unchanged and still unmet; see **Appendix D**.

**How many.** Five consecutive real installs, at two different load levels
(one under ~120, one over ~250), all five showing `request -> swap landed` under
10 s and `Installation completed successfully`. Fewer than five because a single
fast install on a quiet machine is what the spike already has and what a regression
looks like when it is *only* fast once.

**What would falsify it.** Any of these means the design is wrong, not merely
unpolished:

- a real install whose `request -> swap landed` is still minutes, with the
  installer's pid sampling in the background class — i.e. the app's context is not
  the foreground class after all;
- a `Code=-9 App Still Running Error`, which says the spawner's wait did not keep
  the app out of the check (the race this design is shaped around);
- an install that completes but leaves the app unlaunched, or relaunches it on the
  old version;
- a `recoverPendingInstall` that reports a live install as failed, or reaps a
  staging tree a live installer is using;
- free space that used to be sufficient and now is not, at the moment of the
  extraction.

**The rehearsal is not the proof, and this note says so explicitly.** The spike's
4.4 s run was two copies under `/tmp` with `launchAfterInstallation: false` and a
synthetic label — not a Squirrel-orchestrated install of the operator's app. Three
concrete differences: (a) the target path was `/tmp/…`, and
`update-window-report.mjs` anchors its bundle-move phase on
`Moving bundle from file:///Applications/`, so its phase table prints `-` for a
spike's move (measured — Appendix A); (b) nothing was launched and nothing was
relaunched; (c) the label was synthetic, so `ShipIt`'s persisted attempt counter was
a fresh domain rather than the app's. The spike proves the *mechanism*; only real
installs prove the change.

## 7. Risk and blast radius, ranked

1. **The app's quit racing the installer's running-instance check.** The reason
   the spawner waits rather than the app racing. Residual exposure: the spawner's
   0.2 s poll, plus `ShipIt`'s own start-up (sub-second in every run measured).
   Watch: `Code=-9` in any real install.
2. **A validation the app runs itself, on a bundle it then hands to ShipIt.**
   The staged seal probe adds ~2 s of `codesign` to the pre-flight, and a probe
   that *modifies* the tree would be the catastrophic version of this — it does
   not (`--verify`, never `--deep --force`). Watch: the extraction table and the
   seal probe's contract tests, and the fact that a bundle ShipIt rejects costs
   the whole wait.
3. **The liveness rewrite.** Four readers depend on "a job is loaded". Getting a
   predicate wrong shows up as recovery reaping a live install (the 2026-09-13
   incident) or as a failed install never being reported. Watch: the contract
   tests, `evaluatePendingInstall`'s four outcomes, and a deliberate test that a
   marker from an older version still reads through `jobLoaded`.
4. **Staging on the wrong volume** — the swap's final rename fails and the install
   aborts after the wait. Cheap to prevent (`st_dev`), invisible until someone
   installs to `/Applications` on an external disk.
5. **Disk.** Extraction makes the free-space requirement explicit and roughly one
   bundle larger at the moment of install. A machine that used to squeak through
   now refuses — which is the direction to be wrong in, but it is user-visible.
6. **`ShipIt`'s own attempt counter.** Keyed by label in the app's preferences
   domain; a design that passed the bundle id instead of `<bundle id>.ShipIt` would
   silently use a different domain and a different cache directory than the app's
   own reap and log resolution expect. Named because it is exactly the kind of
   detail that looks like nothing until a failed install's log cannot be found.
7. **Least likely, named because it is the one that would be invisible:** a future
   Electron that renames or replaces `Squirrel.framework`'s layout. Mitigated by
   the path check and the fallback, and worth a test that asserts the resolved
   path is inside the running bundle.

## 8. Open questions this note does not settle

- **Whether an Electron main process's detached child really inherits the
  foreground class.** The spike's spawner was a plain `sh` under a CLI parent. This
  is the single assumption a real install changes, and it is cheap to check in the
  same run as the first real install (the report prints the installer's `ps`
  facts).
- **Which part of the launchd context costs the time** (option D). Not needed for
  this design; needed if anyone ever wants a job-based install to be fast.
- **Whether to keep `autoUpdater.checkForUpdates()`'s Squirrel fetch at all.**
  With the app extracting its own bundle, the Squirrel-side fetch that populates
  `update.<random>/` becomes dead weight: that is ~2.3 s of the `request ->
  Beginning installation` phase, and it is the thing that makes the state plist's
  `updateBundleURL` point into a cache we do not own. Removing it would also remove
  Squirrel's own error surface from the download path. It is a second change, and
  it should be considered on its own evidence rather than smuggled into this one.

---

## Appendix A — the spike, and what it measured

`scripts/shipit-direct-spike.mjs` (this branch). Four modes —
`prepare` (clone the installed app twice with APFS clones, write the state plist),
`run` (spawn `ShipIt` detached and exit), `report` (read the installer's log and
print the phase table and the inode change), `cleanup` (remove every tree it made,
including `ShipIt`'s temp directories and the preferences file its synthetic label
creates). Guards: the target is always inside the scratch root, the clone source is
never written, the label is synthetic so `ShipIt`'s running-instance check and its
relaunch cannot reach the operator's app, and `launchAfterInstallation` is false. The
last two are checked against the state plist itself — the file `ShipIt` reads, located
inside the scratch root, not the paths the rig derived — and a `--scratch` root that is
not empty and carries no `evidence.json` (i.e. one this rig did not create) is refused
rather than wiped, so a mistyped argument cannot turn `prepare` into an `rm -rf` of
the operator's own directories.

Run on 2026-09-18 against the 394,498,048-byte installed bundle, all four from
`~/local-operator-ui-worktrees/shipit-direct`, scratch `/tmp/lop-shipit-spike`,
reaped afterwards (verified: `/tmp`, `$TMPDIR`, `~/Library/Caches` and
`~/Library/Preferences/ByHost` contain nothing under the spike's label, and the
operator's `ShipIt_stderr.log` and `ShipItState.plist` hashes are unchanged from
before the first run).

**Run 1 — the shape the app will use, minus the wait (load 140.64 189.48 204.45).**

```
spawned 12421 — the spawning process exited after 4 ms, nothing to inherit from
  12421  0  31  8.8  ShipIt com.local-operator.shipit-spike state.plist
  request -> Beginning installation    14:02:06.825 -> 14:02:06.850   0.0 s
  Beginning installation -> bundle move 14:02:06.850 -> 14:02:10.082  3.2 s
  bundle move -> swap landed           14:02:10.082 -> 14:02:10.083  0.0 s
  request -> swap landed               3.3 s
  request -> terminal                  3.7 s
  VERDICT: installed   swap landed: yes (inode 1289104604 -> 1289109821)
```

An identical earlier run: `request -> swap landed` 4.6 s, `request -> terminal`
5.2 s, inode 1289083090 → 1289090173.

**Run 2 — the same content in the class launchd runs the job in** (`taskpolicy -b`,
load 123.36 145.42 178.19):

```
spawned 27301 (background class)
  14:09:03.536  Detected this as an install request
  14:09:09.603  Beginning installation
  ... at 14:14:05 (5 min 02 s elapsed, 0.2% CPU, nice 0, pri 46) still in that phase
```

Never reached `Moving bundle` inside 300 s. Killed — `SIGTERM` was ignored; it took
`SIGKILL`.

**Run 3 — the update bundle is the app's own `ditto -x -k` extraction** of the
operator's staged 0.28.4 zip (load 113.72 142.48 167.78):

```
spawned 45255 — the spawning process exited after 2 ms
  request -> swap landed   14:14:42.360 -> 14:14:46.764   4.4 s
  request -> terminal      14:14:42.360 -> 14:14:47.096   4.7 s
  VERDICT: installed   swap landed: yes (inode 1289524649 -> 1289529425)
```

`ditto -x -k` itself: 5.7 s. `codesign --verify --strict --deep` on the
extraction: `valid on disk`, `satisfies its Designated Requirement`, exit 0, 1.9 s.
`spctl -a -vvv`: `accepted`, `source=Notarized Developer ID`. No quarantine
attribute in the tree.

**Run 4 — the recommended shape: a spawner that waits, then `exec`s** (load
100.22 125.88 157.29). A `sleep 30` stood in for the running app:

```
stand-in for the app: pid 51985
spawned 51991 at 14:16:59.74 — this spawning process exited after 4 ms
  (the stand-in is still alive; the installer has logged nothing)
killed the app stand-in at 14:17:04.3
  installer first line      14:17:04.839      <- 0.5 s after the app was gone, 5 s after the spawn
  request -> swap landed    2.3 s
  request -> terminal       2.6 s
  VERDICT: installed   swap landed: yes (inode 1289604468 -> 1289611101)
```

**The judging instrument reads these logs.** `scripts/update-window-report.mjs
--shipit-log <run 1 log>` prints `CLOSED WINDOW request -> swap landed 3.3 s`; for
run 3, 4.4 s. Its bundle-move phase prints `-` for both, by design: that phase is
anchored on `Moving bundle from file:///Applications/` (its own comment, "Each is
anchored"), and the spike's target is under `/tmp`. That anchoring is one more
reason the spike cannot stand in for a real install.

**Two `ShipIt` facts the spike found that the design depends on.** (1) `ShipIt`
needs **no launchd job at all**: it completed with a label no job was ever loaded
for. (2) `argv[1]` is the label `ShipIt` names itself by — it printed
`... for app: com.local-operator.shipit-spike` and wrote its preferences to
`~/Library/Preferences/ByHost/<that label>.<hardware uuid>.plist` — which is why
the design passes `shipItJobLabel(bundleId)`, the string the app's own
`shipItCacheDir` and reap already use.

## Appendix B — the state plist the app will write

```json
{
  "bundleIdentifier": "com.local-operator",
  "targetBundleURL": "file:///Applications/Local%20Operator.app/",
  "updateBundleURL": "file:///<userData>/update-staging/0.28.5-<random>/Local%20Operator.app/",
  "launchAfterInstallation": true,
  "useUpdateBundleName": true
}
```

Identical in shape to Squirrel's own (Appendix §2 of this note quotes the one this
machine's 11:59 install left behind), differing only in `updateBundleURL` pointing
at our staging root.

## Appendix C — what this note is not

Not an implementation plan for the Squirrel-fetch removal (§8), not a proposal to
stop using `autoUpdater` for checks (it stays, for the feed and the renderer
events), and not a claim that the numbers above are the change's numbers. They are
the mechanism's numbers, taken in a rig that put everything it made where it could
delete it.

## Appendix D — update, 2026-09-19: what has been measured since this note

**This is an addition, not a revision.** Nothing above it is rewritten, so the figures
that were the design's premise stay distinguishable from the figures measured later.
Everything here is read from the same two logs §6 names, through
`scripts/update-window-report.mjs`, and dated.

**On `main` since 2026-09-19, and still unproven.** The paragraph this one replaces said
there was no implementation on `main`, and that stopped being true while this note sat
in review: #370 merged as `024d2e1e6` at 22:38:25Z on 2026-09-19, after agent review
rounds 1-4, QA rounds 1-4 and UX rounds 1-3 on that PR. The mechanism is in the tree
now, and that is a fact about the repository rather than about the design's numbers.

What a reader must not take from it: **merging is not measuring, and no real install has
yet carried the change.** §6's acceptance test stands unmet — five consecutive real
installs of the operator's app at two load levels, all five showing `request -> swap
landed` under 10 s — and the last install measured on this machine (2026-09-19 11:30,
**44.3 s** closed, 43.0 s of it the validation phase) ran on a build that did **not**
carry it. The first real install that does is the measurement this note is waiting for;
until one exists the seconds belong to the rig, and 44.3 s remains what the app costs
rather than what it used to cost.

**The "before" is the worst case measured, not the typical one.** §1 and §6 quote the
2026-09-18 11:59 install's **4 min 28.9 s** `request -> swap landed` (#11). Three real
installs of the operator's app have completed since, and none took anything like that
long:

```
2026-09-18 19:36   0.29.1   52.8 s        (validation phase 45.5 s)
2026-09-18 21:40   0.29.2   1 min 11.1 s   (validation phase 1 min 6.2 s)
2026-09-19 11:30   0.29.6   44.3 s        (validation phase 43.0 s)
```

The phase that costs the minutes is still the same one — `Beginning installation ->
Moving bundle`, the validation in `SecStaticCodeCheckValidityWithErrors` — so the
mechanism §1 argues about is unchanged. What those three installs show is the spread
on this machine, with the two long ones at the top of it: 4 min 18.3 s (#8, 2026-09-18
00:23) and the 4 min 28.9 s of #11. The window tracks machine load, as the instrument
in §6 says in its own header, so **four and a half minutes is the figure to beat, not
the figure to expect**, and a future comparison against four minutes as the baseline
would understate what a regression has to look like.

**Two details of that third install, so the citation does not surprise a reader.** It
is an install **of 0.29.6** — the app's own marker and the artifact it downloaded both
name 0.29.6, though the day's summary of the same install called it 0.29.7 — and unlike
the other two it did not relaunch the app: `ShipIt` logged `Installation completed
successfully` with no launch line, the app came back 22 minutes later through the
watchdog, and the app's own marker recorded the install as not completing. That is the
0.29.6 signing incident and the relaunch path, neither of which is this note's subject;
the window it measured is still the window.

**The "after" is still unproven, and §6's requirement still stands unmet.** No real
install has yet carried this design — #370 has merged, which is not a measurement — so
the `after` line in §6 is a prediction. Its ask — **five consecutive real installs at two
load levels, all five under 10 s** — has not been run, and until it has, §1's one-line
claim belongs to the spike's rig and Appendix A's `ShipIt` runs rather than to the app.

**The spike was re-run on 2026-09-19**, to check that a rig written on 2026-09-18 still
does what this appendix records on a tree a day newer — the installed bundle is
394,371,072 bytes now against the 394,498,048 of the runs above. It was a complete
install in **3.7 s** `request -> swap landed` at load 80-84, with the target's inode
changed (1339874207 -> 1339879726), and `scripts/update-window-report.mjs
--shipit-log <that run's log>` printing `CLOSED WINDOW request -> swap landed 3.7 s`
with its bundle-move phase `-`, exactly as the runs above record it. Two of the
guards Appendix A describes are now enforced rather than stated; see the sentence
about them there.

**The spike's band is a sample, not a ceiling.** §1 and §4 quote **2.3-4.6 s**
`request -> swap landed` — 2.6-5.2 s if the terminal line is what is being timed, and
those are the two boundaries stated separately because the older `2.3-5.2 s` paired one
endpoint's low with the other's high (both come from Appendix A's runs, the 4.6 s and
5.2 s from the aside run listed under run 1). The four runs carry 1-minute loads of
100.22 / 113.72 / 123.36 / 140.64 — the lightest of which, run 4's, is where the band's
fastest 2.3 s was taken — and #370's own header repeats the band as the measurement the
change rests on. The same rig on the same
394,371,072-byte bundle since: **3.7 s at load 80-84** (the re-run above), **10.4 s at
load 109-114**, **10.2 s at load 118-138** — the last taken independently for this PR's
review round on 2026-09-19, whose clone of the same bundle also took 6.8 s against 3.4 s
here — and **3.5 s at load 185.33** (2026-09-19 18:19, taken while correcting this
paragraph). Every one of them was a complete install of the two phases the rig
exercises: the inode changed and `ShipIt` logged `Installation completed successfully`,
with no launch line. So what stretches is the machine rather than the mechanism — and
**the load does not order these runs**: 3.5 s at 185.33 sits beside 3.7 s at 80-84 and
10.2-10.4 s at 109-138, which is why a future number belongs against the range it was
taken in, with its load recorded beside it, and not against 5.2 s or any single figure.

That matters for §6's bar, `request -> swap landed` under 10 s: at load 109-138 this
rig has now measured 10.2 s and 10.4 s, i.e. at the bar rather than under it — and at
load 185.33 it measured 3.5 s, the same point from the other side. §6's requirement is
not moved here — it is the design's acceptance test, aimed at a real install rather
than at this rig — but a five-install run read without its loads could fail on the
machine rather than on the change, and `update-window-report.mjs` prints the load
beside every number for exactly that reason.
