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
	rmSync,
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
import {
	type InstallBlock,
	type InstallFailurePayload,
	type InstallIdentity,
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
	installFailurePayload,
	installedBundleSealBlock,
	matchArtifactMetadata,
	measureDirectoryBytes,
	parsePipShowVersion,
	readInstallIdentity,
	readLastInstallAttempt,
	readPendingInstallMarker,
	reapFailedInstall,
	recordInstallFailure,
	requiredDiskBytes,
	resolveCommandPath,
	resolveGlobalInstallPlan,
	resolveStagedArtifactPath,
	shipItCacheDir,
	shipItJobLabel,
	verifyStagedArtifact,
	watchdogIsOurs,
	watchdogSwapTarget,
	writePendingInstallMarker,
} from "./update-install";

// Regex constants for performance (moved to top-level)
const VERSION_LINE_REGEX = /Version:\s*([^\n]+)/;
const VERSION_CLEAN_REGEX = /^v/i;
const BETA_VERSION_REGEX = /v\d+\.\d+\.\d+\.beta\.\d+/;

/** A reverse-DNS bundle identifier, and nothing else. */
const BUNDLE_ID_REGEX = /^[\w.-]+$/;

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
	options: { timeoutMs?: number } = {},
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
			{ timeout: options.timeoutMs ?? 20000, maxBuffer: 4 * 1024 * 1024 },
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
	 */
	private recoverPendingInstall(): void {
		const marker = readPendingInstallMarker(this.markerDir());
		const outcome = evaluatePendingInstall({
			marker,
			runningVersion: app.getVersion(),
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
			case "failed": {
				// The log Squirrel wrote is the only record of WHY, because this
				// process was dead while the install failed (review U14).
				const shipItLogPath = this.shipItLog();
				const record = recordInstallFailure(this.markerDir(), {
					payload: installFailurePayload(outcome.marker, app.getVersion(), {
						shipItLogPath,
					}),
					startedAt: outcome.marker.startedAt || null,
					detectedAt: new Date().toISOString(),
				});
				const payload = installFailurePayload(
					outcome.marker,
					app.getVersion(),
					{ attempts: record.attempts, shipItLogPath },
				);
				logger.error(
					`Update marker: install of version ${outcome.marker.targetVersion} did not complete (attempt ${record.attempts}). ${payload.detail}`,
					LogFileType.UPDATE_SERVICE,
				);
				this.pendingInstallFailure = payload;
				this.reapWatchdog(outcome.marker, false);
				clearPendingInstallMarker(this.markerDir());
				this.reapFailedInstallLeftovers();
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
				removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
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
	 * The marker is read while the window is still loading, so the push happens
	 * on `did-finish-load` with a delayed fallback: the component subscribes from
	 * a React effect, which may run after the load event.
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
		logger.info(
			"Reported a failed update install to the renderer",
			LogFileType.UPDATE_SERVICE,
		);
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

		let seal = evaluateBundleSeal(await probeBundle());
		if (seal.kind === "unavailable") {
			logger.warn(
				`Seal check did not complete, retrying once: ${seal.detail}`,
				LogFileType.UPDATE_SERVICE,
			);
			seal = evaluateBundleSeal(await probeBundle());
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
		return installedBundleSealBlock(bundlePath, seal.detail, version);
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
		});

		try {
			const child = spawn("sh", ["-c", plan.script], {
				detached: true,
				stdio: "ignore",
				env: { ...process.env, ...plan.env },
			});
			child.unref();
			// The bound is the promise the user is given, so it is stated here with
			// what shortens it rather than as a bare timeout (review R11).
			logger.info(
				`Started the update relaunch watchdog (pid ${child.pid ?? "unknown"}): it starts the app again as soon as the install's job goes or version ${plan.env.LO_UPDATE_WATCHDOG_TARGET_VERSION || "unknown"} is in place, and at the ${plan.timeoutSeconds}s bound if neither happens.`,
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
				return await this.checkForBackendUpdates();
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
			async (_event, options?: { manual?: boolean }) => {
				logger.info(
					"Checking for all updates (UI and backend)...",
					LogFileType.UPDATE_SERVICE,
				);
				this.onCheckRequested(options);
				try {
					return await this.checkForAllUpdates();
				} catch (error) {
					logger.error(
						"Error checking for all updates:",
						LogFileType.UPDATE_SERVICE,
						error,
					);

					// Apply the same error filtering logic here
					const shouldFilter = this.shouldFilterUpdateError(error as Error);

					if (shouldFilter) {
						logger.info(
							"Error filtering result in check-for-all-updates: Reporting as no updates available",
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

					throw error;
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
	}

	/**
	 * Check for updates
	 * @param silent - Whether to show a notification if no update is available
	 */
	public async checkForUpdates(silent = false): Promise<void> {
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
				return;
			}

			// Handle npx installation case
			if (this.isNpxInstall) {
				logger.info(
					"Application was installed via npx. Checking npm registry for updates...",
					LogFileType.UPDATE_SERVICE,
				);

				if (!silent) {
					// Check npm registry for the latest version
					const currentVersion = app.getVersion();
					const latestVersion = await this.getLatestNpmVersion();

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
					}
				}
				return;
			}

			// Regular update flow for packaged app
			// Set silent mode for the autoUpdater
			autoUpdater.autoDownload = false;

			// Configure the autoUpdater to handle silent mode
			const originalNotAvailableHandler = autoUpdater.listeners(
				"update-not-available",
			)[0];

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

			// Check for updates
			await autoUpdater.checkForUpdates();

			// Restore original handler if we're in silent mode and modified it
			if (silent && originalNotAvailableHandler) {
				autoUpdater.removeAllListeners("update-not-available");
				autoUpdater.on(
					"update-not-available",
					originalNotAvailableHandler as (info: unknown) => void,
				);
			}
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

	public async checkForBackendUpdates(
		silent = false,
	): Promise<BackendUpdateInfo | null> {
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
				return null;
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
				return null;
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
				return null;
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
				return null;
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

				return updateInfo;
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

			return null;
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

			return null;
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
			{ timeoutMs: 120000 },
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
	 * @param silent - Whether to suppress notifications on no updates
	 */
	public async checkForAllUpdates(silent = false): Promise<void> {
		await this.checkForUpdates(silent);
		await this.checkForBackendUpdates(silent);
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
