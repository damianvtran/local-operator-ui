/**
 * Backend Service Manager
 *
 * This module is responsible for managing the Local Operator backend service.
 * It handles starting, stopping, and monitoring the health of the backend service.
 */

/**
 * Enum representing the different startup modes for the Local Operator server
 */
export enum LocalOperatorStartupMode {
	/** An existing server was detected, not managed by the backend service */
	EXISTING_SERVER = "EXISTING_SERVER",
	/** Server started using globally installed local-operator entrypoint */
	GLOBAL_INSTALL = "GLOBAL_INSTALL",
	/** Server started from the virtual environment created with bundled python */
	APP_BUNDLED_VENV = "APP_BUNDLED_VENV",
	/** Initial state before server has been started */
	NOT_STARTED = "NOT_STARTED",
}

import { type ChildProcess, exec, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { app, dialog as electronDialog } from "electron";
import type {
	DesktopFeedState,
	DesktopResponse,
} from "../../shared/desktop-contract";
import type { DesktopFeedFrame } from "../../shared/desktop-session-contract";
import { DesktopFeedRelay } from "../desktop-feed";
import {
	type DesktopMediaResponse,
	requestDesktopMedia,
} from "../desktop-media";
import { DesktopStreamRelay } from "../desktop-stream";
import { requestDesktop } from "../desktop-transport";
import { withPythonBytecodeCache } from "../python-bytecode-cache";
import { backendConfig } from "./config";
import { LogFileType, logger } from "./logger";
import { isLegacyManagedCommand } from "./managed-python";
import { managedVenvPath } from "./venv-paths";

import {
	consoleInterpreter,
	ownedServeLaunch,
	windowsInterpreterCandidates,
	windowsPathInterpreterCandidates,
} from "./owned-serve-launch";

/** Every `where`/`which local-operator` exec the start path runs, bounded.
 *
 * Two of them - the existence check, then the resolution - at one ceiling each
 * is the console half of the start path's worst case. The first used to have no
 * timeout at all, which made it the only unbounded step a quit waiting on a
 * start could land on (review round 3, F12); a bound that has to outlast this
 * work derives from this number rather than restating it. */
const CONSOLE_DISCOVERY_TIMEOUT_MS = 5_000;
export const CONSOLE_RESOLUTION_WORST_MS = 2 * CONSOLE_DISCOVERY_TIMEOUT_MS;

/** The shutdown escalation one `stop(false)` can spend before it gives up: the
 * normal grace, then the force hold after SIGKILL. Exported for the same reason
 * as the constant above - the quit failsafe is derived, not asserted. */
const SHUTDOWN_TIMEOUT_DEFAULTS = {
	restart: 10_000, // 10 seconds for restart operations
	normal: 5_000, // 5 seconds for normal shutdowns
	force: 3_000, // 3 seconds before force killing after SIGKILL
};
export const OWNED_STOP_WORST_MS =
	SHUTDOWN_TIMEOUT_DEFAULTS.normal + SHUTDOWN_TIMEOUT_DEFAULTS.force;

/** How long the readiness loop waits between attempts. Exported for the same
 * reason as the bounds above: the quit path's failsafe adds it up rather than
 * naming a number. */
export const READINESS_POLL_INTERVAL_MS = 1_000;

const execPromise = promisify(exec);

// Regex for parsing environment variable lines (moved to top-level for performance)
const ENV_VAR_REGEX = /^([^=]+)=(.*)$/;
const LINE_BREAK = /\r?\n/;

/**
 * One managed `serve` lifetime: the handle this app actually spawned, plus the
 * state that decides its shutdown.
 *
 * WHY a per-generation record rather than fields on the manager. Every
 * shutdown hazard here was a late callback acting on mutable manager state: a
 * predecessor's exit handler clearing the successor's `process`, an escalation
 * timer firing after a replacement had started, a stop resolving because
 * *something* exited. Anchoring exit state, the stop operation and its timers
 * to the captured child makes a stale generation structurally unable to reach
 * its successor - it holds a reference to its own record, which nothing else
 * consults once `ownedServe` has moved on.
 *
 * Ownership is the child handle and nothing else. A PID is not ownership (it
 * is reused), a responding port is not ownership (anyone may bind it), and a
 * matching process name is not ownership (other tools run backends too).
 */
interface OwnedServe {
	child: ChildProcess;
	exited: boolean;
	/** Resolves on the observed `exit` event - the only evidence of termination
	 * this class accepts. A delivered signal is a request, not a result. */
	exit: Promise<void>;
	resolveExit: () => void;
	/** Non-null once a stop is in flight, which makes it the shared promise every
	 * concurrent quit/restart/update caller awaits instead of starting a second
	 * termination sequence against the same child. */
	stop: Promise<void> | null;
	/** Escalation timers, held so this generation's exit cancels them; a timer
	 * that outlives its generation is how a replacement used to get killed. */
	timers: Set<NodeJS.Timeout>;
}

/**
 * Backend Service Manager class
 * Manages the Local Operator backend service
 */
export class BackendServiceManager {
	private process: ChildProcess | null = null;
	private isRunning = false;
	private isExternalBackend = false;
	private isDisabled = backendConfig.VITE_DISABLE_BACKEND_MANAGER === "true";
	private startupMode: LocalOperatorStartupMode =
		LocalOperatorStartupMode.NOT_STARTED;
	private port: number;
	private backendUrl: string;
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	private healthCheckInterval: NodeJS.Timeout | null = null;
	/** The only process this manager may terminate. Null means it owns nothing,
	 * which is a reason to report "nothing to stop" - never to go looking. */
	private ownedServe: OwnedServe | null = null;
	/** In-flight start, so a stop can await the resolver/readiness work that has
	 * not yet produced a child. Without it, cleanup can return before a spawn
	 * that was already committed, and the caller installs over a live serve. */
	private startPromise: Promise<boolean> | null = null;
	private restartPromise: Promise<boolean> | null = null;
	/** Bumped by every stop. A start that began under an older epoch cannot
	 * report success or adopt its child: the cancellation happened after it
	 * checked, and this is what it re-checks across each await. */
	private startEpoch = 0;
	private shellEnv: Record<string, string | undefined> = {};
	// External/dev backends may be explicitly paired through main's environment.
	// Managed starts always rotate this; it is never exposed by preload or logs.
	private desktopToken: string | null =
		process.env.LOCAL_OPERATOR_DESKTOP_TOKEN || null;

	/** Authenticated SSE relay for canonical session events. Recreated when the
	 * backend URL rotates (external-backend discovery) or the desktop token does
	 * (every managed start mints one), and dropped outright by `stop()`.
	 *
	 * WHY the token is part of the cache key. A URL-only key was the bug behind
	 * "every conversation opens empty": an in-place restart - the health-check
	 * watchdog, or "Update server" - keeps `backendUrl` at
	 * `http://127.0.0.1:1111` and rotates ONLY the token, so the cached relay
	 * went on authenticating with the credential of the process that had just
	 * been killed. Each `GET /v1/desktop/sessions/{id}/events` was refused 401
	 * while `sessions?limit=500` and `sessions.get` stayed 200 (those read the
	 * live token at call time), the renderer never received an `open` frame, and
	 * with no receipt its single auto-reconnect was skipped - so the transcript
	 * stayed empty until the app itself was restarted. */
	private streamRelay: DesktopStreamRelay | null = null;
	private streamRelayUrl = "";
	/** The token `streamRelay` was built with. Tracked beside the URL, not
	 * derived from it: the rotation above is exactly a case where the URL is
	 * unchanged and the token is not. */
	private streamRelayToken: string | null = null;
	/** Survives relay recreation so notifications never silently detach
	 * when the backend URL rotates. */
	private streamObserver: ((sessionId: string, data: string) => void) | null =
		null;

	/**
	 * The machine-wide desktop feed relay, rebuilt when the backend URL rotates
	 * for the same reason the stream relay is: a subscription must never pin a
	 * stale origin. Held HERE rather than in `index.ts` because the desktop
	 * bearer lives in this class and is never exposed — the feed needs it to
	 * carry an SSE connection and to beat the presence lease.
	 */
	private feedRelay: DesktopFeedRelay | null = null;
	private feedRelayUrl = "";
	/** Both survive relay recreation, so a URL rotation cannot silently detach
	 * the banner path or leave the sidebar reading a stale connection state. */
	private feedFrameObserver: ((frame: DesktopFeedFrame) => void) | null = null;
	private feedStateObserver: ((state: DesktopFeedState) => void) | null = null;

	/**
	 * Called every time the backend becomes reachable and authenticated.
	 *
	 * The desktop token is minted inside `start()`, so anything that must query
	 * the backend cannot be issued from `app.whenReady()` — at that point the
	 * port is dead on the ordinary self-managed cold start and the request is
	 * lost. This fires after the health check passes, which is the first moment
	 * `requestDesktop` can succeed.
	 *
	 * It fires AGAIN on every restart and on external-backend discovery, on
	 * purpose: the backend underneath a running app can be replaced by a
	 * different version, and a capability read taken once at startup would
	 * outlive the backend it described.
	 */
	private backendReadyObserver: (() => void) | null = null;

	onBackendReady(observer: (() => void) | null): void {
		this.backendReadyObserver = observer;
	}

	private notifyBackendReady(): void {
		try {
			this.backendReadyObserver?.();
		} catch (error) {
			// A consumer's failure must never take down backend startup: the
			// backend is up either way, and this is a notification, not a step.
			logger.error("Backend-ready observer threw:", LogFileType.BACKEND, error);
		}
	}

	getStreamRelay(): DesktopStreamRelay {
		if (
			!this.streamRelay ||
			this.streamRelayUrl !== this.backendUrl ||
			this.streamRelayToken !== this.desktopToken
		) {
			this.streamRelay?.dispose();
			this.streamRelay = new DesktopStreamRelay(
				this.backendUrl,
				this.desktopToken,
			);
			this.streamRelay.observe(this.streamObserver);
			this.streamRelayUrl = this.backendUrl;
			this.streamRelayToken = this.desktopToken;
		}
		return this.streamRelay;
	}

	/**
	 * Drop the relay and its streams.
	 *
	 * Called from `stop()` so an in-place restart cannot leave a stream bound to
	 * the token of the process being stopped - the open streams are aborted
	 * deliberately, which the renderer sees as a stream `end` and recovers from
	 * with a bounded retry rather than waiting for a frame that will never come.
	 *
	 * `streamRelayToken` is cleared rather than left at the retired value: the
	 * next `getStreamRelay()` must not be able to answer "already built" for a
	 * token whose relay no longer exists.
	 */
	private disposeStreamRelay(): void {
		this.streamRelay?.dispose();
		this.streamRelay = null;
		this.streamRelayUrl = "";
		this.streamRelayToken = null;
	}

	observeStream(
		observer: ((sessionId: string, data: string) => void) | null,
	): void {
		this.streamObserver = observer;
		this.streamRelay?.observe(observer);
	}

	/**
	 * The machine-wide feed, rebuilt when the backend URL rotates.
	 *
	 * Lazily constructed for the same reason `getStreamRelay` is: the desktop
	 * token is minted inside `start()`, so a relay built at `app.whenReady()`
	 * would capture `null` and never authenticate. Callers reach for it from the
	 * backend-ready hook, which is the first moment the token exists.
	 */
	getDesktopFeedRelay(): DesktopFeedRelay {
		if (!this.feedRelay || this.feedRelayUrl !== this.backendUrl) {
			this.feedRelay?.stop();
			this.feedRelay = new DesktopFeedRelay(
				this.backendUrl,
				this.desktopToken,
				{
					request: (input) => this.requestDesktop(input),
					// The presence beat is a contract op, so it travels the same
					// authenticated transport as every other control and the token
					// never leaves this class.
					beatPresence: (subscriptionId, canNotify) =>
						this.requestDesktop({
							op: "sessions.presence",
							subscriptionId,
							canNotify,
						}),
				},
			);
			this.feedRelay.observe(this.feedFrameObserver);
			this.feedRelay.watchState(this.feedStateObserver);
			this.feedRelayUrl = this.backendUrl;
		}
		return this.feedRelay;
	}

	observeDesktopFeed(
		frameObserver: ((frame: DesktopFeedFrame) => void) | null,
		stateObserver: ((state: DesktopFeedState) => void) | null,
	): void {
		this.feedFrameObserver = frameObserver;
		this.feedStateObserver = stateObserver;
		this.feedRelay?.observe(frameObserver);
		this.feedRelay?.watchState(stateObserver);
	}

	requestDesktop(input: unknown): Promise<DesktopResponse> {
		return requestDesktop(input, this.backendUrl, this.desktopToken);
	}

	requestDesktopMedia(
		input: unknown,
		bytes: Uint8Array<ArrayBuffer> | null,
	): Promise<DesktopMediaResponse> {
		return requestDesktopMedia(
			input,
			bytes,
			this.backendUrl,
			this.desktopToken,
		);
	}
	private isAppClosing = false; // Flag to track when the app is being closed
	private isAutoUpdating = false; // Flag to track when an autoupdate is in progress
	private shutdownTimeoutMs = { ...SHUTDOWN_TIMEOUT_DEFAULTS }; // Configurable timeouts for different shutdown scenarios

	/**
	 * Constructor
	 */
	constructor() {
		// Extract port from API URL
		try {
			const apiUrl = new URL(backendConfig.VITE_LOCAL_OPERATOR_API_URL);
			this.port = Number.parseInt(apiUrl.port, 10) || 1111; // Default to 1111 if port is not specified

			// Use explicit IPv4 address instead of localhost for better compatibility
			this.backendUrl = `http://127.0.0.1:${this.port}`;

			logger.info(
				`Backend service configured with port ${this.port} and URL ${this.backendUrl}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			// Fallback to default values if URL parsing fails
			this.port = 1111;
			this.backendUrl = `http://127.0.0.1:${this.port}`;

			logger.error(
				`Error parsing API URL, using default port ${this.port}`,
				LogFileType.BACKEND,
				error,
			);
		}

		// The app-managed venv for THIS instance - a packaged install and an
		// unpackaged one must not share it, or the dev instance's backend imports its
		// stdlib out of the installed, code-sealed bundle (see `managedVenvPath`).
		this.venvPath = managedVenvPath({
			platform: process.platform,
			home: app.getPath("home"),
			appDataPath: this.appDataPath,
			packaged: app.isPackaged,
		});

		// Load shell environment variables
		this.loadShellEnvironment();

		// Log initialization status
		logger.info(
			`Backend Service Manager initialized. Disabled: ${this.isDisabled}`,
			LogFileType.BACKEND,
		);
		logger.info(
			`Virtual environment path: ${this.venvPath}`,
			LogFileType.BACKEND,
		);
	}

	/**
	 * Load shell environment variables from user's shell configuration files
	 * This ensures that programs like gh and brew that are in the PATH are available to the backend service
	 */
	private async loadShellEnvironment(): Promise<void> {
		try {
			// Start with current process environment
			this.shellEnv = { ...process.env };

			// Platform-specific shell environment loading
			if (process.platform === "darwin") {
				// macOS: Source .zshrc or .bash_profile
				await this.loadMacOSEnvironment();
			} else if (process.platform === "linux") {
				// Linux: Source .bashrc or .zshrc
				await this.loadLinuxEnvironment();
			} else if (process.platform === "win32") {
				// Windows: Load from registry and user profile
				await this.loadWindowsEnvironment();
			} else {
				logger.error(
					"Unsupported platform for shell environment loading",
					LogFileType.BACKEND,
				);
			}

			// Log the PATH environment variable to verify it's loaded correctly
			logger.info(
				`Shell environment variables loaded successfully. PATH: ${this.shellEnv.PATH || this.shellEnv.Path || "(not set)"}`,
				LogFileType.BACKEND,
			);

			// Half of a deliberate belt-and-braces pair (the other half is
			// `backendSpawnEnv()`, which every spawn calls): this line corrects a
			// value the platform loaders above can inject from the operator's shell
			// rc, and it is what every OTHER reader of `shellEnv` inherits. It alone
			// is not enough, because this method is started un-awaited from the
			// constructor and nothing sequences it against `start()` - see
			// `backendSpawnEnv()` for the ordering hole and why the guarantee lives
			// there.
			this.shellEnv = withPythonBytecodeCache(this.shellEnv, this.appDataPath);
		} catch (error) {
			logger.error(
				"Error loading shell environment variables:",
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * The environment the backend process is spawned with.
	 *
	 * The prefix is applied HERE, at the point the environment is handed to the
	 * spawn, rather than only inside `loadShellEnvironment()`. That load is
	 * started from the constructor without `await` (a constructor cannot wait)
	 * and `start()` has nothing sequencing it, so a shell rc that takes seconds
	 * to source - nvm, pyenv, conda init all do - leaves `shellEnv` at its
	 * `{ ...process.env }` seed when the first spawn happens: no prefix, and the
	 * exact pre-fix configuration, on the machines whose rc is slowest. Applying
	 * it here makes the guarantee structural instead of ordering-dependent, so
	 * no spawn path can miss it.
	 *
	 * These spawns are the ones whose `python` is the interpreter we ship:
	 * CPython writes `__pycache__/*.pyc` beside the sources it imports, those
	 * sources are inside the code-sealed `.app`, and every such write breaks the
	 * signature ShipIt validates before an in-place update.
	 */
	private backendSpawnEnv(): Record<string, string | undefined> {
		return {
			...withPythonBytecodeCache(this.shellEnv, this.appDataPath),
			// Managed starts rotate the token; set after the spread so the spawn
			// can never inherit a stale one from the shell environment. `start()`
			// mints it before it can reach a spawn site, so the `??` only satisfies
			// the field's nullable seed from `process.env`.
			LOCAL_OPERATOR_DESKTOP_TOKEN: this.desktopToken ?? undefined,
		};
	}

	/**
	 * Load environment variables from macOS shell configuration files
	 */
	private async loadMacOSEnvironment(): Promise<void> {
		const home = os.homedir();
		const possibleFiles = [
			join(home, ".zshrc"),
			join(home, ".bash_profile"),
			join(home, ".bashrc"),
			join(home, ".profile"),
		];

		// Find the first shell config file that exists
		let shellConfigFile: string | null = null;
		for (const file of possibleFiles) {
			if (fs.existsSync(file)) {
				shellConfigFile = file;
				break;
			}
		}

		if (!shellConfigFile) {
			logger.info(
				"No shell configuration file found on macOS",
				LogFileType.BACKEND,
			);
			return;
		}

		try {
			// Execute a command that sources the shell config file and prints the environment
			const { stdout } = await execPromise(
				`source "${shellConfigFile}" && env`,
				{ shell: "/bin/bash" },
			);

			// Parse the environment variables
			const envVars = stdout.split("\n");
			for (const line of envVars) {
				const match = line.match(ENV_VAR_REGEX);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			logger.info(
				`Loaded environment variables from ${shellConfigFile}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				`Error loading environment from ${shellConfigFile}:`,
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Load environment variables from Linux shell configuration files
	 */
	private async loadLinuxEnvironment(): Promise<void> {
		const home = os.homedir();
		const possibleFiles = [
			join(home, ".bashrc"),
			join(home, ".zshrc"),
			join(home, ".profile"),
		];

		// Find the first shell config file that exists
		let shellConfigFile: string | null = null;
		for (const file of possibleFiles) {
			if (fs.existsSync(file)) {
				shellConfigFile = file;
				break;
			}
		}

		if (!shellConfigFile) {
			logger.info(
				"No shell configuration file found on Linux",
				LogFileType.BACKEND,
			);
			return;
		}

		try {
			// Execute a command that sources the shell config file and prints the environment
			const { stdout } = await execPromise(
				`bash -c "source \\"${shellConfigFile}\\" && env"`,
				{ shell: "/bin/bash" },
			);

			// Parse the environment variables
			const envVars = stdout.split("\n");
			for (const line of envVars) {
				const match = line.match(ENV_VAR_REGEX);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			logger.info(
				`Loaded environment variables from ${shellConfigFile}`,
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				`Error loading environment from ${shellConfigFile}:`,
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Load environment variables from Windows user profile
	 */
	private async loadWindowsEnvironment(): Promise<void> {
		try {
			// On Windows, we can use the 'set' command to get environment variables
			const { stdout } = await execPromise("set", { shell: "cmd.exe" });

			// Parse the environment variables
			const envVars = stdout.split("\r\n");
			for (const line of envVars) {
				const match = line.match(ENV_VAR_REGEX);
				if (match) {
					const [, key, value] = match;
					this.shellEnv[key] = value;
				}
			}

			// Explicitly check for and add pyenv-win paths
			// These might not be in the current process environment yet if they were just set
			const userProfile = process.env.USERPROFILE || os.homedir();
			const pyenvDir = join(userProfile, ".pyenv");
			const pyenvBinPath = join(pyenvDir, "pyenv-win", "bin");
			const pyenvShimsPath = join(pyenvDir, "pyenv-win", "shims");

			// Check if these directories exist
			if (fs.existsSync(pyenvBinPath) && fs.existsSync(pyenvShimsPath)) {
				logger.info(
					`Found pyenv-win directories at ${pyenvBinPath} and ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);

				// Add to PATH if not already there
				const currentPath = this.shellEnv.PATH || "";
				if (!currentPath.includes(pyenvBinPath)) {
					this.shellEnv.PATH = `${pyenvBinPath};${currentPath}`;
				}
				if (!currentPath.includes(pyenvShimsPath)) {
					this.shellEnv.PATH = `${pyenvShimsPath};${this.shellEnv.PATH}`;
				}

				// Set PYENV and PYENV_HOME environment variables
				const pyenvWinPath = join(pyenvDir, "pyenv-win");
				this.shellEnv.PYENV = pyenvWinPath;
				this.shellEnv.PYENV_HOME = pyenvWinPath;

				logger.info(
					`Added pyenv-win paths to environment. PATH now includes: ${pyenvBinPath} and ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);
			} else {
				logger.info(
					`pyenv-win directories not found at ${pyenvBinPath} or ${pyenvShimsPath}`,
					LogFileType.BACKEND,
				);
			}

			// Add the virtual environment Scripts directory to PATH
			// This ensures we can find the local-operator executable
			const venvScriptsPath = join(this.venvPath, "Scripts");
			if (fs.existsSync(venvScriptsPath)) {
				const currentPath = this.shellEnv.PATH || "";
				if (!currentPath.includes(venvScriptsPath)) {
					this.shellEnv.PATH = `${venvScriptsPath};${currentPath}`;
					logger.info(
						`Added virtual environment Scripts directory to PATH: ${venvScriptsPath}`,
						LogFileType.BACKEND,
					);
				}
			}

			logger.info(
				"Loaded environment variables from Windows user profile",
				LogFileType.BACKEND,
			);
		} catch (error) {
			logger.error(
				"Error loading environment from Windows user profile:",
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * Check if the local-operator command exists globally
	 * @returns Promise resolving to true if the command exists, false otherwise
	 */
	async checkLocalOperatorExists(): Promise<boolean> {
		try {
			const command =
				process.platform === "win32"
					? "where local-operator"
					: "which local-operator";

			logger.info(
				`Checking if local-operator command exists: ${command}`,
				LogFileType.BACKEND,
			);

			const { stdout } = await execPromise(command, {
				// Bounded: a quit that arrives mid-start waits on this same path, and an
				// unbounded child here is a wait with nothing underneath it.
				timeout: CONSOLE_DISCOVERY_TIMEOUT_MS,
				windowsHide: true,
			});

			if (stdout.trim()) {
				if (
					process.platform === "darwin" &&
					isLegacyManagedCommand(
						stdout.trim().split("\n")[0],
						join(
							app.getPath("home"),
							"Library",
							"Application Support",
							"Local Operator",
						),
					)
				) {
					logger.info(
						"The PATH command belongs to a legacy managed environment; preparing a separate backend instead",
						LogFileType.BACKEND,
					);
					return false;
				}
				logger.info(
					`local-operator command found at: ${stdout.trim()}`,
					LogFileType.BACKEND,
				);
				return true;
			}
		} catch (_error) {
			logger.info(
				"local-operator command not found globally",
				LogFileType.BACKEND,
			);
		}

		return false;
	}

	/**
	 * True when this app holds a desktop credential for the configured backend.
	 *
	 * This is the RELAY's own `available` fact, asked here rather than re-derived,
	 * so that adopting a backend and streaming from it agree on what "we can talk
	 * to this server" means. A server this app holds no token for is one it can
	 * never authenticate to: adopting it attaches the renderer to a backend that
	 * refuses every session list and every stream - the empty-conversation
	 * outcome this whole subsystem exists to remove.
	 */
	private canAuthenticate(): boolean {
		return this.getStreamRelay().available;
	}

	/**
	 * Ask the answering backend whether it will accept this app's bearer.
	 *
	 * A `/health` 200 proves a process is listening, not that it is OURS. The
	 * desktop vocabulary answers 401/403 for a bearer it does not hold, so one
	 * authenticated read is what separates a legitimate paired backend from a
	 * stranger that happens to occupy the port.
	 */
	private async authenticatesAgainstBackend(): Promise<boolean> {
		try {
			const result = await this.requestDesktop({
				op: "sessions.list",
				limit: 1,
			});
			return result.status >= 200 && result.status < 300;
		} catch {
			return false;
		}
	}

	/**
	 * Check if an external backend is already running AND usable by this app.
	 *
	 * WHY the pairing gate. A liveness probe alone made adoption a decision this
	 * app was not entitled to: `checkExistingBackend()` fired against the
	 * CONFIGURED origin, so an app pointed at one port could still adopt whatever
	 * answered a hardcoded fallback on another one, with no desktop token - i.e.
	 * it attached itself to a backend it could never authenticate to, and every
	 * conversation opened empty. The old code even rotated `backendUrl` onto that
	 * fallback origin, so a rig configured for an isolated port silently became a
	 * client of the operator's live server (QA round 1, Q-1).
	 *
	 * Two rules replace it: the probe only ever targets the configured origin, and
	 * a healthy answer is only adopted when this app can authenticate to it.
	 * Declining is not a failure - `start()` spawns our own backend exactly as it
	 * would have on a cold start.
	 *
	 * @returns Promise resolving to true if a paired external backend is running
	 */
	async checkExistingBackend(): Promise<boolean> {
		if (this.isDisabled) {
			logger.info(
				"Backend Service Manager is disabled. Assuming external backend is available.",
				LogFileType.BACKEND,
			);
			return true;
		}

		if (!this.canAuthenticate()) {
			logger.info(
				"No desktop pairing token for the configured backend; not adopting an external backend.",
				LogFileType.BACKEND,
			);
			return false;
		}

		try {
			logger.info(
				`Checking for external backend at ${this.backendUrl}/health`,
				LogFileType.BACKEND,
			);

			// Set a shorter timeout for the fetch request
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

			const response = await fetch(`${this.backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			logger.info(
				`External backend health check response status: ${response.status}`,
				LogFileType.BACKEND,
			);

			if (response.ok) {
				if (!(await this.authenticatesAgainstBackend())) {
					logger.info(
						"A backend answered health but refused this app's desktop token; starting our own instead.",
						LogFileType.BACKEND,
					);
					return false;
				}
				logger.info(
					"External backend detected, healthy and paired",
					LogFileType.BACKEND,
				);
				this.isExternalBackend = true;
				this.notifyBackendReady();
				return true;
			}
		} catch (error) {
			logger.error(
				"Error checking external backend:",
				LogFileType.BACKEND,
				error,
			);
			logger.info(
				"No external backend detected or backend is not healthy",
				LogFileType.BACKEND,
			);
		}

		return false;
	}

	/** Keep PATH discovery authoritative; `ownedServeLaunch` proves the identity
	 * of what it found rather than trusting the name it was resolved under. */
	private async resolveGlobalConsole(env: NodeJS.ProcessEnv): Promise<string> {
		const { stdout } = await execPromise(
			process.platform === "win32"
				? "where local-operator"
				: "which local-operator",
			{ env, timeout: CONSOLE_DISCOVERY_TIMEOUT_MS },
		);
		return stdout.trim().split(LINE_BREAK)[0];
	}

	/**
	 * Start the backend service
	 * @returns Promise resolving to true if the backend was started successfully, false otherwise
	 */
	start(): Promise<boolean> {
		// `stop(false)` is terminal by design: the app is going away or handing the
		// installation over, and a spawn racing that hand-off is the double-serve
		// case. A restart asks for `stop(true)`, which leaves this flag alone.
		if (this.isAppClosing) return Promise.resolve(false);
		if (this.startPromise) return this.startPromise;
		this.startPromise = this.startOwned(this.startEpoch).finally(() => {
			this.startPromise = null;
		});
		return this.startPromise;
	}

	private async startOwned(epoch: number): Promise<boolean> {
		if (this.ownedServe?.stop) return false;
		if (this.ownedServe) return this.isRunning;

		if (this.isDisabled) {
			logger.info(
				"Backend Service Manager is disabled. Skipping backend start.",
				LogFileType.BACKEND,
			);
			this.notifyBackendReady();
			return true;
		}

		// First check if an external backend is already running
		const existing = await this.checkExistingBackend();
		if (epoch !== this.startEpoch || this.isAppClosing) return false;
		if (existing) {
			this.isRunning = true;
			this.startupMode = LocalOperatorStartupMode.EXISTING_SERVER;
			this.startHealthCheck();
			// NO `notifyBackendReady()` here. `checkExistingBackend()` already
			// fired it on both paths that can return true from HERE — its
			// `isDisabled` early return is unreachable at this point, because the
			// disabled branch above returns first — and it fires it AFTER the
			// alternative-URL rotation, which is the ordering a consumer re-reading
			// capabilities needs. Firing again raised two concurrent capability
			// probes on the ordinary external-backend start, doubling that traffic
			// and letting the OLDER read decide the result by settling last
			// (review round 2, R2-2). The notifier is also generation-guarded now,
			// so a duplicate is no longer incorrect — it is merely wasted.
			return true;
		}

		// No external backend, start our own
		this.desktopToken = randomBytes(32).toString("hex");
		// The generation THIS start creates, retained so a failure below cleans up
		// its own child: by then `this.ownedServe` may name a successor.
		let captured: OwnedServe | null = null;
		try {
			// Installation can select a new generation after this manager is built.
			// Once started, this instance pins that generation until its next start.
			this.venvPath = managedVenvPath({
				platform: process.platform,
				home: app.getPath("home"),
				appDataPath: this.appDataPath,
				packaged: app.isPackaged,
			});
			const globalInstall = await this.checkLocalOperatorExists();
			const env = this.backendSpawnEnv();
			/*
			 * The interpreter to own, as CLAIMS rather than one path.
			 *
			 * POSIX reads the console script's shebang, which names the interpreter
			 * exactly. Windows cannot: the launcher is a PE shim, and the directory it
			 * was found in need not hold an interpreter at all - uv's executable
			 * directory holds versioned shims while the tool environment lives in
			 * another tree - so this side asks for every layout that could carry the
			 * backend and lets the identity probe admit one. A wrong assumption here is
			 * an app that cannot start (review round 2, F8).
			 */
			let interpreters: string[];
			if (globalInstall) {
				this.startupMode = LocalOperatorStartupMode.GLOBAL_INSTALL;
				const executable = await this.resolveGlobalConsole(env);
				interpreters =
					process.platform === "win32"
						? await windowsInterpreterCandidates(executable, env)
						: [consoleInterpreter(executable)];
			} else {
				this.startupMode = LocalOperatorStartupMode.APP_BUNDLED_VENV;
				const bin = join(
					this.venvPath,
					process.platform === "win32" ? "Scripts" : "bin",
				);
				interpreters = [
					join(bin, process.platform === "win32" ? "python.exe" : "python"),
				];
				// Preserve activation's environment without leaving an activation
				// shell between the ChildProcess handle and the actual HTTP server.
				env.VIRTUAL_ENV = this.venvPath;
				env.PATH = `${bin}${process.platform === "win32" ? ";" : ":"}${env.PATH ?? ""}`;
				env.PYTHONHOME = undefined;
			}
			const launch = await ownedServeLaunch(
				interpreters,
				this.port,
				env,
				process.platform,
				{},
				// The PATH-side claims spawn discovery children, so they are offered
				// only after the claims above have all failed (round 3, F14).
				process.platform === "win32"
					? () => windowsPathInterpreterCandidates(env)
					: undefined,
			);
			if (epoch !== this.startEpoch || this.isAppClosing) return false;
			const child = spawn(launch.command, launch.args, {
				detached: false,
				stdio: "pipe",
				// The plan owns the environment it proved: a Windows venv's base
				// interpreter needs the venv's import paths, added there and not here.
				env: launch.env,
				windowsHide: true,
			});
			const generation = this.captureServe(child);
			captured = generation;

			// Log output
			if (child.stdout) {
				child.stdout.on("data", (data) => {
					logger.info(`Backend stdout: ${data}`, LogFileType.BACKEND);
				});
			}

			if (child.stderr) {
				child.stderr.on("data", (data) => {
					logger.error(`Backend stderr: ${data}`, LogFileType.BACKEND);
				});
			}

			// Wait for backend to be healthy
			let attempts = 0;
			const maxAttempts = 30; // 30 seconds timeout

			while (attempts < maxAttempts) {
				const healthy = await this.checkHealth();
				if (epoch !== this.startEpoch || generation.exited || generation.stop)
					break;
				if (healthy) {
					this.isRunning = true;
					this.startHealthCheck();
					this.notifyBackendReady();
					return true;
				}

				// Wait 1 second before next attempt
				await new Promise((resolve) =>
					setTimeout(resolve, READINESS_POLL_INTERVAL_MS),
				);
				attempts++;
			}

			await this.stopGeneration(generation, false);
			if (epoch !== this.startEpoch) return false;
			logger.error(
				"Failed to start backend service after multiple attempts",
				LogFileType.BACKEND,
			);

			// Report the failure without parking the main thread - see
			// `reportStartFailure` for why the modal is suppressed on the quit path.
			this.reportStartFailure(
				"Backend Error",
				"Failed to start the Local Operator backend service. Please check the logs for more information.",
			);

			return false;
		} catch (error) {
			/*
			 * Clean up the generation this start created, not whatever manager state
			 * names: `this.ownedServe` can already hold a replacement (the watchdog
			 * spawns one) and stopping that would kill a live backend.
			 *
			 * `stopGeneration` memoises one promise per generation, so a cleanup whose
			 * own attempt already failed throws the SAME rejection here. Awaiting it
			 * unguarded rethrows past the dialog below and turns this method into a
			 * rejection - and `start()` is awaited by `checkUnhealthyBackend`, which
			 * runs from a void'd `setInterval`, so under Node's default
			 * `--unhandled-rejections=throw` the app died of an exception raised while
			 * reporting that it could not stop its own child (review round 1, F3).
			 * An unconfirmed cleanup is a fact to report, not a reason to lose the
			 * report.
			 */
			if (captured) {
				try {
					await this.stopGeneration(captured, false);
				} catch (cleanupError) {
					logger.error(
						"Owned backend cleanup after a failed start did not confirm exit",
						LogFileType.BACKEND,
						cleanupError,
					);
				}
			}
			logger.error(
				"Error starting backend service:",
				LogFileType.BACKEND,
				error,
			);

			// Report the failure without parking the main thread - see
			// `reportStartFailure` for why the modal is suppressed on the quit path.
			this.reportStartFailure(
				"Backend Error",
				`Error starting the Local Operator backend service: ${error}`,
			);

			return false;
		}
	}

	/**
	 * Stop only the captured serve generation, including failed startups. A port
	 * or process name is not ownership. Unconfirmed exit blocks replacement.
	 */
	async stop(isRestart = false): Promise<void> {
		this.startEpoch++;
		if (!isRestart) this.isAppClosing = true;
		this.disposeStreamRelay();
		this.stopHealthCheck();
		const generation = this.ownedServe;
		if (generation) await this.stopGeneration(generation, isRestart);
		// Resolver/readiness work must observe cancellation before an installer
		// is allowed to replace files, even when stop arrived before spawn.
		await this.startPromise;
	}

	private captureServe(child: ChildProcess): OwnedServe {
		let resolveExit = () => {};
		const generation: OwnedServe = {
			child,
			exited: false,
			exit: new Promise<void>((resolve) => {
				resolveExit = resolve;
			}),
			resolveExit: () => resolveExit(),
			stop: null,
			timers: new Set(),
		};
		this.ownedServe = generation;
		this.process = child;
		const exited = (code?: number | null) => {
			if (generation.exited) return;
			generation.exited = true;
			// This generation's escalation timers die with it, so a SIGKILL armed
			// for a process that has already gone cannot fire at a successor that
			// took its place in the meantime.
			for (const timer of generation.timers) clearTimeout(timer);
			generation.timers.clear();
			generation.resolveExit();
			// A LATE exit from a retired generation stops here. Everything below
			// writes manager-wide state, and a predecessor writing it is how a live
			// replacement used to be recorded as gone (and then re-spawned over).
			if (this.ownedServe !== generation) return;
			this.ownedServe = null;
			this.process = null;
			this.isRunning = false;
			// Only an exit nobody asked for is an error worth interrupting the user
			// for. `generation.stop` covers the deliberate kills - including the
			// Windows exit code 1 that a terminated serve reports, which the previous
			// code had to special-case by platform because it could not tell a
			// requested termination from a crash.
			if (
				code != null &&
				code !== 0 &&
				!generation.stop &&
				!this.isAppClosing &&
				!this.isAutoUpdating
			) {
				electronDialog.showErrorBox(
					"Backend Error",
					`The Local Operator backend service exited unexpectedly with code ${code}. Please restart the application.`,
				);
			}
		};
		child.once("exit", exited);
		child.on("error", (error) => {
			logger.error("Owned backend process error", LogFileType.BACKEND, error);
			// Spawn failure has no process. A signal error with a PID does not
			// prove exit and must retain ownership for fail-closed cleanup.
			if (child.pid === undefined) exited();
		});
		return generation;
	}

	/** Signals may only be sent while the handle itself still reports a live
	 * process. Node keeps `kill()` callable on a reaped child, and on a PID the
	 * OS has since recycled that call reaches whatever now holds the number. */
	private canSignal(generation: OwnedServe): boolean {
		return (
			!generation.exited &&
			generation.child.exitCode === null &&
			generation.child.signalCode === null
		);
	}

	/**
	 * The one termination sequence: SIGTERM, wait out the grace, SIGKILL, wait
	 * again, and throw if the process never reported exit.
	 *
	 * Failing rather than returning is the point. Callers use a resolved stop as
	 * permission to replace the backend - install over it, spawn a successor - so
	 * "we signalled it and moved on" would authorise exactly the double-serve
	 * this class exists to prevent. An unconfirmed exit keeps ownership, and the
	 * caller reports failure instead of proceeding.
	 */
	private stopGeneration(
		generation: OwnedServe,
		isRestart: boolean,
	): Promise<void> {
		if (generation.stop) return generation.stop;
		generation.stop = (async () => {
			const waitForExit = (ms: number) =>
				new Promise<boolean>((resolve) => {
					if (generation.exited) {
						resolve(true);
						return;
					}
					const timer = setTimeout(() => {
						generation.timers.delete(timer);
						resolve(false);
					}, ms);
					generation.timers.add(timer);
					void generation.exit.then(() => {
						clearTimeout(timer);
						generation.timers.delete(timer);
						resolve(true);
					});
				});
			if (this.canSignal(generation)) generation.child.kill("SIGTERM");
			const grace = isRestart
				? this.shutdownTimeoutMs.restart
				: this.shutdownTimeoutMs.normal;
			if (!(await waitForExit(grace))) {
				if (this.canSignal(generation)) generation.child.kill("SIGKILL");
				if (!(await waitForExit(this.shutdownTimeoutMs.force))) {
					throw new Error(
						"Owned backend exit is unconfirmed; refusing replacement",
					);
				}
			}
			if (!isRestart && !this.ownedServe)
				this.startupMode = LocalOperatorStartupMode.NOT_STARTED;
			logger.info("Owned backend generation stopped", LogFileType.BACKEND);
		})();
		return generation.stop;
	}

	private stopHealthCheck(): void {
		if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
		this.healthCheckInterval = null;
	}

	/** Whether a quit may proceed. `will-quit` cannot await a listener, so it
	 * prevents the first quit, runs cleanup, and asks this on the retry. */
	/** Whether a shutdown is in flight.
	 *
	 * `stop(false)` is terminal and is what the quit path calls, so this is the
	 * state a caller checks before raising blocking UI it would never be able to
	 * dismiss - `index.ts`'s start-failure paths are the callers. */
	isShuttingDown(): boolean {
		return this.isAppClosing;
	}

	/**
	 * Report a start failure to the user - unless the app is on its way out.
	 *
	 * `showErrorBox` is a native modal: it parks the main thread until somebody
	 * dismisses it, and Electron cannot run the quit it was asked for past a
	 * parked thread. On the quit path that is not a message, it is a deadlock -
	 * the quit has already prevented itself, the owned cleanup it waits on can
	 * never finish, and the quit's own failsafe cannot even fire, because that is
	 * a timer on the thread the dialog holds (review round 4, Q-20: a SIGTERM
	 * during the first start left the app alive 50 s later with the failsafe line
	 * never logged). A shutdown in flight logs the failure instead, where the
	 * post-mortem finds it without the process still being up.
	 */
	private reportStartFailure(title: string, message: string): void {
		if (this.isAppClosing) {
			logger.error(
				`${title} (not shown; the app is shutting down): ${message}`,
				LogFileType.BACKEND,
			);
			return;
		}
		electronDialog.showErrorBox(title, message);
	}

	isOwnedCleanupComplete(): boolean {
		return this.isAppClosing && !this.ownedServe && !this.startPromise;
	}

	/** Synchronous exit cannot await cleanup. Canonical runtimes deliberately
	 * outlive their HTTP server, so neither PID rediscovery nor descent is safe. */
	emergencyStopOwned(): void {
		this.startEpoch++;
		this.isAppClosing = true;
		const generation = this.ownedServe;
		if (
			generation &&
			!generation.exited &&
			generation.child.exitCode === null &&
			generation.child.signalCode === null
		) {
			generation.child.kill("SIGKILL");
		}
	}

	/**
	 * Check if backend is healthy
	 * @returns Promise resolving to true if the backend is healthy, false otherwise
	 */
	async checkHealth(): Promise<boolean> {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3000);

			const response = await fetch(`${this.backendUrl}/health`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			logger.info(
				`Backend health check response status: ${response.status}`,
				LogFileType.BACKEND,
			);

			return response.ok;
		} catch (_error) {
			return false;
		}
	}

	/**
	 * Start health check interval
	 * Periodically checks the health of the backend service
	 */
	private startHealthCheck(): void {
		// Clear existing interval if any
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
		}

		// Start new interval
		this.healthCheckInterval = setInterval(() => {
			void this.checkUnhealthyBackend();
		}, 30000); // Check every 30 seconds
	}

	/**
	 * The watchdog's action for one unhealthy sample.
	 *
	 * A method rather than a closure body so the restart INTENT below is
	 * assertable without waiting out a 30s interval.
	 */
	private async checkUnhealthyBackend(): Promise<void> {
		const epoch = this.startEpoch;
		const isHealthy = await this.checkHealth();
		if (
			epoch !== this.startEpoch ||
			this.isAppClosing ||
			this.isAutoUpdating ||
			this.isDisabled
		)
			return;
		if (isHealthy) return;

		logger.info("Backend health check failed", LogFileType.BACKEND);

		if (this.isExternalBackend) {
			// External backend is no longer healthy
			this.isExternalBackend = false;
			this.isRunning = false;

			// Try to start our own backend
			await this.start();
			return;
		}

		/*
		 * A child that EXITED is not covered by the restart below: its `exit` handler
		 * nulls `this.process`, and this method used to return early on that fact, so
		 * nothing ever brought the backend back. The renderer's Retry could re-arm
		 * the stream but could never succeed, and the failure it showed named the
		 * stream instead of the missing server (QA round 1, Q-2). The watchdog is the
		 * only thing in the app that owns the process lifecycle, so the recovery
		 * lives here; `start()` re-runs its own adoption check and spawns a
		 * replacement.
		 *
		 * The guards are the states in which a spawn would fight the user or another
		 * actor: a disabled manager never owns a process, a closing app is going
		 * away, and an update is mid-handoff to the new version - `update-service`
		 * restarts the backend itself there. Without them a shutdown could race a
		 * spawn it just killed.
		 */
		if (!this.process) {
			if (this.isDisabled || this.isAppClosing || this.isAutoUpdating) return;
			logger.info(
				"Backend process is gone; starting a replacement",
				LogFileType.BACKEND,
			);
			await this.start();
			return;
		}

		await this.restart();
	}

	/**
	 * Get the port number used by the backend service
	 * @returns The port number
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * Check if the backend service is using an external backend
	 * @returns True if using an external backend, false if we started our own
	 */
	isUsingExternalBackend(): boolean {
		return this.isExternalBackend;
	}

	/**
	 * Get the startup mode of the Local Operator server
	 * @returns The current startup mode
	 */
	getStartupMode(): LocalOperatorStartupMode {
		return this.startupMode;
	}

	/**
	 * Get the virtual environment path used by the backend service
	 * @returns The path to the virtual environment
	 */
	getVenvPath(): string {
		return this.venvPath;
	}

	/**
	 * Check if the backend service is auto-updating
	 * @returns True if auto-updating, false otherwise
	 */
	checkIsAutoUpdating(): boolean {
		return this.isAutoUpdating;
	}

	/**
	 * Set the auto-updating flag
	 * @param isAutoUpdating True if auto-updating, false otherwise
	 */
	setAutoUpdating(isAutoUpdating: boolean): void {
		this.isAutoUpdating = isAutoUpdating;
	}

	/**
	 * Restart the backend service
	 * This method properly handles the restart process to ensure that any pending
	 * timeouts from the stop operation don't affect the newly started process
	 * @returns Promise resolving to true if the restart was successful, false otherwise
	 */
	restart(): Promise<boolean> {
		if (this.restartPromise) return this.restartPromise;
		this.restartPromise = (async () => {
			try {
				await this.stop(true);
				if (this.isAppClosing) return false;
				return await this.start();
			} catch (error) {
				logger.error("Backend restart refused", LogFileType.BACKEND, error);
				return false;
			}
		})().finally(() => {
			this.restartPromise = null;
		});
		return this.restartPromise;
	}
}

/**
 * Helper function to show error dialog
 * @param title Dialog title
 * @param message Dialog message
 */
export function showErrorDialog(title: string, message: string): void {
	electronDialog.showErrorBox(title, message);
}
