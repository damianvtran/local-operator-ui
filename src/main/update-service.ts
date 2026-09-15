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
import { type BrowserWindow, app, ipcMain } from "electron";
import { type UpdateInfo, autoUpdater } from "electron-updater";
import type { BackendServiceManager } from "./backend/backend-service";

import { LocalOperatorStartupMode } from "./backend/backend-service";
import { apiConfig } from "./backend/config";
import { LogFileType, logger } from "./backend/logger";
import { withPythonBytecodeCache } from "./python-bytecode-cache";
import {
	type UpdateChannelStatus,
	type UpdateCheckVerdict,
	isReadableVersion,
	updateCheckVerdict,
} from "./update-check-verdict";
import {
	type InstallBlock,
	type InstallFailurePayload,
	type InstallIdentity,
	type InstallInFlightPayload,
	type LastInstallAttempt,
	type PendingInstallMarker,
	type UpdateFileMetadata,
	appBundleFromExecutable,
	buildPipUpgradeCommand,
	buildWatchdogPlan,
	classifyGlobalInstall,
	clearPendingInstallMarker,
	didUpgradeLand,
	evaluateBundleSeal,
	evaluatePendingInstall,
	healPythonBytecode,
	installFailurePayload,
	installInFlightPayload,
	installedBundleSealBlock,
	isInstallInFlight,
	launchdJobLoaded,
	matchArtifactMetadata,
	measureDirectoryBytes,
	parsePipShowVersion,
	parseSealViolations,
	readInstallIdentity,
	readLastInstallAttempt,
	readPendingInstallMarker,
	reapFailedInstall,
	reapStagedTree,
	recordInstallFailure,
	requiredDiskBytes,
	resolveCommandPath,
	resolveGlobalInstallPlan,
	resolveStagedArtifactPath,
	shipItCacheDir,
	shipItJobLabel,
	verifyStagedArtifact,
	watchdogIsOurs,
	watchdogSignals,
	watchdogSwapTarget,
	writePendingInstallMarker,
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

/** ` to version X`, or nothing when the version is unknown. */
function versionSuffix(version: string | null | undefined): string {
	return version ? ` to version ${version}` : "";
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

/** Read a command's trimmed stdout, or null when it fails to run. */
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
 * Health check result containing version information
 */
type HealthCheckResult = {
	/** API server version */
	version: string;
};

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
 * Type definition for backend update information
 */
export type BackendUpdateInfo = {
	currentVersion: string;
	latestVersion: string;
	updateCommand: string;
	/** Whether the update can be managed by the update service */
	canManageUpdate: boolean;
	/** The startup mode of the backend service */
	startupMode?: LocalOperatorStartupMode;
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

		// Start periodic update checks (every 5 minutes)
		this.startPeriodicUpdateChecks();
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
		this.sendToRenderer("update-install-blocked", {
			code: block.code,
			version: version ?? null,
			message: block.message,
			remedy: block.remedy,
			detail: block.detail,
		});
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
	 */
	private async probeInstalledBundleSeal(
		version?: string | null,
	): Promise<InstallBlock | null> {
		if (process.platform !== "darwin" || !app.isPackaged) return null;

		const bundlePath = appBundleFromExecutable(process.execPath);
		if (!bundlePath) {
			// Not a bundle layout we recognise (unpacked/dev run): nothing to
			// verify, and refusing every install because the path did not parse
			// would be worse than the risk it guards against.
			logger.warn(
				`Could not derive an app bundle from ${process.execPath}; skipping the seal pre-flight.`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}

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
				`Installed bundle passed its seal check: ${bundlePath}`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}

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
			return installedBundleSealBlock(bundlePath, seal.detail, version);
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
		const healed = evaluateBundleSeal(await probeBundle());
		if (healed.kind === "sealed") {
			logger.info(
				`Installed bundle sealed again after removing ${heal.removed.length} added bytecode file(s); continuing with the install.`,
				LogFileType.UPDATE_SERVICE,
			);
			return null;
		}

		logger.error(
			`Installed bundle still fails its seal check after healing: ${healed.detail}`,
			LogFileType.UPDATE_SERVICE,
		);
		return installedBundleSealBlock(bundlePath, healed.detail, version);
	}

	/** File names the updater's metadata knows this update by. */
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
	 * Register the backend service for proper shutdown when app quits
	 * This ensures that restarted backend services are properly shut down
	 */
	private registerBackendShutdown(): void {
		if (!this.backendService || this.backendService.isUsingExternalBackend()) {
			return;
		}

		// We'll use a more direct approach to ensure the backend is shut down
		// Register a handler for the 'before-quit' event which is supported in Electron's type definitions
		const shutdownHandler = async () => {
			logger.info(
				"Shutting down backend service before app quit...",
				LogFileType.UPDATE_SERVICE,
			);
			try {
				// Use false for isRestart to indicate this is a final shutdown, not a restart
				await this.backendService?.stop(false);
				logger.info(
					"Backend service successfully shut down before app quit",
					LogFileType.UPDATE_SERVICE,
				);
			} catch (error) {
				logger.error(
					"Error shutting down backend service before app quit:",
					LogFileType.UPDATE_SERVICE,
					error,
				);

				// If normal shutdown fails, try a more aggressive approach
				try {
					logger.info(
						"Attempting forced shutdown of backend service...",
						LogFileType.UPDATE_SERVICE,
					);
					await this.forceTerminateBackendProcess();
					logger.info(
						"Forced shutdown of backend service completed",
						LogFileType.UPDATE_SERVICE,
					);
				} catch (forceError) {
					logger.error(
						"Error during forced shutdown of backend service:",
						LogFileType.UPDATE_SERVICE,
						forceError,
					);
				}
			}
		};

		// Remove any existing handlers to avoid duplicates
		// biome-ignore lint/suspicious/noExplicitAny: Needed for compatibility with Electron's type system
		(app as any).removeAllListeners("before-quit");

		// Register the handler for app quit
		// biome-ignore lint/suspicious/noExplicitAny: Needed for compatibility with Electron's type system
		(app as any).once("before-quit", shutdownHandler);

		// Also register a handler for the will-quit event as a backup
		// biome-ignore lint/suspicious/noExplicitAny: Needed for compatibility with Electron's type system
		(app as any).once("will-quit", shutdownHandler);

		logger.info(
			"Registered backend service for proper shutdown on app quit",
			LogFileType.UPDATE_SERVICE,
		);
	}

	/**
	 * Force terminate the backend process using platform-specific commands
	 * This is a last resort method when normal termination fails
	 */
	private async forceTerminateBackendProcess(): Promise<void> {
		if (!this.backendService) {
			return;
		}

		const execAsync = promisify(exec);

		try {
			if (process.platform === "win32") {
				// On Windows, use taskkill to forcefully terminate processes with "local-operator serve" in the command line
				await execAsync('taskkill /f /im "local-operator serve" /t');
				await execAsync(
					"wmic process where \"commandline like '%local-operator serve%'\" call terminate",
				);
			} else {
				// On Unix systems (macOS/Linux), use pkill to forcefully terminate processes with "local-operator serve" in the command line
				await execAsync('pkill -f "local-operator serve"');
				// Give processes a moment to terminate gracefully before force killing
				await new Promise((resolve) => setTimeout(resolve, 1000));
				// Force kill any remaining processes
				await execAsync('pkill -9 -f "local-operator serve"');
			}
		} catch (error) {
			// Ignore errors, as the process might not exist
			logger.warn(
				"Error during force termination (this may be normal if process was already terminated):",
				LogFileType.UPDATE_SERVICE,
				error,
			);
		}
	}

	/**
	 * Set up event handlers for the autoUpdater
	 */
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
				// Only send the error to the renderer if it shouldn't be filtered
				this.sendToRenderer("update-error", err.message);
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
				try {
					return await autoUpdater.checkForUpdates();
				} catch (error) {
					logger.error(
						"Error checking for UI updates:",
						LogFileType.UPDATE_SERVICE,
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

					// Only throw the error if it shouldn't be filtered
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
					return await this.checkForAllUpdates(silent);
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
			logger.info(
				"Preparing to quit and install the update...",
				LogFileType.UPDATE_SERVICE,
			);

			this.installPreflightInFlight = true;
			this.updateStage = "installing";
			let block: InstallBlock | null = null;
			try {
				block = await this.runInstallPreflight(this.lastUpdateInfo);
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
	public async checkForUpdates(silent = false): Promise<UpdateChannelStatus> {
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
				result = await autoUpdater.checkForUpdates();
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
				!silent
			) {
				this.mainWindow.webContents.send(
					"update-error",
					(error as Error).message,
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
	 * Get the installed backend version using the health API
	 * @returns Promise resolving to the installed version or null if not found
	 */
	private async getInstalledBackendVersion(): Promise<string | null> {
		try {
			logger.info(
				`Checking backend version from health API at ${this.backendUrl}/health`,
				LogFileType.UPDATE_SERVICE,
			);

			// Set a timeout for the fetch request
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

			const response = await fetch(`${this.backendUrl}/health`, {
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
				return null;
			}

			const healthData = (await response.json()) as HealthCheckResponse;

			// Check if the response has version information
			if (healthData.result?.version) {
				logger.info(
					`Backend version from health API: ${healthData.result.version}`,
					LogFileType.UPDATE_SERVICE,
				);
				return healthData.result.version;
			}

			// For older server versions that don't have the version information
			logger.info(
				"Backend version not available in health response",
				LogFileType.UPDATE_SERVICE,
			);
			return "Unknown";
		} catch (error) {
			logger.error(
				"Error getting backend version from health API:",
				LogFileType.UPDATE_SERVICE,
				error,
			);

			// Try alternative URL with localhost if the first attempt failed with 127.0.0.1
			if (this.backendUrl.includes("127.0.0.1")) {
				try {
					const altUrl = this.backendUrl.replace("127.0.0.1", "localhost");
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
						return null;
					}

					const healthData = (await response.json()) as HealthCheckResponse;

					// Check if the response has version information
					if (healthData.result?.version) {
						logger.info(
							`Backend version from alternative health API: ${healthData.result.version}`,
							LogFileType.UPDATE_SERVICE,
						);
						return healthData.result.version;
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
						return version;
					}
				} catch (pipError) {
					logger.error(
						"Error getting backend version from pip:",
						LogFileType.UPDATE_SERVICE,
						pipError,
					);
				}
			}

			return null;
		}
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
	 */
	private async resolveBackendUpdatePlan(
		startupMode: LocalOperatorStartupMode,
	): Promise<{
		canManageUpdate: boolean;
		updateCommand: string;
		remedy: string;
		detail: string;
		sourceBuild: boolean;
	}> {
		if (
			startupMode === LocalOperatorStartupMode.EXISTING_SERVER ||
			startupMode === LocalOperatorStartupMode.GLOBAL_INSTALL
		) {
			const plan = resolveGlobalInstallPlan({
				identity: this.resolveInstallIdentity(),
				lopUpdatePath: this.resolveLopUpdatePath(),
			});
			logger.info(
				`External backend install (${startupMode}): ${plan.detail}; remedy is \`${plan.updateCommand || "nothing the app can name"}\``,
				LogFileType.UPDATE_SERVICE,
			);
			return {
				canManageUpdate: plan.canManageUpdate,
				updateCommand: plan.updateCommand,
				remedy: plan.remedy,
				detail: plan.detail,
				sourceBuild: plan.sourceBuild,
			};
		}

		return {
			canManageUpdate: true,
			updateCommand: "pip install --upgrade local-operator",
			remedy: "Updating the server will improve AI functionality.",
			detail: `The app started this server itself (${startupMode}).`,
			sourceBuild: false,
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
		if (process.platform === "win32") {
			const first = readCommandOutput("where", ["local-operator"])
				?.split("\n")[0]
				?.trim();
			return first && first.length > 0 ? first : null;
		}
		return resolveCommandPath("local-operator");
	}

	/**
	 * Path the `lop-update` shim resolves to, or null when this machine has none.
	 *
	 * The same problem as the shim above, for the remedy rather than the
	 * classification: `lop-update` is what the source-build wording tells the user
	 * to run, and it lives in `~/.local/bin`, which a Finder launch cannot see
	 * through PATH alone - so the plan fell back to the pip/pipx wording for an
	 * install that is neither. It is a shell script, so there is no Windows
	 * counterpart to look for.
	 */
	private resolveLopUpdatePath(): string | null {
		if (process.platform === "win32") return null;
		return resolveCommandPath("lop-update");
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
	private resolveInstallIdentity(): InstallIdentity {
		const identity = readInstallIdentity(this.resolveLocalOperatorPath());
		if (identity.path && classifyGlobalInstall(identity) !== "global-unknown") {
			return identity;
		}
		// Resolved the same way as the shims: a shell the app did not inherit also
		// hides these two, and a probe that cannot be spawned is not evidence.
		const uv = resolveCommandPath("uv");
		const pipx = resolveCommandPath("pipx");
		identity.uvToolList = uv ? readCommandOutput(uv, ["tool", "list"]) : null;
		identity.pipxList = pipx ? readCommandOutput(pipx, ["list"]) : null;
		return identity;
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
	): Promise<BackendCheckReport> {
		logger.info(
			`Checking for backend updates... (silent mode: ${silent})`,
			LogFileType.UPDATE_SERVICE,
		);

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

			const installedVersion = await this.getInstalledBackendVersion();
			const latestVersion = await this.getLatestPypiVersion();
			// Remembered for the by-hand prompt: that event is produced from a click
			// rather than from a check, and it has to be able to name the published
			// release the user is working towards (review U17).
			if (latestVersion) this.lastPublishedBackendVersion = latestVersion;

			if (!installedVersion || !latestVersion) {
				logger.error(
					"Unable to determine backend versions.",
					LogFileType.UPDATE_SERVICE,
				);
				if (!silent) {
					this.sendToRenderer(
						"backend-update-error",
						"Unable to determine backend version.",
					);
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
				if (!silent) {
					this.sendToRenderer(
						"backend-update-error",
						"The installed server version could not be determined, so no update was offered. Restart the app to try again.",
					);
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
				if (!silent) {
					this.sendToRenderer(
						"backend-update-error",
						"Unable to determine backend version.",
					);
				}
				return { status: "unavailable", info: null };
			}

			const shouldUpdate = this.isNewerVersion(latestVersion, installedVersion);

			logger.info(
				`Installed backend version: ${installedVersion}, Latest: ${latestVersion}, Update needed: ${shouldUpdate}, Startup mode: ${startupMode}`,
				LogFileType.UPDATE_SERVICE,
			);

			if (shouldUpdate) {
				logger.info(
					`New backend version available: ${latestVersion} (installed: ${installedVersion})`,
					LogFileType.UPDATE_SERVICE,
				);

				const { canManageUpdate, updateCommand, remedy, detail, sourceBuild } =
					await this.resolveBackendUpdatePlan(startupMode);

				const updateInfo: BackendUpdateInfo = {
					currentVersion: installedVersion,
					latestVersion,
					updateCommand,
					canManageUpdate,
					startupMode,
					remedy,
					detail,
					sourceBuild,
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

			if (
				!silent &&
				this.mainWindow &&
				!this.mainWindow.isDestroyed() &&
				this.mainWindow.webContents &&
				!this.mainWindow.webContents.isDestroyed()
			) {
				this.mainWindow.webContents.send("backend-update-not-available", {
					version: installedVersion,
				});
			}

			return { status: "current", info: null };
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
				this.mainWindow.webContents.send(
					"backend-update-error",
					(error as Error).message,
				);
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
				if (target == null || version === target) return version;
			}
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}
		logger.warn(
			`Backend version poll timed out after ${timeoutMs}ms (target ${target ?? "any"}, last seen ${last ?? "none"})`,
			LogFileType.UPDATE_SERVICE,
		);
		return null;
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
					this.mainWindow.webContents.send(
						"backend-update-error",
						"No backend service reference available, cannot update.",
					);
				}
				return false;
			}

			const startupMode = this.backendService.getStartupMode();

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
						this.mainWindow.webContents.send(
							"backend-update-error",
							"No python server is available, nothing to update.",
						);
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
					const plan = await this.resolveBackendUpdatePlan(startupMode);
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
					const installed = await this.getInstalledBackendVersion();
					this.sendToRenderer("backend-update-manual-required", {
						message: plan.remedy,
						command: plan.updateCommand,
						detail: plan.detail,
						// The caller's target when it named one (the "Update server"
						// button does), otherwise the published release the last check
						// read: the compatibility banner calls this with no target at
						// all, and the panel's version sentence then had nothing to
						// render on the path that actually produces it (review U17).
						latestVersion:
							targetVersion ?? this.lastPublishedBackendVersion ?? null,
						currentVersion:
							installed && installed !== "Unknown" ? installed : null,
						sourceBuild: plan.sourceBuild,
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
					`Cannot update the bundled backend: no Python at ${pythonPath || "an unknown path"}`,
					LogFileType.UPDATE_SERVICE,
				);
				await this.restartBackendAfterFailedUpgrade();
				this.sendToRenderer(
					"backend-update-error",
					"The bundled server's Python environment could not be found, so the update did not run. Please reinstall the application.",
				);
				return false;
			}

			const pip = buildPipUpgradeCommand(pythonPath);

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
				this.sendToRenderer(
					"backend-update-error",
					pipRun.exitCode !== 0
						? serverIsBack
							? "The server update failed to install. The previously installed server is running again; see the update service log for pip's output."
							: "The server update failed to install and the server did not come back up. Restart Local Operator, and see the update service log for pip's output."
						: `The server update ran but the installed version did not change (still ${versionAfter ?? "unknown"}), so it is reported as failed.`,
				);
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

			// Ensure the backend is fully stopped before attempting to restart
			// Wait a bit to ensure any cleanup processes have completed
			await new Promise((resolve) => setTimeout(resolve, 2000));

			// Verify the backend is actually stopped
			const isHealthy = await this.checkBackendHealth();
			if (isHealthy) {
				logger.warn(
					"Backend service is still running after stop command, attempting force termination",
					LogFileType.UPDATE_SERVICE,
				);

				// Try force termination
				await this.forceTerminateBackendProcess();

				// Wait again to ensure termination
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}

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
							this.mainWindow.webContents.send(
								"backend-update-error",
								"Backend was updated but failed to restart properly. Please restart the application.",
							);
						}
						return false;
					}
				}

				// Register the backend service for proper shutdown when app quits
				this.registerBackendShutdown();
			} else {
				logger.error(
					"Failed to restart backend service after update",
					LogFileType.UPDATE_SERVICE,
				);

				// Reset the auto-updating flag even if restart failed
				this.backendService.setAutoUpdating(false);

				if (this.mainWindow) {
					this.mainWindow.webContents.send(
						"backend-update-error",
						"Backend was updated but failed to restart. Please restart the application.",
					);
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
				this.sendToRenderer(
					"backend-update-error",
					`The server restarted but did not report ${targetVersion ? `version ${targetVersion}` : "the updated version"}. Check the update service log, then try again.`,
				);
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
				this.mainWindow.webContents.send(
					"backend-update-error",
					(error as Error).message,
				);
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
	public async checkForAllUpdates(silent = false): Promise<UpdateCheckVerdict> {
		// Sequential rather than concurrent: each channel reports through its own
		// renderer events and completes on its own schedule, and the verdict is
		// the only thing here that reads both - so running them together would
		// change nothing a user sees while making the pair's failures harder to
		// attribute.
		const app = await this.checkForUpdates(silent);
		const server = await this.checkForBackendUpdates(silent);
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

			const response = await fetch(`${this.backendUrl}/health`, {
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
