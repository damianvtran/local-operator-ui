# Update and install robustness evidence

The 0.17.0 auto-update downloaded, verified its checksum, called
`quitAndInstall`, and the app never came back. The same evening the operator
tried to install 0.17.0 from the website and macOS answered *"Local Operator" is
damaged and can't be opened. You should move it to the Trash.* Two different
failures with one shared root: nothing on the update path checked the state of
the thing being replaced, and nothing told the user when it went wrong.

This directory holds the evidence for both, and the frames for the states the
user now sees.

## The forensic files

Copied from the audit of the operator's machine
(`~/workspace/lo-update-audit/evidence/`, 2026-09-11):

| File | What it shows |
| --- | --- |
| [ShipIt_stderr.log](ShipIt_stderr.log) | Squirrel.Mac's ShipIt refusing the install: `Installation error: Error Domain=NSOSStatusErrorDomain Code=-67028` from `SecStaticCodeCreateWithPath` on the installed bundle, then `ShipIt quitting`. `-67028` is `errSecCSBadBundleFormat`. |
| [ShipItState.plist.txt](ShipItState.plist.txt) | ShipIt's own state after the failure: an install that stopped without relaunching anything. |
| [pending-update-info.json](pending-update-info.json) | The staged update left behind in `~/Library/Caches/local-operator-ui-updater/pending/`. |
| [bundle-validation-probe.txt](bundle-validation-probe.txt) | The probe that maps the Security framework codes: nonexistent path → `-67068 errSecCSStaticCodeNotFound`; a plain directory or a bundle without `Contents/MacOS/...` → **`-67028`**. This is what makes the ShipIt error conclusive rather than suggestive. |
| [artifacts-gatekeeper.txt](artifacts-gatekeeper.txt) | The release artifacts themselves. The app inside the mounted image: `codesign --verify: OK`, `spctl` **accepted / source=Notarized Developer ID**, `stapler validate` OK. The image as downloaded: `code object is not signed at all`, `spctl` **rejected / source=no usable signature**. |
| [update-service-log-excerpts.txt](update-service-log-excerpts.txt) | The update service's own log: the 22:36:48 `update-downloaded`, the pip offer made for a `GLOBAL_INSTALL` server, and the `APP_BUNDLED_VENV` offer an hour earlier. |
| [gate-on-shipped-0.17.0.txt](gate-on-shipped-0.17.0.txt) | The new release gate run against the real 0.17.0 artifacts (below). |
| [notarize-step-guards.txt](notarize-step-guards.txt) | What the disk image step does on a machine with no signing identity or Apple credentials, and why the positive direction is only exercised in CI. |
| [leftover-shipit-job.txt](leftover-shipit-job.txt) | What the failed install left *running* on the operator's machine: the ShipIt launchd job in a respawn loop and the staging tree beside it. This is what the app now reaps itself, and why. |
| [remediation-round-1.txt](remediation-round-1.txt) | Every gate run on the review remediation: lint, typecheck, theme contract, the desktop suite, the build, the artifact gate against the real 0.17.0 artifacts, and the environment checks behind the classification and the watchdog. |
| [remediation-round-2.txt](remediation-round-2.txt) | The same gates on the second remediation, plus the measurements the watchdog's bound is derived from: every ShipIt attempt in this log by timestamp (255 s slowest), the `plutil` read the swap check makes against the real bundle, and the launchd answer for a job that is not loaded (exit 3, no output) that Q4 is about. |

## The gate, run against the shipped 0.17.0 release

`node scripts/verify-macos-artifacts.mjs --app "/Volumes/Local Operator
0.17.0-universal/Local Operator.app" --dmg ~/Downloads/local-operator-ui-0.17.0-universal.dmg`
— the mounted app and the downloaded image, exactly as they shipped:

```
PASS app-codesign: codesign --verify --deep --strict on the app
PASS app-spctl: spctl -a -vvv -t exec on the app
PASS app-stapler: stapler validate on the app
FAIL dmg-spctl: spctl -a -vvv -t open on the disk image -> rejected | source=no usable signature
FAIL dmg-stapler: stapler validate on the disk image -> does not have a ticket stapled to it.
gate exit=1
```

Two things to take from that. The three app checks passed on the release users
could not open, which is why 0.17.0 shipped: the pipeline asserted the app and
never the container. And the two checks that failed are the ones now run before
upload, so this same artifact would not leave CI today.

## What could not be produced here, and where it is covered

There is no Developer ID identity on this machine (`security find-identity -v -p
codesigning` → `0 valid identities found`) and no `APPLE_ID` /
`APPLE_ID_PASSWORD` / `APPLE_TEAM_ID`, so a signed, notarized, stapled disk
image cannot be produced locally. The positive direction — all five checks
passing on a real release artifact — runs in the `build-macos` job of
`.github/workflows/publish.yml` on every release, where a failure fails the
release before anything is uploaded. The negative direction is a contract test:
`scripts/update-robustness.test.mjs` asserts the shipped-0.17.0 shape
(signed app, unsigned image) fails, asserts an accepted image passes, and runs
the real `spctl` and `xcrun stapler` against a synthetic unsigned image created
with `hdiutil` on this machine.

## The pre-flight, run against a real bundle

`scripts/update-robustness.test.mjs` builds a small bundle, signs it ad-hoc,
runs the real `/usr/bin/codesign --verify --deep` on it, and then re-runs it
after changing a sealed resource — the audit's own "damaged" reproduction. The
first run exits 0 and the pre-flight proceeds; the second exits 1 with `a sealed
resource is missing or invalid` and the install is refused without quitting.
Ad-hoc signatures verify exactly like Developer ID ones for this purpose, which
is what lets the case run anywhere macOS does.

The probe deliberately does **not** pass `--strict`. `--strict` does not test the
seal — `--verify` does that — it additionally rejects FinderInfo/detritus xattrs
that ShipIt itself tolerates, so it could only ever refuse installs Squirrel
would have performed. Dropping it is safe because the case above still fails
without it: measured on this machine, a tampered sealed resource reports `a
sealed resource is missing or invalid` and exits 1 with or without `--strict`.

A probe that could not run at all (a timeout, a failure to exec) is a third
outcome, not a rejection: the pre-flight retries it once and then proceeds,
logging why. Treating "we could not ask" as "the bundle is bad" is how a
transient failure became a permanent reinstall message.

## The bundle that unsealed itself, and the heal

The pre-flight above is what refused the 0.18.0 update on the operator's
installed 0.17.3 — correctly, because the bundle had already broken its own
seal before the update was offered. The cause was ours: the standalone CPython
the app bundles as an `extraResource` ships without bytecode for its stdlib, so
every process that runs it writes `__pycache__/*.pyc` beside sources that live
inside the code-sealed `.app`. Measured on this machine: 308 `file added:` and 3
`file modified:` violations, all `.pyc`, within seconds of the first backend
run — and `spctl -a -vvv -t exec` now rejects the installed app too.

[bytecode-seal.txt](bytecode-seal.txt) is the full measurement set: the shipped
bundle's three `.pyc` and why they are stale by construction (recorded source
mtime 1748584453 against packaged sources at 1789072763, so CPython rewrites
them and one rewrite is a `file modified:` violation); `.pyc` going from 3 to 55
in a copy of the real tree, against 1821 files byte-for-byte unchanged and 582
`.pyc` still cached when `PYTHONPYCACHEPREFIX` is set; which violation classes
can be healed and which cannot; and the two-bundle round trip through the real
`codesign` — a bundle that shipped no bytecode takes `file added:` damage,
heals, and installs, while a bundle built the way 0.17.0 shipped is refused and
stays refused.

Three consequences are visible in the shipped tree: the interpreter runs under
`PYTHONPYCACHEPREFIX` in a userData cache directory (never inside the bundle),
the build ships no bytecode at all, and the release gate fails on any `.pyc`
under the bundled interpreter trees — the check that would have stopped 0.17.0
before upload. An install that is already broken in this way needs one manual
reinstall; the three rewritten sealed `.pyc` in it cannot be restored by
deleting anything, and the measurements say so rather than the prose.

## How the relaunch watchdog decides

The watchdog exists for one outcome: a failed Squirrel.Mac install quits the app
and never brings it back, so the user is left with no app and no message. Both
of its inputs were wrong and are now measured against the machine rather than
inferred:

- **Has the app exited?** Asked of the app's own pid with `kill -0`, captured by
the app before it quit. A name probe cannot answer this: macOS `pgrep -f` does
not report its own ancestors, and the watchdog *is* the app's child — so
`pgrep -f <app path>` returned "not running" while the app was running.
- **Is the install over?** Asked of the ShipIt *launchd job* by label
(`launchctl list com.local-operator.ShipIt`), not of a process name. `pgrep -f
ShipIt` matched any process with the word in its command line, including an
unrelated sampling loop, and could not tell a hung install from a bystander.

The script relaunches in exactly one situation — the app is not running — and it
reaches that point on two paths: the install is decided (the job is gone, the
conservative case), or the deadline arrived with no decision. There is no exit
from the script that skips the attempt, which is what the previous version did
at its deadline, leaving the reporter with nothing.

## What the app cleans up afterwards

A failed install leaves the ShipIt launchd job loaded in the user's domain, and
nothing in Squirrel retires it: on this machine it respawned every ~2.5 s
(`runs=3114`, `LastExitStatus=256`) and wrote `Could not read update request` to
`ShipIt_stderr.log` until the file was 3.4 MB, with the staged update tree beside
it. It was removed by hand during round 1 of the review, and the product does it
now: on detecting a failed install from the pending marker, the app removes its
own `<bundle id>.ShipIt` job (`launchctl remove`, treating "not loaded" as the
ordinary case) and deletes the `update.*` staging directories under
`~/Library/Caches/<bundle id>.ShipIt`. The ShipIt logs are deliberately left
alone — they are the only record of why the install failed, and the failure
detail points at them. See [leftover-shipit-job.txt](leftover-shipit-job.txt).

## The frames

Captured with `node scripts/capture-evidence.mjs http://localhost:6006
--only=common-updatenotification --themes=localOperatorDark,localOperatorLight
--allow-backend` against the running Storybook:

| Surface | Frame | State |
| --- | --- | --- |
| install-blocked | [dark](common-updatenotification/install-blocked/localOperatorDark.webp) · [light](common-updatenotification/install-blocked/localOperatorLight.webp) | The install refused before the app quit: a danger-marked heading (the marker is the glyph, because `danger` as *text* on `elevated` measures 3.76:1 in monokai — under the 4.5:1 text floor the theme contract asserts), the version being refused, the remedy at reading weight with `Open download page` on the panel, and codesign's own line below the actions under a `Details:` label with a copy button. |
| install-failed | [dark](common-updatenotification/install-failed/localOperatorDark.webp) · [light](common-updatenotification/install-failed/localOperatorLight.webp) | The next start after an install that never completed: the app came back on the old version and now says so, offers the one-click retry its copy names, offers the manual page as well, counts a repeat failure (`2 attempts`), and puts the machine detail — starting time in the user's own locale, and the artifact path — below the actions. |
| backend-manual-required | [dark](common-updatenotification/backend-manual-required/localOperatorDark.webp) · [light](common-updatenotification/backend-manual-required/localOperatorLight.webp) | A server the app installed itself, with the command for how it was installed, a copy button, and a `Check for updates` that re-reads the *server* rather than only the UI. |
| backend-manual-required-existing-server | [dark](common-updatenotification/backend-manual-required-existing-server/localOperatorDark.webp) · [light](common-updatenotification/backend-manual-required-existing-server/localOperatorLight.webp) | The same state reached through `EXISTING_SERVER` — a server the user started in a terminal. This path used to send a hardcoded `pip install --upgrade local-operator` whatever owned the environment; here it is a pipx install, so the panel names `pipx upgrade local-operator` and the `Details:` line carries the classification it was decided from. |
| backend-update-non-managed | [dark](common-updatenotification/backend-update-non-managed/localOperatorDark.webp) · [light](common-updatenotification/backend-update-non-managed/localOperatorLight.webp) | A uv tool install: `uv tool upgrade local-operator`, a copy button, no `Update server` button (`canManageUpdate: false` is honoured rather than guessed from a substring), no duplicate toast (the panel is the notification), and one emphasis shared with the manual-required panel instead of a warning hue. |

The five surfaces are declared in `docs/evidence/manifest.json` under
`partialCapture`, so `pnpm check-evidence` accounts for every frame on disk.

The `update-available` frame was re-captured too and came out byte-identical:
this change does not touch the informational state, which is the point — the
failure states now differ from it by construction rather than in principle.
