import {
	exec,
	execFile,
	execFileSync,
	spawn,
	spawnSync,
} from "node:child_process";
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	readdirSync,
	statSync,
	statfsSync,
} from "node:fs";
import * as https from "node:https";
import { homedir } from "node:os";
import * as path from "node:path";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { net, type BrowserWindow, app, ipcMain, powerMonitor } from "electron";
import { type UpdateInfo, autoUpdater } from "electron-updater";
import {
	type DriftRestartHold,
	backendVersionDrift,
	driftRestartDecision,
} from "./backend-version-drift";
import type { BackendServiceManager } from "./backend/backend-service";

import {
	stripErrorPrefixes,
	transientTransportCode,
} from "../shared/transport-failure";
import { LocalOperatorStartupMode } from "./backend/backend-service";
import { apiConfig } from "./backend/config";
import { LogFileType, logger } from "./backend/logger";
import {
	isUnpreparedVenvPath,
	legacyEnvironmentReport,
	legacyVenvPaths,
	managedSupportRoot,
	managedVenvPath,
} from "./backend/venv-paths";
import { withPythonBytecodeCache } from "./python-bytecode-cache";
import {
	type UpdateChannelStatus,
	type UpdateCheckVerdict,
	isReadableVersion,
	serverChannelVerdict,
	updateCheckVerdict,
} from "./update-check-verdict";
import {
	type BytecodeHealResult,
	type InstallBlock,
	type InstallFailurePayload,
	type InstallIdentity,
	type InstallInFlightPayload,
	type LastInstallAttempt,
	type PendingInstallMarker,
	type SealBlockContext,
	type SealProbe,
	type SealVerdict,
	type UpdateFileMetadata,
	appBundleFromExecutable,
	buildPipUpgradeCommand,
	buildWatchdogPlan,
	classifyGlobalInstall,
	clearPendingInstallMarker,
	clearPendingServerUpdateMarker,
	compareVersions,
	didUpgradeLand,
	evaluateBundleSeal,
	evaluatePendingInstall,
	healPythonBytecode,
	installFailurePayload,
	installInFlightPayload,
	installedBundleSealBlock,
	installerSearchPath,
	isInstallInFlight,
	launchdJobLoaded,
	matchArtifactMetadata,
	measureDirectoryBytes,
	parsePipShowVersion,
	parseSealViolations,
	readInstallIdentity,
	readLastInstallAttempt,
	readPendingInstallMarker,
	readPendingServerUpdateMarker,
	reapFailedInstall,
	reapStagedTree,
	recordInstallFailure,
	requiredDiskBytes,
	resolveCommandPath,
	resolveDistributionMarkers,
	resolveGlobalConsoleScript,
	resolveGlobalInstallPlan,
	resolveStagedArtifactPath,
	shipItCacheDir,
	shipItJobLabel,
	verifyStagedArtifact,
	watchdogIsOurs,
	watchdogSignals,
	watchdogSwapTarget,
	writePendingInstallMarker,
	writePendingServerUpdateMarker,
} from "./update-install";

// Regex constants for performance (moved to top-level)
const VERSION_LINE_REGEX = /Version:\s*([^\n]+)/;
const VERSION_CLEAN_REGEX = /^v/i;
const BETA_VERSION_REGEX = /v\d+\.\d+\.\d+\.beta\.\d+/;

/** A reverse-DNS bundle identifier, and nothing else. */
const BUNDLE_ID_REGEX = /^[\w.-]+$/;

/**
 * How often a live install is re-checked while the app is open, in ms.
 *
 * ShipIt either swaps or aborts within a couple of minutes of the app coming
 * back - it asks "is any instance of the app running?" as its last validation -
 * so this is the delay between the panel saying the update is still going and
 * the user hearing the truth. It is not the bound: `isInstallInFlight` stops
 * calling a marker current after `PENDING_INSTALL_RECENCY_SECONDS`, and the
 * first re-check past that point evaluates as a failure and ends the loop.
 */
const INSTALL_IN_FLIGHT_RECHECK_MS = 10_000;

/** What `launchctl remove` prints when the job is not loaded. */
const LAUNCHCTL_NOT_LOADED_REGEX = /could not find|no such process/i;

/**
 * How long `codesign --verify` gets on the installed bundle.
 *
 * Measured at 6.1 s warm for a 1.0 GiB app, so the old 20 s was not
 * comfortably clear on a cold cache or a slow volume - and a probe that timed
 * out there used to refuse the install for good (review R5).
 */
const SEAL_PROBE_TIMEOUT_MS = 45_000;

/**
 * How long after the window is created the start-up seal pass runs.
 *
 * The same `codesign --verify --deep` the pre-flight runs, over the same bundle,
 * measured at 4.1 s and 4.3 s on the shipped 0.22.2 app on this machine - so it
 * does not belong in the launch path, which is already loading a renderer and
 * starting a backend. Nothing is lost by the delay: the break it repairs is the
 * one the NEXT launch is refused for, and this process is already up.
 */
const STARTUP_SEAL_PROBE_DELAY_MS = 15_000;

/**
 * How long after this machine resumes the wake-armed check runs, in ms.
 *
 * WHY A WAKE ARMS A CHECK AT ALL, and why it waits. The operator's own
 * `update-service.log` and `pmset -g log` pin the reported failure to a DARK
 * WAKE: `2026-09-16 09:03:12 DarkWake from Deep Idle [CDN] : due to
 * smc.sysState.Wake(0x70070000) wifibt ...`, with the feed fetch failing
 * `net::ERR_INTERNET_DISCONNECTED` in the same second, the machine's resolver
 * answering `getaddrinfo ENOTFOUND pypi.org` at the same instant, and airportd
 * reporting `hasAssocToWiFi1 = 0` twelve seconds later - the wake reason itself
 * names the Wi-Fi stack coming back up. The five-minute tick that lands on that
 * instant is a tick that cannot succeed, so the fix is to give the network a
 * moment and then ask once: twenty seconds is past the association the log shows
 * (about twelve) and far inside the next tick.
 *
 * ONE TIMER, never a storm: a second resume while one is armed leaves the
 * existing timer alone, so a night of maintenance wakes cannot accumulate
 * checks - and the check this arms is the ordinary scheduled one, which is
 * silent, so it can never report anything by itself.
 */
const POST_WAKE_CHECK_DELAY_MS = 20_000;

/** ` to version X`, or nothing when the version is unknown. */
function versionSuffix(version: string | null | undefined): string {
	return version ? ` to version ${version}` : "";
}

/**
 * The failure the network gate hands its caller when the machine never had a network.
 *
 * WHY IT CARRIES A CHROMIUM CODE. This is not an invented error: it is the exact
 * failure a fetch attempted in that state produces - the operator's own log has
 * `net::ERR_INTERNET_DISCONNECTED` at the dark-wake second, from the updater's own
 * executor - so the renderer classifies it with the same shared classifier and
 * paints the same sentence it would paint for the real one. The alternative
 * (inventing a message in the app's own voice) would be a second spelling of one
 * failure, in the module whose whole purpose is having one.
 */
function offlineTransportError(): Error {
	/*
	 * THE MESSAGE NAMES THE GATE, not a failed fetch (review round 3, R3-3). A grep
	 * for this code in the log would otherwise find a line that reads like a request
	 * that went out and came back refused, and a reader chasing it would look for a
	 * dropped connection that never existed. The code stays, because the renderer
	 * classifies and describes it with the shared table; the parenthetical is what
	 * says the check never left the machine.
	 */
	return new Error(
		"net::ERR_INTERNET_DISCONNECTED - the machine reported no network, so no request was made",
	);
}
/**
 * Run a command and report its exit code rather than throwing on failure.
 *
 * The seal probes need the code and the raw output together: the -67028 that
 * ShipIt reports for a half-replaced bundle is only distinguishable from a
 * missing one by what `codesign` actually printed.
 *
 * `ran` is the second half of that answer, and it is the part that was missing:
 * a timeout, a failure to exec and a probe that died silently all arrived as
 * "exit code 1", which the pre-flight read as "codesign rejected this bundle"
 * and turned into a permanent reinstall message (review R5).
 */
function runCommand(
	command: string,
	args: string[],
	options: {
		timeoutMs?: number;
		/**
		 * Environment for the child, when the default (`process.env`) is wrong for
		 * it. The python spawns pass `pythonSpawnEnv()`; everything else here runs
		 * a macOS tool that wants the inherited environment.
		 */
		env?: Record<string, string | undefined>;
	} = {},
): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
	/** False when the process could not be run to a verdict. */
	ran: boolean;
}> {
	return new Promise((resolve) => {
		execFile(
			command,
			args,
			{
				timeout: options.timeoutMs ?? 20000,
				maxBuffer: 4 * 1024 * 1024,
				...(options.env ? { env: options.env } : {}),
			},
			(error, stdout, stderr) => {
				const code = (error as { code?: unknown; killed?: boolean } | null)
					?.code;
				const killed = (error as { killed?: boolean } | null)?.killed === true;
				const out = stdout?.toString() ?? "";
				const err = stderr?.toString() ?? "";
				resolve({
					exitCode: error ? (typeof code === "number" ? code : 1) : 0,
					stdout: out,
					stderr: err,
					// A timeout (killed) or a process that failed to start (a string
					// code such as ENOENT) produced no verdict about the bundle. A
					// numeric exit with output did.
					ran:
						!error ||
						(!killed &&
							typeof code === "number" &&
							`${out}${err}`.trim().length > 0),
				});
			},
		);
	});
}

/**
 * The update service log, as a path a renderer surface can open.
 *
 * Every failing branch of this service ends with a sentence telling the reader the
 * installer's own output is in the update service log, and until this helper
 * existed the pointer named a file no panel could open: the path is composed in
 * the logger from the platform's user-data location plus the launch's own
 * override, so a renderer could not derive it - and a renderer that guessed would
 * name the operator's file during a scratch agent run (QA U5, design D3/D6). The
 * producer that wrote the log is the party that knows, so it travels on the report.
 */
function serverUpdateLogPath(): string {
	return join(logger.getLogPath(), LogFileType.UPDATE_SERVICE);
}

/**
 * Read a command's trimmed stdout, or null when it fails to run.
 */
function readCommandOutput(command: string, args: string[]): string | null {
	try {
		const output = execFileSync(command, args, {
			encoding: "utf8",
			timeout: 5000,
		});
		return output.trim();
	} catch {
		return null;
	}
}

/**
 * How long an installer probe may take before it is not evidence.
 *
 * The sync probe's own timeout (`readCommandOutput`), kept because the two answer
 * the same question about the same tools and a longer wait would only delay the
 * classification it feeds.
 */
const INSTALLER_PROBE_TIMEOUT_MS = 5000;

/**
 * Health check result containing version information
 */
type HealthCheckResult = {
	/** API server version */
	version: string;
	/**
	 * `sys.prefix` of the install the answering process was started from.
	 *
	 * The identity of the INSTALL rather than of the process, and the value the
	 * update check judges: a machine can have several installs and only one of them
	 * is serving this app. Optional because a server older than this field answers
	 * without it, which the check reads as "the install could not be named" rather
	 * than as "the install is current".
	 */
	prefix?: string;
	/**
	 * The backend's own classification of that install (`install_kind()`).
	 *
	 * Carried for the check's Details line and for the app-owned arm's copy: it is
	 * the backend's answer about the environment it runs in, which is the one piece
	 * of evidence the app cannot derive from a path alone.
	 */
	install_kind?: string;
};

/**
 * Why a version-drift restart is not running, in the log's own words.
 *
 * A table rather than a ternary chain at the log site, so every hold the pure
 * decision can return has a sentence: a hold that rendered as an empty fragment
 * would leave a log line whose second half is missing, which is how "the server is
 * behind" becomes unreadable in the one file that has to explain it.
 */
const DRIFT_HOLD_REPORT: Record<DriftRestartHold, string> = {
	"no-drift": "nothing to do",
	"not-app-owned":
		"this app does not restart a server it did not start, so the skew is reported and the process is left alone",
	"update-in-flight":
		"an update of this server is already running and will restart it",
	"session-stream-open":
		"a conversation stream is open, so the restart waits for the next check",
};

/**
 * The last few lines of an installer's stderr, for a panel's error sentence.
 *
 * The tail rather than the head, because an installer's own refusal is its last
 * line (`installer exited 127`, `error: Failed to install`), and bounded rather
 * than whole, because this text lands in a notification: the full streams are in
 * the update service log, which the sentence names.
 */
function stderrTail(stderr: string, maxLines = 4): string {
	const lines = stderr
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return lines.slice(-maxLines).join("\n").slice(-600);
}

/**
 * Response from health check endpoint.
 */
type HealthCheckResponse = {
	/** HTTP status code */
	status: number;
	/** Health check message */
	message: string;
	/** Health check result containing version information (may be undefined in older server versions) */
	result?: HealthCheckResult;
};

/**
 * The server serving this app, as `/health` reports it.
 *
 * `version` keeps `getInstalledBackendVersion`'s own convention, because two
 * callers depend on it: `"Unknown"` is a server that answered without a version
 * (an older build), and null is a server that did not answer at all. `prefix` and
 * `installKind` are null rather than `"Unknown"` when the server did not report
 * them - which the check reads as "the install could not be named", not as
 * "the install is current".
 */
type RunningBackendReading = {
	version: string | null;
	/** `sys.prefix` of the install the process was started from, or null. */
	prefix: string | null;
	/** The process's own `install_kind()`, or null when it did not report one. */
	installKind: string | null;
};

/**
 * One `/health` body as a reading, with the absent fields made explicit.
 *
 * The `Unknown` sentinel is applied by the caller rather than here: this stores
 * what the server said, and "answered without a version" is a fact about the
 * answer rather than about the install.
 */
function readingOfHealth(health: HealthCheckResponse): RunningBackendReading {
	const result = health.result;
	return {
		version: result?.version ?? null,
		prefix: result?.prefix ? result.prefix : null,
		installKind: result?.install_kind ? result.install_kind : null,
	};
}

/**
 * The install that is actually serving this app, and what the app may do to it.
 *
 * The subject of every judgement the server channel makes, taken from the running
 * server's own `/health` rather than from the shim the app can name: a machine can
 * have a current global install on `PATH` while a different install, three
 * releases behind, is the one answering the user.
 */
type ServingInstall = {
	/** The install root the server reported (`sys.prefix`), or null. */
	prefix: string | null;
	/** The version that root reports on disk, or null when it could not be read. */
	version: string | null;
	/** The server's own `install_kind()`, or null when it did not report one. */
	installKind: string | null;
	/**
	 * Whether this root is one of the app's own managed environments.
	 *
	 * It decides the REMEDY and nothing else: no package manager owns a tree under
	 * the app's management root, so neither a pip command nor the app's
	 * global-install path describes it.
	 */
	appOwned: boolean;
};

/**
 * What `backend-update-error` carries: the sentence, and the phase that wrote it.
 *
 * The channel has two producers that mean different things - the failing branches
 * of `checkForBackendUpdates`, which answer a CHECK the user may have pressed, and
 * the failing branches of `updateBackend`, which answer the attempt itself - and
 * the renderer has to tell them apart. It used to infer the difference from
 * whether an attempt happened to be in flight, which is wrong in exactly the case
 * the sibling settings surfaces make reachable: a check the user pressed fails
 * while a server update (minutes long) is running, and the check's "Unable to
 * determine backend version." then painted as the UPDATE's reason while the
 * update's own sentence went to a toast that dismissed itself six seconds later
 * (review R2-1, QA Q2). So the producer says which phase it is rather than the
 * consumer guessing from timing.
 */
/**
 * What a finished app-driven server update reports about the two readings.
 *
 * Sent on `backend-update-completed` instead of the null payload that used to
 * ride it, because a completion is not always good news for the server the user
 * is talking to: `restarted: false` with two different readings is the adopted
 * daemon that will keep serving the old build, and `unattended` is an attempt
 * that landed after the app was gone (reviews R1-3, UX U1/U6). A null payload
 * still means what it always did - the plain success the renderer toast shows -
 * so an older producer keeps working.
 */
export type BackendUpdateCompletion = {
	/** The version the install on disk reports after the attempt. */
	installVersion: string | null;
	/** The version the daemon serving this app reports, when it was readable. */
	runningVersion: string | null;
	/**
	 * Whether the app restarted the daemon it owns. False on every path where the
	 * server serving the conversation has NOT moved onto the new build.
	 */
	restarted: boolean;
	/**
	 * True when the attempt landed while no app was watching it - a quit mid-update
	 * whose installer finished on its own (UX U6).
	 */
	unattended?: boolean;
	/** Whether the daemon serving this app is one the APP may restart. */
	restartable?: boolean;
	/** The install version read before an unattended attempt, when there was one. */
	before?: string | null;
};

export type BackendUpdateErrorReport = {
	/** The sentence to show, written by the branch that failed. */
	message: string;
	/**
	 * `check` for a report from `checkForBackendUpdates`, `update` for one from
	 * `updateBackend`. The renderer puts an attempt's report on the standing
	 * failure panel and a check's on the toast a check has always taken.
	 */
	phase: "check" | "update";
	/**
	 * The update service log the failing branch wrote its detail to, when it has
	 * one.
	 *
	 * Every one of these last-resort sentences tells the reader the installer's own
	 * output is in the update service log, and until this field existed that
	 * pointer named a file no renderer surface could open - the path is composed in
	 * the logger from the platform's user-data location and the launch's own
	 * override, so the renderer could not derive it, let alone the right one for a
	 * scratch launch (QA U5, design D3/D6). The producer that wrote the log is the
	 * one party that knows, so it travels with the report and the panel offers the
	 * button.
	 */
	logPath?: string;
};

/**
 * Type definition for backend update information
 */
export type BackendUpdateInfo = {
	/**
	 * The version the INSTALL on disk reports - what an update would move.
	 *
	 * Not necessarily the build serving the conversation: the app can be attached
	 * to a daemon it did not start, or one left over from the last update
	 * (`runningVersion` below). The panel says which is which rather than
	 * presenting this one as the version the reader is using (review D3).
	 */
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
	/** Whether the update can be managed by the update service */
	canManageUpdate: boolean;
	/**
	 * Whether the install IS one of the app's own, so the panel may not offer the
	 * reader a terminal command or imply that anything on screen moves it.
	 *
	 * Carried rather than inferred from `updateCommand === ""`: an empty command
	 * also means "the app could not classify this install", which is an arm where
	 * the reader DOES have the tool they installed it with and the manual panel's
	 * "check for updates again" is the right closing line (review round 1, UX U1;
	 * R5).
	 */
	appOwned?: boolean;
	/**
	 * Whether the app may restart the daemon serving this app.
	 *
	 * The plan states the managed arm's consequence from the INSTALL's layout and
	 * cannot know who started the server, so a machine where discovery adopted a
	 * daemon got an offer promising a restart that cannot happen - and the app's own
	 * completion notice then denied it (UX U9). This reading, which the other two
	 * events already carry, is what lets the panel choose the sentence that is true
	 * for the server the reader is talking to: false means it keeps serving the old
	 * build until it restarts on its own, and no turn in flight is dropped.
	 */
	restartable?: boolean;
	/** The startup mode of the backend service */
	startupMode?: LocalOperatorStartupMode;
	/**
	 * The version the daemon SERVING this app reports, when it is not the same
	 * reading as `currentVersion` - and it is always sent, so the panel can tell
	 * "the same build" from "no reading".
	 *
	 * It used to travel as a clause appended to `detail`, which the managed panel
	 * branch never rendered, so the skew vanished exactly where the app is about
	 * to act (review R1-2) and the version sentence kept calling the install's
	 * version the one the reader "is currently using" (review D3, UX U1).
	 */
	runningVersion?: string | null;
	/**
	 * Sentence introducing `updateCommand` in the prompt, chosen for how the
	 * backend is actually installed (uv tool, pipx, or a server outside the app).
	 */
	remedy?: string;
	/**
	 * How the install was classified, and where it resolved to.
	 *
	 * Carried to the prompt so both producers of the by-hand state render the
	 * same details line: the command has to be checkable against the install it
	 * was chosen for, and the producer reached by a plain version check used to
	 * send none at all (review U15).
	 */
	detail?: string;
	/**
	 * Whether this install follows a source tree on this machine rather than the
	 * published release, in which case the prompt says so instead of promising the
	 * offered version (review U12).
	 */
	sourceBuild?: boolean;
	/**
	 * Whether this event answers a check the user asked for.
	 *
	 * The by-hand panel's own instruction says to run a command and check again,
	 * so the answer to a check the USER ran is what ends it - while a periodic or
	 * start-up check must not dismiss a panel out from under the reader. The
	 * renderer cannot tell the two apart from the payload's contents (both carry
	 * the same fields), so the producer states it: `silent` is exactly that
	 * distinction on this side, and it is the same line that already decides
	 * whether "nothing newer" is sent at all (review U12, round 3).
	 */
	manual?: boolean;
};

/**
 * What the server channel found out, beside the offer it may carry.
 *
 * The two travel together because they answer different questions: `status` is
 * what this check knows about the channel and is what the whole check's verdict
 * is built from, while `info` is the offer the by-hand panel renders. The IPC
 * handler for `check-for-backend-updates` unwraps the offer, because that
 * channel's existing return shape is a panel's input and nothing consumes a
 * status from it.
 */
type BackendCheckReport = {
	status: UpdateChannelStatus;
	info: BackendUpdateInfo | null;
};

/**
 * The platform/home/userData triple an ownership question is asked with.
 *
 * Named rather than repeated, because there are two callers now: the check's own
 * classification below, and the test that has to ask the SAME question for the
 * platforms this fix newly covers but a darwin host cannot run (review round 2,
 * R6).
 */
type OwnedInstallInput = {
	platform: NodeJS.Platform;
	home: string;
	appDataPath: string;
	packaged: boolean;
};

/**
 * Every root an install can live in and still be the APP'S OWN, for one
 * platform/home/userData triple.
 *
 * THREE SHAPES, not one, because the answer changed over time and every one of
 * them can still be the environment a daemon was started from:
 *
 * 1. `<support>/managed-python` - the post-split tree this build manages. It is
 *    a PARENT: the environments and runtimes live in generations beneath it.
 * 2. `legacyVenvPaths(support)` - the pre-split venvs an older build created and
 *    left on disk. Each entry is a venv root ITSELF, not a parent.
 * 3. `managedVenvPath(...)` - the app's environments by NAME, BOTH of them. On
 *    darwin these are generations under shape 1, but on Windows they are
 *    `userData`'s and on Linux `<home>/.config/local-operator`'s: venv roots
 *    outside the support root entirely. Asking `managedVenvPath` is what keeps
 *    that from becoming a second copy of the split rule here.
 *
 * BOTH NAMES RATHER THAN THIS INSTANCE'S, because which flavour owns an install
 * is a property of the INSTALL and not of the instance asking - the same
 * asymmetry shapes 2 and 3 exist for. `managedVenvPath` answers one name per
 * call, chosen by `packaged`, so listing one flavour's name made the app's own
 * OTHER environment read as external on win32 and linux: their venv roots are
 * not under `managed-python`, where shapes 1 and 2 cover the sibling by being a
 * parent, and the arm that resolves for an install the app does not own offers
 * `pip install --upgrade local-operator` into the app's own tree. That is exactly
 * the instruction shape 2/3 exist to remove, surviving where the parent shape
 * cannot reach it (review round 2, R6) - and on those platforms the SIBLING name
 * is also the pre-split location, whose install scripts fall back to the packaged
 * name (`venv-paths.ts`).
 *
 * Exported and platform-parameterised because the guard below is only as good as
 * this list, and a test that can pass `platform` is the only way to check the
 * Windows and Linux shapes on a darwin host (review round 1, R1: the containment
 * test required the prefix to be a STRICT descendant, which excluded shapes 2 and
 * 3 - the two that are roots rather than parents - so the app offered
 * `pip install --upgrade local-operator` for a tree no package manager owns).
 */
export function appOwnedInstallRoots(input: OwnedInstallInput): string[] {
	const support = managedSupportRoot(input.home);
	return [
		join(support, "managed-python"),
		...legacyVenvPaths(support),
		managedVenvPath(input),
		managedVenvPath({ ...input, packaged: !input.packaged }),
	];
}

/**
 * Whether an install root is one the app manages, or lives under one.
 *
 * The APP'S OWN TREE, not a package manager's: `managed-python` is where the app
 * builds and owns its runtime and its pinned environments, nothing outside it may
 * be read, walked or removed, and no install tool knows about it. The packaged
 * and dev scopes are both matched, because which one owns an install is a
 * property of the install rather than of the instance asking - a packaged
 * environment outlives the build that made it, and a check that asked only about
 * this instance's own scope would offer a package-manager command for a tree the
 * app owns.
 *
 * The roots and the containment rule live in `appOwnedInstallRoots` and
 * `isWithinAnyRoot` above, where a test can reach them: this verdict is what stops
 * the app offering a package-manager command for a tree no package manager owns,
 * so "which roots, and is the root ITSELF inside" is a question that has to be
 * answerable off the machine's own platform. Exported for the same reason and
 * taking the triple as an argument rather than reading `process.platform`, so the
 * win32 and linux verdicts - the ones a darwin host cannot reach - are asserted
 * rather than inferred from the root list (review round 2, R6).
 */
export function appOwnsInstallRoot(
	input: OwnedInstallInput,
	prefix: string,
): boolean {
	return isWithinAnyRoot(appOwnedInstallRoots(input), prefix);
}

/**
 * The newer of two readings, or whichever of them is readable.
 *
 * Used for the SUBJECT of the comparison when the server named no install (see
 * the call site in the check). The rule's own ordering is handed in rather than
 * re-implemented, the same way the verdict is handed it, so the app keeps one
 * answer to "which of two versions is newer".
 */
function newerReading(
	left: string | null,
	right: string | null,
	isNewer: (candidate: string, subject: string) => boolean,
): string | null {
	/*
	 * The `typeof` halves are the narrowing, not belt-and-braces on top of it:
	 * `isReadableVersion` answers a boolean rather than a type predicate, so
	 * `!isReadableVersion(left)` leaves `left` as `string | null` and the call below
	 * would not typecheck. Spelled this way rather than as a local `v is string`
	 * guard because the guard would re-state the predicate's own contract.
	 */
	if (typeof left !== "string" || !isReadableVersion(left)) return right;
	if (typeof right !== "string" || !isReadableVersion(right)) return left;
	return isNewer(left, right) ? left : right;
}

/**
 * Whether `candidate` is one of `roots`, or lives inside one.
 *
 * The SAME TREE counts as inside: `path.relative(root, root)` is `""`, which is a
 * descendant answer rather than the "these share no root" one, and shapes 2 and 3
 * above are roots a daemon starts FROM. Only a path that leaves the root
 * (`..`-prefixed) or shares no root with it at all (`path.relative` echoes the
 * input back, absolute) is outside - which is what keeps a partial or unreadable
 * prefix from matching by substring.
 */
export function isWithinAnyRoot(roots: string[], candidate: string): boolean {
	return roots.some((root) => {
		const relative = path.relative(root, candidate);
		return !relative.startsWith("..") && !path.isAbsolute(relative);
	});
}

/**
 * Service to handle application updates using electron-updater
 * and backend updates using pip
 */
export class UpdateService {
	private mainWindow: BrowserWindow | null = null;
	private isDevMode: boolean;
	private isNpxInstall: boolean;
	private backendUrl: string;
	private updateCheckInterval: NodeJS.Timeout | null = null;
	private backendService: BackendServiceManager | null = null;

	/**
	 * What the updater is doing right now.
	 *
	 * Only used to decide whether an `error` event is a failure the user has to
	 * hear about: a download or an install that dies is not "no update
	 * available", which is how `shouldFilterUpdateError` would otherwise read it.
	 */
	private updateStage: "idle" | "downloading" | "installing" = "idle";

	/**
	 * How many app-channel checks are in flight right now.
	 *
	 * ONE OWNER PER FAILURE. The `autoUpdater` `error` event and the check that
	 * caused it are two producers of the same user-facing message, and they used
	 * to carry two different suppression rules: `checkForUpdates` refuses to send
	 * for a silent check and the event handler sent regardless, so one transient
	 * failure was reported twice and a background check was reported at all. A
	 * check in flight owns its own failure report, so the handler stands down
	 * while this is above zero. It is a DEPTH rather than a boolean because the
	 * scheduled check and a click can overlap.
	 */
	private appChecksInFlight = 0;

	/**
	 * The attempt sequence in flight in the app channel, so a second check rides
	 * it instead of doubling it.
	 *
	 * WHY THIS EXISTS, measured. Two checks are started at launch by different
	 * owners - the renderer's mount effect and this process's own delayed check -
	 * and QA round 1 measured the cost of letting them run independently while
	 * the feed is down: six fetches in 6.6 s where the base made two
	 * (`Q-2`), three per check because of the retries. The fetch is the same
	 * request for the same feed, so the second caller awaits the first one's
	 * sequence and the result is shared; `appChecksInFlight` stays at 1 for the
	 * pair, which is also what keeps the `error` events of that one sequence owned
	 * by the check that started it.
	 */
	private appFeedFetchInFlight: Promise<
		Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>
	> | null = null;

	/**
	 * The wake-armed check, held so a second wake cannot arm a second one.
	 */
	private postWakeCheckTimer: NodeJS.Timeout | null = null;

	/**
	 * The backoff between attempts at one app-channel feed fetch, in ms.
	 *
	 * Two retries, so three attempts, which is the bound a transient Wi-Fi roam
	 * or resolver blip needs and short enough that a check the user is waiting on
	 * still answers in seconds. A test overrides it rather than waiting 4 s per
	 * case; nothing else does.
	 */
	public appFeedRetryDelaysMs: readonly number[] = [1_000, 3_000];

	/** The last update the updater told us about, for its file metadata. */
	private lastUpdateInfo: UpdateInfo | null = null;

	/**
	 * The version the published release last answered with, or null.
	 *
	 * The by-hand prompt is produced from a click, not from a check, so it has no
	 * version of its own to name - and the panel that tells the user to go and do
	 * work is the one that most needs to say what they are working towards. The
	 * periodic and start-up checks read this from the published release already,
	 * so it is kept rather than fetched again on the click (review U17).
	 */
	private lastPublishedBackendVersion: string | null = null;

	/** Path of the artifact this run downloaded, when the updater reported one. */
	private downloadedArtifactPath: string | null = null;

	/**
	 * Artifacts that failed their size/sha512/disk check, by version.
	 *
	 * The 5-minute periodic check runs regardless of what the user dismissed, so
	 * without this an update that cannot be verified is offered again every five
	 * minutes for as long as the app is open.
	 */
	private failedVerificationVersions = new Set<string>();

	/** A failed install detected from the marker on this start, if any. */
	private pendingInstallFailure: InstallFailurePayload | null = null;
	private installFailureDelivered = false;

	/**
	 * Consecutive checks that deferred a version-drift restart.
	 *
	 * See `DRIFT_DEFERRALS_BEFORE_RESTART`: the hold exists so a restart does not
	 * land while a conversation is being watched, and this is what stops the hold
	 * from lasting for the rest of the session. Reset whenever the readings agree.
	 */
	private driftDeferrals = 0;

	/**
	 * The `booted -> installed` pair already restarted for, if any.
	 *
	 * A restart for a skew that did not move is the one failure mode with no natural
	 * end: the periodic check would restart the daemon every five minutes forever,
	 * which is worse than the skew it is chasing. A successful restart changes the
	 * boot reading (a new process, a new record) and therefore the pair, so this
	 * blocks only the repeats.
	 */
	private driftRestartedFor: string | null = null;

	/**
	 * A refusal this process found at start-up, if any.
	 *
	 * Kept apart from `pendingInstallFailure` because they are different facts with
	 * different remedies - that one is an install that did not finish, this one is a
	 * bundle that can no longer be replaced in place - and both can be true of the
	 * same start. Delivered through the same scheduler shape for the same reason:
	 * the window is loading when this is produced (the service is constructed as
	 * the window is created), and a bare `webContents.send` with no subscriber
	 * still reports success.
	 */
	private pendingInstallBlock: InstallBlock | null = null;
	private installBlockDelivered = false;

	/**
	 * An install this process found still running, if any.
	 *
	 * The opposite fact to `pendingInstallFailure`, and kept apart from it: this
	 * one means the update is still in progress and the user has to leave the app
	 * closed for it to finish. Nothing may be cleared, reaped or reported while
	 * it is up.
	 */
	private pendingInstallInFlight: InstallInFlightPayload | null = null;
	private installInFlightDelivered = false;

	/**
	 * True once this process has seen its own install run.
	 *
	 * It is what lets a later failure name the real cause: an install this app
	 * watched start and then not finish, on a machine where the app was open for
	 * part of it, was cancelled by that relaunch (Squirrel asks whether any
	 * instance is running before it swaps), and saying "the update didn't finish"
	 * there sends the user back to retry the one thing that cannot work.
	 */
	private installWasInFlight = false;

	/** The pending re-check of a live install, while the app is open. */
	private installInFlightTimer: NodeJS.Timeout | null = null;

	/**
	 * True once a quit following an in-flight install has made sure the app will
	 * come back.
	 *
	 * The two callers are the same quit seen twice - `window-all-closed` decides
	 * and `before-quit` runs as it goes through - so without this the launchd
	 * probe, the `ps` read and the "no watchdog is running" log all happen twice
	 * for one quit.
	 */
	private inFlightQuitWatchdogEnsured = false;

	/**
	 * True while `quit-and-install` is running its pre-flight.
	 *
	 * The pre-flight can take seconds over a large bundle and artifact, and the
	 * whole point of it is that a second request must not run beside the first (see
	 * the handler).
	 */
	private installPreflightInFlight = false;

	/**
	 * Initialize the update service
	 * @param mainWindow - The main application window
	 * @param backendService - Optional backend service manager for restarting the backend after updates
	 */
	constructor(
		mainWindow: BrowserWindow,
		backendService?: BackendServiceManager,
	) {
		this.mainWindow = mainWindow;
		this.backendService = backendService || null;

		// Determine if we're in dev mode
		this.isDevMode =
			!app.isPackaged || Boolean(process.env.ELECTRON_RENDERER_URL);

		// Determine if this is an npx installation
		// Check if the app is running from a node_modules/.bin directory which is typical for npx
		const execPath = process.execPath;
		this.isNpxInstall =
			execPath.includes("node_modules/.bin") ||
			execPath.includes("node_modules\\.bin");

		// Get the backend URL from config.  Use 127.0.0.1 instead of localhost to avoid issues with local fetch.
		this.backendUrl = apiConfig.baseUrl.replace("localhost", "127.0.0.1");

		logger.info(
			`Update service initialized. Dev mode: ${this.isDevMode}, NPX install: ${this.isNpxInstall}`,
			LogFileType.UPDATE_SERVICE,
		);

		// Configure logging for autoUpdater
		autoUpdater.logger = {
			info: (message: string) =>
				logger.info(message, LogFileType.UPDATE_SERVICE),
			warn: (message: string) =>
				logger.warn(message, LogFileType.UPDATE_SERVICE),
			error: (message: string) =>
				logger.error(message, LogFileType.UPDATE_SERVICE),
			debug: (message: string) =>
				logger.debug(message, LogFileType.UPDATE_SERVICE),
		};

		// Configure autoUpdater
		autoUpdater.autoDownload = false;
		// Install only through the explicit "install now" action, which runs the
		// pre-flight checks first (see quit-and-install below). With this on, a
		// staged update is applied at whatever quit comes next - the user quits
		// for the day and Squirrel installs with no seal check, no marker and no
		// watchdog, and a failed install leaves them with no app (operator report,
		// 2026-09-11). The download stays staged on disk; "install now" re-checks it.
		autoUpdater.autoInstallOnAppQuit = false;

		// Set up event handlers
		this.setupUpdateEvents();

		// A marker left behind by a previous run means that run's install never
		// completed. Recover it before anything else can offer the update again.
		this.recoverPendingInstall();

		/*
		 * Then repair this bundle's seal, if an earlier run broke it.
		 *
		 * After the marker, deliberately: what is on disk about an install whose result
		 * the user still has to hear is reported first, and this pass can only affect
		 * the next install. Deferred, and unref'd, because the probe is a real
		 * `codesign --verify --deep` over the bundle - measured at 4.1 s and 4.3 s on
		 * the shipped 0.22.2 app on this machine, and the file's own note records 6.1 s
		 * for the ~1 GiB install - and nothing about the repair is time-critical while
		 * the app is up: the damage it repairs is what the NEXT launch is refused for.
		 * A quit before the timer fires simply leaves it to the next start, which is
		 * why this timer is unref'd rather than awaited.
		 */
		const sealProbe = setTimeout(() => {
			void this.repairReachableBundleSeals().catch((error: unknown) => {
				logger.warn(
					`Start-up seal check could not run: ${error instanceof Error ? error.message : String(error)}`,
					LogFileType.UPDATE_SERVICE,
				);
			});
		}, STARTUP_SEAL_PROBE_DELAY_MS);
		sealProbe.unref();

		// Start periodic update checks (every 5 minutes)
		this.startPeriodicUpdateChecks();

		/*
		 * A resume arms ONE check a moment later, for the failure this change's
		 * root cause turned out to be: see `POST_WAKE_CHECK_DELAY_MS`. The listener
		 * is registered here rather than in `startPeriodicUpdateChecks` because it
		 * is about the machine's state, not about the schedule.
		 */
		powerMonitor.on("resume", () => this.armPostWakeCheck());
	}

	/**
	 * Arm the single check that follows a resume, or leave the armed one alone.
	 *
	 * `unref`'d like the seal probe: a quit before it fires loses nothing, because
	 * the next launch checks and the five-minute tick is still there.
	 */
	private armPostWakeCheck(): void {
		if (this.postWakeCheckTimer) return;
		this.postWakeCheckTimer = setTimeout(() => {
			this.postWakeCheckTimer = null;
			logger.info(
				"Running the update check this machine's wake armed",
				LogFileType.UPDATE_SERVICE,
			);
			void this.checkForAllUpdates(true);
		}, POST_WAKE_CHECK_DELAY_MS);
		this.postWakeCheckTimer.unref();
	}

	/**
	 * Start periodic update checks
	 * Checks for updates every 5 minutes
	 */
	private startPeriodicUpdateChecks(): void {
		// Clear any existing interval
		if (this.updateCheckInterval) {
			clearInterval(this.updateCheckInterval);
		}

		// Set up new interval (5 minutes = 300000 ms)
		this.updateCheckInterval = setInterval(() => {
			logger.info(
				"Running scheduled update check (every 5 minutes)",
				LogFileType.UPDATE_SERVICE,
			);
			this.checkForAllUpdates(true);
		}, 300000);

		logger.info(
			"Periodic update checks scheduled (every 5 minutes)",
			LogFileType.UPDATE_SERVICE,
		);
	}

	// -----------------------------------------------------------------------
	// Install robustness
	// -----------------------------------------------------------------------

	/**
	 * Where the pending-update marker lives.
	 *
	 * userData, not the app bundle: the marker has to survive the bundle being
	 * replaced (that is exactly the case it describes) and it must not be inside
	 * the thing ShipIt is swapping.
	 */
	private markerDir(): string {
		return app.getPath("userData");
	}

	/**
	 * The environment every python this service spawns has to run under.
	 *
	 * The bundled venv's `python` is the interpreter we ship, so its stdlib - and
	 * therefore any `__pycache__` CPython writes for it - is inside the code-sealed
	 * `.app`. `pip show` and the pip upgrade both compile stdlib modules, so both
	 * would unseal the bundle the pre-flight is about to ask ShipIt to replace.
	 *
	 * userData is the location for the same reason the pending marker uses it: it
	 * is never inside the bundle being swapped.
	 */
	private pythonSpawnEnv(): Record<string, string | undefined> {
		return withPythonBytecodeCache(process.env, this.markerDir());
	}

	private sendToRenderer(channel: string, payload: unknown): boolean {
		const webContents = this.mainWindow?.webContents;
		if (!webContents || webContents.isDestroyed()) return false;
		webContents.send(channel, payload);
		return true;
	}

	/**
	 * Report a refusal to start an install, with the reason and the remedy.
	 *
	 * Sent rather than thrown: the caller is an IPC handler the renderer fires and
	 * forgets, and the whole point of these checks is that the user gets an
	 * explanation instead of an app that quits and never returns.
	 */
	private sendInstallBlock(block: InstallBlock, version?: string): void {
		logger.error(
			`Update refused (${block.code}): ${block.detail}`,
			LogFileType.UPDATE_SERVICE,
		);
		this.sendToRenderer(
			"update-install-blocked",
			this.installBlockPayload(block, version ?? null),
		);
	}

	/**
	 * The refusal payload the renderer's panel reads.
	 *
	 * One builder, so a refusal found at start-up and one found by the pre-flight
	 * cannot arrive in two shapes: the renderer keys the heading off `code` and the
	 * remedy off `remedy`, and a field missing in one path is a panel that renders
	 * nothing where the user was told what to do.
	 */
	private installBlockPayload(
		block: InstallBlock,
		version: string | null,
	): Record<string, unknown> {
		return {
			code: block.code,
			version,
			message: block.message,
			remedy: block.remedy,
			detail: block.detail,
			// Both optional, and both must travel: the payload is built field by
			// field, so a copy the main process owns and this builder forgets is a
			// panel that renders the default heading (design D2, D3).
			heading: block.heading ?? null,
			dismissLabel: block.dismissLabel ?? null,
		};
	}

	/**
	 * Read the marker a previous run may have left, and act on it.
	 *
	 * A failed Squirrel install leaves no exit status and never relaunches the
	 * app, so the marker plus the running version is the only record that the
	 * update did not happen. Everything the user learns afterwards starts here:
	 * the notice, the durable record it can be found in later, and the cleanup of
	 * what Squirrel left running.
	 *
	 * The one case that must NOT be read as a failure is the install that is still
	 * running, and it is the 2026-09-13 incident: the app comes back mid-install
	 * on the old version, because the swap has not happened yet. That used to
	 * clear the marker, remove the very job doing the installing, and tell the
	 * user the update had failed - two seconds before ShipIt aborted the install
	 * on its own final check. So the job is probed first, a live install is left
	 * alone entirely, and the re-check below reports what really happens to it.
	 */
	private recoverPendingInstall(): void {
		/*
		 * Only the packaged app acts on this state.
		 *
		 * The marker describes an install of the packaged bundle, and ShipIt's job and
		 * staging tree are that install's. An unpackaged instance - `pnpm dev` in a
		 * worktree, `npx electron .` - writes its log into the same directory, because
		 * on macOS the log path is hardcoded to `~/Library/Application Support/Local
		 * Operator/logs` rather than read from `app.getPath("userData")`, so one file
		 * interleaves the packaged app's installs with every worktree's starts
		 * (measured on 2026-09-14: the 09:48:42 packaged install and every `Update
		 * service initialized. Dev mode: true` line after 09:50 are in one log).
		 * Whether such an instance's userData ALSO lands on the packaged app's is an
		 * Electron naming accident rather than a rule, and the rule must not depend on
		 * it: acting here would report a failure the packaged app never saw, clear the
		 * marker that is the only record the install was attempted, or reap a ShipIt
		 * job mid-install - and the packaged app coming back would then have nothing
		 * left to tell the user, which is the silence this path exists to remove. So
		 * this names what it found and touches nothing.
		 *
		 * The predicate is `app.isPackaged`, not `isDevMode`: the question is whether
		 * this process is the bundle an install replaces, and a packaged build pointed
		 * at a dev server still is.
		 */
		if (!app.isPackaged) {
			const marker = readPendingInstallMarker(this.markerDir());
			logger.info(
				marker
					? `Unpackaged instance: leaving the packaged app's pending install marker for version ${marker.targetVersion} alone, with its install job and staging tree; this process cannot act on an install of a bundle it is not.`
					: "Unpackaged instance: no packaged install state to leave alone.",
				LogFileType.UPDATE_SERVICE,
			);
			return;
		}
		const marker = readPendingInstallMarker(this.markerDir());
		const outcome = evaluatePendingInstall({
			marker,
			runningVersion: app.getVersion(),
			// Probed once per evaluation, and only on macOS: a loaded job plus a
			// current marker is what makes "still on the old version" an install in
			// progress rather than an install that failed.
			installInFlight: isInstallInFlight({
				marker,
				jobLoaded: this.shipItInstallJobLoaded(),
			}),
		});

		switch (outcome.kind) {
			case "none":
				return;
			case "succeeded":
				logger.info(
					`Update marker: install of version ${outcome.marker.targetVersion} succeeded (running ${app.getVersion()}).`,
					LogFileType.UPDATE_SERVICE,
				);
				this.reapWatchdog(outcome.marker, true);
				clearPendingInstallMarker(this.markerDir());
				return;
			case "stale":
				// A marker from an install this machine has already moved past. It is
				// not news, and reporting it as a failure told a user on 0.17.0 that
				// an install of 0.9.0 had failed (review Q2).
				logger.info(
					`Update marker: ignored a marker for version ${outcome.marker.targetVersion}; version ${app.getVersion()} is running, so it was superseded.`,
					LogFileType.UPDATE_SERVICE,
				);
				this.reapWatchdog(outcome.marker, true);
				clearPendingInstallMarker(this.markerDir());
				return;
			case "in-flight": {
				this.installWasInFlight = true;
				logger.info(
					`Update marker: the install of version ${outcome.marker.targetVersion} is still running (its install job is loaded). Leaving the marker, the install job and the relaunch watchdog in place.`,
					LogFileType.UPDATE_SERVICE,
				);
				// The user is told, because the app being open is what stops this
				// install finishing - and quitting now can still let the swap through,
				// which is the one action that saves it.
				this.pendingInstallInFlight = installInFlightPayload(
					outcome.marker,
					app.getVersion(),
				);
				this.scheduleInstallInFlightDelivery();
				this.scheduleInstallInFlightRecheck();
				return;
			}
			case "failed": {
				// The log Squirrel wrote is the only record of WHY, because this
				// process was dead while the install failed (review U14).
				const shipItLogPath = this.shipItLog();
				const record = recordInstallFailure(this.markerDir(), {
					payload: installFailurePayload(outcome.marker, app.getVersion(), {
						shipItLogPath,
						cancelledByRelaunch: this.installWasInFlight,
					}),
					// The record names the version that is running now, which is the same
					// answer the payload above was built from: Settings renders it as
					// "Version X is running", and it used to carry the previous failure's
					// version forward instead (QA Q1).
					runningVersion: app.getVersion(),
					startedAt: outcome.marker.startedAt || null,
					detectedAt: new Date().toISOString(),
				});
				const payload = installFailurePayload(
					outcome.marker,
					app.getVersion(),
					{
						attempts: record.attempts,
						shipItLogPath,
						// An install this process watched run and then not finish, with the
						// app open for part of it, was cancelled by that relaunch.
						cancelledByRelaunch: this.installWasInFlight,
					},
				);
				logger.error(
					`Update marker: install of version ${outcome.marker.targetVersion} did not complete (attempt ${record.attempts}). ${payload.detail}`,
					LogFileType.UPDATE_SERVICE,
				);
				this.pendingInstallFailure = payload;
				/*
				 * NOT nulled here, and the marker is not cleared here either.
				 *
				 * The renderer is showing "still installing" for this very install when
				 * this branch runs off a re-check, and the panel only changes when it
				 * hears this failure. Dropping the in-flight payload and the marker
				 * before that notice lands would leave the user's screen claiming an
				 * install is running for one that is over, with nothing left to
				 * re-send - so both go when the notice is delivered
				 * (`deliverPendingInstallFailure`, review R2).
				 */
				this.stopInstallInFlightRecheck();
				this.reapWatchdog(outcome.marker, false);
				this.reapFailedInstallLeftovers();
				/*
				 * The same delivery path the start-up failure takes, for every failure.
				 *
				 * A re-check is not evidence the renderer is listening: `sendToRenderer`
				 * answers true whenever a live `webContents` exists, so a direct push
				 * with no subscriber still sets `installFailureDelivered` and the notice
				 * is lost with no second attempt. The scheduler is what gives it one -
				 * the load event it may have missed, then the delayed fallback - and it
				 * is safe to call from any branch because the send itself is guarded by
				 * that flag (review R2).
				 */
				this.schedulePendingInstallFailureDelivery();
			}
		}
	}

	/**
	 * This app's bundle identifier, as macOS records it.
	 *
	 * Read from the running bundle rather than from `package.json`: the running
	 * app is the only thing whose ShipIt job and cache directory this process may
	 * touch, and a build whose `appId` drifted would otherwise have us cleaning up
	 * some other app's leftovers.
	 */
	private bundleIdentifier(): string | null {
		const bundlePath = appBundleFromExecutable(process.execPath);
		if (!bundlePath) return null;
		const value = readCommandOutput("/usr/bin/defaults", [
			"read",
			join(bundlePath, "Contents", "Info.plist"),
			"CFBundleIdentifier",
		]);
		return value && BUNDLE_ID_REGEX.test(value) ? value : null;
	}

	/** The launchd job Squirrel's install runs under, by label. */
	private shipItJob(): string | null {
		const bundleId = this.bundleIdentifier();
		return bundleId ? shipItJobLabel(bundleId) : null;
	}

	/**
	 * Squirrel's own stderr log for this app, when it exists.
	 *
	 * It is the only record of why an install failed: the app is not running
	 * while ShipIt works, so the failure notice cannot quote a reason the way the
	 * pre-flight refusal can. The log is preserved by `reapFailedInstallLeftovers`
	 * for exactly this reason, so the details line points at the thing that is
	 * still there afterwards (review U14).
	 */
	private shipItLog(): string | null {
		const bundleId = this.bundleIdentifier();
		if (!bundleId) return null;
		const candidate = join(
			shipItCacheDir(join(homedir(), "Library", "Caches"), bundleId),
			"ShipIt_stderr.log",
		);
		return existsSync(candidate) ? candidate : null;
	}

	/**
	 * Remove the launchd job and the staged update a failed install left behind.
	 *
	 * Why: the 0.17.0 failure left `com.local-operator.ShipIt` loaded in the
	 * user's launchd domain, respawning every ~2.5 s (runs=3114,
	 * LastExitStatus=256) and writing 3.4 MB of "Could not read update request" to
	 * its stderr log, with the staged tree beside it. Squirrel only retires that
	 * job when an install finishes, so a failed one leaves it running forever - it
	 * was removed by hand during round 1 of the review, and the product must not
	 * need that.
	 */
	private reapFailedInstallLeftovers(): void {
		if (process.platform !== "darwin") return;
		const log = (message: string) =>
			logger.info(message, LogFileType.UPDATE_SERVICE);
		try {
			const result = reapFailedInstall({
				bundleId: this.bundleIdentifier(),
				cacheRoot: join(homedir(), "Library", "Caches"),
				removeJob: (label) => {
					const result = spawnSync("/bin/launchctl", ["remove", label], {
						encoding: "utf8",
						timeout: 5000,
					});
					const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
					// `launchctl remove` answers a job that is not loaded in two ways on
					// this macOS, and neither is a failure: the "Could not find service"
					// text, or a non-zero exit with NO output at all (measured here: exit
					// 3, empty stdout and stderr, against exit 0 when the job is there).
					// Matching only the text meant every start after the job had gone
					// logged a cleanup failure for a cleanup with nothing left to do
					// (review Q4). Silence plus a non-zero exit is the not-loaded case.
					const notFound =
						LAUNCHCTL_NOT_LOADED_REGEX.test(output) ||
						(output === "" && result.status !== 0);
					if (result.status !== 0 && !notFound) {
						throw new Error(
							output || `launchctl remove exited ${result.status}`,
						);
					}
					return { notFound, output };
				},
				exists: (path) => existsSync(path),
				listDir: (dir) => readdirSync(dir),
				// Retried, because the draw this cleans up is a race: on 2026-09-13
				// ShipIt was moving this very tree into place while the reap walked
				// it, and the rmdir it lost surfaced as ENOTDIR - which `rmSync`
				// does not retry (see `removeStagedTree`). A tree that cannot be
				// removed after that is still reported, because it is ~1 GiB the
				// user's disk is paying for.
				removeDir: (dir) => reapStagedTree(dir),
				log,
			});
			if (result.errors.length > 0) {
				logger.warn(
					`Failed to clean up the leftover install: ${result.errors.join("; ")}`,
					LogFileType.UPDATE_SERVICE,
				);
			}
		} catch (error) {
			logger.warn(
				`Could not clean up the leftover install: ${String(error)}`,
				LogFileType.UPDATE_SERVICE,
			);
		}
	}

	/**
	 * Deliver the failed-install notice once the renderer can hear it.
	 *
	 * The single delivery path for every install failure, read at start-up or
	 * found on a re-check: the marker is read while the window is still loading
	 * (and, on a re-check, the window is up but the React effect that subscribes
	 * is not provably past), so the push happens on `did-finish-load` with a
	 * delayed fallback. One path rather than two is what keeps "delivered"
	 * meaning the same thing in both cases (review R2).
	 */
	private schedulePendingInstallFailureDelivery(): void {
		if (!this.pendingInstallFailure) return;
		const deliver = () => this.deliverPendingInstallFailure();
		const webContents = this.mainWindow?.webContents;
		if (webContents && !webContents.isDestroyed()) {
			webContents.once("did-finish-load", deliver);
		}
		setTimeout(deliver, 5000);
	}

	private deliverPendingInstallFailure(): void {
		if (!this.pendingInstallFailure || this.installFailureDelivered) return;
		if (
			!this.sendToRenderer("update-install-failed", this.pendingInstallFailure)
		) {
			return;
		}
		this.installFailureDelivered = true;
		/*
		 * The state this failure supersedes goes only now, once the notice is
		 * away: the in-flight panel and the marker on disk both exist to be
		 * re-reported until the user is told what happened, so clearing them
		 * before this point is what made a lost push unrecoverable (review R2).
		 */
		this.pendingInstallInFlight = null;
		clearPendingInstallMarker(this.markerDir());
		logger.info(
			"Reported a failed update install to the renderer",
			LogFileType.UPDATE_SERVICE,
		);
	}

	/**
	 * Deliver a refusal found at start-up once the renderer can hear it.
	 *
	 * Same shape as the failure's delivery, for the same measured reason: the
	 * refusal is produced while the window is loading (the service is constructed
	 * as the window is created), the panel subscribes from a React effect that can
	 * run after `did-finish-load`, and `sendToRenderer` answers true for a push
	 * that no subscriber saw. Unlike the failure it clears nothing on the way out -
	 * this refusal is not tied to any on-disk state, and the pre-flight's own
	 * direct push (`sendInstallBlock`) stays the path used when the window is
	 * already up.
	 */
	private scheduleInstallBlockDelivery(block: InstallBlock): void {
		this.pendingInstallBlock = block;
		if (this.installBlockDelivered) return;
		const deliver = () => this.deliverPendingInstallBlock();
		const webContents = this.mainWindow?.webContents;
		if (webContents && !webContents.isDestroyed()) {
			webContents.once("did-finish-load", deliver);
		}
		setTimeout(deliver, 5000);
	}

	private deliverPendingInstallBlock(): void {
		const block = this.pendingInstallBlock;
		if (!block || this.installBlockDelivered) return;
		if (
			!this.sendToRenderer(
				"update-install-blocked",
				this.installBlockPayload(block, null),
			)
		) {
			return;
		}
		this.installBlockDelivered = true;
		logger.info(
			"Reported a start-up refusal to the renderer",
			LogFileType.UPDATE_SERVICE,
		);
	}

	/**
	 * A substituted answer to "is this app's install job loaded", or null.
	 *
	 * The production answer is the launchd probe in `shipItInstallJobLoaded`, and
	 * it asks about a label read from the RUNNING BUNDLE (`shipItJob`). A test or a
	 * harness process that is not that bundle has no label to ask about, so the
	 * whole in-flight path - recovery's reading, the re-check, and the quit below -
	 * is otherwise unreachable from a suite. This is the same shape as the
	 * watchdog's own probe, which is invoked by name precisely so a harness can
	 * substitute it: one seam for the whole answer, so what a test drives is the
	 * rule production uses rather than a second copy of it. Production never sets
	 * it.
	 */
	public installJobLoadedProbe: (() => boolean) | null = null;

	/**
	 * Whether this app's ShipIt install job is loaded, right now.
	 *
	 * This is the machine's own answer to "is an install in flight", and the only
	 * answer that can tell a live install apart from the job a failed one left
	 * behind. It is asked of launchd by label rather than inferred from a process
	 * name, so nothing else on the machine can be mistaken for it. Off macOS there
	 * is no launchd to ask, so the answer is a plain no and recovery stays
	 * version-only there, exactly as it is today.
	 */
	private shipItInstallJobLoaded(): boolean {
		if (this.installJobLoadedProbe) return this.installJobLoadedProbe();
		// The command comes from the same place the watchdog's own probe does, so
		// there is one answer to "which command asks launchd about this job" and
		// the two cannot disagree. It is invoked by name, exactly as the script
		// invokes it, which is also what makes this probe substitutable in a
		// harness: PATH resolves it to /bin/launchctl on any machine with launchd.
		const jobProbe = watchdogSignals(process.platform).jobProbe;
		if (!jobProbe) return false;
		return launchdJobLoaded(this.shipItJob(), (label) => {
			const result = spawnSync(jobProbe, ["list", label], {
				encoding: "utf8",
				timeout: 5000,
			});
			// No exit status is not an answer: a probe that could not run must not
			// read as "loaded", and `launchdJobLoaded` treats null as not loaded.
			return result.error || result.status == null ? null : result.status;
		});
	}

	/**
	 * Deliver the still-installing notice once the renderer can hear it.
	 *
	 * Same shape and the same reason as the failure's delivery: the marker is read
	 * while the window is still loading, and the component subscribes from a React
	 * effect that can run after `did-finish-load`.
	 */
	private scheduleInstallInFlightDelivery(): void {
		// Guarded on the delivered flag as well as on the payload, because the
		// re-check calls this on every pass: without it a long install accumulates
		// a `did-finish-load` listener and a 5 s timer per pass, all of them no-ops
		// by then, for as long as the install lasts (review N1).
		if (!this.pendingInstallInFlight || this.installInFlightDelivered) return;
		const deliver = () => this.deliverPendingInstallInFlight();
		const webContents = this.mainWindow?.webContents;
		if (webContents && !webContents.isDestroyed()) {
			webContents.once("did-finish-load", deliver);
		}
		setTimeout(deliver, 5000);
	}

	private deliverPendingInstallInFlight(): void {
		if (!this.pendingInstallInFlight || this.installInFlightDelivered) return;
		if (
			!this.sendToRenderer(
				"update-install-in-flight",
				this.pendingInstallInFlight,
			)
		) {
			return;
		}
		this.installInFlightDelivered = true;
		logger.info(
			"Reported an install still in flight to the renderer",
			LogFileType.UPDATE_SERVICE,
		);
	}

	/**
	 * Re-check a live install while the app stays open, until it settles.
	 *
	 * The panel that says "the update is still installing" cannot be the end of
	 * the story: ShipIt decides within a couple of minutes of the app coming back
	 * (it asks whether any instance is running as its final validation), and the
	 * user has to hear what that decision was. Re-evaluating is what produces it -
	 * the job no longer loaded means the install is over, and the marker plus the
	 * old running version then say truthfully that it was cancelled. The loop ends
	 * by itself: once the marker is older than
	 * `PENDING_INSTALL_RECENCY_SECONDS` nothing calls it current, the next
	 * evaluation is a failure, and that branch stops the timer.
	 */
	private scheduleInstallInFlightRecheck(): void {
		if (this.installInFlightTimer) return;
		this.installInFlightTimer = setTimeout(() => {
			this.installInFlightTimer = null;
			this.recoverPendingInstall();
		}, INSTALL_IN_FLIGHT_RECHECK_MS);
		// Unref'd: a panel staying in step is not a reason for the app to stay
		// alive, and this timer must never be what keeps the process up.
		this.installInFlightTimer.unref();
	}

	private stopInstallInFlightRecheck(): void {
		if (!this.installInFlightTimer) return;
		clearTimeout(this.installInFlightTimer);
		this.installInFlightTimer = null;
	}

	/**
	 * Make sure something will start the app again after a quit that is only
	 * getting out of an install's way.
	 *
	 * The watchdog from the original install is usually still there - it holds
	 * while the job is loaded now, rather than starting the app into the swap -
	 * but it may have run out its own bounds, and the user may be quitting hours
	 * later. Quitting without one would leave them with no app at all, which is
	 * the outcome this whole change exists to remove. Nothing is started when ours
	 * is alive, because two watchdogs relaunching at the same moment is a race
	 * with nothing to gain. The marker is left exactly as it is: its start time is
	 * what tells recovery this is still the same install.
	 */
	private ensureWatchdogAfterInFlightQuit(marker: PendingInstallMarker): void {
		const pid = marker.watchdogPid;
		const commandLine =
			pid == null
				? null
				: readCommandOutput("/bin/ps", ["-o", "command=", "-p", String(pid)]);
		if (
			watchdogIsOurs({
				alive: commandLine != null,
				commandLine,
				installSucceeded: true,
			})
		) {
			logger.info(
				`Relaunch watchdog ${pid} is still running; it will start the app when the install settles.`,
				LogFileType.UPDATE_SERVICE,
			);
			return;
		}
		const launched = this.launchWatchdog(marker.targetVersion);
		logger.info(
			launched
				? `Started relaunch watchdog ${launched} for the install already in flight; it will start the app when the install's job goes.`
				: "No relaunch watchdog is running for the install in flight and none could be started; the app will need starting by hand after it quits.",
			LogFileType.UPDATE_SERVICE,
		);
	}

	/**
	 * The pending-install marker, if the machine says an install is live now.
	 *
	 * The marker is read first, because the ordinary answer to "is an update
	 * installing" is no and a file read answers it; the launchd probe behind it is
	 * a process spawn and is only worth paying for when there is a marker to ask
	 * about.
	 */
	private livePendingInstallMarker(): PendingInstallMarker | null {
		const marker = readPendingInstallMarker(this.markerDir());
		if (!marker) return null;
		return isInstallInFlight({
			marker,
			jobLoaded: this.shipItInstallJobLoaded(),
		})
			? marker
			: null;
	}

	/**
	 * Treat a quit as a quit for an install that is in flight, and make sure
	 * something will start the app again.
	 *
	 * Two gestures reach this, and a user believes both are harmless: the macOS
	 * close-the-last-window close, and any ordinary quit (Cmd+Q, the dock, the
	 * menu). `window-all-closed` on macOS deliberately leaves the app running with
	 * no window, which is right for every ordinary close - but a running instance
	 * of this app is exactly what Squirrel's final validation aborts an install on,
	 * so a user who closes the window during an install has cancelled their update
	 * without being told, and reached the incident this whole change exists to
	 * remove by the platform's most familiar gesture (UX U1). The relaunch promise
	 * was also button-shaped: a plain quit while an install was in flight left it
	 * resting on whatever watchdog the install happened to still have (UX U2).
	 *
	 * The probe is the machine's answer rather than the renderer's, so this holds
	 * even when the panel was never drawn - the app can come back mid-install and
	 * have its last window closed before the renderer has heard anything.
	 *
	 * Returns true when an install was in flight, so a caller that is deciding
	 * whether to quit knows the close was taken over. Nothing here touches the
	 * marker, the install's job or the failure record: this only gets the app out
	 * of Squirrel's way and makes sure it comes back.
	 */
	public quitForInFlightInstall(context: string): boolean {
		const marker = this.livePendingInstallMarker();
		if (!marker) return false;
		if (this.inFlightQuitWatchdogEnsured) return true;
		this.inFlightQuitWatchdogEnsured = true;
		logger.info(
			`Quitting so the in-flight update install can finish (${context}).`,
			LogFileType.UPDATE_SERVICE,
		);
		this.ensureWatchdogAfterInFlightQuit(marker);
		return true;
	}

	/**
	 * Kill a watchdog still running from the recorded install attempt.
	 *
	 * Killing by pid alone would be unsafe after a pid reuse, so the process's
	 * command line has to still carry the script's sentinel.
	 */
	private reapWatchdog(
		marker: PendingInstallMarker,
		installSucceeded: boolean,
	): void {
		const pid = marker.watchdogPid;
		if (pid == null) return;

		let commandLine: string | null = null;
		let alive = false;
		commandLine = readCommandOutput("/bin/ps", [
			"-o",
			"command=",
			"-p",
			String(pid),
		]);
		alive = commandLine != null;

		if (!watchdogIsOurs({ alive, commandLine, installSucceeded })) {
			if (alive && !installSucceeded) {
				logger.info(
					`Relaunch watchdog ${pid} is still running; leaving it to finish or hit its deadline.`,
					LogFileType.UPDATE_SERVICE,
				);
			}
			return;
		}

		try {
			process.kill(pid, "SIGTERM");
			logger.info(
				`Reaped relaunch watchdog ${pid} left over from the previous install.`,
				LogFileType.UPDATE_SERVICE,
			);
		} catch (error) {
			logger.warn(
				`Could not reap relaunch watchdog ${pid}: ${String(error)}`,
				LogFileType.UPDATE_SERVICE,
			);
		}
	}

	/**
	 * Ask `codesign` whether the installed bundle is a sealed code object.
	 *
	 * This is the exact question ShipIt asks of the same bundle before it
	 * installs (`SecStaticCodeCreateWithPath` in SQRLInstaller): on 2026-09-11 it
	 * answered -67028 errSecCSBadBundleFormat because a Finder copy was replacing
	 * the app at that moment, ShipIt quit, and nothing relaunched the app.
	 * Refusing the install here keeps the user with a working app instead.
	 *
	 * Three deliberate properties, all of them from round 1's findings:
	 *
	 * - `--strict` is gone. It does not test the seal - `--verify` does that, and
	 *   it is what catches the mid-replacement -67028 - it additionally rejects
	 *   bundles carrying FinderInfo/detritus xattrs that ShipIt itself tolerates,
	 *   so it can only refuse installs Squirrel would have performed (R5).
	 * - The timeout is generous because the bundle is ~1 GiB; measured warm at
	 *   6.1 s, and a cold or slow volume is not a reason to refuse.
	 * - A probe that could not run is retried once and then *allowed to proceed*.
	 *   "We could not ask" is not "the bundle is bad", and treating it as one is
	 *   how a transient hiccup became a permanent reinstall message (R5).
	 *
	 * A bundle that fails the check is given one chance to heal itself, because
	 * the failure every 0.17.x/0.18.0 install has is ours rather than the user's:
	 * a CPython stdlib bytecode cache written into the sealed bundle by our own
	 * backend. Those writes are `file added:` violations and deleting exactly
	 * those files restores the seal (measured; see `healPythonBytecode`), where a
	 * bundle broken any other way still gets the reinstall refusal below.
	 *
	 * The probe, the retry and the heal are `readBundleSeal` and `repairBundleSeal`
	 * below, shared with the start-up repair pass: this method is the update-time
	 * policy on top of them (an unanswerable probe proceeds, an unhealable bundle
	 * refuses the install), and it must not grow a second copy of either.
	 */
	private async probeInstalledBundleSeal(
		version?: string | null,
	): Promise<InstallBlock | null> {
		const bundlePath = this.runningBundlePath();
		if (!bundlePath) return null;

		const { seal, heal, block } = await this.repairBundleSeal(
			bundlePath,
			version,
		);
		if (seal.kind === "unavailable") {
			// Proceeding is the conservative choice here: Squirrel validates the
			// bundle itself, and the alternative is refusing an update for a
			// reason we could not substantiate.
			logger.warn(
				`Seal check could not run twice, continuing with the install: ${seal.detail}`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}
		if (seal.kind === "sealed") {
			logger.info(
				heal
					? `Installed bundle sealed again after removing ${heal.removed.length} added bytecode file(s); continuing with the install.`
					: `Installed bundle passed its seal check: ${bundlePath}`,
				LogFileType.UPDATE_SERVICE,
			);
		}
		return block;
	}

	/**
	 * The `.app` this process runs from, or null when it is not a bundle layout.
	 *
	 * Shared by the pre-flight and the start-up repair pass so both ask about the
	 * same bundle, and so the "unpacked or dev run" answer is stated once: not a
	 * bundle we recognise means nothing to verify, and refusing every install
	 * because the path did not parse would be worse than the risk it guards
	 * against.
	 */
	private runningBundlePath(): string | null {
		if (process.platform !== "darwin" || !app.isPackaged) return null;
		const bundlePath = appBundleFromExecutable(process.execPath);
		if (!bundlePath) {
			logger.warn(
				`Could not derive an app bundle from ${process.execPath}; skipping the seal checks.`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}
		return bundlePath;
	}

	/**
	 * One `codesign --verify` of `bundlePath`, retried once when it could not run.
	 *
	 * The retry lives here rather than at either caller because "did not complete"
	 * is a fact about the probe, not about the install being offered: measured on
	 * macOS 26.5, a 1 GiB bundle answers in 6.1 s warm, and a timeout or a probe
	 * that died silently used to arrive as exit code 1 - which the pre-flight read
	 * as "codesign rejected this bundle" and turned into a permanent reinstall
	 * message (review R5). `probe` is returned beside the verdict because the
	 * heal reads the violations out of the raw stdout, and a second probe for them
	 * would be a second answer about one bundle.
	 */
	private async readBundleSeal(
		bundlePath: string,
	): Promise<{ seal: SealVerdict; probe: SealProbe }> {
		const probeBundle = () =>
			runCommand(
				"/usr/bin/codesign",
				["--verify", "--deep", "--verbose=2", bundlePath],
				{ timeoutMs: SEAL_PROBE_TIMEOUT_MS },
			);

		let probe = await probeBundle();
		let seal = evaluateBundleSeal(probe);
		if (seal.kind === "unavailable") {
			logger.warn(
				`Seal check did not complete, retrying once: ${seal.detail}`,
				LogFileType.UPDATE_SERVICE,
			);
			probe = await probeBundle();
			seal = evaluateBundleSeal(probe);
		}
		return { seal, probe };
	}

	/**
	 * Probe the bundle, heal the one break we cause, and probe again.
	 *
	 * The whole mechanism, run identically by the update pre-flight and by the
	 * start-up pass: a sealed bundle is returned untouched, an unsealed one is
	 * healed only when the plan says the break is ours (`planPythonBytecodeHeal`),
	 * and the verdict that follows the heal is a fresh probe rather than an
	 * assumption about what a deletion did. `block` is the refusal to show when the
	 * bundle cannot be put back together, and it carries the version the caller was
	 * asked about (null at start-up, where no update is being offered yet).
	 *
	 * Why start-up also runs this: the break is introduced by the app running, not
	 * by the update, so by the time an install is attempted the bundle may already
	 * have been refused by macOS at launch - measured on 2026-09-14, a bundle
	 * signed at 09:31:53 with one added
	 * `lib/python3.12/__pycache__/webbrowser.cpython-312.pyc` at 10:11:29, and no
	 * packaged instance ever came back to report it.
	 */
	private async repairBundleSeal(
		bundlePath: string,
		version?: string | null,
		/// Who is asking: the pre-flight (an update was stopped) or the start-up pass
		/// (this copy is damaged and no update was on the table). See
		/// `SealBlockContext`.
		context: SealBlockContext = "update",
	): Promise<{
		seal: SealVerdict;
		heal: BytecodeHealResult | null;
		block: InstallBlock | null;
	}> {
		const { seal, probe } = await this.readBundleSeal(bundlePath);
		if (seal.kind !== "unsealed") return { seal, heal: null, block: null };

		logger.error(
			`Installed bundle failed its seal check: ${seal.detail}`,
			LogFileType.UPDATE_SERVICE,
		);

		// The violations come from stdout: `codesign` prints one `file <kind>:`
		// line per resource there and its verdict on stderr, and the verdict is
		// not a violation of the bundle (see `parseSealViolations`).
		const violations = parseSealViolations(probe.stdout);
		const heal = healPythonBytecode(bundlePath, violations);
		if (!heal.healable) {
			logger.warn(
				`Installed bundle is not healable in place: ${heal.reason}`,
				LogFileType.UPDATE_SERVICE,
			);
			return {
				seal,
				heal,
				block: installedBundleSealBlock(
					bundlePath,
					seal.detail,
					version,
					context,
				),
			};
		}

		logger.info(
			`Removed ${heal.removed.length} bytecode file(s) our own interpreter had written into the sealed bundle: ${heal.reason}. Paths:\n${heal.removed.join("\n")}`,
			LogFileType.UPDATE_SERVICE,
		);

		/*
		 * Re-probe immediately, and only continue on a fresh verdict: the heal is
		 * a deletion, and the bundle is sealed again only if codesign says so. It
		 * is also why there is no second probe just before `quitAndInstall`: the
		 * backend python is still running at that point (the quit stops it), so a
		 * bundle re-broken between the two probes is one a probe placed there
		 * could not prevent either - the writer would go on writing. The one place
		 * the answer can be trusted is here, seconds before the decision it feeds.
		 */
		const { probe: healedProbe } = await this.readBundleSeal(bundlePath);
		const healed = evaluateBundleSeal(healedProbe);
		if (healed.kind === "sealed") {
			return { seal: healed, heal, block: null };
		}

		logger.error(
			`Installed bundle still fails its seal check after healing: ${healed.detail}`,
			LogFileType.UPDATE_SERVICE,
		);
		return {
			seal: healed,
			heal,
			block: installedBundleSealBlock(
				bundlePath,
				healed.detail,
				version,
				context,
			),
		};
	}

	/** Inspect only the app this process runs from. An unpackaged instance must
	 * never traverse, heal, seal or otherwise mutate another installed bundle. */
	private async repairReachableBundleSeals(): Promise<void> {
		this.reportLegacyVenvInterpreters();
		const running = this.runningBundlePath();
		if (running) await this.repairRunningBundleSeal(running);
	}

	/**
	 * Say what the pre-split environments resolve to, and change nothing.
	 *
	 * An install from before this change has a venv whose `pyvenv.cfg` `home` is
	 * inside an `.app`, and one whose bundle is already gone is a state this
	 * machine has actually been in. Both are reported because they explain the log
	 * a support conversation reads - "this venv belongs to a bundle that is not
	 * here any more" and "this venv is still built on the installed app's
	 * interpreter" are different facts, and silence makes them look like the same
	 * healthy one. Neither is repaired: those environments are left byte-identical,
	 * deliberately, so a rollback to an older build still finds what it built.
	 *
	 * Darwin only, and by construction rather than by choice: what is reported is a
	 * venv built on the interpreter inside a code-sealed `.app`, and no other
	 * platform has one (`BUNDLED_INTERPRETER_HOME` requires the `.app` component).
	 *
	 * It reads `legacyVenvPaths`, NOT `managedVenvPath`. That was the bug: on darwin
	 * `managedVenvPath` answers with the post-split selection venv - whose
	 * `pyvenv.cfg` names the external runtime by construction - or with the
	 * `no-environment-selected` sentinel, so both iterations took the `continue` and
	 * nothing was ever logged for the state this exists to describe (review R7).
	 */
	private reportLegacyVenvInterpreters(): void {
		if (process.platform !== "darwin") return;
		for (const line of legacyEnvironmentReport(
			managedSupportRoot(app.getPath("home")),
		))
			logger.info(line, LogFileType.UPDATE_SERVICE);
	}

	/**
	 * Repair this bundle's seal at start-up, and say so either way.
	 *
	 * What this catches: a bundle that already carries bytecode its own interpreter
	 * wrote after it was signed. macOS refuses such a bundle at launch
	 * ("damaged and can't be opened") and ShipIt refuses the next in-place update
	 * with -67028, so a break found here is repaired before either can happen, and
	 * one that cannot be repaired is reported with the same refusal/remedy panel
	 * the pre-flight uses - the user has to replace the app by hand, and finding
	 * that out at the next update is worse than being told now.
	 *
	 * Nothing is reported when the bundle is sealed, which is every ordinary
	 * start: the log line is the evidence that the pass ran at all.
	 */
	private async repairRunningBundleSeal(bundlePath: string): Promise<void> {
		const { seal, heal, block } = await this.repairBundleSeal(
			bundlePath,
			null,
			"startup",
		);
		if (seal.kind === "sealed") {
			logger.info(
				heal
					? `Start-up seal repair: removed ${heal.removed.length} added bytecode file(s) from ${bundlePath}, and the bundle verifies again.`
					: `Start-up seal check: ${bundlePath} is a sealed code object.`,
				LogFileType.UPDATE_SERVICE,
			);
			return;
		}
		if (seal.kind === "unavailable") {
			// Not a refusal: a probe that could not run has no verdict to act on and
			// the next launch will ask again.
			logger.warn(
				`Start-up seal check could not run: ${seal.detail}`,
				LogFileType.UPDATE_SERVICE,
			);
			return;
		}
		if (block) this.scheduleInstallBlockDelivery(block);
	}

	/**
	 * File names the updater's metadata knows this update by.
	 */
	private stagedArtifactCandidates(info: UpdateInfo | null): string[] {
		const names = new Set<string>();
		if (info?.path) names.add(basename(info.path));
		for (const file of info?.files ?? []) {
			if (file.url) names.add(basename(decodeURIComponent(file.url)));
		}
		if (this.downloadedArtifactPath) {
			names.add(basename(this.downloadedArtifactPath));
		}
		return [...names];
	}

	/**
	 * electron-updater exposes no public path for the staged file; the private
	 * download helper is authoritative for a download this run performed, and a
	 * null simply falls back to the updater's pending cache directory.
	 */
	private downloadHelper(): {
		file?: string | null;
		cacheDirForPendingUpdate?: string | null;
	} | null {
		const updater = autoUpdater as unknown as {
			downloadedUpdateHelper?: {
				file?: string | null;
				cacheDirForPendingUpdate?: string | null;
			} | null;
		};
		return updater.downloadedUpdateHelper ?? null;
	}

	/** Free bytes on the volume holding `dir`, or null when it cannot be read. */
	private freeBytesAt(dir: string): number | null {
		try {
			const stats = statfsSync(dir);
			return stats.bavail * stats.bsize;
		} catch (error) {
			logger.warn(
				`Could not read free space for ${dir}: ${String(error)}`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}
	}

	private static async sha512Base64(filePath: string): Promise<string> {
		const hash = createHash("sha512");
		const stream = createReadStream(filePath);
		for await (const chunk of stream) {
			hash.update(chunk as Buffer);
		}
		return hash.digest("base64");
	}

	/**
	 * Verify the staged artifact against the metadata the updater parsed.
	 *
	 * electron-updater checks a file's sha512 while downloading it, but a staged
	 * file reused on a later start is only checked for existence (`"check here
	 * only existence, not checksum"` in its own DownloadedUpdateHelper), and the
	 * install's real footprint - a full copy of the app - is never checked
	 * against the free space available.
	 */
	private async ensureStagedArtifactVerified(
		info: UpdateInfo | null,
	): Promise<InstallBlock | null> {
		const helper = this.downloadHelper();
		const pendingDir = helper?.cacheDirForPendingUpdate ?? null;
		const candidates = this.stagedArtifactCandidates(info);

		const artifactPath = resolveStagedArtifactPath({
			downloadHelperFile: this.downloadedArtifactPath ?? helper?.file ?? null,
			pendingDir: pendingDir ?? "",
			candidateNames: candidates,
			listDir: (dir) => {
				try {
					return readdirSync(dir);
				} catch {
					return [];
				}
			},
		});

		if (!artifactPath) {
			return {
				code: "download-verification-failed",
				message: `The downloaded update${versionSuffix(info?.version)} could not be found on disk, so it wasn't installed.`,
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `No staged artifact matching ${candidates.join(", ") || "the update metadata"}.`,
			};
		}

		const files = (info?.files ?? []) as UpdateFileMetadata[];
		const metadata = matchArtifactMetadata(
			artifactPath,
			files,
			info?.path ?? null,
		);

		let actualSize: number;
		let actualSha512: string;
		try {
			actualSize = statSync(artifactPath).size;
			actualSha512 = await UpdateService.sha512Base64(artifactPath);
		} catch (error) {
			return {
				code: "download-verification-failed",
				message: `The downloaded update${versionSuffix(info?.version)} could not be read, so it wasn't installed.`,
				remedy: {
					text: "Check for updates again to re-download the release.",
				},
				detail: `${artifactPath}: ${String(error)}`,
			};
		}

		/*
		 * The volume that has to hold the install is the one the APP lives on: that
		 * is where Squirrel unpacks the new bundle and swaps it in. The artifact's
		 * own volume matters too, because the download is re-read from it, and the
		 * old code's `app.getPath("temp")` probe did not answer either question
		 * (temp is a different volume on any machine with a separate scratch disk).
		 * The smaller of the two is the honest answer.
		 */
		const bundlePath = appBundleFromExecutable(process.execPath);
		const installedBundleSize = bundlePath
			? measureDirectoryBytes(bundlePath)
			: null;
		if (installedBundleSize == null) {
			logger.warn(
				`Could not measure the installed app at ${bundlePath ?? "(no bundle path)"}; the free-space guard falls back to the artifact's own size.`,
				LogFileType.UPDATE_SERVICE,
			);
		}
		const freeCandidates = [
			bundlePath ? this.freeBytesAt(path.dirname(bundlePath)) : null,
			this.freeBytesAt(path.dirname(artifactPath)),
		].filter((value): value is number => value != null);
		const freeBytes =
			freeCandidates.length > 0
				? Math.min(...freeCandidates)
				: Number.MAX_SAFE_INTEGER;

		const verdict = verifyStagedArtifact({
			filePath: artifactPath,
			actualSize,
			actualSha512,
			metadata,
			freeBytes,
			installedBundleSize,
			version: info?.version ?? null,
		});
		if (verdict.ok) {
			const required = requiredDiskBytes({
				artifactSize: verdict.size,
				installedBundleSize: installedBundleSize ?? 0,
			});
			logger.info(
				`Staged artifact verified: ${artifactPath} (${verdict.size} bytes, sha512 matches, ${required} bytes required free, ${installedBundleSize ?? "unknown"} byte app).`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}
		return verdict.block;
	}

	/**
	 * Everything that has to hold before the app is allowed to quit.
	 *
	 * Returns the reason to refuse, or null to go ahead.
	 */
	private async runInstallPreflight(
		info: UpdateInfo | null,
	): Promise<InstallBlock | null> {
		const sealBlock = await this.probeInstalledBundleSeal(
			info?.version ?? null,
		);
		if (sealBlock) return sealBlock;
		return this.ensureStagedArtifactVerified(info);
	}

	/**
	 * Start the detached relaunch watchdog.
	 *
	 * Spawned detached so it survives this process exiting, with stdio ignored so
	 * it holds no pipe open and cannot keep the app alive.
	 */
	private launchWatchdog(targetVersion: string | null): number | null {
		if (process.platform !== "darwin" || !app.isPackaged) return null;
		const bundlePath = appBundleFromExecutable(process.execPath);
		if (!bundlePath) return null;

		const plan = buildWatchdogPlan({
			appBundlePath: bundlePath,
			executableName: basename(process.execPath),
			// The app's own pid, captured here - before the quit - because the
			// watchdog cannot ask a name about its own ancestor (review R1).
			appPid: process.pid,
			shipItJob: this.shipItJob(),
			// What "the install is over" is measured against on disk (review R11):
			// the updater's advertised version, and nothing that is already in place
			// (review R15).
			targetVersion: watchdogSwapTarget({
				target: targetVersion,
				running: app.getVersion(),
			}),
			// Stated rather than read off `process.platform` at the plan: this
			// watchdog exists for Squirrel.Mac's ShipIt, the guard above already
			// refuses it anywhere else, and the script's two probes (launchd's job
			// lookup, `plutil`) are generated for the platform the script runs on
			// rather than for whichever host planned it (see `watchdogSignals`).
			platform: "darwin",
		});

		try {
			const child = spawn("sh", ["-c", plan.script], {
				detached: true,
				stdio: "ignore",
				env: { ...process.env, ...plan.env },
			});
			child.unref();
			// The bound is the promise the user is given, so it is stated here with
			// what shortens it rather than as a bare timeout (review R11) - and the
			// second bound is stated because it is the one that now applies when the
			// install is demonstrably still working (2026-09-13: a launch at the
			// first bound is what aborted the install, so the script holds for the
			// harder one instead of starting the app into the swap).
			logger.info(
				`Started the update relaunch watchdog (pid ${child.pid ?? "unknown"}): it starts the app again as soon as the install's job goes or version ${plan.env.LO_UPDATE_WATCHDOG_TARGET_VERSION || "unknown"} is in place, and at the ${plan.timeoutSeconds}s bound if neither happens - or at the ${plan.hardTimeoutSeconds}s hard bound when the install's job is still loaded at the first, which is the case where starting the app would cancel the install.`,
				LogFileType.UPDATE_SERVICE,
			);
			return child.pid ?? null;
		} catch (error) {
			logger.error(
				`Could not start the update relaunch watchdog: ${String(error)}`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}
	}

	/**
	 * Clean up resources when the service is no longer needed
	 */
	/**
	 * Clean up resources, event listeners, and IPC handlers when the service is no longer needed
	 */
	public dispose(): void {
		// Clear the update check interval
		if (this.updateCheckInterval) {
			clearInterval(this.updateCheckInterval);
			this.updateCheckInterval = null;
		}

		// A pending re-check of a live install is a timer holding a reference to
		// this service and, through the closure, to the window: dropped with the
		// rest of them.
		this.stopInstallInFlightRecheck();

		// Remove all autoUpdater event listeners
		autoUpdater.removeAllListeners();

		// Remove all relevant IPC handlers
		ipcMain.removeHandler("check-for-updates");
		ipcMain.removeHandler("check-for-backend-updates");
		ipcMain.removeHandler("check-for-all-updates");
		ipcMain.removeHandler("get-last-install-attempt");
		ipcMain.removeHandler("update-backend");
		ipcMain.removeHandler("download-update");
		ipcMain.removeHandler("quit-and-install");
		ipcMain.removeHandler("quit-for-update-install");

		// Set mainWindow to null to break references
		this.mainWindow = null;
	}

	/**
	 * Set up event handlers for the autoUpdater
	 */
	/**
	 * One app-channel feed fetch, with its retries, as the owner of its failures.
	 *
	 * WHY A RETRY AND NOT A BETTER ERROR MESSAGE. The failures in the operator's
	 * log are transients: a Wi-Fi change, a wake, a resolver blip. Every one of
	 * them was followed by a check five minutes later that answered normally, so
	 * the honest response to the first is to ask again rather than to tell the
	 * user their network is down. Only a TRANSIENT failure is retried
	 * (`transientTransportCode`), so a 404, a refused credential or a certificate
	 * verdict still fails immediately and is not swallowed by a backoff.
	 *
	 * WHAT A CHECK CONCLUDES IS UNCHANGED, deliberately: a feed that never
	 * arrived still reaches the caller as a rejected promise, and a check that
	 * could not find out stays `unavailable` in the verdict. Retrying must not
	 * turn "could not find out" into "nothing newer" - that conflation is this
	 * repository's documented defect class, and it is why this is a retry rather
	 * than an extra entry in `shouldFilterUpdateError` (whose filtered branch
	 * emits `update-not-available`).
	 *
	 * The in-flight depth is held across the whole attempt sequence, so the
	 * `error` events each attempt raises are owned by this call rather than
	 * reported beside it.
	 */
	private async runAppFeedCheck(
		fetchFeed: () => Promise<
			Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>
		>,
	): Promise<Awaited<ReturnType<typeof autoUpdater.checkForUpdates>> | null> {
		/*
		 * The gate that decides whether a REQUEST is worth spending lives inside the
		 * attempt ladder (`runAppFeedAttempts`), not here: a skip has to leave the
		 * caller's own failure path intact, and what that path does depends on who
		 * asked. See the note there.
		 *
		 * The second caller rides the sequence already in flight rather than
		 * starting another one; see `appFeedFetchInFlight`.
		 */
		if (this.appFeedFetchInFlight) return this.appFeedFetchInFlight;
		const sequence = this.runAppFeedAttempts(fetchFeed);
		this.appFeedFetchInFlight = sequence;
		try {
			return await sequence;
		} finally {
			this.appFeedFetchInFlight = null;
		}
	}

	/**
	 * Whether Electron believes this machine has a network at all.
	 *
	 * The `typeof` guard is a constraint rather than defensiveness: this module is
	 * bundled with Electron STUBBED by its own contract harness
	 * (`scripts/update-robustness.test.mjs`), and a stub that does not answer this
	 * question must not turn every check into a skip. A missing reading is read as
	 * "reachable", which is the behaviour that existed before the gate.
	 */
	private networkIsReachable(): boolean {
		return typeof net?.isOnline === "function" ? net.isOnline() : true;
	}

	/**
	 * The attempt sequence itself: the retries, and the depth that owns them.
	 */
	private async runAppFeedAttempts(
		fetchFeed: () => Promise<
			Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>
		>,
	): Promise<Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>> {
		this.appChecksInFlight += 1;
		try {
			const delays = this.appFeedRetryDelaysMs;
			for (let attempt = 0; ; attempt += 1) {
				try {
					/*
					 * THE GATE IS AN ATTEMPT, NOT AN EXIT. A machine that reports no network
					 * spends no request - but the ladder still runs, because whether a check
					 * FAILS is the caller's question and its answer depends on WHO ASKED:
					 * an app-initiated check is silent, and a check the user clicked has to
					 * be answered with the sentence the copy already has (review round 2,
					 * R2-1). Returning early here made a clicked check resolve `null`, and a
					 * resolved invoke is not a failure - so the click the operator's rule
					 * exists for was the one path that said nothing at all.
					 *
					 * Waiting between gate readings rather than between requests is also
					 * what a wake needs: the network can come back inside the ladder's four
					 * seconds, and an attempt that never left the machine costs nothing to
					 * repeat.
					 */
					if (!this.networkIsReachable()) {
						logger.info(
							`The machine reports no network (net.isOnline() is false); not spending a request on the update feed${attempt < delays.length ? `, asking again in ${delays[attempt]}ms (attempt ${attempt + 2} of ${delays.length + 1})` : ""}.`,
							LogFileType.UPDATE_SERVICE,
						);
						if (attempt >= delays.length) throw offlineTransportError();
						await new Promise((resolve) =>
							setTimeout(resolve, delays[attempt]),
						);
						continue;
					}
					return await fetchFeed();
				} catch (error) {
					const code = transientTransportCode(error);
					if (code === null || attempt >= delays.length) throw error;
					const delay = delays[attempt];
					/*
					 * Logged per attempt, because a retry that succeeds leaves no trace
					 * for the user and this line is the only record that the app papered
					 * over a real network blip. It is also what tells a later reader that
					 * an intermittent failure is happening often rather than once.
					 */
					logger.warn(
						`Transient transport failure during the update check (${code}); retrying in ${delay}ms (attempt ${attempt + 2} of ${delays.length + 1})`,
						LogFileType.UPDATE_SERVICE,
					);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		} finally {
			this.appChecksInFlight -= 1;
		}
	}

	private setupUpdateEvents(): void {
		// When an update is available
		autoUpdater.on("update-available", (info) => {
			logger.info("Update available:", LogFileType.UPDATE_SERVICE, info);
			this.lastUpdateInfo = info;

			// An update whose artifact failed its size/sha512/disk check is not
			// re-offered by the routine checks: the 5-minute one would otherwise
			// re-offer it forever, and every offer ends in the same refusal. A check
			// the user asks for clears the record first (`onCheckRequested`), because
			// two of the refusals tell the user to free space or re-download and then
			// check again - a remedy that has to work when they follow it.
			if (this.failedVerificationVersions.has(info.version)) {
				logger.warn(
					`Not offering version ${info.version} again: its artifact already failed verification in this session.`,
					LogFileType.UPDATE_SERVICE,
				);
				return;
			}

			this.sendToRenderer("update-available", info);
		});

		// When no update is available
		autoUpdater.on("update-not-available", (info) => {
			logger.info("No update available:", LogFileType.UPDATE_SERVICE, info);
			this.sendToRenderer("update-not-available", info);
		});

		// When an update has been downloaded
		//
		// Verified before it is forwarded: the renderer only offers "install now"
		// once it has seen this event, so refusing here is what keeps an install
		// prompt away from an artifact we cannot vouch for.
		autoUpdater.on("update-downloaded", async (info) => {
			logger.info("Update downloaded:", LogFileType.UPDATE_SERVICE, info);
			this.lastUpdateInfo = info;

			const block = await this.ensureStagedArtifactVerified(info);
			if (block) {
				this.failedVerificationVersions.add(info.version);
				this.sendInstallBlock(block, info.version);
				return;
			}

			this.sendToRenderer("update-downloaded", info);
		});

		// When there's an error with the update
		autoUpdater.on("error", (err) => {
			logger.error("Update error:", LogFileType.UPDATE_SERVICE, err);

			// A download or an install that dies is not an availability problem:
			// the user asked for something and it failed, so it has to be shown.
			const actionable = this.updateStage !== "idle";
			/*
			 * ONE OWNER PER FAILURE. This handler and the check that provoked the
			 * error are two producers of one message, and until this gate existed
			 * they disagreed about when it may be sent: a scheduled check is silent
			 * and its `checkForUpdates` catch sends nothing, while this handler sent
			 * the same string regardless - so the log holds each transient failure
			 * twice and the silent background check was the surface the operator
			 * actually saw an alert from. While a check is in flight the check owns
			 * the report, and what that check does with it depends on WHO ASKED FOR
			 * IT (the operator's rule of 2026-09-16): a check the user clicked a
			 * button for reports its own failure once, after the retries are
			 * exhausted (`checkForUpdates(..., silent)`'s `!silent` catch), and an
			 * APP-INITIATED check - the five-minute tick, the launch check, the
			 * wake-armed one - reports nothing at all, transient or not, because
			 * nobody asked for it. This handler therefore never reports during a
			 * check; the sentence above is true for the click and silent for the
			 * rest, which is the whole rule.
			 *
			 * A stage failure still reports through here even during a check, which
			 * is why `actionable` is tested first: a download that dies while an
			 * availability check happens to be running is still a failure the user
			 * asked for.
			 */
			if (!actionable && this.appChecksInFlight > 0) {
				logger.info(
					// The rule, at the point it is implemented: a check in flight owns
					// its own failure report, and an app-initiated check's owner is a
					// silent one - so this is the log line that replaces the alert the
					// operator saw, not a swallowed error.
					"Update error during an availability check: the check reports its own failure",
					LogFileType.UPDATE_SERVICE,
				);
				return;
			}
			const shouldFilter = !actionable && this.shouldFilterUpdateError(err);

			if (shouldFilter) {
				logger.info(
					"Error filtering result: Reporting as no updates available",
				);
				// Send update-not-available instead of the error
				this.sendToRenderer("update-not-available", {
					version: app.getVersion(),
				});
			} else {
				/*
				 * Only send the error to the renderer if it shouldn't be filtered.
				 *
				 * The message is the machine's own words, cleaned of the nested
				 * `Error: ` prefixes a wrapped failure carries; the sentence a person
				 * reads is the renderer's (it classifies the same code with the same
				 * shared module), so a raw `net::ERR_*` string can no longer BE the
				 * message. Cleaning it here rather than only at the paint is what
				 * keeps the machine-voice detail on the alert readable.
				 */
				this.sendToRenderer("update-error", stripErrorPrefixes(err.message));
			}
		});

		// When update download progress changes
		autoUpdater.on("download-progress", (progressObj) => {
			logger.info(
				"Download progress:",
				LogFileType.UPDATE_SERVICE,
				progressObj,
			);
			if (
				this.mainWindow &&
				!this.mainWindow.isDestroyed() &&
				this.mainWindow.webContents &&
				!this.mainWindow.webContents.isDestroyed()
			) {
				this.mainWindow.webContents.send("update-progress", progressObj);
			}
		});

		// When the app is about to quit and install the update
		// Using type assertion to handle the event that might not be in the type definitions
		// biome-ignore lint/suspicious/noExplicitAny: This event is documented but not in the type definitions
		(autoUpdater as any).on("before-quit-for-update", () => {
			logger.info(
				"Application will quit and install update",
				LogFileType.UPDATE_SERVICE,
			);
			if (
				this.mainWindow &&
				!this.mainWindow.isDestroyed() &&
				this.mainWindow.webContents &&
				!this.mainWindow.webContents.isDestroyed()
			) {
				this.mainWindow.webContents.send("before-quit-for-update");
			}
		});
	}

	/**
	 * Set up IPC handlers for update-related actions
	 */
	/**
	 * The last install that did not complete, if any.
	 *
	 * Read from disk rather than from `this.pendingInstallFailure` so it survives
	 * a dismiss: the panel that reports a failure is not the only place the user
	 * can find out what happened, which is what made Dismiss an information loss
	 * (reviews U1, D3).
	 */
	public lastInstallAttempt(): LastInstallAttempt | null {
		return readLastInstallAttempt(this.markerDir());
	}

	/**
	 * Note that a check was asked for, and let an explicit one re-offer a release
	 * whose artifact failed verification.
	 *
	 * Why the distinction exists: every refusal records its version in
	 * `failedVerificationVersions` so the 5-minute timer cannot re-offer an
	 * artifact that will fail again. That record used to apply to user-initiated
	 * checks too, which made two of the panels' own labelled remedies inert - the
	 * user freed disk space or cleared the bad download, pressed "Check for
	 * updates" as instructed, and got silence until the app restarted (reviews
	 * R3, U3). A user who asks again gets a fresh answer; the timer does not.
	 */
	private onCheckRequested(options?: { manual?: boolean }): void {
		if (!options?.manual) return;
		if (this.failedVerificationVersions.size === 0) return;
		logger.info(
			`Explicit check requested; re-offering ${[...this.failedVerificationVersions].join(", ")} after a failed verification.`,
			LogFileType.UPDATE_SERVICE,
		);
		this.failedVerificationVersions.clear();
	}

	public setupIpcHandlers(): void {
		// Check for UI updates
		ipcMain.handle(
			"check-for-updates",
			async (_event, options?: { manual?: boolean }) => {
				logger.info("Checking for UI updates...", LogFileType.UPDATE_SERVICE);
				this.onCheckRequested(options);
				/*
				 * WHO ASKED decides whether a failure of this check may be reported; see
				 * `checkForUpdates`'s `reportFailure`. The renderer's mount check is the
				 * app's own startup check and says nothing here, while every button that
				 * proceeds an explicit check sends `manual: true`.
				 */
				const reportFailure = options?.manual === true;
				try {
					/*
					 * The same fetch with the same retries as the scheduled check
					 * (`runAppFeedCheck`): a Wi-Fi roam that lands mid-click is the same
					 * transient failure, and the person who pressed the button is the one
					 * least served by being told their network is down.
					 */
					return await this.runAppFeedCheck(() =>
						autoUpdater.checkForUpdates(),
					);
				} catch (error) {
					logger.error(
						"Error checking for UI updates:",
						LogFileType.UPDATE_SERVICE,
						// The failure is logged here whatever the caller is, because the log
						// is where an app-initiated check's failure belongs once it is not
						// reported.
						error,
					);

					// Apply the same error filtering logic here as in the autoUpdater error event
					const shouldFilter = this.shouldFilterUpdateError(error as Error);

					if (shouldFilter) {
						logger.info(
							"Error filtering result in IPC handler: Reporting as no updates available",
							LogFileType.UPDATE_SERVICE,
						);
						// Return a "no update available" result instead of throwing the error
						return {
							updateInfo: {
								version: app.getVersion(),
							},
							versionInfo: {
								version: app.getVersion(),
							},
							cancellationToken: null,
						};
					}

					/*
					 * AN APP-INITIATED CHECK RESOLVES RATHER THAN REJECTING. Rejecting was how
					 * this failure reached the renderer, and the renderer painted it - the
					 * mount check's `Error checking for updates: Error invoking remote method
					 * 'check-for-updates': Error: net::ERR_...` was the second of the two
					 * producers of the operator's alert, on a check nobody asked for (QA
					 * round 1, Q1). `null` is the shape the updater itself uses for "this
					 * check did not produce a result" and the verdict already reads it as
					 * `unavailable`, so the silence costs no information.
					 */
					if (!reportFailure) {
						logger.info(
							"An app-initiated check could not read the update feed; the failure is logged and not shown (only a check the user asked for is reported).",
							LogFileType.UPDATE_SERVICE,
						);
						return null;
					}

					/*
					 * THE RULE AT THE RETHROW SITE: this rejection carries the MACHINE's own
					 * string, so a consumer that paints it must map it first - the shared
					 * classifier plus `updateErrorCopy` on the renderer side produce the
					 * sentence and the subordinate code line, and painting the rejection raw
					 * is how `net::ERR_INTERNET_DISCONNECTED` became a message a person read.
					 * Every consumer in this tree goes through that path; a new one must too.
					 */
					throw error;
				}
			},
		);

		// Check for backend updates
		ipcMain.handle("check-for-backend-updates", async () => {
			logger.info(
				"Checking for backend updates...",
				LogFileType.UPDATE_SERVICE,
			);
			try {
				// The channel's status is the verdict's business; this handler's
				// contract is the panel's input, so only the offer crosses it.
				const { info } = await this.checkForBackendUpdates();
				return info;
			} catch (error) {
				logger.error(
					"Error checking for backend updates:",
					LogFileType.UPDATE_SERVICE,
					error,
				);
				throw error;
			}
		});

		// Check for all updates (UI and backend)
		ipcMain.handle(
			"check-for-all-updates",
			async (_event, options?: { manual?: boolean; silent?: boolean }) => {
				logger.info(
					"Checking for all updates (UI and backend)...",
					LogFileType.UPDATE_SERVICE,
				);
				this.onCheckRequested(options);
				/*
				 * `silent` is its OWN flag, not the absence of `manual`.
				 *
				 * The two answer different questions. `manual` is the renderer's - it
				 * lets a by-hand check re-offer a release whose artifact failed
				 * verification, and it travels on to the server offer - while `silent`
				 * decides whether this check emits the per-channel `*-not-available`
				 * events, which `update-notification.tsx` clears stale state on and
				 * which gate the npx registry read.
				 *
				 * `!options?.manual` made the suppression rule a side effect of a flag
				 * that exists for a different reason, so a caller that set `manual` for
				 * the re-offer rule while saying nothing about notifications would
				 * acquire it invisibly. Reading it explicitly also keeps this handler's
				 * own history: it used to drop `options` entirely and run every check
				 * non-silent, so a caller that sends no `silent` still gets the events.
				 */
				const silent = options?.silent === true;
				try {
					/*
					 * The same `who asked` fact as `check-for-updates`: a check the user
					 * pressed a button for reports its own failures, and any other caller -
					 * the launch check, the schedule, the wake - reports nothing.
					 */
					return await this.checkForAllUpdates(
						silent,
						options?.manual === true,
					);
				} catch (error) {
					logger.error(
						"Error checking for all updates:",
						LogFileType.UPDATE_SERVICE,
						error,
					);
					/*
					 * ALWAYS a verdict, including here, so the renderer's read of what
					 * this check earned is total. The branch is total and the rejection
					 * that used to sit on it is gone: neither channel's check rethrows
					 * its own failure - each reports it through its own
					 * `update-error`/`backend-update-error` event and resolves an
					 * `unavailable` status - so the old filter-then-throw was dead in
					 * practice, and removing it loses no report. Throwing would only
					 * have moved the answer to "what did this check find out?" out of
					 * the verdict and into an exception; a rejected invoke is still
					 * reported by the button's own catch.
					 */
					return updateCheckVerdict({
						app: "unavailable",
						server: "unavailable",
					});
				}
			},
		);

		// The last failed install, for Settings -> App updates.
		ipcMain.handle("get-last-install-attempt", () => this.lastInstallAttempt());

		// Update backend
		ipcMain.handle(
			"update-backend",
			async (_event, targetVersion?: unknown) => {
				logger.info("Updating backend...", LogFileType.UPDATE_SERVICE);
				try {
					return await this.updateBackend(
						typeof targetVersion === "string" ? targetVersion : undefined,
					);
				} catch (error) {
					logger.error(
						"Error updating backend:",
						LogFileType.UPDATE_SERVICE,
						error,
					);
					throw error;
				}
			},
		);

		// Download update
		ipcMain.handle("download-update", async () => {
			logger.info("Downloading update...", LogFileType.UPDATE_SERVICE);
			this.updateStage = "downloading";
			try {
				const downloadedPaths = await autoUpdater.downloadUpdate();
				// The paths are the updater's own answer for where the artifact
				// landed, so the verification that follows does not have to guess.
				if (Array.isArray(downloadedPaths) && downloadedPaths.length > 0) {
					this.downloadedArtifactPath = downloadedPaths[0];
				}
				return downloadedPaths;
			} catch (error) {
				logger.error(
					"Error downloading update:",
					LogFileType.UPDATE_SERVICE,
					error,
				);

				// Apply the same error filtering logic here
				const shouldFilter = this.shouldFilterUpdateError(error as Error);

				if (shouldFilter) {
					logger.info(
						"Error filtering result in download-update: Reporting as no updates available",
						LogFileType.UPDATE_SERVICE,
					);
					// Return a "no update available" result instead of throwing the error
					if (
						this.mainWindow &&
						!this.mainWindow.isDestroyed() &&
						this.mainWindow.webContents &&
						!this.mainWindow.webContents.isDestroyed()
					) {
						this.mainWindow.webContents.send("update-not-available", {
							version: app.getVersion(),
						});
					}
					// Return a minimal result to avoid breaking the promise chain
					return {
						cancellationToken: null,
					};
				}

				throw error;
			} finally {
				this.updateStage = "idle";
			}
		});

		// Quit and install update
		//
		// Async, and deliberately capable of refusing: this is the only place an
		// install starts, and it starts only after the installed bundle and the
		// staged artifact have been checked (see runInstallPreflight).
		//
		// One install at a time. The pre-flight can run `codesign` over a 1 GiB
		// bundle and hash a 350 MB artifact, and for those seconds the panel used to
		// look untouched with its primary button still live - so a second click
		// re-entered the whole thing, spawned a second watchdog and overwrote the
		// first marker's pid (review U5). The renderer also shows a pending state;
		// this is the half that has to hold when something else calls in.
		ipcMain.handle("quit-and-install", async () => {
			if (this.installPreflightInFlight) {
				logger.info(
					"Ignoring a second install request while the pre-flight is still running.",
					LogFileType.UPDATE_SERVICE,
				);
				return false;
			}

			/*
			 * An unpackaged instance never starts an install, and stating it here is what
			 * makes that more than a detail: the marker below goes into the shared
			 * userData the packaged app reads, so one written here would tell the
			 * packaged app an install was in flight for a bundle nothing was installing
			 * (see `recoverPendingInstall`, which is the reader's half of this rule).
			 */
			if (!app.isPackaged) {
				logger.info(
					"Refusing to start an update install: this instance is unpackaged, so it is not the bundle an install replaces.",
					LogFileType.UPDATE_SERVICE,
				);
				return false;
			}
			logger.info(
				"Preparing to quit and install the update...",
				LogFileType.UPDATE_SERVICE,
			);

			this.installPreflightInFlight = true;
			this.updateStage = "installing";
			let block: InstallBlock | null = null;
			try {
				block = await this.runInstallPreflight(this.lastUpdateInfo);
				// Native updaters do not await Electron's async quit listeners.
				// Cleanup must precede even the watchdog/marker handoff effects.
				if (!block) await this.backendService?.stop(false);
			} catch (error) {
				this.updateStage = "idle";
				logger.error(
					"Update handoff refused: owned backend cleanup failed",
					LogFileType.UPDATE_SERVICE,
					error,
				);
				return false;
			} finally {
				this.installPreflightInFlight = false;
			}
			if (block) {
				this.updateStage = "idle";
				this.sendInstallBlock(block, this.lastUpdateInfo?.version ?? undefined);
				return false;
			}

			// Written before the quit, because after it there is nothing left of
			// this process to record that an install was in flight. The target is
			// decided once: the marker records it and the watchdog's on-disk swap
			// check compares against it, and two computations of one fact are two
			// chances to disagree (review R11). The one place the two must differ is
			// a fallback: the watchdog never gets a target that is already installed,
			// because such a target reads as "the swap landed" before the install has
			// started (review R15, see `watchdogSwapTarget`).
			const targetVersion = this.lastUpdateInfo?.version ?? app.getVersion();
			const watchdogPid = this.launchWatchdog(targetVersion);
			const marker = writePendingInstallMarker(this.markerDir(), {
				targetVersion,
				artifactPath:
					this.downloadedArtifactPath ??
					this.downloadHelper()?.file ??
					"unknown",
				startedAt: new Date().toISOString(),
				watchdogPid,
			});
			logger.info(
				`Pending install marker written for version ${marker.targetVersion} (watchdog pid ${watchdogPid ?? "none"}).`,
				LogFileType.UPDATE_SERVICE,
			);

			this.backendService?.setAutoUpdating(true);
			autoUpdater.quitAndInstall(false, true);
			return true;
		});

		/**
		 * Quit so an install that is ALREADY running can finish.
		 *
		 * What the panel for an in-flight install offers, and deliberately not
		 * `quit-and-install`: the marker is already written, the install's job is
		 * loaded and its watchdog is running, so re-entering the pre-flight would
		 * verify the seal of a bundle Squirrel is halfway through replacing and then
		 * write a second marker over the first. All this needs to do is get the app
		 * out of the way of Squirrel's last validation, which asks whether any
		 * instance of the target app is running before it swaps.
		 */
		ipcMain.handle("quit-for-update-install", () => {
			const marker = readPendingInstallMarker(this.markerDir());
			logger.info(
				"Quitting so the in-flight update install can finish.",
				LogFileType.UPDATE_SERVICE,
			);
			/*
			 * Recorded the way `quitForInFlightInstall` records it, and before the
			 * ensure rather than after: this handler IS the decision, and this app's
			 * quit runs the other one again on the way out (`before-quit` asks the
			 * same question). Without the flag the second answer finds
			 * `inFlightQuitWatchdogEnsured` false, decides again and ensures again -
			 * two decisions and two watchdogs for one quit, where the window-close
			 * gesture has always been one (UX U8). The flag is what makes "one
			 * decision per quit" a property of the service rather than of which
			 * gesture reached it.
			 */
			if (marker && !this.inFlightQuitWatchdogEnsured) {
				this.inFlightQuitWatchdogEnsured = true;
				this.ensureWatchdogAfterInFlightQuit(marker);
			}
			// Deferred so the reply reaches the renderer first: the button that
			// asked for this reports a failure if the app quits mid-request, and
			// the quit it asked for is happening either way.
			setImmediate(() => app.quit());
			return true;
		});
	}

	/**
	 * Check for updates
	 * @param silent - Whether to show a notification if no update is available
	 * @returns What THIS channel found out, which is half of a whole check's
	 *   answer and never an answer of its own: "nothing newer here" says nothing
	 *   about the other channel, and a channel that could not reach an answer
	 *   says it with `unavailable` rather than by omission. `checkForAllUpdates`
	 *   is what turns the pair into the one sentence a user reads.
	 */
	public async checkForUpdates(
		silent = false,
		/*
		 * WHETHER A FAILURE HERE MAY REACH THE USER, which is not the same question as
		 * `silent` - and that is the point.
		 *
		 * The operator's rule of 2026-09-16: "if updates can't be checked then that
		 * should be an error that only pops up if clicking the button to check for
		 * updates". So the fact that decides reporting is WHO ASKED, not which events
		 * the check emits: `silent` is about the per-channel `*-not-available` events,
		 * which clear stale state in the renderer and gate the npx registry read, and
		 * an APP-INITIATED check - the five-minute tick, the launch check, the
		 * wake-armed one - can report nothing while still emitting those exactly as it
		 * does today. Making one flag do both jobs would have silenced the stale-state
		 * clearing to buy the silence we actually want.
		 *
		 * The default keeps every existing caller's behaviour (`!silent` is what the
		 * gate was), and the IPC handlers pass the renderer's own `manual` fact in.
		 */
		reportFailure = !silent,
	): Promise<UpdateChannelStatus> {
		logger.info(
			`Checking for updates... (silent mode: ${silent})`,
			LogFileType.UPDATE_SERVICE,
		);

		try {
			// Handle dev mode case
			if (this.isDevMode) {
				logger.info(
					"Skip checkForUpdates because application is not packed and dev update config is not forced",
					LogFileType.UPDATE_SERVICE,
				);

				if (
					!silent &&
					this.mainWindow &&
					!this.mainWindow.isDestroyed() &&
					this.mainWindow.webContents &&
					!this.mainWindow.webContents.isDestroyed()
				) {
					this.mainWindow.webContents.send(
						"update-dev-mode",
						"Application is running in development mode. Updates are disabled.",
					);
				}
				// Development mode does not find out nothing: it does not find out
				// anything, which is the difference that keeps an affirmation off
				// a check that never ran.
				return "unavailable";
			}

			// Handle npx installation case
			if (this.isNpxInstall) {
				logger.info(
					"Application was installed via npx. Checking npm registry for updates...",
					LogFileType.UPDATE_SERVICE,
				);

				let status: UpdateChannelStatus = "unavailable";

				if (!silent) {
					// Check npm registry for the latest version
					const currentVersion = app.getVersion();
					const latestVersion = await this.getLatestNpmVersion();

					/*
					 * Both readings, before either is compared (QA round 1, Q2).
					 *
					 * `isNewerVersion` coerces non-numeric parts to `NaN` and every
					 * comparison against `NaN` is false, so a malformed pair reads as
					 * "nothing newer" and would earn the whole check's affirmation. An
					 * unreadable registry answer or an unreadable running version is
					 * "we could not find out", which is `unavailable` - the same answer
					 * an empty registry read already gets. This is also the answer for
					 * an offer: a version that cannot be read is not one to tell the
					 * user to move to.
					 */
					if (
						!isReadableVersion(currentVersion) ||
						!isReadableVersion(latestVersion)
					) {
						logger.warn(
							`Unreadable version reading for the npx install (running: ${currentVersion}, latest: ${latestVersion}); reporting the channel as unavailable rather than comparing them.`,
							LogFileType.UPDATE_SERVICE,
						);
						return "unavailable";
					}

					if (
						latestVersion &&
						this.isNewerVersion(latestVersion, currentVersion)
					) {
						logger.info(
							`Newer version available: ${latestVersion} (current: ${currentVersion})`,
							LogFileType.UPDATE_SERVICE,
						);

						if (
							this.mainWindow &&
							!this.mainWindow.isDestroyed() &&
							this.mainWindow.webContents &&
							!this.mainWindow.webContents.isDestroyed()
						) {
							this.mainWindow.webContents.send("update-npx-available", {
								currentVersion,
								latestVersion,
								updateCommand: "npx local-operator-ui@latest",
							});
						}
						status = "available";
					} else {
						logger.info(
							`No newer version available. Current: ${currentVersion}, Latest: ${latestVersion || "unknown"}`,
							LogFileType.UPDATE_SERVICE,
						);

						if (
							this.mainWindow &&
							!this.mainWindow.isDestroyed() &&
							this.mainWindow.webContents &&
							!this.mainWindow.webContents.isDestroyed()
						) {
							this.mainWindow.webContents.send("update-not-available", {
								version: currentVersion,
							});
						}
						// The event stays where it is - the renderer clears a stale
						// offer on it - but only a registry that ANSWERED has said
						// there is nothing newer: a read that came back empty is the
						// absence of a reading, and calling it "current" would let a
						// failed fetch earn the whole check's affirmation.
						status = latestVersion ? "current" : "unavailable";
					}
				}
				return status;
			}

			// Regular update flow for packaged app
			// Set silent mode for the autoUpdater
			autoUpdater.autoDownload = false;

			// Configure the autoUpdater to handle silent mode
			/*
			 * Every listener, not the first one: `removeAllListeners` takes off all
			 * of them, so restoring `listeners(...)[0]` alone would drop any second
			 * subscriber for the rest of the session.
			 */
			const originalNotAvailableHandlers = autoUpdater.listeners(
				"update-not-available",
			);

			if (silent) {
				// Temporarily remove the update-not-available handler to prevent notifications
				autoUpdater.removeAllListeners("update-not-available");
				autoUpdater.once("update-not-available", (info) => {
					logger.info(
						"No update available (silent mode):",
						LogFileType.UPDATE_SERVICE,
						info,
					);
					// Don't send notification to renderer in silent mode
				});
			}

			// Check for updates.
			//
			// The channel's status comes from what the CHECK resolved to, never from
			// which events it happened to emit: electron-updater resolves a
			// `UpdateCheckResult` in both cases (`isUpdateAvailable` false after it
			// emits `update-not-available`), and this service's own filtered-error
			// path emits that same `update-not-available` for a check that found out
			// nothing at all - so the event cannot tell "nothing newer" from "no
			// answer", which is exactly how the renderer came to show "You are up to
			// date" beside a server offer. A `null` result is the updater declining
			// to run at all (`isUpdaterActive()` false), which is a refusal to find
			// out rather than an answer.
			/*
			 * The swap is undone in a `finally`, and UNCONDITIONALLY while `silent`.
			 *
			 * `checkForUpdates()` rejects on a failed feed fetch, and a restore
			 * placed after the `await` never ran on that path: the service's own
			 * `update-not-available` forwarder (`setupUpdateEvents`) stayed removed
			 * for the rest of the session, with the silent no-op listener left
			 * behind to swallow the next genuine not-available event. Restoring
			 * outside the `if (original...)` guard is the same hazard from the other
			 * side: when there was nothing to put back, the temporary listener was
			 * still the one that had to come off.
			 */
			let result: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>;
			try {
				/*
				 * The fetch is retried on a TRANSIENT transport failure (`runAppFeedCheck`),
				 * before the `finally` below puts the not-available listener back: a
				 * retry is the same fetch, so the listener swap has to hold across the
				 * whole attempt sequence rather than per attempt.
				 */
				result = await this.runAppFeedCheck(() =>
					autoUpdater.checkForUpdates(),
				);
			} finally {
				if (silent) {
					autoUpdater.removeAllListeners("update-not-available");
					for (const handler of originalNotAvailableHandlers) {
						autoUpdater.on(
							"update-not-available",
							handler as (info: UpdateInfo) => void,
						);
					}
				}
			}

			if (!result) return "unavailable";
			/*
			 * What the packaged app channel is allowed to conclude, from the readings
			 * the updater resolved rather than from the flag alone (QA round 1, Q2).
			 *
			 * `isUpdateAvailable` is a comparison's RESULT: when either side of that
			 * comparison was not a version, the flag is false for a reason that has
			 * nothing to do with being current, and "false" then earns the
			 * installation-wide affirmation. Both sides are therefore checked here:
			 * the running version, and the version the feed reported. electron-updater
			 * populates `versionInfo` on BOTH of its outcomes
			 * (`AppUpdater.doCheckForUpdates`: the not-available and available returns
			 * both carry `versionInfo: updateInfo`), so a missing one is an absent
			 * reading - not a legitimate "no update" - and is refused for the same
			 * reason. A malformed reading on an otherwise-available check yields no
			 * offer either: the version could not be read, so there is nothing to name
			 * and nothing to affirm.
			 */
			const runningVersion = app.getVersion();
			const publishedVersion = result.versionInfo?.version;
			if (
				!isReadableVersion(runningVersion) ||
				!isReadableVersion(publishedVersion)
			) {
				logger.warn(
					`Unreadable version reading from the update feed (running: ${runningVersion}, published: ${publishedVersion}); reporting the channel as unavailable rather than trusting isUpdateAvailable=${result.isUpdateAvailable}.`,
					LogFileType.UPDATE_SERVICE,
				);
				return "unavailable";
			}
			return result.isUpdateAvailable ? "available" : "current";
		} catch (error) {
			logger.error(
				"Error checking for updates:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			if (
				this.mainWindow &&
				!this.mainWindow.isDestroyed() &&
				this.mainWindow.webContents &&
				!this.mainWindow.webContents.isDestroyed() &&
				reportFailure
			) {
				this.mainWindow.webContents.send(
					"update-error",
					/*
					 * Cleaned of the nested `Error: ` prefixes a wrapped failure carries,
					 * at the source: this string is shown to a person as the machine's own
					 * words under the sentence the renderer builds from the same code, and
					 * `Error: Error: net::...` is a nesting nobody asked for.
					 */
					stripErrorPrefixes((error as Error).message),
				);
			}
			// An error is not an answer: a known-spurious no-availability error is
			// filtered here (the autoUpdater's own listener turns it into an
			// `update-not-available` event), and an unfiltered one is reported to the
			// user through `update-error` above. Either way this check did not find
			// out what the running version is, so it may not affirm anything.
			return "unavailable";
		}
	}

	/**
	 * Get the latest version from npm registry
	 * @returns The latest version string or null if unable to fetch
	 */
	private getLatestNpmVersion(): Promise<string | null> {
		return new Promise((resolve) => {
			const packageName = "local-operator-ui";
			const url = `https://registry.npmjs.org/${packageName}`;

			https
				.get(url, (res) => {
					let data = "";

					res.on("data", (chunk) => {
						data += chunk;
					});

					res.on("end", () => {
						try {
							const packageInfo = JSON.parse(data);
							const latestVersion = packageInfo["dist-tags"]?.latest;
							resolve(latestVersion || null);
						} catch (error) {
							logger.error(
								"Error parsing npm registry response:",
								LogFileType.UPDATE_SERVICE,
								error,
							);
							resolve(null);
						}
					});
				})
				.on("error", (error) => {
					logger.error(
						"Error fetching from npm registry:",
						LogFileType.UPDATE_SERVICE,
						error,
					);
					resolve(null);
				});
		});
	}

	/**
	 * Compare version strings to determine if version1 is newer than version2
	 * @param version1 First version string
	 * @param version2 Second version string
	 * @returns True if version1 is newer than version2
	 */
	private isNewerVersion(version1: string, version2: string): boolean {
		const normalizeVersion = (ver: string) =>
			ver.trim().replace(VERSION_CLEAN_REGEX, ""); // Remove leading 'v' or 'V'

		const v1Norm = normalizeVersion(version1);
		const v2Norm = normalizeVersion(version2);

		const v1Parts = v1Norm.split("-")[0].split(".").map(Number);
		const v2Parts = v2Norm.split("-")[0].split(".").map(Number);

		// Compare major, minor, patch
		for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
			const v1Part = v1Parts[i] || 0;
			const v2Part = v2Parts[i] || 0;

			if (v1Part > v2Part) return true;
			if (v1Part < v2Part) return false;
		}

		// If we get here and versions have pre-release tags, compare those
		const v1PreRelease = v1Norm.split("-")[1];
		const v2PreRelease = v2Norm.split("-")[1];

		// No pre-release is newer than any pre-release
		if (!v1PreRelease && v2PreRelease) return true;
		if (v1PreRelease && !v2PreRelease) return false;

		// If both have pre-release tags, compare them lexicographically
		return v1PreRelease > v2PreRelease;
	}

	/**
	 * The address every backend read in this service goes to.
	 *
	 * The manager's LIVE address rather than the configured one: an adopted daemon
	 * is discovered at a port the configuration never named, and the manager rotates
	 * its own `backendUrl` onto it when it attaches. Reading the configured URL
	 * instead made every health read fail for exactly the shape this branch adds -
	 * a daemon the app did not start - so the skew after an install moved degraded
	 * to "no reading" on the one path where that sentence is the only report the
	 * user gets, while Settings could name the same daemon's version a few clicks
	 * away (QA Q-2, UX U1).
	 *
	 * The configured URL stays as the fallback for the frames where no manager is
	 * attached yet - the update service is constructed before it in the app's start
	 * path.
	 */
	private liveBackendUrl(): string {
		return this.backendService?.getBackendUrl() ?? this.backendUrl;
	}

	/**
	 * Read the server serving this app: its version, and the install it runs from.
	 *
	 * The install root travels with the version because the update check is a
	 * statement about an INSTALL, and `/health` is the only thing that knows which
	 * one is answering. The app used to classify the install it could name from the
	 * `local-operator` shim on `PATH` and compare THAT against PyPI while reading
	 * this version separately - so a machine serving the app from a three-release-old
	 * environment was told "The application and server are up to date" beside a
	 * Settings row naming the older build.
	 *
	 * @returns the reading, with a null version when nothing answered
	 */
	private async readRunningBackend(): Promise<RunningBackendReading> {
		const notAnswered: RunningBackendReading = {
			version: null,
			prefix: null,
			installKind: null,
		};
		try {
			const backendUrl = this.liveBackendUrl();
			logger.info(
				`Checking backend version from health API at ${backendUrl}/health`,
				LogFileType.UPDATE_SERVICE,
			);

			// Set a timeout for the fetch request
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

			const response = await fetch(`${backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				logger.error(
					`Health API returned status ${response.status}`,
					LogFileType.UPDATE_SERVICE,
				);
				return notAnswered;
			}

			const healthData = (await response.json()) as HealthCheckResponse;
			const reading = readingOfHealth(healthData);

			// Check if the response has version information
			if (reading.version) {
				logger.info(
					`Backend version from health API: ${reading.version} (install root ${reading.prefix ?? "not reported"}, install kind ${reading.installKind ?? "not reported"})`,
					LogFileType.UPDATE_SERVICE,
				);
				return reading;
			}

			// For older server versions that don't have the version information
			logger.info(
				"Backend version not available in health response",
				LogFileType.UPDATE_SERVICE,
			);
			return { ...reading, version: "Unknown" };
		} catch (error) {
			logger.error(
				"Error getting backend version from health API:",
				LogFileType.UPDATE_SERVICE,
				error,
			);

			// Try alternative URL with localhost if the first attempt failed with 127.0.0.1
			const retryUrl = this.liveBackendUrl();
			if (retryUrl.includes("127.0.0.1")) {
				try {
					const altUrl = retryUrl.replace("127.0.0.1", "localhost");
					logger.info(
						`Trying alternative URL: ${altUrl}/health`,
						LogFileType.UPDATE_SERVICE,
					);

					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 5000);

					const response = await fetch(`${altUrl}/health`, {
						method: "GET",
						headers: { Accept: "application/json" },
						signal: controller.signal,
					});

					clearTimeout(timeoutId);

					if (!response.ok) {
						logger.error(
							`Alternative health API returned status ${response.status}`,
							LogFileType.UPDATE_SERVICE,
						);
						return notAnswered;
					}

					const healthData = (await response.json()) as HealthCheckResponse;
					const reading = readingOfHealth(healthData);

					// Check if the response has version information
					if (reading.version) {
						logger.info(
							`Backend version from alternative health API: ${reading.version} (install root ${reading.prefix ?? "not reported"}, install kind ${reading.installKind ?? "not reported"})`,
							LogFileType.UPDATE_SERVICE,
						);
						return reading;
					}
				} catch (altError) {
					logger.error(
						"Error checking alternative backend URL:",
						LogFileType.UPDATE_SERVICE,
						altError,
					);
				}
			}

			// If we're in dev mode, try to get the version using pip as a fallback
			if (this.isDevMode) {
				try {
					logger.info(
						"Trying to get backend version using pip as fallback",
						LogFileType.UPDATE_SERVICE,
					);
					const execAsync = promisify(exec);
					const { stdout } = await execAsync("pip show local-operator");
					const match = stdout.match(VERSION_LINE_REGEX);
					if (match) {
						const version = match[1].trim();
						logger.info(
							`Backend version from pip: ${version}`,
							LogFileType.UPDATE_SERVICE,
						);
						/*
						 * The version without an install root: `pip show` in this process's own
						 * environment is not evidence about a server that is not answering, and
						 * the check treats a missing root as "the serving install could not be
						 * named" rather than as a reading of the global install.
						 */
						return { version, prefix: null, installKind: null };
					}
				} catch (pipError) {
					logger.error(
						"Error getting backend version from pip:",
						LogFileType.UPDATE_SERVICE,
						pipError,
					);
				}
			}

			return notAnswered;
		}
	}

	/**
	 * The version the server serving this app reports, or null when it did not.
	 *
	 * Kept beside `readRunningBackend` rather than replaced by it: four callers ask
	 * only this question (the skew notices, the by-hand panel), and none of them may
	 * start judging an install because a second reading became available.
	 */
	private async getInstalledBackendVersion(): Promise<string | null> {
		return (await this.readRunningBackend()).version;
	}

	/**
	 * Get the latest version from PyPI
	 * @returns Promise resolving to the latest version string or null if unable to fetch
	 */
	private getLatestPypiVersion(): Promise<string | null> {
		return new Promise((resolve) => {
			const url = "https://pypi.org/pypi/local-operator/json";
			https
				.get(url, (res) => {
					let data = "";
					res.on("data", (chunk) => {
						data += chunk;
					});
					res.on("end", () => {
						try {
							const packageInfo = JSON.parse(data);
							const latestVersion = packageInfo.info?.version;
							resolve(latestVersion || null);
						} catch (error) {
							logger.error(
								"Error parsing PyPI response:",
								LogFileType.UPDATE_SERVICE,
								error,
							);
							resolve(null);
						}
					});
				})
				.on("error", (error) => {
					logger.error(
						"Error fetching from PyPI:",
						LogFileType.UPDATE_SERVICE,
						error,
					);
					resolve(null);
				});
		});
	}

	/**
	 * Check for backend updates using health API and PyPI
	 * @param silent - Whether to suppress notifications on no update
	 * @returns Promise resolving to update info or null if no update is available
	 */
	/**
	 * Read the install that is serving this app, from the root `/health` named.
	 *
	 * The version comes from the dist-info at that root
	 * (`resolveDistributionMarkers`, the same read the global classification uses),
	 * which is shell-free and needs no interpreter: `pip show` inside that
	 * environment would spawn the very server's python, and a second process is not
	 * worth a number that is already on disk beside the code.
	 *
	 * A root the server did not name answers with nulls, and the check treats that
	 * as "the serving install could not be identified" rather than falling back to
	 * an install the app can name - which is the reported defect.
	 */
	private readServingInstall(reading: RunningBackendReading): ServingInstall {
		const prefix = reading.prefix;
		if (!prefix) {
			return {
				prefix: null,
				version: null,
				installKind: reading.installKind,
				appOwned: false,
			};
		}
		let version: string | null = null;
		try {
			const markers = resolveDistributionMarkers(prefix);
			/*
			 * THE RUNNING READING WINS when the install's own metadata is stale BY
			 * CONSTRUCTION. `markers.version` is the dist-info directory's NAME, and pip
			 * writes that once and never refreshes it when the version in
			 * `pyproject.toml` moves - which the backend already stopped trusting:
			 * `installed_version()` in the serving environment prefers the checkout's own
			 * `pyproject.toml` whenever `direct_url.json` proves the editable
			 * relationship, and says so in its own comment (a checkout at 0.49.0 kept
			 * reporting the 0.46.23 it had been installed at, and the app showed that
			 * number in Settings). `resolveDistributionMarkers` returns the two signals
			 * for exactly this - `editable`, and a `.lop-source` ref, which is the same
			 * stale-metadata situation for a uv tool install built from a checkout - and
			 * this call site used to ignore both.
			 *
			 * So on an editable serving install the SUBJECT of the comparison would be an
			 * old number while `/health` carries the real one, and the rule would answer
			 * `install-behind` for a server that is current: the two-number sentence
			 * ("The install on this machine is at 0.46.23, and the server you are using is
			 * running 0.49.0 until it restarts") is the one-screen contradiction this
			 * change exists to remove, on the machine shape this project develops on
			 * (review round 1, R2). Not a regression, because the pre-fix subject was a
			 * version from the same dist-info - but the read now uses the signal it was
			 * already given.
			 *
			 * The dist-info version stays as the fallback: an unreadable `/health`
			 * version is not evidence that the install is behind, and the `Unknown`
			 * sentinel an older backend answers must not become the subject here.
			 */
			version =
				(markers.editable || markers.sourceRef) &&
				isReadableVersion(reading.version)
					? reading.version
					: markers.version;
		} catch (error) {
			logger.warn(
				`Could not read the install at ${prefix}: ${(error as Error).message}`,
				LogFileType.UPDATE_SERVICE,
			);
		}
		return {
			prefix,
			version,
			installKind: reading.installKind,
			appOwned: appOwnsInstallRoot(this.ownedInstallInput(), prefix),
		};
	}

	/**
	 * This instance's own ownership triple.
	 *
	 * `packaged` is the build this process IS, not the environment it is asking
	 * about: a packaged build pointed at a dev server still owns the environment
	 * its bundle carries, and the sibling name is in the root list for the
	 * question the other way round.
	 */
	private ownedInstallInput(): OwnedInstallInput {
		return {
			platform: process.platform,
			home: app.getPath("home"),
			appDataPath: app.getPath("appData"),
			packaged: app.isPackaged,
		};
	}

	/**
	 * The identity of the install serving this app, for the classification the plan
	 * needs when that install is not one the app owns.
	 *
	 * Read from the console script INSIDE the reported prefix, so
	 * `classifyGlobalInstall` sees the install that answered rather than whichever
	 * one the shim on `PATH` happens to point at - the two differ exactly on the
	 * machines this check exists for. Null when the prefix carries no console
	 * script, which is "we could not classify it" rather than a guess.
	 */
	private servingInstallIdentity(prefix: string): InstallIdentity | null {
		const script =
			process.platform === "win32"
				? join(prefix, "Scripts", "local-operator.exe")
				: join(prefix, "bin", "local-operator");
		return existsSync(script) ? readInstallIdentity(script) : null;
	}

	/**
	 * Decide what the backend update prompt may offer for a startup mode.
	 *
	 * GLOBAL_INSTALL is the mode that produced the operator's report: the app
	 * offered `pip install --upgrade local-operator` for a server that was a uv
	 * tool install (0.54.17, read from /health) with `canManageUpdate: true`. pip
	 * is the wrong installer for that environment - uv owns it, and the
	 * environment lives outside anything the app may write to.
	 *
	 * EXISTING_SERVER takes the same classification as GLOBAL_INSTALL, because it
	 * is the same question: a server the app attaches to but does not own was
	 * still being told to run pip, three lines below the code that had already
	 * learned better (reviews U4, D4).
	 *
	 * Both of those modes resolve the plan for ONE install: the install that is
	 * actually serving this app, as `/health` reports it. Classifying a global
	 * install by name while a different one serves the user is how the check came to
	 * affirm a version the panel's own row contradicted.
	 */
	private async resolveBackendUpdatePlan(
		startupMode: LocalOperatorStartupMode,
		serving: ServingInstall,
	): Promise<{
		canManageUpdate: boolean;
		updateCommand: string;
		remedy: string;
		detail: string;
		sourceBuild: boolean;
		/**
		 * The version the resolved install reports on disk, or null.
		 *
		 * Travels beside the plan because the plan IS a statement about that
		 * install: the check compares this version (what an update would move),
		 * and `updateBackend` holds the installer to it before and after. Null for
		 * the modes whose environment the app owns, where the bundled `pip show` is
		 * the reading and nothing else needs one.
		 */
		installedInstallVersion: string | null;
		/**
		 * Whether this install IS one of the app's own, which changes what the panel
		 * may tell the reader to do about it.
		 *
		 * Travels as a field rather than being inferred from `updateCommand === ""`
		 * because an empty command has two producers with opposite next steps: this
		 * arm, where nothing the reader can run - or press - moves the environment,
		 * and the unclassifiable-install arm (`resolveGlobalInstallPlan`'s `unknown`
		 * kind), where the reader does have the tool they installed it with and a
		 * re-check can observe the change. The renderer's closing sentence is not the
		 * same sentence for both, and inferring it from an absent command is how the
		 * app-owned arm came to carry the manual panel's "then check for updates
		 * again" (review round 1, UX U1; R5).
		 */
		appOwned: boolean;
	}> {
		if (
			startupMode === LocalOperatorStartupMode.EXISTING_SERVER ||
			startupMode === LocalOperatorStartupMode.GLOBAL_INSTALL
		) {
			/*
			 * THE APP'S OWN ENVIRONMENT FIRST, and it names no installer.
			 *
			 * A root under `managed-python` is the app's: it built it from its own
			 * runtime seed, it records which environment is selected, and nothing
			 * outside that tree may be read, walked or removed. Every classification
			 * below would answer `pip` for it (it IS a pip venv - `pyvenv.cfg` and an
			 * `INSTALLER` of `pip`), and the pip arm's command is the one remedy that
			 * is a lie here: `pip install --upgrade` into the environment a live
			 * daemon is serving rewrites `site-packages` under a running process,
			 * which is the in-place rewrite the managed layout exists to avoid and
			 * which this app may not start on a user's behalf. So no command, and a
			 * sentence that says which install is behind instead.
			 *
			 * `canManageUpdate: false` because the app cannot move it FROM HERE: this
			 * is the arm for a server the app did not start, and the path that does
			 * own the environment is its own launch (`APP_BUNDLED_VENV`, below). The
			 * consequence is stated rather than softened: the fix is not a terminal
			 * command the reader can run.
			 *
			 * THE SENTENCE NAMES THE READER'S NEXT STEP RATHER THAN A CAPABILITY (review
			 * round 1, UX U1). It used to say "Local Operator updates that environment
			 * itself when it starts the server", which reads as either "it will fix
			 * itself" or "one more press" - and neither is true from this panel, because
			 * `prepareManagedPython` REUSES a ready generation and readiness never compares
			 * the recorded `backendVersion`, so a restart does not move an existing
			 * environment onto the published release. The route that does exist is the arm
			 * below: with nothing serving on this app's address, Local Operator starts its
			 * OWN daemon, and THAT server can be updated from here (`canManageUpdate: true`
			 * on `APP_BUNDLED_VENV`). Naming the route is the honest interim: the copy must
			 * not imply an action that does not exist, and it does not have to pretend the
			 * reader has no move either.
			 */
			if (serving.appOwned) {
				const detail = `The server serving this app runs from Local Operator's own managed environment at ${serving.prefix}, which the app owns rather than a package manager (the backend reports it as install kind "${serving.installKind || "not reported"}")${
					serving.version
						? `, at version ${serving.version}`
						: " and its installed version could not be read"
				}.`;
				logger.info(
					`External backend install (${startupMode}) runs from the app's own managed environment ` +
						`at ${serving.prefix}; no installer owns it, so the app names no command`,
					LogFileType.UPDATE_SERVICE,
				);
				return {
					canManageUpdate: false,
					updateCommand: "",
					remedy:
						"This server is running from Local Operator's own managed environment, which no package manager owns - so there is no terminal command that can update it correctly. The app can only update a server it started itself: stop this one, then start Local Operator again and let it start its own.",
					detail,
					sourceBuild: false,
					appOwned: true,
					installedInstallVersion: serving.version,
				};
			}

			/*
			 * The serving install's OWN identity when the server named one, and the
			 * shim's only as the fallback: a server that answers `/health` from a
			 * prefix is the install an update has to move, and classifying the shim
			 * instead is how a global install at the published version came to speak
			 * for an environment three releases behind it.
			 */
			const identity =
				(serving.prefix ? this.servingInstallIdentity(serving.prefix) : null) ??
				(await this.resolveInstallIdentity());
			const plan = resolveGlobalInstallPlan({ identity });
			logger.info(
				`External backend install (${startupMode}): ${plan.detail}; remedy is ` +
					`\`${plan.updateCommand || "nothing the app can name"}\`; install version ` +
					`${serving.version ?? identity.version ?? "unreadable"}`,
				LogFileType.UPDATE_SERVICE,
			);
			return {
				canManageUpdate: plan.canManageUpdate,
				updateCommand: plan.updateCommand,
				remedy: plan.remedy,
				detail: plan.detail,
				sourceBuild: plan.sourceBuild,
				appOwned: false,
				installedInstallVersion: serving.version ?? identity.version ?? null,
			};
		}

		return {
			canManageUpdate: true,
			updateCommand: "pip install --upgrade local-operator",
			remedy: "Updating the server will improve AI functionality.",
			detail: `The app started this server itself (${startupMode}).`,
			sourceBuild: false,
			/*
			 * `false` although this IS the app's own environment: the flag answers
			 * "may the manual panel tell the reader nothing here can move it", and on
			 * this arm the app moves it itself with the button above. It is the
			 * app-owned MANUAL arm that owns the sentence (review round 1, UX U1).
			 */
			appOwned: false,
			/*
			 * The app-managed environment's own on-disk version when the server named
			 * it, which is what an update moves: the check compares against the same
			 * install it would rewrite, so a landed update with a daemon still on the
			 * old build is visible as exactly that rather than as "nothing newer".
			 */
			installedInstallVersion: serving.version,
		};
	}

	/**
	 * Path the `local-operator` shim resolves to, or null when it is not installed.
	 *
	 * Sync on purpose: it runs once per backend check, and the answer decides
	 * which installer the prompt names, so the caller wants it before it builds
	 * the message rather than a promise to settle afterwards.
	 *
	 * It does NOT ask the shell's `which` on macOS: the app is normally started
	 * by Finder or `open`, whose PATH is the launchd default and does not contain
	 * `~/.local/bin` - so the uv tool install this whole classification exists to
	 * describe was invisible, and its remedy came out with no command in it.
	 * `resolveCommandPath` searches the standard install locations for the same
	 * markers (see `commandSearchDirs`). Windows keeps `where`, which already
	 * searches the machine's and the user's own install locations.
	 */
	private resolveLocalOperatorPath(): string | null {
		/*
		 * THE SAME RESOLUTION the decision, the ranking and the spawn use (reviews
		 * R1-6, R2-2): one helper, so an install whose `local-operator` console script
		 * is gone but whose `lop` remains is one install to all of them - on Windows
		 * too, where this used to probe a single name of its own while the spawn tried
		 * both.
		 */
		return resolveGlobalConsoleScript();
	}

	/**
	 * Everything `classifyGlobalInstall` needs to tell a uv tool install from a
	 * pipx one from an ordinary pip venv from the checkout a developer runs.
	 *
	 * The cheap signals are gathered first - `readInstallIdentity` reads the
	 * shim's path, its resolved target, its shebang and the dist-info's own
	 * markers - and the two CLI probes are skipped when a string test already
	 * answered: spawning `uv` and `pipx` on every backend check for a question
	 * three string tests settled is work nobody asked for.
	 */
	private async resolveInstallIdentity(): Promise<InstallIdentity> {
		const identity = readInstallIdentity(this.resolveLocalOperatorPath());
		if (identity.path && classifyGlobalInstall(identity) !== "global-unknown") {
			return identity;
		}
		/*
		 * Resolved the same way as the shims: a shell the app did not inherit also
		 * hides these two, and a probe that cannot be spawned is not evidence.
		 *
		 * ASYNC, and that is the point: this method runs on every backend check, and
		 * the synchronous form of it blocked the main thread for up to 5 s per probe
		 * (10 s for the pair) on any machine whose install the three string tests
		 * cannot classify - measured by review R1-4, which is the cost this fixes.
		 * Nothing above depends on the answer arriving in the same tick.
		 */
		const uv = resolveCommandPath("uv");
		const pipx = resolveCommandPath("pipx");
		const [uvToolList, pipxList] = await Promise.all([
			uv ? this.probeInstallerList(uv, ["tool", "list"]) : null,
			pipx ? this.probeInstallerList(pipx, ["list"]) : null,
		]);
		identity.uvToolList = uvToolList;
		identity.pipxList = pipxList;
		return identity;
	}

	/**
	 * What an installer's own list command answers, or null.
	 *
	 * ASYNC, and that is the R1-4 fix: this runs on every backend check for an
	 * install the three string tests cannot classify, and the synchronous form of it
	 * blocked the main thread for up to 5 s per probe - 10 s for the pair, with the
	 * window and every IPC channel frozen behind it. Review R1-4 measured it; the
	 * answer is identical, only the waiting is not done on the event loop.
	 *
	 * `runCommand` rather than a second runner, and with `pythonSpawnEnv()`: `uv` and
	 * `pipx` are python programs, so they get the same guarded environment every
	 * other python spawn here passes - which is what keeps bytecode they write out
	 * of the installed app.
	 */
	private async probeInstallerList(
		command: string,
		args: string[],
	): Promise<string | null> {
		const result = await runCommand(command, args, {
			timeoutMs: INSTALLER_PROBE_TIMEOUT_MS,
			env: this.pythonSpawnEnv(),
		});
		if (!result.ran) return null;
		const output = result.stdout.trim();
		return output.length > 0 ? output : null;
	}

	/**
	 * Check the installed server against the published release.
	 *
	 * @returns this channel's status and the offer it may carry. The renderer
	 *   events below are unchanged and still the thing a panel clears itself on;
	 *   the status is what keeps an "up to date" sentence off a check that
	 *   proved nothing, which is why "could not determine the version" returns
	 *   `unavailable` rather than the `current` it used to read as.
	 */
	public async checkForBackendUpdates(
		silent = false,
		/*
		 * The same fact as `checkForUpdates`'s, for the same reason: the three
		 * `backend-update-error` sends on the check path below are a failure REPORT,
		 * and a check nobody asked for does not get one. See that parameter's comment
		 * for the operator's rule.
		 */
		reportFailure = !silent,
	): Promise<BackendCheckReport> {
		logger.info(
			`Checking for backend updates... (silent mode: ${silent})`,
			LogFileType.UPDATE_SERVICE,
		);

		/*
		 * BEFORE anything is compared, and on every check rather than once at
		 * construction: the check is the first thing that runs after the renderer is
		 * listening (the offer appears seconds after the first frame), and this has to
		 * reach a surface. It reports at most once per attempt - the marker is cleared
		 * as soon as it is read - so a periodic check finding nothing left says
		 * nothing (UX U6).
		 */
		await this.reportUnattendedServerUpdate();

		try {
			// Handle dev mode case
			if (this.isDevMode) {
				logger.info(
					"Skip backend update check in dev mode unless forced",
					LogFileType.UPDATE_SERVICE,
				);

				if (
					!silent &&
					this.mainWindow &&
					!this.mainWindow.isDestroyed() &&
					this.mainWindow.webContents &&
					!this.mainWindow.webContents.isDestroyed()
				) {
					this.mainWindow.webContents.send(
						"backend-update-dev-mode",
						"Backend updates are disabled in development mode.",
					);
				}
				return { status: "unavailable", info: null };
			}

			// Check if we have a backend service and get its startup mode
			const startupMode =
				this.backendService?.getStartupMode() ||
				LocalOperatorStartupMode.NOT_STARTED;

			// If the server is not started, there's nothing to update
			if (startupMode === LocalOperatorStartupMode.NOT_STARTED) {
				logger.info(
					"No python server is available, nothing to check or update",
					LogFileType.UPDATE_SERVICE,
				);
				return { status: "unavailable", info: null };
			}

			/*
			 * A MACHINE THAT REPORTS NO NETWORK IS NOT ASKED ANYTHING. Both reads below
			 * spend a request - one against the local server, one against the published
			 * release - and the operator's log has this check's own failure beside the
			 * app channel's at the dark-wake instant (`Error fetching from PyPI: Error:
			 * getaddrinfo ENOTFOUND pypi.org`, same second). Skipping leaves the status
			 * `unavailable`, which is what a channel that did not find out reports.
			 *
			 * AND THIS CHANNEL DOES NOT REPORT THE STATE, even when the check was the
			 * user's: the app channel's ladder reaches the same reading first, fails with
			 * the same code and is what the renderer is answered with, so a report here
			 * would put a second sentence beside it for one condition (review round 2,
			 * R2-1's rule, applied to the other channel).
			 */
			if (!this.networkIsReachable()) {
				logger.info(
					"Skipping the server update check: this machine reports no network right now (net.isOnline() is false). The app channel owns the report; the next scheduled check will try again.",
					LogFileType.UPDATE_SERVICE,
				);
				return { status: "unavailable", info: null };
			}

			/*
			 * THE SERVING INSTALL IS READ FIRST, because it is what this check is about.
			 *
			 * `/health` names the process's version AND the install root it was started
			 * from (`prefix`, with the backend's own `install_kind` beside it), so the
			 * check can judge the install that is actually answering this app instead of
			 * whichever install the app can name from the `local-operator` shim on
			 * `PATH`. Those are different installs on exactly the machines this defect
			 * was reported on: a global uv-tool install at the published version, and an
			 * app-managed environment three releases behind serving the user - the check
			 * compared the first against PyPI, affirmed "up to date", and Settings'
			 * own row printed the second.
			 *
			 * Asked in this order rather than concurrently because both the plan and the
			 * verdict are statements ABOUT this reading, and a machine can rotate its
			 * daemon between two requests.
			 */
			const running = await this.readRunningBackend();
			const runningVersion = running.version;
			const serving = this.readServingInstall(running);
			const plan = await this.resolveBackendUpdatePlan(startupMode, serving);
			const latestVersion = await this.getLatestPypiVersion();
			// Remembered for the by-hand prompt: that event is produced from a click
			// rather than from a check, and it has to be able to name the published
			// release the user is working towards (review U17).
			if (latestVersion) this.lastPublishedBackendVersion = latestVersion;

			/*
			 * The version the OFFER and the comparison are about: the install that is
			 * SERVING this app when the server named it, which is what an update would
			 * move (`resolveBackendUpdatePlan` resolves exactly that subject, and falls
			 * back to the install the app can name only when the server did not report
			 * one - see its own comment). Read from the plan rather than re-derived here,
			 * so the panel, the installer and the check cannot disagree about which
			 * install this is.
			 *
			 * The running reading stands in when the install reports nothing. That is the
			 * same install rather than a substitute for it: the process executes the code
			 * in the prefix it names, so its reading is the install's version or older
			 * than it, never newer. The gates below are about the absence of a reading,
			 * so a fallback that answered "up to date" from a version nobody could read
			 * would be the one misreading they exist to prevent.
			 *
			 * AND ONLY WHEN THE SERVER NAMED ITS INSTALL, is the subject the install
			 * alone. Without a `prefix` the plan's identity fell back to the shim - the
			 * one install the app can still name a REMEDY for, but not necessarily the
			 * one answering the user - and this read that fallback's version as the
			 * subject, so the check offered an update for an install nothing was serving
			 * while the pane's own row printed the daemon: the reading pair the check
			 * exists to compare was two different installs (review round 1, R3 - the
			 * shape needs a backend older than v0.54.38, the release that added `prefix`
			 * to `/health`).
			 *
			 * What stands in is the NEWER of the two readings, not simply the running
			 * one, and both halves are load-bearing:
			 *
			 * - The running reading has to be able to raise the subject, because
			 *   otherwise the check offers an update while the version the user is
			 *   actually using is already at the published release - R3's own case
			 *   (`/health` 0.56.11, published 0.56.11, shim 0.56.8), where the offer
			 *   contradicted the pane beside it and the remedy it named was for an
			 *   install nothing was serving.
			 * - The named install has to be able to raise it too, because a daemon-only
			 *   subject makes `restart-required` unreachable on this path: with the shim
			 *   at the published release and the daemon behind it, the honest state is
			 *   "nothing to install, the process needs a restart" - and answering
			 *   `available` there offers the reader a remedy (the shim's own installer)
			 *   that is a no-op at the version it is already at, which is the loop this
			 *   check exists to keep out of the panel. The named install is also the only
			 *   reading that can be AHEAD of the published release, which is what keeps a
			 *   source build from being offered its own release.
			 */
			const installVersion = serving.prefix
				? plan.installedInstallVersion
				: newerReading(
						plan.installedInstallVersion,
						runningVersion,
						(candidate, subject) => this.isNewerVersion(candidate, subject),
					);
			const installedVersion =
				installVersion && isReadableVersion(installVersion)
					? installVersion
					: runningVersion;

			if (!installedVersion || !latestVersion) {
				logger.error(
					"Unable to determine backend versions.",
					LogFileType.UPDATE_SERVICE,
				);
				if (reportFailure) {
					this.sendToRenderer("backend-update-error", {
						message: "Unable to determine backend version.",
						phase: "check",
						logPath: serverUpdateLogPath(),
					});
				}
				return { status: "unavailable", info: null };
			}

			// "Unknown" is not a version older than the latest one - it is the
			// absence of a reading. Treating it as "needs update" is what produced a
			// pip command for a server whose version could not even be read.
			if (installedVersion === "Unknown") {
				logger.error(
					"The installed backend version could not be determined from the health endpoint.",
					LogFileType.UPDATE_SERVICE,
				);
				if (reportFailure) {
					this.sendToRenderer("backend-update-error", {
						message:
							"The installed server version could not be determined, so no update was offered. Restart the app to try again.",
						phase: "check",
						logPath: serverUpdateLogPath(),
					});
				}
				return { status: "unavailable", info: null };
			}

			/*
			 * A reading that ARRIVED but cannot be parsed is the same absence as one that
			 * never arrived (QA round 1, Q2): `999.invalid` installed against `0.54.43`
			 * published compared as not-newer - every `NaN` comparison in
			 * `isNewerVersion` is false - and the channel reported `current`, which
			 * affirmed that the whole installation was up to date from a health payload
			 * nobody could read.
			 *
			 * This gate sits AFTER the two branches above, not before them. Both of those
			 * describe an absent reading in its own words - no value at all, and the
			 * `"Unknown"` sentinel that an older server's health payload produces (see
			 * `getInstalledBackendVersion`) - and `isReadableVersion("Unknown")` is
			 * false, so a gate placed above them would answer for exactly the cases they
			 * exist to name and leave both unreachable while claiming they kept their own
			 * message (review round 3, R8). What is left for this gate is the ordinary
			 * case's leftovers: a value that arrived and cannot be parsed.
			 */
			const unreadable = [
				["installed", installedVersion as string | null],
				["published", latestVersion as string | null],
			].filter(([, value]) => !isReadableVersion(value));
			if (unreadable.length > 0) {
				logger.error(
					`Unable to read the ${unreadable
						.map(([which]) => which)
						.join(
							" and ",
						)} server version (installed: ${installedVersion}, published: ${latestVersion}); no status is reported rather than comparing an unreadable reading.`,
					LogFileType.UPDATE_SERVICE,
				);
				if (reportFailure) {
					this.sendToRenderer("backend-update-error", {
						message: "Unable to determine backend version.",
						phase: "check",
						logPath: serverUpdateLogPath(),
					});
				}
				return { status: "unavailable", info: null };
			}

			/*
			 * THE ONE DECISION, from the one rule that owns it
			 * (`src/main/update-check-verdict.ts`): what this channel may say about the
			 * install serving this app and the process running it. `isNewerVersion` is
			 * handed in rather than re-implemented there, so the app keeps a single
			 * ordering for its update decisions - including the four-part releases the
			 * backend has published.
			 */
			const channel = serverChannelVerdict({
				installVersion,
				runningVersion,
				publishedVersion: latestVersion,
				isNewer: (candidate, subject) =>
					this.isNewerVersion(candidate, subject),
			});
			const shouldUpdate = channel.status === "available";

			// Both readings on one line, deliberately: they disagree in exactly one
			// situation that matters - after an update has landed on disk and before
			// the daemon that serves it has been restarted - and when they do, the
			// check has to be answerable from the log. The install ROOT is on the line
			// too, because the defect this check was reporting on was a comparison
			// against an install that was not the one answering.
			logger.info(
				`Install on disk reports: ${installVersion ?? "no reading"} (at ${serving.prefix ?? "an install the server did not name"}), running backend reports: ${runningVersion ?? "no reading"}, Latest: ${latestVersion}, Update needed: ${shouldUpdate}, Server channel: ${channel.status} (${channel.state}), Startup mode: ${startupMode}`,
				LogFileType.UPDATE_SERVICE,
			);

			logger.info(
				`Installed backend version: ${installedVersion}, Latest: ${latestVersion}, Update needed: ${shouldUpdate}, Startup mode: ${startupMode}`,
				LogFileType.UPDATE_SERVICE,
			);

			if (channel.state === "restart-required") {
				/*
				 * THE INSTALL IS CURRENT AND THE SERVER IS NOT (status
				 * `restart-required`, which earns no affirmation).
				 *
				 * Nothing to install, so there is no offer: the only thing that closes
				 * the gap is a restart of the process serving this app, and the notice
				 * below is the surface that can say so. It is NOT a `current` check:
				 * the whole installation is not up to date while the build the reader is
				 * talking to trails the published release, and saying so was the
				 * contradiction the reported defect produced.
				 */
				logger.info(
					`The install is current (${installedVersion}) and the server serving this app runs ${runningVersion}; a restart of that server picks the installed build up.`,
					LogFileType.UPDATE_SERVICE,
				);
			}

			/*
			 * The third reading, and the one nothing used to compare: what the process
			 * SERVING this app booted with. `installVersion` is the install on disk (the
			 * plan's own reading, never `/health`'s - see `backend-version-drift.ts` for
			 * why that field cannot see a stale process), and when the two disagree with
			 * the process older, the installed code is not what is serving.
			 *
			 * Before the offer below, because the drift is about the code that is
			 * INSTALLED and is true whether or not a newer release is also published: a
			 * machine can be offered an update it will not press while the daemon goes on
			 * serving a build the disk left behind.
			 */
			await this.settleBackendVersionDrift(installVersion);

			if (shouldUpdate) {
				logger.info(
					`New backend version available: ${latestVersion} (installed: ${installedVersion})`,
					LogFileType.UPDATE_SERVICE,
				);

				const updateInfo: BackendUpdateInfo = {
					currentVersion: installedVersion,
					latestVersion,
					runningVersion,
					updateCommand: plan.updateCommand,
					canManageUpdate: plan.canManageUpdate,
					appOwned: plan.appOwned,
					startupMode,
					remedy: plan.remedy,
					detail: plan.detail,
					sourceBuild: plan.sourceBuild,
					/*
					 * WHO THE APP WOULD RESTART, on the panel where the user decides (UX U9).
					 *
					 * The managed arm's consequence sentence comes from the plan, and the plan is
					 * an INSTALL classification - it cannot know whether the daemon serving this
					 * app is one the app started. On a machine where discovery ADOPTED a server,
					 * the offer therefore promised a restart that cannot happen, and the app's
					 * own completion notice then said the opposite ("Local Operator does not
					 * restart a server it did not start"). The sentence is right for the arm it
					 * was written for; what was missing is the reading that decides it, which the
					 * other two events already carry. It travels here too.
					 */
					restartable: this.backendIsAppOwned(),
					/* `silent` is the whole difference between the two callers: the periodic
					   and start-up checks pass `true`, the IPC handlers behind the buttons
					   pass `false`. The renderer needs to know which one it is answering,
					   because the by-hand panel's instruction deliberately outlives a
					   background check and is only ended by a check the user asked for
					   (review U12, round 3). */
					manual: !silent,
				};

				logger.info(
					`Sending backend-update-available event with info: ${JSON.stringify(updateInfo)}`,
					LogFileType.UPDATE_SERVICE,
				);
				this.sendToRenderer("backend-update-available", updateInfo);

				return { status: "available", info: updateInfo };
			}

			logger.info(
				`No new backend version available. (installed: ${installedVersion}, latest: ${latestVersion})`,
				LogFileType.UPDATE_SERVICE,
			);

			/*
			 * WHO HEARS THIS, and why a SILENT check can still speak (UX U10).
			 *
			 * A launch and a periodic check are silent, and silence used to swallow this
			 * event along with everything else it suppresses - so the one state with no
			 * other surface to say it (install current, the daemon serving the app a build
			 * behind) was invisible until the user happened to press Check for updates.
			 * That is Q-1's discoverability half surviving Q-1's fix: the launch that
			 * follows such an update ran the check and reached the renderer with nothing.
			 *
			 * So the READINGS decide, not the caller: when the two disagree, this event is
			 * sent even on a silent pass, because the disagreement is the fact no other
			 * surface carries. Everything else a silent check could say stays suppressed,
			 * and the renderer's own guard keeps a pair that agrees silent - so an
			 * equal-reading machine still hears nothing from a launch.
			 *
			 * The two readings here are the SERVING install's and the process's, which is
			 * the pair the notice is about ("the server is on an older build than the
			 * install"): a check that compared an unrelated install and then announced a
			 * skew between it and the daemon would be reporting a disagreement the reader
			 * cannot act on.
			 */
			const readingsDiffer =
				installedVersion !== null &&
				runningVersion !== null &&
				isReadableVersion(installedVersion) &&
				isReadableVersion(runningVersion) &&
				installedVersion.trim() !== runningVersion.trim();
			if (
				(!silent || readingsDiffer) &&
				this.mainWindow &&
				!this.mainWindow.isDestroyed() &&
				this.mainWindow.webContents &&
				!this.mainWindow.webContents.isDestroyed()
			) {
				this.mainWindow.webContents.send("backend-update-not-available", {
					version: installedVersion,
					/*
					 * The second reading travels on THIS state too, which is the one QA
					 * Q-1 found: an install already at the published version whose daemon
					 * still serves the old build offers nothing, so the offer's detail was
					 * never rendered and the user was told nothing at all - while the log
					 * carried both readings and Settings could name the daemon. It is the
					 * state design §5 exists for (right after a landed install, before the
					 * restart), and no later check re-offers it, because the install itself
					 * is up to date.
					 */
					runningVersion,
					/** Whether the app may restart the daemon that is behind. */
					restartable: this.backendIsAppOwned(),
				});
			}

			/*
			 * `current` or `restart-required`, and never `unavailable`: the three
			 * absences above return before this line, and a check that reached here has
			 * two readable readings and a published release. `restart-required` is what
			 * keeps the whole check's affirmation off a machine whose server trails the
			 * install on disk.
			 */
			return { status: channel.status, info: null };
		} catch (error) {
			logger.error(
				"Error checking for backend updates:",
				LogFileType.UPDATE_SERVICE,
				error,
			);

			if (
				!silent &&
				this.mainWindow &&
				!this.mainWindow.isDestroyed() &&
				this.mainWindow.webContents &&
				!this.mainWindow.webContents.isDestroyed()
			) {
				this.mainWindow.webContents.send("backend-update-error", {
					/*
					 * Cleaned at the source, the same way the app channel's report is:
					 * this channel's real strings are Node errno forms, and a wrapped
					 * one carries the inner `Error: ` prefix into the sentence a person
					 * reads. The renderer maps what is left to a sentence; this is what
					 * keeps that sentence's machine line readable.
					 */
					message: stripErrorPrefixes((error as Error).message),
					phase: "check",
					logPath: serverUpdateLogPath(),
				});
			}

			// A failed check is not "the server is current": the panel's copy and
			// the pip fallback used to be offered either way, and the affirmation
			// used to be earned either way.
			return { status: "unavailable", info: null };
		}
	}

	/**
	 * Update the backend using pip and restart the backend service
	 * @returns Promise resolving to true if update was successful, false otherwise
	 */
	/** The version the bundled environment has installed, via `pip show`. */
	private async readBundledBackendVersion(
		pythonPath: string,
	): Promise<string | null> {
		const probe = await runCommand(
			pythonPath,
			["-m", "pip", "show", "local-operator"],
			{ timeoutMs: 120000, env: this.pythonSpawnEnv() },
		);
		if (probe.exitCode !== 0) {
			logger.warn(
				`pip show local-operator exited ${probe.exitCode}: ${(probe.stderr || probe.stdout).trim()}`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}
		return parsePipShowVersion(probe.stdout);
	}

	/**
	 * Do something about a daemon that booted from a build older than the install.
	 *
	 * The defect: the process serving this app can be running code the disk has
	 * already replaced, and nothing in the check used to look. The install moved, the
	 * daemon kept serving its in-memory build, and the app reported the install up to
	 * date - so a fix that had shipped was not in effect (see
	 * `backend-version-drift.ts` for the incident, and for why `/health`'s version
	 * cannot see this).
	 *
	 * The action is the lifecycle's own restart, gated by the pure decision next to
	 * the readings: only a daemon this app started is restarted, nothing is touched
	 * while the update flow is mid-flight or while a conversation is being watched
	 * (for one cycle - see `DRIFT_DEFERRALS_BEFORE_RESTART`), and a pair already
	 * restarted for is not restarted again, because a skew a restart did not fix
	 * would otherwise become a five-minute kill loop.
	 *
	 * Incapable of failing the check: every branch logs and returns. A check whose
	 * verdict is "the install is current" must not become an error because the
	 * daemon could not be moved onto it.
	 */
	private async settleBackendVersionDrift(
		installVersion: string | null,
	): Promise<void> {
		const bootVersion = this.backendService?.getAttachedBootVersion() ?? null;
		const drift = backendVersionDrift(bootVersion, installVersion);
		if (drift.kind !== "stale") {
			// Nothing to act on: the readings agree, or one of them is missing and the
			// pure decision has already said which. The deferral count belongs to a
			// skew, so it resets here.
			this.driftDeferrals = 0;
			return;
		}

		const pair = `${drift.bootVersion} -> ${drift.installVersion}`;
		if (this.driftRestartedFor === pair) {
			logger.warn(
				`The server is still on ${drift.bootVersion} after being restarted for install ${drift.installVersion}; not restarting it again (a restart that does not move it would become a kill loop every check).`,
				LogFileType.UPDATE_SERVICE,
			);
			return;
		}

		const decision = driftRestartDecision({
			drift,
			appOwned: this.backendIsAppOwned(),
			sessionStreamOpen: this.backendService?.hasOpenSessionStreams() ?? false,
			updateInFlight: this.backendService?.checkIsAutoUpdating() ?? false,
			deferrals: this.driftDeferrals,
		});

		if (!decision.restart) {
			// Only the stream hold is a deferral; the other two are refusals, and a
			// refusal must not leave a count that makes the next check restart anyway.
			this.driftDeferrals =
				decision.because === "session-stream-open"
					? this.driftDeferrals + 1
					: 0;
			logger.info(
				`The server serving this app booted on ${drift.bootVersion} while the install on disk is ${drift.installVersion}; ${DRIFT_HOLD_REPORT[decision.because]}`,
				LogFileType.UPDATE_SERVICE,
			);
			return;
		}

		this.driftDeferrals = 0;
		this.driftRestartedFor = pair;
		logger.info(
			`The server serving this app booted on ${drift.bootVersion} while the install on disk is ${drift.installVersion}; restarting the server this app started so the installed build serves.`,
			LogFileType.UPDATE_SERVICE,
		);
		await this.restartBackendForVersionDrift(drift);
	}

	/**
	 * Restart the daemon this app owns so the install on disk takes effect.
	 *
	 * `restart()` rather than `start()`, and that is not a style choice:
	 * `startOwned` returns the running state untouched when a generation is already
	 * owned, so a `start()` here would report success while the old process kept
	 * serving - which is the defect, not the repair. `restart()` is the same
	 * stop-then-start the post-install path uses.
	 */
	private async restartBackendForVersionDrift(drift: {
		bootVersion: string;
		installVersion: string;
	}): Promise<void> {
		try {
			const restarted = await this.backendService?.restart();
			if (!restarted) {
				logger.error(
					`The server did not come back after being restarted to pick up install ${drift.installVersion}; it booted on ${drift.bootVersion} and is not serving.`,
					LogFileType.UPDATE_SERVICE,
				);
				return;
			}
			/*
			 * What was OBSERVED after, not what was hoped for: the settled reading is the
			 * successor process's own record, and the health probe is a separate fact
			 * from it. A restart that came back on the same build is the case this line
			 * exists to make visible in the log rather than in a claim.
			 */
			const settledBoot = this.backendService?.getAttachedBootVersion() ?? null;
			const healthy = await this.checkBackendHealth();
			logger.info(
				`Restarted the server onto the installed build: it booted on ${settledBoot ?? "a reading that could not be taken"} (was ${drift.bootVersion}, install is ${drift.installVersion}) and its health probe ${healthy ? "answered" : "did not answer"}.`,
				LogFileType.UPDATE_SERVICE,
			);
		} catch (error) {
			logger.error(
				"Could not restart the server to pick up the installed build:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
		}
	}

	/**
	 * Bring the previous server back after a failed upgrade, and say whether it
	 * actually came back.
	 *
	 * A failure here must not leave the user with no backend at all: whatever pip
	 * did or did not do, the environment usually still holds a working install, so
	 * start it again and then ask /health rather than assuming. The answer is not
	 * cosmetic: `pip install --upgrade` uninstalls before it installs, so a
	 * mid-install failure can leave the package absent, and telling the user "the
	 * previous server is still running" when it is not is a claim we had no
	 * evidence for (review R6).
	 */
	private async restartBackendAfterFailedUpgrade(): Promise<boolean> {
		try {
			await this.backendService?.start();
			const healthy = await this.checkBackendHealth();
			logger.info(
				healthy
					? "Restarted the previous backend after a failed update"
					: "The backend did not answer its health check after a failed update",
				LogFileType.UPDATE_SERVICE,
			);
			return healthy;
		} catch (error) {
			logger.error(
				"Could not restart the backend after a failed update:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			return false;
		}
	}

	/**
	 * Poll /health until it reports `targetVersion`, bounded by a timeout.
	 *
	 * Returns null when the version never matched (or could not be read), which
	 * the caller reports as a failure rather than as a completed update.
	 */
	private async waitForBackendVersion(
		target: string | null,
		timeoutMs = 60000,
		intervalMs = 2000,
	): Promise<string | null> {
		const deadline = Date.now() + timeoutMs;
		let last: string | null = null;
		while (Date.now() < deadline) {
			const version = await this.getInstalledBackendVersion();
			if (version && version !== "Unknown") {
				last = version;
				if (target == null) return version;
				/*
				 * AT OR PAST the target, the same rule the landing check states (review
				 * R2-1, and the same scenario): the app names the version the CHECK read
				 * off PyPI, and `lop update` installs whatever PyPI has when it RUNS - so
				 * a release published between the offer and the click comes back one past
				 * the string that was asked for, and equality here failed a restart that
				 * had landed ("The server restarted but did not report version 0.56.0"),
				 * one step after the landing rule stopped doing the same thing. An
				 * unorderable reading falls back to equality rather than being accepted:
				 * this cannot order it, so it cannot call it at the target.
				 */
				const order = compareVersions(version, target);
				if (order === null ? version.trim() === target.trim() : order >= 0) {
					return version;
				}
			}
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}
		logger.warn(
			`Backend version poll timed out after ${timeoutMs}ms (target ${target ?? "any"}, last seen ${last ?? "none"})`,
			LogFileType.UPDATE_SERVICE,
		);
		return null;
	}

	/**
	 * Whether the daemon serving this app is one the APP may restart.
	 *
	 * The answer decides what the skew notice can tell the user to do about a server
	 * still on the old build: an owned daemon is the app's to bounce (so the sentence
	 * names restarting Local Operator, which is an action), while an adopted one is
	 * not (so the sentence says the app will not, which is a fact about what the
	 * reader should expect). Getting this wrong is not cosmetic - the notice would
	 * tell a user of an app-owned daemon that nothing will ever move it.
	 */
	private backendIsAppOwned(): boolean {
		return (
			this.backendService !== null &&
			!this.backendService.isUsingExternalBackend()
		);
	}

	/**
	 * The version the resolved global install reports on disk, or null.
	 *
	 * Shell-free, and deliberately a different read from the running backend's
	 * `/health`: the install is what an update moves, and immediately after one it
	 * is the only reading that has moved - the daemon lags until it is restarted.
	 * Read through the same resolution the plan classified, because it is half of
	 * the evidence that the install changed at all.
	 */
	private readGlobalInstallVersion(): string | null {
		return (
			readInstallIdentity(this.resolveLocalOperatorPath())?.version ?? null
		);
	}

	/**
	 * Run the install's own front end: `<resolved shim> update`.
	 *
	 * WHY THIS AND NOT AN INSTALLER. The mechanism that owns a uv tool install is
	 * `lop update`: it detects the install kind, honours the `editable`/`unknown`
	 * refusals, writes the `.lop-source` marker runtimes converge on, prunes the
	 * generations nothing refers to, and refreshes the daemons it supervises. An
	 * app that ran `uv` itself would bypass every one of those, and the two
	 * commands this path used to name are the ones the harness documents as
	 * failing (`uv tool upgrade` on a pinned receipt or a git snapshot) or as
	 * belonging to another audience (`lop-update`, the release owner's
	 * build-from-checkout script, which refuses when its ref has diverged).
	 *
	 * THE PATH IS BUILT, NOT INHERITED. `lop update` reaches `uv` by bare name
	 * through the child's environment, and this app is normally launched by Finder
	 * with `/usr/bin:/bin:/usr/sbin:/sbin` - on this machine `uv` is
	 * `/opt/homebrew/bin/uv`. Without `installerSearchPath` the feature fails with
	 * an `installer exited 127` that reads as an installer bug.
	 *
	 * The cwd is the user's home: a neutral directory, never the app's resources
	 * dir, so an installer that resolves a relative path from where it stands
	 * cannot land inside the sealed bundle. `shell: true` is never used - this is a
	 * resolved shim path, not a command line.
	 */
	private async runGlobalUpdate(consolePath: string): Promise<{
		exitCode: number;
		stdout: string;
		stderr: string;
		ran: boolean;
	}> {
		// The same bytecode-cache discipline the pip path uses (`pythonSpawnEnv`),
		// because the child is another Python process this app is responsible for -
		// plus the ONE entry it needs on top of it: the PATH its own installer lookup
		// reads. See `installerSearchPath` for why the child cannot inherit it.
		const updatePath = installerSearchPath(process.env, homedir());
		logger.info(
			`Executing the install's own updater: ${consolePath} update (PATH: ${updatePath})`,
			LogFileType.UPDATE_SERVICE,
		);
		const run = await runCommand(consolePath, ["update"], {
			timeoutMs: 15 * 60 * 1000,
			env: { ...this.pythonSpawnEnv(), PATH: updatePath },
		});
		// Both streams, both to the update service log: the installer's own output is
		// the only thing that can say WHY it refused, and the panel's error line is a
		// tail of it. Same capture discipline as the pip branch.
		logger.info(
			`lop update stdout: ${run.stdout.trim() || "(empty)"}`,
			LogFileType.UPDATE_SERVICE,
		);
		if (run.stderr.trim().length > 0) {
			logger.warn(
				`lop update stderr: ${run.stderr.trim()}`,
				LogFileType.UPDATE_SERVICE,
			);
		}
		return run;
	}

	/**
	 * True while an app-driven update of the global install is running.
	 *
	 * The guard is here and not on the surfaces that ask for the update, because
	 * their flags are per-surface: the offer holds `checking` and the run panel holds
	 * `updatingBackend`, so a press on each of them reached `updateGlobalInstall`
	 * twice and the second `lop update` ran beside the first against one install root
	 * (review R1-8). The bundled path never needed one because it stops the backend
	 * first, which serialises it by accident; nothing on this path stops anything.
	 */
	private globalUpdateInFlight = false;

	/**
	 * Update the resolved global install, then restart the daemon this app owns.
	 *
	 * ORDERING IS THE POINT, and it is the opposite of the bundled path: that one
	 * stops the backend BEFORE pip because pip replaces the environment the daemon
	 * runs from. Under generations the install lands in a new tree, the pointer
	 * flips, and no running process's tree is touched - so the install cannot fail
	 * the daemon, and stopping first would throw away in-flight work for the whole
	 * install to buy nothing. Install, verify, restart. A failed install therefore
	 * leaves a daemon that never stopped serving.
	 *
	 * `landed` is a READING, not an exit code: `lop update` exits 0 in its "already
	 * latest" case too, so the app holds the install's own version to the target
	 * exactly as the pip path does (`didUpgradeLand`).
	 */
	private async updateGlobalInstall(
		backend: BackendServiceManager,
		plan: { installedInstallVersion: string | null },
		target: string | null,
	): Promise<boolean> {
		if (this.globalUpdateInFlight) {
			logger.warn(
				"A global install update is already running; refusing to start a second beside it",
				LogFileType.UPDATE_SERVICE,
			);
			this.sendToRenderer("backend-update-error", {
				message:
					"A server update is already running. Let it finish before starting another.",
				phase: "update",
				logPath: serverUpdateLogPath(),
			});
			return false;
		}
		this.globalUpdateInFlight = true;
		try {
			return await this.runGlobalUpdateAttempt(backend, plan, target);
		} finally {
			this.globalUpdateInFlight = false;
		}
	}

	/** The attempt itself, under the guard above. */
	private async runGlobalUpdateAttempt(
		backend: BackendServiceManager,
		plan: { installedInstallVersion: string | null },
		target: string | null,
	): Promise<boolean> {
		// The same resolution the plan classified - not a fresh lookup and not the
		// `lop` name either: the app has to run the front end of the install it is
		// about to hold to the result, or it updates one tree and verifies another.
		const consolePath = this.resolveLocalOperatorPath();
		if (!consolePath) {
			this.sendToRenderer("backend-update-error", {
				message:
					"The global install could not be found on this machine, so the update did not run. See the update service log.",
				phase: "update",
				logPath: serverUpdateLogPath(),
			});
			return false;
		}

		// Re-read rather than trusting the plan's reading: a check and a click can be
		// minutes apart, and `before` is half of the only evidence that anything
		// moved.
		const before =
			this.readGlobalInstallVersion() ?? plan.installedInstallVersion;
		/*
		 * The phase is announced BEFORE the child starts, because on a realistic cold
		 * cache the install is ~47 s and the restart ~15 s of one unchanging panel:
		 * the bar animated and nothing else moved, so a user could not tell a working
		 * install from a hung one, and the panel's only cost claim ("will temporarily
		 * go offline") described the phase that had not started yet (UX U4).
		 */
		this.sendToRenderer("backend-update-progress", { phase: "installing" });
		/*
		 * The durable record of an attempt that nobody is watching (UX U6). It is
		 * written BEFORE the spawn because the case it exists for is the app dying
		 * while the child keeps running - measured: killed 10 s in, the installer
		 * finished on its own, created a generation and flipped the pointer with no app
		 * alive, and the next launch read that as the state it had always been in. It
		 * is cleared as soon as this attempt reaches its own verdict, which is the
		 * only thing that makes it mean "nobody saw this end".
		 */
		writePendingServerUpdateMarker(this.markerDir(), {
			before,
			target,
			startedAt: new Date().toISOString(),
		});
		const run = await this.runGlobalUpdate(consolePath);
		const after = this.readGlobalInstallVersion();
		// The verdict is in THIS process, so the marker's remaining job is gone: the
		// panel carries the outcome, and a later launch must not report it twice.
		clearPendingServerUpdateMarker(this.markerDir());
		const landed =
			run.exitCode === 0 && didUpgradeLand({ before, after, target });
		if (!landed) {
			const running = await this.getInstalledBackendVersion();
			const tail = stderrTail(run.stderr);
			logger.error(
				`Global install update did not land (exited ${run.exitCode}, ran ${run.ran}): ${before ?? "unknown"} -> ${after ?? "unknown"}, running backend reports ${running ?? "no reading"}`,
				LogFileType.UPDATE_SERVICE,
			);
			// Nothing moved, so nothing is restarted: the daemon that was serving is
			// still serving, on the build it loaded.
			this.sendToRenderer("backend-update-error", {
				message: `${
					!run.ran
						? "The server update did not finish: the installer could not be run to a verdict or timed out."
						: run.exitCode !== 0
							? `The server update did not install: \`lop update\` exited ${run.exitCode}.`
							: `The server update to ${target ?? "the new release"} did not take effect: the install still reports ${after ?? before ?? "its previous version"}.`
				} The running backend is still serving${running ? ` version ${running}` : ""}; see the update service log for the installer's output.${tail ? `\n\n${tail}` : ""}`,
				phase: "update",
				logPath: serverUpdateLogPath(),
			});
			return false;
		}

		logger.info(
			`Global install updated: ${before ?? "unknown"} -> ${after ?? "unknown"}`,
			LogFileType.UPDATE_SERVICE,
		);

		/*
		 * A daemon this app did not start is NOT the app's to bounce. It keeps
		 * serving the build it loaded - the backend refuses the handover contract in
		 * production (`local_operator/server/retire.py`), and this app's own
		 * observation of the build announcement deliberately does not act on it - so
		 * the app reports the skew and leaves the process alone. A supervised daemon
		 * has already been refreshed by `lop update` itself
		 * (`refresh_daemons_after_upgrade`), and the existing probe loop re-attaches.
		 */
		if (backend.isUsingExternalBackend()) {
			const running = await this.getInstalledBackendVersion();
			logger.info(
				`Install moved to ${after ?? "unknown"}; the attached backend still reports ${running ?? "no reading"}`,
				LogFileType.UPDATE_SERVICE,
			);
			/*
			 * BOTH readings travel, and both surface: this used to log the skew and send
			 * a null payload, so the renderer answered with "Server update completed
			 * successfully" and a six-second toast while the daemon the user was talking
			 * to kept serving the old build, with nothing else ever saying so - the
			 * install is now latest, so no later check re-offers it (review R1-3,
			 * QA Q-2, UX U1). `restarted: false` is the whole reason the panel has
			 * something to say: the app deliberately does not bounce a daemon it did not
			 * start, so the honest report is "the install moved; this server has not".
			 */
			this.sendToRenderer("backend-update-completed", {
				installVersion: after,
				runningVersion: running,
				restarted: false,
				restartable: this.backendIsAppOwned(),
			});
			return true;
		}

		// The app owns this daemon, so it is the one process that has to move onto
		// the new build - and the same tail the bundled path runs: restart, health,
		// hold the reported version to the target, then announce.
		logger.info(
			"Restarting backend service onto the updated install...",
			LogFileType.UPDATE_SERVICE,
		);
		this.sendToRenderer("backend-update-progress", { phase: "restarting" });
		backend.setAutoUpdating(true);
		const restartSuccess = await backend.restart();
		backend.setAutoUpdating(false);
		if (!restartSuccess) {
			logger.error(
				"Backend service restart failed after the global install update",
				LogFileType.UPDATE_SERVICE,
			);
			this.sendToRenderer("backend-update-error", {
				message:
					"The server was updated but the backend did not restart. Restart Local Operator to run the new version.",
				phase: "update",
				logPath: serverUpdateLogPath(),
			});
			return false;
		}
		const healthy = await this.checkBackendHealth();
		if (!healthy) {
			logger.error(
				"Backend service restarted but the health check failed; retrying once",
				LogFileType.UPDATE_SERVICE,
			);
			await backend.start();
			if (!(await this.checkBackendHealth())) {
				this.sendToRenderer("backend-update-error", {
					message:
						"The server was updated but the backend did not restart properly. Restart Local Operator to run the new version.",
					phase: "update",
					logPath: serverUpdateLogPath(),
				});
				return false;
			}
		}
		const reported = await this.waitForBackendVersion(target);
		if (reported === null) {
			logger.error(
				`Backend restarted onto the updated install but did not report ${target ?? "the target version"}`,
				LogFileType.UPDATE_SERVICE,
			);
			this.sendToRenderer("backend-update-error", {
				message: `The server restarted but did not report ${target ? `version ${target}` : "the updated version"}. See the update service log, then restart Local Operator.`,
				phase: "update",
				logPath: serverUpdateLogPath(),
			});
			return false;
		}
		logger.info(
			`Backend reports version ${reported} after the global install update`,
			LogFileType.UPDATE_SERVICE,
		);
		this.sendToRenderer("backend-update-completed", {
			installVersion: after,
			runningVersion: reported,
			restarted: true,
		});
		return true;
	}

	/**
	 * Report a server update that landed while no app was supervising it.
	 *
	 * The other half of UX U6: the marker above survives exactly when the app died
	 * mid-attempt, and the installer is a child that outlives its parent, so the
	 * update can land with nothing watching. The end state is coherent on its own -
	 * the app comes up on the new build and reports it - which is why this reports
	 * the fact ONCE rather than treating a stale marker as a failure: there is no
	 * remedy to offer and no version to hold anyone to, only a sentence the user has
	 * never seen about an update they started.
	 *
	 * Cleared either way: a marker whose install did NOT move describes an
	 * interrupted attempt whose reason is in the log, and re-reporting it on every
	 * launch would be a permanent warning about a state the app has since read
	 * correctly (and the failure path keeps no record for the app to re-read).
	 */
	private async reportUnattendedServerUpdate(): Promise<void> {
		const marker = readPendingServerUpdateMarker(this.markerDir());
		if (!marker) return;
		const after = this.readGlobalInstallVersion();
		clearPendingServerUpdateMarker(this.markerDir());
		if (!after || after === marker.before) {
			logger.info(
				`A server update started at ${marker.startedAt} did not move the install (still ${after ?? "no reading"}); nothing to report on this launch`,
				LogFileType.UPDATE_SERVICE,
			);
			return;
		}
		/*
		 * THE SERVING DAEMON'S OWN READING, and this is UX U14's cause. The event
		 * used to carry `runningVersion: null` deliberately, on the reasoning that the
		 * attempt landed while nothing was watching - so the renderer had no reading
		 * to compare the install against and announced a skew it could not see. On the
		 * ordinary graceful-quit path the app comes back and spawns its daemon from
		 * the landed install (the reading is the install's own version), while the
		 * panel headed itself "The server is on an older build than the install" and
		 * told the user to restart the app that was painting it - with Settings one
		 * second later reading the new version.
		 *
		 * The read is the same one the check uses, taken at the same moment (the app's
		 * backend is up by now: discovery runs before the first check), so the
		 * renderer's own guard can say whether the two readings actually differ and
		 * stay silent when they agree. Unreadable stays null, and null is silence: the
		 * panel may not claim a skew it cannot see.
		 */
		const running = await this.getInstalledBackendVersion();
		logger.info(
			`A server update that no app was supervising landed: ${marker.before ?? "unknown"} -> ${after}; the backend serving this launch reports ${running ?? "no reading"}`,
			LogFileType.UPDATE_SERVICE,
		);
		this.sendToRenderer("backend-update-completed", {
			installVersion: after,
			runningVersion: running,
			restarted: false,
			unattended: true,
			restartable: this.backendIsAppOwned(),
			before: marker.before,
		});
	}

	public async updateBackend(targetVersion?: string): Promise<boolean> {
		logger.info("Updating backend...", LogFileType.UPDATE_SERVICE);

		try {
			// Check if we have a backend service and get its startup mode
			if (!this.backendService) {
				logger.error(
					"No backend service reference available, cannot update",
					LogFileType.UPDATE_SERVICE,
				);
				if (
					this.mainWindow &&
					!this.mainWindow.isDestroyed() &&
					this.mainWindow.webContents &&
					!this.mainWindow.webContents.isDestroyed()
				) {
					this.mainWindow.webContents.send("backend-update-error", {
						message: "No backend service reference available, cannot update.",
						phase: "update",
						logPath: serverUpdateLogPath(),
					});
				}
				return false;
			}

			const startupMode = this.backendService.getStartupMode();

			/*
			 * THE SAME SUBJECT THE OFFER NAMED. The plan is resolved for the install
			 * that is serving this app, read from `/health` the way the check reads
			 * it, because the action has to be about the install the panel described:
			 * resolving it from the shim on `PATH` while a different install serves
			 * the user is how pressing the button would run a command for an install
			 * that is already current.
			 */
			const running = await this.readRunningBackend();
			const serving = this.readServingInstall(running);

			// Handle different startup modes
			switch (startupMode) {
				case LocalOperatorStartupMode.NOT_STARTED:
					logger.info(
						"No python server is available, nothing to update",
						LogFileType.UPDATE_SERVICE,
					);
					if (
						this.mainWindow &&
						!this.mainWindow.isDestroyed() &&
						this.mainWindow.webContents &&
						!this.mainWindow.webContents.isDestroyed()
					) {
						this.mainWindow.webContents.send("backend-update-error", {
							message: "No python server is available, nothing to update.",
							phase: "update",
							logPath: serverUpdateLogPath(),
						});
					}
					return false;

				case LocalOperatorStartupMode.EXISTING_SERVER:
				case LocalOperatorStartupMode.GLOBAL_INSTALL: {
					// Both are environments the app does not own, and the operator's own
					// report is the one that mattered: a uv tool install told to run
					// `pip install --upgrade`. The plan classifies the install from what
					// it actually is (the shim's target, the script's shebang, uv's
					// receipt, the installers' own listings, the dist-info's own markers)
					// and names the command that owns it - or names none, rather than
					// defaulting to pip (reviews R10, U4, D4, R13, Q5).
					const plan = await this.resolveBackendUpdatePlan(
						startupMode,
						serving,
					);
					// The caller's target when it named one (the "Update server" button
					// does), otherwise the published release the last check read: the
					// compatibility banner calls this with no target at all, and the
					// panel's version sentence then had nothing to render on the path
					// that actually produces it (review U17).
					const target =
						targetVersion ?? this.lastPublishedBackendVersion ?? null;

					if (plan.canManageUpdate) {
						/*
						 * The app runs the install's own updater. This is the ONE branch that
						 * may start an install without stopping the daemon first, and
						 * `plan.canManageUpdate` is what licenses it: the plan only says yes
						 * for a generation-based install, where the update lands in a tree
						 * no running process is reading.
						 */
						return await this.updateGlobalInstall(
							this.backendService,
							plan,
							target,
						);
					}

					logger.info(
						`Cannot manage the update for ${startupMode}: ${plan.detail}`,
						LogFileType.UPDATE_SERVICE,
					);
					// The panel names the version it is waiting for, so the producer has
					// to send one: the event carries no version of its own, and the
					// renderer used to reconstruct the target from whatever offer
					// happened to precede it (reviews U12, U17). The running version
					// travels too, because the sibling panel is able to say both and a
					// user comparing the two doors would expect the same sentence.
					//
					// BOTH READINGS ARE STRUCTURED FIELDS rather than a clause appended
					// to `detail`: the sentence that names them belongs in the panel's
					// prose, and the Details line is the classification evidence the
					// reader copies for support (review D3). `currentVersion` keeps the
					// meaning this payload has always had - the build the reader is
					// using - while `installVersion` is what an update would move.
					// The reading taken above, deliberately not a second fetch: this
					// event and the offer it answers must describe one server, and a
					// daemon can rotate between two requests.
					const installed = running.version;
					this.sendToRenderer("backend-update-manual-required", {
						message: plan.remedy,
						command: plan.updateCommand,
						detail: plan.detail,
						latestVersion: target,
						currentVersion:
							installed && installed !== "Unknown" ? installed : null,
						installVersion: plan.installedInstallVersion,
						runningVersion: installed,
						sourceBuild: plan.sourceBuild,
						/*
						 * The second door into the same state, and it needs the same reading: this
						 * panel renders `ManualRemedyNote` too, and on an app-owned install the
						 * closing line it would otherwise append asks for a press that cannot move
						 * the environment (review round 1, UX U1).
						 */
						appOwned: plan.appOwned,
					});
					return false;
				}

				case LocalOperatorStartupMode.APP_BUNDLED_VENV:
					// Continue with update process for this mode
					break;

				default:
					logger.error(
						`Unknown startup mode: ${startupMode}`,
						LogFileType.UPDATE_SERVICE,
					);
					/*
					 * Every other failing branch above reports on `backend-update-error`,
					 * and this one used to leave the renderer with nothing: `update-backend`
					 * RESOLVES false, so a renderer reading only the rejection kept its
					 * in-flight panel up with no reason on it. "Say so on every failure" is
					 * the rule this branch was the exception to.
					 */
					this.sendToRenderer("backend-update-error", {
						message:
							"The app could not tell how this server was started, so it did not update it. See the update service log.",
						phase: "update",
						logPath: serverUpdateLogPath(),
					});
					return false;
			}

			// First, stop the backend service if we have a reference to it
			if (!this.backendService.isUsingExternalBackend()) {
				logger.info(
					"Stopping backend service before update...",
					LogFileType.UPDATE_SERVICE,
				);
				// Set the auto-updating flag to prevent error dialogs during shutdown
				this.backendService.setAutoUpdating(true);
				await this.backendService.stop(true);
				logger.info(
					"Backend service stopped successfully",
					LogFileType.UPDATE_SERVICE,
				);
			}

			// Update the backend using pip.
			//
			// Only the app's own bundled environment reaches this point: a global
			// install returns above. `pip install --upgrade` against a uv tool or
			// pipx environment either fails or corrupts it, and a fallback to the
			// bare `pip` on PATH was how the app ended up offering to update an
			// install it did not own.
			let pythonPath = "";
			const venvPath = this.backendService?.getVenvPath();
			if (venvPath && app.isPackaged) {
				const venvBinDir = process.platform === "win32" ? "Scripts" : "bin";
				const pythonName =
					process.platform === "win32" ? "python.exe" : "python3";
				pythonPath = join(venvPath, venvBinDir, pythonName);
			}

			if (!pythonPath || !existsSync(pythonPath)) {
				logger.error(
					// `managedVenvPath` answers with a sentinel when no environment has
					// been published, and "no Python at …/no-environment-selected" sent a
					// reader to a directory-shaped path that nothing creates (review N3).
					isUnpreparedVenvPath(venvPath ?? "")
						? "Cannot update the bundled backend: no environment has been selected for this instance yet"
						: `Cannot update the bundled backend: no Python at ${pythonPath || "an unknown path"}`,
					LogFileType.UPDATE_SERVICE,
				);
				await this.restartBackendAfterFailedUpgrade();
				this.sendToRenderer("backend-update-error", {
					message:
						"The bundled server's Python environment could not be found, so the update did not run. Please reinstall the application.",
					phase: "update",
					logPath: serverUpdateLogPath(),
				});
				return false;
			}

			/*
			 * The target travels into the requirement, so pip cannot satisfy the user's
			 * request with the version it is already standing on: the app promised a
			 * specific release, and an index page that predates it (a cached one, or an
			 * unreachable one) has to fail here rather than report success.
			 */
			const pip = buildPipUpgradeCommand(pythonPath, targetVersion ?? null);

			// Read what the environment has NOW. "pip exited 0" is not evidence that
			// anything was installed - pip reports success when the requirement is
			// already satisfied - so the post-check needs a version to compare.
			const versionBefore = await this.readBundledBackendVersion(pythonPath);

			logger.info(
				`Executing pip command: ${pip.display}`,
				LogFileType.UPDATE_SERVICE,
			);
			const pipRun = await runCommand(pip.command, pip.args, {
				timeoutMs: 15 * 60 * 1000,
				env: this.pythonSpawnEnv(),
			});
			// Both streams are captured into update-service.log: a pip failure with
			// no output is what made the earlier failures unreadable.
			logger.info(
				`pip stdout:\n${pipRun.stdout.trim()}`,
				LogFileType.UPDATE_SERVICE,
			);
			if (pipRun.stderr.trim().length > 0) {
				logger.warn(
					`pip stderr:\n${pipRun.stderr.trim()}`,
					LogFileType.UPDATE_SERVICE,
				);
			}

			const versionAfter = await this.readBundledBackendVersion(pythonPath);
			// An unreadable "before" is not evidence that the upgrade landed: when
			// `pip show` failed beforehand, the target version is what the reading
			// afterwards is held to (review R6, `didUpgradeLand`).
			const upgradeLanded =
				pipRun.exitCode === 0 &&
				didUpgradeLand({
					before: versionBefore,
					after: versionAfter,
					target: targetVersion ?? null,
				});
			if (!upgradeLanded) {
				logger.error(
					`Backend upgrade did not land: pip exited ${pipRun.exitCode}; version ${versionBefore ?? "unknown"} -> ${versionAfter ?? "unknown"}`,
					LogFileType.UPDATE_SERVICE,
				);
				const serverIsBack = await this.restartBackendAfterFailedUpgrade();
				this.sendToRenderer("backend-update-error", {
					message:
						pipRun.exitCode !== 0
							? serverIsBack
								? "The server update failed to install. The previously installed server is running again; see the update service log for pip's output."
								: "The server update failed to install and the server did not come back up. Restart Local Operator, and see the update service log for pip's output."
							: `The server update to ${targetVersion ?? "the new release"} did not take effect: the server is still on ${versionAfter ?? "its previous version"}. See the update service log for pip's output, then try again.`,
					phase: "update",
					logPath: serverUpdateLogPath(),
				});
				return false;
			}

			logger.info(
				`Backend package upgraded: ${versionBefore ?? "unknown"} -> ${versionAfter}`,
				LogFileType.UPDATE_SERVICE,
			);

			// Restart the backend service
			logger.info(
				"Restarting backend service after update...",
				LogFileType.UPDATE_SERVICE,
			);

			// Use the dedicated restart method which properly handles the restart process
			const restartSuccess = await this.backendService.restart();

			if (restartSuccess) {
				logger.info(
					"Backend service restarted successfully after update",
					LogFileType.UPDATE_SERVICE,
				);

				// Reset the auto-updating flag
				this.backendService.setAutoUpdating(false);

				// Verify the backend is actually running after restart
				const isRunningAfterRestart = await this.checkBackendHealth();
				if (!isRunningAfterRestart) {
					logger.error(
						"Backend service reported successful restart but health check failed",
						LogFileType.UPDATE_SERVICE,
					);

					// Try one more time to start the service
					logger.info(
						"Attempting to start backend service again...",
						LogFileType.UPDATE_SERVICE,
					);
					await this.backendService.start();

					// Final health check
					const finalHealthCheck = await this.checkBackendHealth();
					if (!finalHealthCheck) {
						logger.error(
							"Backend service failed to start after multiple attempts",
							LogFileType.UPDATE_SERVICE,
						);
						if (this.mainWindow) {
							this.mainWindow.webContents.send("backend-update-error", {
								message:
									"Backend was updated but failed to restart properly. Please restart the application.",
								phase: "update",
								logPath: serverUpdateLogPath(),
							});
						}
						return false;
					}
				}
			} else {
				logger.error(
					"Failed to restart backend service after update",
					LogFileType.UPDATE_SERVICE,
				);

				// Reset the auto-updating flag even if restart failed
				this.backendService.setAutoUpdating(false);

				if (this.mainWindow) {
					this.mainWindow.webContents.send("backend-update-error", {
						message:
							"Backend was updated but failed to restart. Please restart the application.",
						phase: "update",
						logPath: serverUpdateLogPath(),
					});
				}
				return false;
			}

			// Confirm the version the server actually reports before claiming
			// success: a restart that came back on the old version is not an update,
			// and "pip exited 0" is not evidence that it took effect.
			const reportedVersion = await this.waitForBackendVersion(
				targetVersion ?? null,
			);
			if (reportedVersion == null) {
				logger.error(
					`Backend did not report version ${targetVersion ?? "the new one"} after the update`,
					LogFileType.UPDATE_SERVICE,
				);
				this.sendToRenderer("backend-update-error", {
					message: `The server restarted but did not report ${targetVersion ? `version ${targetVersion}` : "the updated version"}. Check the update service log, then try again.`,
					phase: "update",
					logPath: serverUpdateLogPath(),
				});
				return false;
			}
			logger.info(
				`Backend reports version ${reportedVersion} after the update`,
				LogFileType.UPDATE_SERVICE,
			);

			logger.info(
				"Backend update and restart completed successfully",
				LogFileType.UPDATE_SERVICE,
			);

			if (
				this.mainWindow &&
				!this.mainWindow.isDestroyed() &&
				this.mainWindow.webContents &&
				!this.mainWindow.webContents.isDestroyed()
			) {
				this.mainWindow.webContents.send("backend-update-completed");
			}

			return true;
		} catch (error) {
			logger.error(
				"Error updating backend:",
				LogFileType.UPDATE_SERVICE,
				error,
			);

			// Try to restart the backend service if it was stopped
			if (
				this.backendService &&
				!this.backendService.isUsingExternalBackend()
			) {
				try {
					logger.info(
						"Attempting to restart backend service after update failure...",
						LogFileType.UPDATE_SERVICE,
					);
					await this.backendService.start();
				} catch (restartError) {
					logger.error(
						"Failed to restart backend service after update failure:",
						LogFileType.UPDATE_SERVICE,
						restartError,
					);
				}
			}

			if (
				this.mainWindow &&
				!this.mainWindow.isDestroyed() &&
				this.mainWindow.webContents &&
				!this.mainWindow.webContents.isDestroyed()
			) {
				this.mainWindow.webContents.send("backend-update-error", {
					// Cleaned at the source, for the reason written on the check-phase
					// report above.
					message: stripErrorPrefixes((error as Error).message),
					phase: "update",
					logPath: serverUpdateLogPath(),
				});
			}

			return false;
		}
	}

	/**
	 * Check for all updates (UI and backend)
	 *
	 * @param silent - Whether to suppress notifications on no updates
	 * @returns what the WHOLE check found out, with the one sentence it earns.
	 *   This is what the renderer's "check for updates" affirmation is read
	 *   from: a sentence about the user's installation cannot be assembled from
	 *   one channel's event, which is how the app came to offer a server update
	 *   and affirm it was up to date in the same turn. No new event channel
	 *   carries it - each channel's own events are unchanged, and the verdict
	 *   crosses the IPC boundary as this call's return value.
	 */
	public async checkForAllUpdates(
		silent = false,
		/* Passed to both channels; see `checkForUpdates`'s parameter of the same name. */
		reportFailure = !silent,
	): Promise<UpdateCheckVerdict> {
		// Sequential rather than concurrent: each channel reports through its own
		// renderer events and completes on its own schedule, and the verdict is
		// the only thing here that reads both - so running them together would
		// change nothing a user sees while making the pair's failures harder to
		// attribute.
		const app = await this.checkForUpdates(silent, reportFailure);
		const server = await this.checkForBackendUpdates(silent, reportFailure);
		return updateCheckVerdict({ app, server: server.status });
	}

	/**
	 * Check if the backend service is healthy
	 * @returns Promise resolving to true if the backend is healthy, false otherwise
	 */
	private async checkBackendHealth(): Promise<boolean> {
		try {
			// Set a timeout for the fetch request
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

			const response = await fetch(`${this.liveBackendUrl()}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			logger.info(
				`Backend health check response status: ${response.status}`,
				LogFileType.UPDATE_SERVICE,
			);

			return response.ok;
		} catch (error) {
			logger.error(
				"Error checking backend health:",
				LogFileType.UPDATE_SERVICE,
				error,
			);
			return false;
		}
	}

	/**
	 * Determines if an update error should be filtered (not shown to the user)
	 * @param err The error object from autoUpdater
	 * @returns True if the error should be filtered, false if it should be shown to the user
	 */
	/**
	 * Whether an error from the updater is a genuine availability problem.
	 *
	 * Only availability checks may be filtered. A download, verification or
	 * install failure means something the user asked for did not happen, and
	 * reporting it as "no update available" (the previous behaviour) is how the
	 * operator's failed install produced no message at all.
	 */
	private shouldFilterUpdateError(err: Error): boolean {
		const errorMessage = err.message || "";
		logger.info(
			`Checking if error should be filtered: ${errorMessage}`,
			LogFileType.UPDATE_SERVICE,
		);

		// Filter errors related to missing latest*.yml files
		if (
			(errorMessage.includes("latest") && errorMessage.includes(".yml")) ||
			errorMessage.includes("Cannot find latest-mac.yml")
		) {
			logger.info(
				"Filtering error: Missing latest*.yml file",
				LogFileType.UPDATE_SERVICE,
			);
			return true;
		}

		// Filter errors related to GitHub releases that don't exist or aren't ready
		if (
			errorMessage.includes("GitHub") &&
			(errorMessage.includes("release") || errorMessage.includes("tag"))
		) {
			logger.info(
				"Filtering error: GitHub release issue",
				LogFileType.UPDATE_SERVICE,
			);
			return true;
		}

		// Filter errors related to beta versions
		if (
			errorMessage.includes("beta") ||
			errorMessage.match(BETA_VERSION_REGEX)
		) {
			logger.info("Filtering error: Beta version", LogFileType.UPDATE_SERVICE);
			return true;
		}

		// Filter network errors that might be temporary
		if (
			errorMessage.includes("ENOTFOUND") ||
			errorMessage.includes("ETIMEDOUT") ||
			errorMessage.includes("ECONNREFUSED") ||
			errorMessage.includes("HttpError: 404")
		) {
			logger.info("Filtering error: Network issue", LogFileType.UPDATE_SERVICE);
			return true;
		}

		// Don't filter other errors
		return false;
	}

	/**
	 * Handle platform-specific setup for the updater
	 */
	public handlePlatformSpecifics(): void {
		// Handle Windows Squirrel events
		if (process.platform === "win32") {
			const appFolder = path.dirname(process.execPath);
			const updateExe = path.resolve(appFolder, "..", "Update.exe");
			const exeName = path.basename(process.execPath);

			// Handle Squirrel.Windows startup events
			if (process.argv.includes("--squirrel-firstrun")) {
				// This is the first run after installation
				logger.info(
					`First run after installation for ${exeName}`,
					LogFileType.UPDATE_SERVICE,
				);
				logger.info(
					`Update executable path: ${updateExe}`,
					LogFileType.UPDATE_SERVICE,
				);

				// Wait a bit before checking for updates to avoid file lock issues
				setTimeout(() => {
					this.checkForUpdates(true);
				}, 10000); // 10 seconds delay

				return;
			}

			// Log Windows update configuration
			logger.info(
				`Windows update configuration: ${exeName} will use ${updateExe} for updates`,
				LogFileType.UPDATE_SERVICE,
			);
		}

		// For macOS, ensure the app is signed
		if (process.platform === "darwin") {
			// macOS requires the app to be signed for auto-updates
			// This is handled by the build process, but we can log it for clarity
			logger.info(
				"macOS auto-update requires app signing",
				LogFileType.UPDATE_SERVICE,
			);
		}
	}
}
