import { join } from "node:path";

/**
 * The update bundle the app stages for itself, and the installer it hands it to.
 *
 * WHY THIS EXISTS. An in-app update ends at `autoUpdater.quitAndInstall`, which
 * asks Squirrel.Mac to fetch the zip, unzip it with `/usr/bin/ditto`, write a
 * state plist and SUBMIT `ShipIt` as a LAUNCHD JOB (`SMJobSubmit`). Every part of
 * that is fine except the last: the job's scheduling class is what makes
 * `SecStaticCodeCheckValidityWithErrors` - Apple's own validation, over a 394 MB
 * bundle - cost minutes instead of seconds. Measured on the operator's machine,
 * 2026-09-18: the same call is 0.25-3.85 s from an ordinary process, 33.3 s as a
 * launchd job, and 331-777 s under `taskpolicy -b`, while a real install sat in it
 * for 4 min 26.6 s at 4.3% CPU with 100% of `sample`'s samples in a `__ulock_wait`.
 * Spawned directly instead, the same ShipIt completes the install's own two phases -
 * validate and swap - in 2.3-5.2 s (`scripts/shipit-direct-spike.mjs`, Appendix A of
 * `docs/design/update-install-window.md`, runs whose state plist kept
 * `launchAfterInstallation: false` on purpose). The relaunch is the third phase and
 * the spike deliberately did not exercise it: its evidence is the launchd path's own
 * log (a real install's `Launching new ShipIt ... with instructions to launch ...`,
 * 2.2 s after `Installation completed`) plus the state plist this module writes,
 * which is where that instruction comes from.
 *
 * So nothing about the install is re-implemented here. The installer is still
 * Apple's, the validation is still Apple's, the swap is still Apple's, and this
 * module only does what Squirrel used to do on the app's behalf: extract the zip
 * into a bundle, write the state plist, and start ShipIt - in the caller's own
 * scheduling context rather than in a job's, and only once the app is gone, since
 * ShipIt asks "is any instance of the target app running?" once, as its last check
 * before the swap, and a launch that answers yes aborts the install
 * (`SQRLInstallerErrorDomain Code=-9`, the 2026-09-18 09:37 install).
 *
 * WHY THE EXTRACTION IS `ditto`. It is the tool Squirrel.Mac itself uses
 * (`SQRLZipArchiver`, `dittoTask` and `/usr/bin/ditto` are in the framework's own
 * strings), so the tree is byte-for-byte the one Apple's own path would have
 * produced, and it was measured to leave the signature intact: `codesign --verify
 * --strict --deep` on the extraction reports `valid on disk` and `satisfies its
 * Designated Requirement`, `spctl -a -vvv` accepts it as `source=Notarized
 * Developer ID`, and no quarantine attribute appears anywhere in the tree.
 *
 * Everything here is free of Electron imports, for the same reason
 * `update-install.ts` is: the contract tests bundle the shipped TypeScript in
 * memory, so what they drive is the code that runs rather than a copy of it.
 */

/**
 * The zip extractor, named absolutely for the reason the watchdog's probes are:
 * it is macOS's tool, this path is where macOS keeps it, and a `PATH` that
 * happens to have been changed by whatever the app was spawned from must not
 * decide which program unpacks an update.
 */
export const DITTO_PATH = "/usr/bin/ditto";

/**
 * ShipIt's location inside the running bundle, relative to the `.app`.
 *
 * `Versions/Current` rather than `Versions/A`: all three spellings exist on this
 * machine, and this is the only version-agnostic one - a future Electron that
 * renames the framework's version directory must not need this constant changed.
 * It is resolved against the RUNNING bundle (`shipItPathInBundle`), which is the
 * same rule the app's own `shipItJobLabel`/`shipItCacheDir` follow: the app may
 * only touch the installer of the bundle it is.
 */
export const SHIPIT_RELATIVE_PATH = join(
	"Contents",
	"Frameworks",
	"Squirrel.framework",
	"Versions",
	"Current",
	"Resources",
	"ShipIt",
);

/**
 * The sentinel that marks a process as this module's waiting spawner.
 *
 * The watchdog has the same thing (`WATCHDOG_TOKEN`) and for the same reason: a
 * pid alone is not an identity, because a pid is reused. The installer's own
 * liveness is asked of the process's command line, and this token is what the
 * waiting half carries until it `exec`s ShipIt - after which the command line is
 * ShipIt's own argv and `installerIsAlive` reads that instead.
 */
export const INSTALLER_TOKEN = "local-operator-update-installer";

/** The app's own root for staged update bundles, under its userData directory. */
export const UPDATE_STAGING_DIR = "update-staging";

/**
 * How long the spawner waits between `kill -0` polls of the app's pid.
 *
 * The same order as the relaunch watchdog's own interval, and the number is
 * what stands between "the app is gone" and "ShipIt checks whether anything of
 * the app is running": the smaller it is, the less of that exposure, and every
 * poll is one `kill` in a shell that is doing nothing else.
 */
export const INSTALLER_POLL_SECONDS = "0.2";

/**
 * How long the extraction may take before it is killed.
 *
 * `ditto` over a 152 MB zip was measured at 5.7 s on this machine; this is two
 * orders of magnitude of headroom for a cold cache or a slow volume, and the
 * bound exists because a wedged extraction inside the quit-and-install handler
 * would otherwise hold the whole update panel forever with nothing to show for
 * it. A timeout is an extraction failure like any other, and the caller falls
 * back to Squirrel's own path.
 */
export const EXTRACTION_TIMEOUT_MS = 10 * 60_000;

/**
 * The ShipIt inside a running bundle, or null when there is no bundle to ask.
 *
 * The path is not checked here: whether it exists and is executable is the
 * caller's question, because "there is no Squirrel.framework in this layout" and
 * "there is no bundle at all" are different failures and only the caller knows
 * what to say about them.
 */
export function shipItPathInBundle(bundlePath: string | null): string | null {
	if (!bundlePath) return null;
	return join(bundlePath, SHIPIT_RELATIVE_PATH);
}

/** The app's own root for staged update bundles. */
export function updateStagingRoot(userDataDir: string): string {
	return join(userDataDir, UPDATE_STAGING_DIR);
}

/**
 * One install's staging directory: `<userData>/update-staging/<version>-<nonce>`.
 *
 * The version leads so a human reading the directory knows which release it
 * holds, and the nonce follows because two attempts at the same version must not
 * land in one tree: the second would extract over the first while ShipIt may
 * still be reading it, which is the same class of race that made `removeStagedTree`
 * retry (2026-09-13: a reap removed a tree ShipIt was moving at that instant).
 *
 * The directory is deliberately NOT keyed on anything derivable from the marker:
 * a stale tree has to be recognisable as stale on the next start, and a path that
 * changes with every attempt is what makes "every tree but the live one is
 * rubbish" the reap's rule rather than a guess about which attempt a tree was.
 */
export function updateStagingDir(input: {
	userDataDir: string;
	version: string;
	nonce: string;
}): string {
	return join(
		updateStagingRoot(input.userDataDir),
		`${input.version}-${input.nonce}`,
	);
}

/**
 * The state plist handed to ShipIt, under the staging directory it describes.
 *
 * Under the staging root rather than in Squirrel's cache, because the whole
 * point of this path is that the tree ShipIt is pointed at is the app's own: the
 * plist names it, the spawner passes its path as `argv[2]`, and the liveness
 * check reads that same argument back to tell this install's installer from any
 * other process that happens to be running.
 */
export function stagingStatePath(stagingRoot: string): string {
	return join(stagingRoot, "state.plist");
}

/**
 * The log both of the installer's streams are appended to.
 *
 * The SAME file launchd's redirection writes for a Squirrel-run install
 * (`<cache>/<bundle id>.ShipIt/ShipIt_stderr.log`), and that is the whole reason
 * it is not a log of our own: the app's `shipItLog()`, the failure panel's
 * "here is why" detail line and `scripts/update-window-report.mjs` all read that
 * path, and an install that this app started must not be the one install whose
 * log nobody can find.
 */
export function installerLogPath(shipItCacheDir: string): string {
	return join(shipItCacheDir, "ShipIt_stderr.log");
}

/** The argv `ditto` needs to unzip a release into a staging directory. */
export function extractionArguments(
	zipPath: string,
	stagingRoot: string,
): string[] {
	return ["-x", "-k", zipPath, stagingRoot];
}

/**
 * What a staged bundle is, as the pre-flight can establish it.
 *
 * Three facts and one deliberate non-answer. The bundle HAS to be the app the
 * running process is (`bundle identifier`) at the version the update was for
 * (`CFBundleShortVersionString`) with its own executable present, because ShipIt
 * swaps the tree at the target path and a mismatched tree would replace the user's
 * app with something else entirely. Architecture is the non-answer: the running
 * architecture is read from the staged executable's own load commands
 * (`lipo -archs`), and a value that could not be read is NOT treated as a refusal -
 * "we could not ask" is not "the bundle is bad" (the same rule `readBundleSeal`'s
 * retry exists for), and a bundle that is wrong about the version or the identity
 * is already refused here.
 */
export type StagedBundleReading = {
	/** The `.app` the extraction was expected to produce. */
	appPath: string;
	exists: boolean;
	/** `CFBundleIdentifier` as read from the staged bundle, or null. */
	bundleIdentifier: string | null;
	/** `CFBundleShortVersionString` as read from the staged bundle, or null. */
	version: string | null;
	/** Whether the staged bundle's own executable exists. */
	executablePresent: boolean;
	/** Architectures `lipo -archs` reported, or null when it could not be read. */
	architectures: string[] | null;
};

export type StagedBundleVerdict =
	| { ok: true; detail: string }
	| { ok: false; detail: string };

export function evaluateStagedBundle(input: {
	reading: StagedBundleReading;
	expectedBundleIdentifier: string;
	expectedVersion: string;
	/** `process.arch`, the architecture this app is running as. */
	runningArchitecture: string;
}): StagedBundleVerdict {
	const { reading } = input;
	if (!reading.exists) {
		return {
			ok: false,
			detail: `the extraction produced no bundle at ${reading.appPath}`,
		};
	}
	if (reading.bundleIdentifier !== input.expectedBundleIdentifier) {
		return {
			ok: false,
			detail: `the staged bundle is ${
				reading.bundleIdentifier ?? "unsigned for an identifier"
			}, not ${input.expectedBundleIdentifier}`,
		};
	}
	if (reading.version !== input.expectedVersion) {
		return {
			ok: false,
			detail: `the staged bundle reports version ${
				reading.version ?? "unknown"
			}, not ${input.expectedVersion}`,
		};
	}
	if (!reading.executablePresent) {
		return {
			ok: false,
			detail: `the staged bundle at ${reading.appPath} has no executable of its own`,
		};
	}
	if (
		reading.architectures != null &&
		reading.architectures.length > 0 &&
		!reading.architectures.includes(input.runningArchitecture)
	) {
		return {
			ok: false,
			detail: `the staged bundle is built for ${reading.architectures.join(
				", ",
			)} and this app is running as ${input.runningArchitecture}`,
		};
	}
	return {
		ok: true,
		detail: `${input.expectedBundleIdentifier} ${input.expectedVersion}${
			reading.architectures ? ` (${reading.architectures.join(", ")})` : ""
		}`,
	};
}

/**
 * The `st_dev` of the volume a path lives on, or null when it cannot be read.
 *
 * ShipIt finishes by RENAMING the staged bundle into the target's directory - its
 * own log says `Moving bundle from file:///... to file:///Applications/...` - and
 * a rename across volumes is not a rename. Staging on the app's own volume is
 * therefore a precondition rather than a preference, and this is the number that
 * answers it.
 */
export function volumeId(device: number | null | undefined): number | null {
	return device == null || Number.isNaN(device) ? null : device;
}

/** Whether a staged tree and a target bundle are on the same volume. */
export function sameVolume(
	stagingDevice: number | null,
	targetDevice: number | null,
): boolean {
	return stagingDevice != null && stagingDevice === targetDevice;
}

/** `file://` URL for a directory, percent-encoded the way Squirrel writes it. */
export function fileUrlForDirectory(path: string): string {
	const withSlash = path.endsWith("/") ? path : `${path}/`;
	return `file://${encodeURI(withSlash)}`;
}

/**
 * The state plist ShipIt is handed, field for field Squirrel's own.
 *
 * The schema is not invented: this machine's
 * `~/Library/Caches/com.local-operator.ShipIt/ShipItState.plist`, written by the
 * 2026-09-18 11:59 install, is JSON with exactly these five keys, and ShipIt read
 * it. Read back with `plutil -p` it is:
 *
 * ```json
 * {"bundleIdentifier":"com.local-operator","launchAfterInstallation":true,
 *  "targetBundleURL":"file:///Applications/Local%20Operator.app/",
 *  "updateBundleURL":"file:///Users/.../update.j73onLx/Local%20Operator.app/",
 *  "useUpdateBundleName":true}
 * ```
 *
 * Only `updateBundleURL` differs here, and it differs because it is the point of
 * the change: our staging directory instead of one under Squirrel's cache.
 *
 * `launchAfterInstallation: true` is kept because ShipIt relaunching the app is
 * how a successful install ends - it logs `Launching new ShipIt ... with
 * instructions to launch ...` - and the app's own relaunch watchdog sits behind
 * it for the failure case, refusing to start an app that is already running so
 * the two cannot fight.
 */
export function shipItStatePlist(input: {
	bundleIdentifier: string;
	targetBundlePath: string;
	updateBundlePath: string;
}): Record<string, unknown> {
	return {
		bundleIdentifier: input.bundleIdentifier,
		targetBundleURL: fileUrlForDirectory(input.targetBundlePath),
		updateBundleURL: fileUrlForDirectory(input.updateBundlePath),
		launchAfterInstallation: true,
		useUpdateBundleName: true,
	};
}

/**
 * The detached spawner: wait for the app to be gone, then BECOME the installer.
 *
 * WHY A SPAWNER AND NOT A DIRECT SPAWN. The obvious version of this change -
 * start ShipIt in the app, then `app.quit()` - has a race, and it is the race the
 * 2026-09-18 09:37 install died of: ShipIt's running-instance check comes AFTER
 * validation, validation can be as short as 0.25 s on a warm bundle, and an
 * Electron quit is not bounded by that. Waiting for the pid first means the
 * question ShipIt asks last ("is any instance of the target app running?") is
 * asked after the app is provably gone, whatever the quit costs.
 *
 * `exec` rather than calling ShipIt as a child, so the waiting process BECOMES
 * the installer: the pid the app recorded is the installer's own for the rest of
 * its life, no shell sits between the log and the work, and nothing has to be
 * reaped that is not ShipIt itself.
 *
 * `kill -0` on the app's own pid is the same question the relaunch watchdog asks
 * of the same pid (`buildWatchdogPlan`), and the same one the app's own reap
 * asks of a watchdog. The pid travels as a positional argument rather than in the
 * environment for the watchdog's own reason: `sh -c` puts the script text in the
 * process's command line, and a script carrying `/Applications/Local
 * Operator.app` would show up in any process listing of it.
 *
 * Both of the installer's streams are appended to the log launchd would have
 * written (see `installerLogPath`), inside the script rather than as inherited
 * descriptors, so the spawned process holds no descriptor of ours open: a pipe
 * the app holds is a pipe that can keep the app alive.
 */
export function buildInstallerSpawn(input: {
	/** The app's own pid, captured before the quit. */
	appPid: number;
	shipItPath: string;
	/** The label ShipIt names itself by: `<bundle id>.ShipIt`. */
	label: string;
	statePath: string;
	logPath: string;
}): { script: string; env: Record<string, string>; args: string[] } {
	const script = `#!/bin/sh
# ${INSTALLER_TOKEN}
#
# Why this exists: the app is about to quit so an install can replace it, and the
# installer must not be running its own check for a running instance of the app
# while one is still there - ShipIt asks that question once, as its last check
# before the swap, and an instance of the target app answers it with "abort"
# (SQRLInstallerErrorDomain Code=-9, the 2026-09-18 09:37 install). So this waits
# for the app's pid to go, and then replaces itself with the installer: one
# process, one pid for the app to record, and no shell left in the way.
while kill -0 "$1" 2>/dev/null; do
	sleep ${INSTALLER_POLL_SECONDS}
done
exec "$LO_UPDATE_INSTALLER_SHIPIT" "$LO_UPDATE_INSTALLER_LABEL" "$LO_UPDATE_INSTALLER_STATE" >>"$LO_UPDATE_INSTALLER_LOG" 2>&1
`;
	return {
		script,
		env: {
			LO_UPDATE_INSTALLER_SHIPIT: input.shipItPath,
			LO_UPDATE_INSTALLER_LABEL: input.label,
			LO_UPDATE_INSTALLER_STATE: input.statePath,
			LO_UPDATE_INSTALLER_LOG: input.logPath,
		},
		// `sh -c <script> <name> <pid>`: the name is $0 and the pid is $1, so the
		// script text carries no path and no number that a process listing of it
		// would not otherwise show.
		args: ["-c", script, "lo-update-installer", String(input.appPid)],
	};
}

/**
 * Whether the installer a marker names is still running, from the machine.
 *
 * The marker's `installerPid` is a pid, and a pid alone is not an identity - it
 * is reused, and the same pid later may be anything at all. So the process's own
 * command line has to say it is ours, and it says it in one of two ways because
 * this pid has two lives:
 *
 * - before the installer starts, the process is the WAITING SPAWNER, whose
 *   command line is `sh -c <script>` and therefore carries `INSTALLER_TOKEN`;
 * - after it starts, the process IS ShipIt, whose argv is
 *   `<ShipIt> <label> <state plist>` - so it names this app's own ShipIt AND a
 *   state plist under this app's own staging root, both of which are required.
 *
 * The second rule deliberately requires BOTH halves. "A process called ShipIt
 * exists" is not an answer: `reapFailedInstall`'s own docstring records a harness
 * on this machine whose capture script was called `shipit-capture.sh`, and a
 * stale registry entry is exactly what the launchd probe was demoted for. The path
 * plus the staging root are what make it this install's installer.
 */
export function installerIsAlive(input: {
	pid: number | null;
	/** `ps -o command= -p <pid>`, or null when nothing runs under that pid. */
	commandLine: string | null;
	/** This app's own ShipIt, as resolved from the running bundle. */
	shipItPath: string | null;
	/** This app's staging root - the directory every install's plist lives under. */
	stagingRoot: string | null;
}): boolean {
	if (input.pid == null || input.commandLine == null) return false;
	const line = input.commandLine;
	if (line.includes(INSTALLER_TOKEN)) return true;
	return (
		input.shipItPath != null &&
		input.stagingRoot != null &&
		line.includes(input.shipItPath) &&
		line.includes(input.stagingRoot)
	);
}

/**
 * Whether ANY process is this install's ShipIt, for the pid that stopped being it.
 *
 * WHY THIS EXISTS, AND WHICH WAY IT FAILS. The marker records one pid, and one pid
 * is a snapshot: the spawner `exec`s ShipIt (same pid, so the common case is
 * covered), but a ShipIt that re-execs or forks internally would leave the recorded
 * pid dead while an install it is in the middle of continues. The reader that acts
 * on "the installer is gone" is recovery, and its action is destructive - it
 * declares the install failed and reaps the staged tree, which a live installer is
 * renaming - so a false negative there is the 2026-09-13 incident class and the one
 * failure direction worth paying a second `ps` to avoid.
 *
 * So the recorded pid is the fast path and this is the answer before declaring the
 * installer dead: one `ps -Ao command= -ww` listing, matched on the same two facts
 * `installerIsAlive` requires of the pid - this app's own ShipIt AND a state plist
 * under this app's own staging root. It is not asked the other way round, and
 * deliberately: a live foreign `ShipIt` (another application's install, which this
 * machine has several of) must never be read as ours.
 *
 * An unreadable listing (`null`) answers false, and that is the direction stated
 * rather than hidden: a `ps` that cannot run leaves the installer unproven, and the
 * caller treats unproven as gone. That is the safe direction for the LAUNCH HOLD
 * (better a launch the install may abort than an app the user cannot open) and the
 * unsafe one for recovery's reap - named here so the next reader does not have to
 * rediscover which way it leans.
 */
export function installerElsewhere(input: {
	/** `ps -Ao command= -ww`, or null when the listing could not be read. */
	processList: string | null;
	/** This app's own ShipIt, as resolved from the running bundle. */
	shipItPath: string | null;
	/** This app's staging root - the directory every install's plist lives under. */
	stagingRoot: string | null;
}): boolean {
	if (!input.processList || !input.shipItPath || !input.stagingRoot) {
		return false;
	}
	return input.processList
		.split("\n")
		.some(
			(line) =>
				line.includes(input.shipItPath as string) &&
				line.includes(input.stagingRoot as string),
		);
}
