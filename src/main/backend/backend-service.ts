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
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { app, dialog as electronDialog } from "electron";
import type { DaemonStatusSnapshot } from "../../shared/backend-status";
import type {
	DesktopFeedState,
	DesktopResponse,
} from "../../shared/desktop-contract";
import type { DesktopFeedFrame } from "../../shared/desktop-session-contract";
import { serveRecordVersion } from "../backend-version-drift";
import { DesktopFeedRelay } from "../desktop-feed";
import {
	type DesktopMediaResponse,
	requestDesktopMediaOutcome,
} from "../desktop-media";
import { DesktopStreamRelay } from "../desktop-stream";
import { requestDesktop, requestDesktopOutcome } from "../desktop-transport";
import { withPythonBytecodeCache } from "../python-bytecode-cache";
import {
	readInstallIdentity,
	resolveGlobalConsoleScript,
} from "../update-install";
import { backendConfig } from "./config";
import {
	DETACHED_AFTER_MS,
	type DaemonIdentity,
	DaemonStateMachine,
	PROBE_INTERVAL_MS,
	PROBE_TIMEOUT_MS,
	type ProbeObservation,
} from "./daemon-status";
import {
	type DiscoveredDaemon,
	HEALTH_PATH,
	OWNED_RECORD_WINDOW_MS,
	OWNED_REGISTRATION_WINDOW_MS,
	type UnreachableCause,
	type WedgedRecord,
	claimDesktopPlane,
	classifyUnreachable,
	discoverDaemons,
	normaliseAddress,
	parseRecord,
	pidLiveness,
	probeIdentity,
	probeUnidentified,
	readIdentity,
	reapStaleRecords,
	recordAddress,
	serveRunDir,
} from "./discovery";
import { launchEnv } from "./launch-env";
import { LogFileType, logger } from "./logger";
import { isLegacyManagedCommand } from "./managed-python";
import { resolveNotificationLaunch } from "./notification-launch";
import { managedVenvPath } from "./venv-paths";

import {
	consoleInterpreter,
	ownedServeLaunch,
	windowsInterpreterCandidates,
	windowsPathInterpreterCandidates,
} from "./owned-serve-launch";

/*
 * There is no `CONSOLE_RESOLUTION_WORST_MS` here any more, and the absence is a
 * removal rather than an oversight. The console half of the start path used to
 * be two bounded `which`/`where` execs - the existence check, then the
 * resolution - and the quit path's failsafe carried a term for them. Both are
 * gone: the launcher is named by `resolveCommandPath`, a synchronous search of
 * the installers' own bin directories (see `globalConsoleScript`). Leaving the
 * term in place would inflate `QUIT_CLEANUP_FAILSAFE_MS` by ten seconds of
 * waiting that no longer happens, and that constant's own note says each term
 * has to be the bound it comes from. A future exec on this path owes the
 * failsafe a term again.
 */

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

/**
 * Where the app keeps the bearer for the daemon it spawns, inside its userData
 * directory. 0600, written by `mintDesktopToken` on every managed start and read
 * by `persistedDesktopToken` on every launch, so the daemon a previous run left
 * serving is attachable.
 */
const DESKTOP_TOKEN_FILENAME = "desktop-token";

/**
 * What the spawn gate found at the address this app is configured for.
 *
 * `null` (no occupancy) is deliberately absent from this union: the gate's
 * caller tests for it, so "provably free" cannot be mistaken for a variant
 * somebody forgot to handle.
 */
type OriginOccupancy =
	| { kind: "daemon"; pid: number | null; version: string; detail: string }
	| { kind: "silent"; cause: UnreachableCause; detail: string };

const execPromise = promisify(exec);

// Regex for parsing environment variable lines (moved to top-level for performance)
const ENV_VAR_REGEX = /^([^=]+)=(.*)$/;

/**
 * Which of the three things one answered desktop read told us.
 *
 * `refused` is HTTP 401/403 and NOTHING else: those are the two statuses that
 * mean this app's CREDENTIAL was rejected. Every other answered status - a 503
 * from a daemon whose session store cannot be read, a 500 from a broken build,
 * a 404 from a daemon that never had a desktop plane - is `unusable`: a daemon
 * answered, so the address is OCCUPIED and the app must neither call that a
 * credential refusal nor start a second daemon over it.
 *
 * WHY the distinction is a type and not a boolean. Reading "any non-2xx" as a
 * refusal recorded a live 503-answering daemon as one that refused this app's
 * bearer, and that verdict - a `capability` observation plus a declined
 * candidate - is what reached `start()` and spawned a replacement onto a port
 * that was already answering. A boolean cannot carry the third case, so the
 * distinction had nowhere to live.
 */
function classifyDesktopAnswer(
	status: number,
): "accepted" | "refused" | "unusable" {
	if (status >= 200 && status < 300) return "accepted";
	if (status === 401 || status === 403) return "refused";
	return "unusable";
}

/** Options a `start()` caller may set. `quiet` is the watchdog's retry, whose
 * failures the status surface is already reporting; `reuseDiscovery` is the
 * startup block's second call, in the same tick as its own discovery pass. */
interface StartOptions {
	quiet?: boolean;
	reuseDiscovery?: boolean;
}

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
	/**
	 * Whether this app may SPAWN or KILL a daemon - never whether one exists.
	 *
	 * `VITE_DISABLE_BACKEND_MANAGER=true` used to mean "assume a backend is
	 * already there": `checkExistingBackend()` returned true before probing and
	 * the startup block in `index.ts` was skipped outright, so discovery never
	 * ran, no daemon was ever found, no bearer was ever held, and every
	 * conversation opened empty. It now means exactly what its name says: do not
	 * spawn one and do not kill one. Discovery runs either way, which is the
	 * only way the operator's own daemon (started by a TUI, publishing a record)
	 * is ever found by an app configured this way.
	 */
	private readonly managerMaySpawn =
		backendConfig.VITE_DISABLE_BACKEND_MANAGER !== "true";
	private startupMode: LocalOperatorStartupMode =
		LocalOperatorStartupMode.NOT_STARTED;
	private port: number;
	private backendUrl: string;
	private remoteConfigured = false;
	/** A failed probe or unreadable record is not evidence that spawning is safe. */
	private discoveryBlocksSpawn = false;
	/**
	 * The address of a daemon that ANSWERED this app's desktop read without
	 * refusing its credential, and the status it answered, from the last
	 * discovery sweep.
	 *
	 * Non-null means the address is OCCUPIED by a daemon this app may not attach
	 * to *yet*: `start()`'s no-spawn report has to publish that as a running
	 * daemon, because the alternative it would otherwise reach - `no-candidate` -
	 * renders as offline, which is the one sentence this whole change exists to
	 * stop saying about a server that answers (#1170: an unreadable session store
	 * answers 503 instead of an empty 200).
	 */
	private answeredButUnusable: { address: string; status: number } | null =
		null;
	/**
	 * Records discovery found alive but unresponsive (pid alive, heartbeat
	 * stopped). They are why no candidate exists AND why spawning is forbidden,
	 * and they are carried separately from `discoveryBlocksSpawn` so the app can
	 * say which of those two facts it observed.
	 */
	private discoveryWedged: WedgedRecord[] = [];
	private recoveryInFlight = false;
	private nextRecoveryAt = 0;
	private appDataPath = app.getPath("userData");
	private venvPath: string;
	/**
	 * Why the last `/health` read did not return 200, for the callers that must
	 * tell a refusal from an expired budget: `null` when it was not a transport
	 * failure at all (the address answered, with a status this path does not
	 * accept).
	 */
	private lastHealthFailure: UnreachableCause | null = null;

	/** The one probe loop's interval handle. */
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
	/** The record behind the current attachment, when discovery found it. */
	private attachedRecord: DiscoveredDaemon | null = null;
	/**
	 * The connection state.
	 *
	 * One machine, one answer to "is the server up": the renderer's status
	 * signal is this object's snapshot (see `getStatusSnapshot`), so a second
	 * opinion about liveness cannot grow inside the renderer or in a probe that
	 * forgot the capability rules.
	 */
	private daemonState = new DaemonStateMachine();
	/** Consumers of status changes in main (the window's IPC sender). */
	private statusObserver: ((snapshot: DaemonStatusSnapshot) => void) | null =
		null;
	private shellEnv: Record<string, string | undefined> = {};
	// External/dev backends may be explicitly paired through main's environment.
	// Managed starts always rotate this; it is never exposed by preload or logs.
	/**
	 * The credential this app holds for its OWN daemon.
	 *
	 * Read from disk at construction, and REPLACED by a freshly minted, persisted
	 * one on every managed start. Those are two halves of one rule:
	 *
	 *   - the read is what makes a daemon the previous run left running
	 *     attachable. The app deliberately leaves its daemon serving when it
	 *     attached to an external backend, and a daemon it spawned is
	 *     env-governed from the spawn (its record publishes `claim_key: ""`), so
	 *     the ONLY credential that can ever open it is the token its spawner held.
	 *     A launch that starts with no token there declines the daemon it owns and
	 *     starts a second one onto its port - measured on the operator's machine as
	 *     the 07:47 -> 09:17 sequence, ending in `[Errno 48] Address already in
	 *     use`;
	 *   - the write is why the token still changes when the app REPLACES a daemon
	 *     in place: the relay's cache key is this value (see `getStreamRelay`), and
	 *     a token that survived a restart would leave a subscription pointed at a
	 *     daemon this app had already stopped.
	 *
	 * The environment still wins, because an explicitly paired app is a deliberate
	 * configuration and not a cache to be second-guessed.
	 */
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
	 * The window/focus/displayed-session answers the presence claim carries.
	 *
	 * Set by main once a window can exist — before that a windowless app is the
	 * honest answer, which is also the reference's own default for a client that
	 * has not said anything yet.
	 */
	private presenceContext:
		| (() => {
				sessionId: string;
				window: {
					exists: boolean;
					focused: boolean;
					visible: boolean;
					minimized: boolean;
				};
		  })
		| null = null;

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

	/**
	 * Subscribe to status changes.
	 *
	 * A push rather than a poll so a state change reaches the renderer within a
	 * probe interval, and a pull (`getStatusSnapshot`) so a window that opens
	 * later is not left waiting for the next transition.
	 */
	onStatusChange(
		observer: ((snapshot: DaemonStatusSnapshot) => void) | null,
	): void {
		this.statusObserver = observer;
	}

	private notifyStatus(): void {
		try {
			this.statusObserver?.(this.getStatusSnapshot());
		} catch (error) {
			// A consumer's failure must not take down the supervisor: the state
			// is reported either way, and a later push carries it again.
			logger.error(
				"Backend status observer threw:",
				LogFileType.BACKEND,
				error,
			);
		}
	}

	/**
	 * The server-status signal, for the renderer's IPC handlers.
	 *
	 * Carries the daemon's identity (version, prefix, install kind) because the
	 * main process is the only caller that can read it honestly: it holds the
	 * bearer and sends no Origin, so neither CORS nor a gated route can turn
	 * "I am not allowed" into "it is down".
	 */
	getStatusSnapshot(): DaemonStatusSnapshot {
		return this.daemonState.snapshot();
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
					beatPresence: (presence) =>
						this.requestDesktop({
							op: "sessions.presence",
							...presence,
						}),
					// What this app can say about its own window. Supplied by main
					// (it owns the window and the notifier's displayed session) and
					// read at each beat rather than captured, so a window that opens
					// or closes mid-lease is reported without a new relay.
					presenceContext: () => this.presenceContext?.() ?? null,
				},
			);
			this.feedRelay.observe(this.feedFrameObserver);
			this.feedRelay.watchState(this.feedStateObserver);
			this.feedRelayUrl = this.backendUrl;
		}
		return this.feedRelay;
	}

	/**
	 * Supply the presence claim's window state.
	 *
	 * Separate from `observeDesktopFeed` because it is a different question
	 * asked of a different owner: the observers are consumers of frames, and
	 * this is main's answer about itself. Applied to a relay that already
	 * exists, so the ordering between "start the feed" and "make a window" does
	 * not decide whether the claim is complete.
	 */
	providePresenceContext(
		context: () => {
			sessionId: string;
			window: {
				exists: boolean;
				focused: boolean;
				visible: boolean;
				minimized: boolean;
			};
		},
	): void {
		this.presenceContext = context;
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
		return requestDesktopOutcome(
			input,
			this.backendUrl,
			this.desktopToken,
		).then(({ response, answered }) => {
			if (answered) this.noteTransportAnswer();
			return response;
		});
	}

	requestDesktopMedia(
		input: unknown,
		bytes: Uint8Array<ArrayBuffer> | null,
	): Promise<DesktopMediaResponse> {
		return requestDesktopMediaOutcome(
			input,
			bytes,
			this.backendUrl,
			this.desktopToken,
		).then(({ response, answered }) => {
			if (answered) this.noteTransportAnswer();
			return response;
		});
	}

	/**
	 * Tell the state machine that this app's own request reached the daemon.
	 *
	 * `answered` is the TRANSPORT's verdict, not the promise's: every failure the
	 * transport can produce resolves rather than throws, so `.then()` alone fires
	 * for a refused socket, for a request this app never sent (no token, oversize,
	 * an invalid op), and for one whose budget expired. Gating on it here is the
	 * fix for review round 1's F-1, where an unearned stamp held the state at
	 * `degraded` - which is not a state `checkBackendHealth` recovers from, so a
	 * genuinely gone daemon could never be reported as gone.
	 *
	 * WHY this still counts EVERY answer, including a gated route's `401`/`403`:
	 * the capability rules elsewhere in this file say a refusal is not a LIVENESS
	 * signal, and that is about not calling it "connected". Turned around, a
	 * refusal is the strongest liveness evidence this app has - a process read the
	 * request and wrote a status line - which is exactly what a probe that ran out
	 * of its 2 s budget failed to establish. Without this, one long agent turn was
	 * enough to detach the connection and disable every read the daemon was still
	 * answering.
	 *
	 * Only a state that actually moves pushes a snapshot: this runs on every
	 * desktop call, and one IPC wake-up per request would be worse than the bug.
	 */
	private noteTransportAnswer(): void {
		if (this.daemonState.recordTransportSuccess()) this.notifyStatus();
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

			this.remoteConfigured = !["localhost", "127.0.0.1", "[::1]"].includes(
				apiUrl.hostname,
			);
			// A remote configuration is an explicit target, not a local port hint.
			// Never rewrite its scheme/host or substitute a local daemon for it.
			this.backendUrl = this.remoteConfigured
				? apiUrl.href.endsWith("/")
					? apiUrl.href.slice(0, -1)
					: apiUrl.href
				: `http://127.0.0.1:${this.port}`;

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

		/*
		 * The credential for this app's OWN daemon, read before anything asks
		 * whether there is one to attach to.
		 *
		 * ORDER IS THE WHOLE POINT. `src/main/index.ts` calls
		 * `checkExistingBackend()` first and `start()` only when discovery finds
		 * nothing, so a token minted inside `startOwned()` does not exist yet when
		 * the app decides whether it can attach to the daemon the previous run left
		 * running - which is how a daemon that was serving got declined and a second
		 * one was spawned onto its port. Loading it here means the first adoption
		 * pass already holds the credential.
		 */
		this.desktopToken = this.desktopToken || this.persistedDesktopToken();

		// Log initialization status
		logger.info(
			`Backend Service Manager initialized. May spawn or kill: ${this.managerMaySpawn}`,
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
	 *
	 * The notification kill switch joins it here for the same reason, one level
	 * further out: the environment this returns is also where a `.env` folded
	 * over the launch, or a shell rc merged over that, would otherwise be the
	 * one that decides whether the backend this app spawns can banner the
	 * operator (see the comment on that entry, and `./notification-launch`).
	 */
	private backendSpawnEnv(): Record<string, string | undefined> {
		return {
			...withPythonBytecodeCache(this.shellEnv, this.appDataPath),
			// Managed starts rotate the token; set after the spread so the spawn
			// can never inherit a stale one from the shell environment. `start()`
			// mints it before it can reach a spawn site, so the `??` only satisfies
			// the field's nullable seed from `process.env`.
			LOCAL_OPERATOR_DESKTOP_TOKEN: this.desktopToken ?? undefined,
			/*
			 * LAST, and from `launchEnv` rather than from `this.shellEnv`: the
			 * notification kill switch is a fact about the LAUNCH, and `shellEnv`
			 * is where that fact can be lost twice over. `backend/config.ts` folds
			 * a `.env` from the working directory with dotenv `override: true`
			 * AFTER the launch, and `loadMacOSEnvironment` merges the operator's
			 * own shell rc on top of that - so a file or an rc can replace the
			 * value `pnpm app:headless` set, and the empty shape it leaves behind
			 * reads as ENABLED in the backend, which is the incident back.
			 * Applying it here, at the point the environment is handed to the
			 * spawn, is what the python bytecode prefix above already does for the
			 * same reason: structural, so no spawn path and no fold order can miss
			 * it. See `./notification-launch` for the three cases and why an
			 * unstated key is left alone.
			 */
			...resolveNotificationLaunch(launchEnv),
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

	/** Publish WHY no daemon could be attached, as a named state rather than a
	 * generic failure.
	 *
	 * Three different facts reach the no-spawn branch and a surface told only
	 * "blocked" rendered a daemon that is still running as an outage: a wedged
	 * record is a LIVE process whose heartbeat stopped, a gone record is a lost
	 * server whose heartbeat is too fresh to reap, and a remote target that
	 * refused this app's credential is a third. Each is named here, which is what
	 * lets the copy say "a server is running and this app did not attach to it"
	 * instead of "the server is offline". */
	private observeNoCandidate(): void {
		const wedged = this.discoveryWedged.find((record) => record.alive);
		const goneRecord = this.discoveryWedged.find((record) => !record.alive);
		if (wedged) {
			/*
			 * A daemon IS running: its process is alive and its record is on disk,
			 * but its published heartbeat stopped, so discovery refuses both to
			 * attach to it and to start a second one over it. Reporting this as
			 * `detached` was the last way this app told a user their server was
			 * offline while a process was still there - the record is the reason
			 * it is named by pid, which is also its filename in `run/serve`.
			 */
			this.daemonState.observe({
				kind: "heartbeat-stale",
				detail: `A Local Operator daemon is running (pid ${wedged.pid}), but it stopped publishing its heartbeat, so this app did not attach to it. Waiting without starting a second one.`,
			});
		} else if (this.answeredButUnusable) {
			/*
			 * A daemon that answered is not an absence. Reaching `no-candidate` here
			 * published `detached` - the banner's "offline" - for a server that had
			 * just answered this app's own read with a status, which is the same
			 * wrong sentence as the false credential refusal one branch up, one
			 * state further along.
			 */
			this.daemonState.observe({
				kind: "unattachable",
				detail: `A Local Operator daemon is running at ${this.answeredButUnusable.address} and answered this app's read with HTTP ${this.answeredButUnusable.status}, so this app is not attached to it. Nothing is being started over it; it keeps probing.`,
			});
		} else {
			this.daemonState.observe({
				kind: "no-candidate",
				detail: this.remoteConfigured
					? "The configured remote server is unavailable or refused this app's credential; no local replacement will be started."
					: goneRecord
						? /*
							 * The other way a record is `wedged`: the process is GONE and the
							 * heartbeat is too fresh to justify reaping. That is a lost server,
							 * not a running one, so it is reported as a detach - claiming a
							 * daemon "is running" here would be the same wrong sentence QA
							 * round 1 found in the rejection detail, on the surface a user reads.
							 */
							`The Local Operator server whose record names pid ${goneRecord.pid} is no longer running, but its record is too fresh to reap, so this app did not attach to it.`
						: this.discoveryBlocksSpawn
							? "A local daemon may still be running, but could not be attached. Waiting without starting a duplicate."
							: "No Local Operator daemon was found and this app is configured not to start one.",
			});
		}
		this.notifyStatus();
	}

	/**
	 * The global launcher this app ranks its daemons by, spawns from, and reports.
	 *
	 * ONE resolution, read by `checkLocalOperatorExists`, `resolveGlobalConsole`
	 * and `preferredInstallPrefix`, because the three have to name the same
	 * install: the decision to run GLOBAL_INSTALL is only true if the spawn can
	 * resolve that same launcher, and a second resolution through a different
	 * mechanism is exactly how a shell rc file's prepended venv becomes the thing
	 * that gets spawned while the ranking talked about a different one.
	 *
	 * `resolveCommandPath`, NOT `which`. WHY, measured on this host 2026-09-16: the
	 * app is started by LaunchServices, whose PATH is `/usr/bin:/bin:/usr/sbin:/sbin`,
	 * and an app launched from a session that carries its own minimal PATH inherits
	 * that. `~/.local/bin` - where uv and pipx link their console scripts, and where
	 * this machine's `lop-update` install lives - is on neither. So the shell probe
	 * this replaced answered "not found globally" on every ordinary launch, and the
	 * app fell through to its OWN bundled environment: it ran a backend the
	 * operator never updates, watched it diverge from `lop --version` (0.55.9
	 * bundled against 0.55.10 installed), and offered to `pip install` into a uv
	 * tool. `resolveCommandPath` searches the installers' own locations
	 * (`UV_TOOL_BIN_DIR`, `XDG_BIN_HOME`, `$XDG_DATA_HOME/../bin`, `~/.local/bin`,
	 * the Homebrew prefixes and every uv tool environment) as well as the inherited
	 * PATH, so the same install is named with or without a shell - which is the
	 * ranking rule `preferredInstallPrefix` states, and precisely what a
	 * `which`-based check could not honour.
	 *
	 * `local-operator` before `lop`: both are console scripts of the same install
	 * and normally sit in the same bin directory, but the spawn reads the resolved
	 * script's shebang and refuses anything that is not a
	 * `from local_operator.cli import main` launcher (`consoleInterpreter`), so the
	 * name this app has always spawned is tried first and `lop` covers an install
	 * whose older console script is gone.
	 */
	private globalConsoleScript(): string | null {
		/*
		 * THE SHARED HELPER, not a second copy of its rule (review R2-2). The update
		 * path resolves the plan and the install's identity through this same
		 * function, so the decision this feeds, the ranking and the plan cannot drift
		 * apart - including on Windows, where the helper's own arm asks `where` for
		 * both names and the inline pair here could only ever have tried one of them
		 * through `resolveCommandPath`. Its docstring says it is one helper for both
		 * callers; this is the call site that made that true.
		 */
		return resolveGlobalConsoleScript();
	}

	/**
	 * Check if the local-operator command exists globally
	 * @returns Promise resolving to true if the command exists, false otherwise
	 */
	async checkLocalOperatorExists(): Promise<boolean> {
		const command = this.globalConsoleScript();
		if (!command) {
			logger.info(
				"local-operator command not found globally",
				LogFileType.BACKEND,
			);
			return false;
		}
		if (
			process.platform === "darwin" &&
			isLegacyManagedCommand(
				command,
				join(
					app.getPath("home"),
					"Library",
					"Application Support",
					"Local Operator",
				),
			)
		) {
			logger.info(
				`The resolved command belongs to a legacy managed environment (${command}); preparing a separate backend instead`,
				LogFileType.BACKEND,
			);
			return false;
		}
		logger.info(
			`local-operator command found at: ${command}`,
			LogFileType.BACKEND,
		);
		return true;
	}

	/**
	 * `sys.prefix` of the install the user's own `lop` runs, when it can be named.
	 *
	 * This is ranking rule 1 (design §3.5): the daemon to prefer is the one that
	 * shares your CLI's install, because the complaint that produced this work
	 * is that the app used to prefer its OWN bundled venv. The prefix is read
	 * from the resolved shim's layout - uv writes `uv-receipt.toml` beside the
	 * environment, pip/pipx leave `pyvenv.cfg` in it - rather than from a version
	 * comparison, since two installs can hold the same version and still be the
	 * wrong one.
	 */
	private preferredInstallPrefix(): string | null {
		try {
			const identity = readInstallIdentity(this.globalConsoleScript());
			if (identity.uvReceipt) return dirname(identity.uvReceipt);
			if (identity.venvPrefix) return identity.venvPrefix;
			return null;
		} catch {
			// Not being able to name the user's install is a ranking downgrade,
			// never a reason to fail: discovery still attaches to a validated
			// daemon by version and start time.
			return null;
		}
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
	 *
	 * Since discovery, the ordinary path mints that credential through the claim
	 * handshake (`attachIfUsable`). This predicate is the gate of the ONE path
	 * that cannot: the legacy fixed-port fallback below.
	 */
	private canAuthenticate(): boolean {
		return this.getStreamRelay().available;
	}

	/**
	 * Discover the daemons on this machine, then attach to the best usable one.
	 *
	 * The replacement for "probe one URL and accept any 200". Every candidate is
	 * a record whose pid is alive and whose `/health` proves it is the process
	 * the record describes, so this answers the two questions the old probe could
	 * not: WHICH daemon is this, and is it the same one I was talking to a minute
	 * ago.
	 *
	 * Candidates are tried in rank order and the first USABLE one wins, where
	 * usable means this app holds a bearer the daemon actually accepts. That gate
	 * is not new and not negotiable: adopting a daemon this app cannot
	 * authenticate to attaches the renderer to a backend that refuses every
	 * session list and every stream - the empty-conversation outcome. A daemon
	 * that answers but is out of this app's reach is REPORTED (its capability is
	 * in the status) and skipped, which is also why the next candidate gets a
	 * try: the operator can have several daemons, and the right one is not
	 * necessarily the first by version.
	 *
	 * @returns true when a daemon was attached (which is not the same as "the
	 * app will not start one": `start()` decides that separately, and an app
	 * forbidden from spawning is still allowed to discover).
	 */
	private async discoverAndAttach(): Promise<boolean> {
		const adopted = await this.adoptFirstUsableDaemon();
		/*
		 * WHY the probe loop is armed HERE and not only in `startOwned()`.
		 *
		 * `src/main/index.ts` calls this (through `checkExistingBackend()`) at
		 * startup and calls `start()` ONLY when discovery found nothing - so an app
		 * that adopted the operator's daemon finished starting with no interval at
		 * all. The status then froze for the life of the app: the row kept naming
		 * the adopted pid (and its version) after that process was gone,
		 * `DETACHED_AFTER_MS` never promoted it to "stopped", nothing re-discovered
		 * a daemon the operator started later without an app restart, and the
		 * connectivity banner - whose only entry is an unreachable state - could
		 * never appear, so the Retry that would run `reconnectNow()` was unreachable
		 * in exactly the state that needed it (QA round 3, Q-1; review round 3,
		 * R3-1).
		 *
		 * Adoption is what arms it, at every adoption: the record-backed candidate
		 * here and the deprecated pre-record fallback this method reaches, which
		 * publishes the same attachment. `startHealthCheck()` is idempotent - it
		 * clears any existing interval first - so the owned path's own call, a
		 * re-attach after a recovery and the three existing call sites stay
		 * harmless.
		 */
		if (adopted) this.startHealthCheck();
		return adopted;
	}

	/**
	 * The discovery sweep and the adoption it ends in.
	 *
	 * {@link discoverAndAttach} owns what a successful attach implies for the
	 * app; this owns which daemon is found, and why the rest are refused.
	 */
	private async adoptFirstUsableDaemon(): Promise<boolean> {
		if (this.isAppClosing) return false;
		this.discoveryWedged = [];
		this.answeredButUnusable = null;
		if (this.remoteConfigured) {
			this.discoveryBlocksSpawn = true;
			return await this.legacyFixedPortAdoption();
		}
		const result = await discoverDaemons({
			configuredUrl: backendConfig.VITE_LOCAL_OPERATOR_API_URL,
			preferredPrefix: this.preferredInstallPrefix(),
			log: (message) => logger.info(message, LogFileType.BACKEND),
		});
		this.discoveryBlocksSpawn = result.blocksSpawn;
		this.discoveryWedged = result.wedged;
		// Reaping is the one write discovery may lead to, and it is guarded
		// inside `reapStaleRecords`: dead pid, aged heartbeat, and a re-read
		// record that must still classify as dead. A proven-dead record is MOVED
		// into `<run dir>/reaped/`, never deleted - the backend's own reaper keeps
		// it there as the evidence an attention classifier reads.
		for (const file of reapStaleRecords(result.reapable)) {
			logger.info(`Reaped stale serve record ${file}`, LogFileType.BACKEND);
		}
		for (const candidate of result.candidates) {
			if (await this.attachIfUsable(candidate)) return true;
		}
		if (result.noRecordsAtAll) return await this.legacyFixedPortAdoption();
		return false;
	}

	/**
	 * Attach to one candidate, if this app holds a bearer its desktop plane
	 * accepts.
	 *
	 * The claim happens HERE, before anything about this app changes: a candidate
	 * that turns out to be unusable must leave the manager exactly as it was, or
	 * a failed attach would strand the app on a daemon it cannot talk to. The
	 * key comes from that daemon's 0600 record - the only channel it is ever
	 * published through - and is used as a bearer and nothing else: never logged,
	 * never returned, never forwarded, including in the failure branches below,
	 * which name the OUTCOME only.
	 *
	 * @returns true when the candidate was adopted
	 */
	private async attachIfUsable(candidate: DiscoveredDaemon): Promise<boolean> {
		const key = candidate.record.claim_key;
		// Two ways to hold a bearer for somebody else's daemon: the claim key it
		// published, or the token this app was paired with through its
		// environment. With neither, the daemon is out of reach by construction -
		// an env-governed daemon the app did not spawn has no key on disk and a
		// token nobody told us.
		if (!key && !this.desktopToken) {
			logger.info(
				`Daemon ${candidate.address} publishes no claim key and this app holds no pairing token for it; not attaching (its controls would refuse every call).`,
				LogFileType.BACKEND,
			);
			// A CAPABILITY result, recorded beside the state: the daemon is
			// running, this app simply may not use it. Rendering that as "server
			// down" is the conflation this whole change exists to remove.
			this.daemonState.observe({
				kind: "capability",
				status: 401,
				detail: `A daemon is running at ${candidate.address}, but this app holds no credential for its desktop plane.`,
			});
			this.notifyStatus();
			return false;
		}
		const token = key || (this.desktopToken as string);
		if (key) {
			const outcome = await claimDesktopPlane(candidate.address, key, {
				origins: this.rendererOrigins(),
			});
			switch (outcome.outcome) {
				case "claimed":
					logger.info(
						`Claimed the desktop plane on ${candidate.address}${outcome.origins.length > 0 ? ` declaring ${outcome.origins.length} renderer origin(s)` : ""}.`,
						LogFileType.BACKEND,
					);
					break;
				case "already-claimed":
					// The latch: the plane is already governed. The key it was
					// governed with is the SAME key this record publishes (the claim
					// stores the published value), so the read below decides - and a
					// second app instance on this machine is a normal thing for the
					// operator to run, not an error.
					logger.info(
						`Daemon ${candidate.address} is already governed (claim latch). Verifying that this app's key is the accepted one rather than fighting for ownership.`,
						LogFileType.BACKEND,
					);
					break;
				case "wrong-key":
				case "refused":
					// The record's key is not the plane's (a record from a previous
					// process), or this caller may not claim at all. Either way there
					// is nothing to use here.
					logger.info(
						`Daemon ${candidate.address} did not accept this app's claim (${outcome.outcome}); not attaching.`,
						LogFileType.BACKEND,
					);
					return false;
				case "unreachable":
					logger.info(
						`Daemon ${candidate.address} could not be reached to claim its desktop plane: ${outcome.detail}`,
						LogFileType.BACKEND,
					);
					return false;
			}
		}
		const probe = await this.probeCandidate(candidate.address, token);
		if (probe.verdict === "refused") {
			logger.info(
				`Daemon ${candidate.address} refused this app's bearer for its desktop plane (HTTP ${probe.status}); not attaching (it would refuse every session list and every stream).`,
				LogFileType.BACKEND,
			);
			this.daemonState.observe({
				kind: "capability",
				status: probe.status,
				detail: `A daemon is running at ${candidate.address}, but it refused this app's credential for its desktop plane (HTTP ${probe.status}).`,
			});
			this.notifyStatus();
			return false;
		}
		if (probe.verdict === "unusable") {
			/*
			 * A daemon that ANSWERS but cannot serve this read is not a daemon that
			 * refused this app's credential, and the difference is load-bearing: the
			 * refusal branch above records a capability verdict and declines, and a
			 * decline here is what let `start()` mint a replacement token and spawn a
			 * second daemon onto a port that was already answering (a 503 from a
			 * daemon whose session store cannot be read was read as "any non-2xx" by
			 * the old boolean probe). `discoveryBlocksSpawn` is the flag the spawn
			 * path already consults to mean "a local daemon may still be running"
			 * (backend-service.ts, `start`), so the app keeps probing and re-attaches
			 * on a later tick instead of racing a replacement onto a serving port.
			 */
			logger.info(
				`Daemon ${candidate.address} answered HTTP ${probe.status} to this app's desktop read without refusing its credential; not attaching this tick, and not starting a daemon over it.`,
				LogFileType.BACKEND,
			);
			this.discoveryBlocksSpawn = true;
			this.answeredButUnusable = {
				address: candidate.address,
				status: probe.status,
			};
			this.daemonState.observe({
				kind: "unattachable",
				detail: `A daemon is running at ${candidate.address} and answered this app's read with HTTP ${probe.status}, so this app is not attached to it. Nothing is being started over it.`,
			});
			this.notifyStatus();
			return false;
		}
		if (probe.verdict === "unreachable") {
			/*
			 * Nothing answered, so this is not evidence about the ADDRESS either way
			 * - unlike the two branches above, it must not claim occupancy, or a
			 * stale record's dead address would pin the app off spawning for good.
			 * The record's own aging path (`reapStaleRecords`) is what retires it.
			 */
			return false;
		}
		await this.attachTo(candidate, token);
		return true;
	}

	/**
	 * One authenticated read against a specific address with a specific bearer.
	 *
	 * A `/health` 200 proves a process is listening, not that it is OURS or that
	 * this app may use it. The desktop vocabulary answers 401/403 for a bearer it
	 * does not hold, so one authenticated read is what separates a daemon this
	 * app can actually drive from one that merely answers.
	 *
	 * The address and token are parameters rather than `this.backendUrl` /
	 * `this.desktopToken` because this runs BEFORE adoption: the candidate must
	 * be proved usable without the manager having committed to it.
	 */
	private async probeCandidate(
		address: string,
		token: string,
	): Promise<
		| { verdict: "accepted" }
		| { verdict: "refused" | "unusable"; status: number }
		| { verdict: "unreachable" }
	> {
		try {
			/*
			 * Deliberately NOT evidence for the state machine, unlike
			 * `requestDesktop`. This asks about a CANDIDATE address with a
			 * candidate's credential, which may be neither the daemon this app is
			 * attached to nor one it ever attaches to; stamping `lastTransportAt`
			 * from a probe of someone else's port would let an unrelated listener
			 * hold the app off `detached`. The adoption path that follows an
			 * `accepted` here publishes its own state through `attachTo`.
			 */
			const result = await requestDesktop(
				{ op: "sessions.list", limit: 1 },
				address,
				token,
			);
			const verdict = classifyDesktopAnswer(result.status);
			return verdict === "accepted"
				? { verdict }
				: { verdict, status: result.status };
		} catch {
			return { verdict: "unreachable" };
		}
	}

	/**
	 * Adopt a validated, usable daemon: rotate onto it and publish the state.
	 *
	 * The rotation must happen before `notifyBackendReady()`: everything that
	 * queries the backend (the SSE relay, `requestDesktop`, the capability read)
	 * resolves against `backendUrl` at call time, and a consumer that ran against
	 * the previous address would describe a daemon the app has just left
	 * (review round 2, R2-2).
	 */
	private async attachTo(
		candidate: DiscoveredDaemon,
		token: string,
	): Promise<void> {
		const previousUrl = this.backendUrl;
		this.port = candidate.record.port;
		this.backendUrl = candidate.address;
		this.attachedRecord = candidate;
		this.isExternalBackend = true;
		// The bearer that was just proved accepted, kept for the relay and every
		// later desktop call against this daemon.
		this.desktopToken = token;
		// EXISTING_SERVER, not a new mode: "a daemon this app did not start is
		// serving" is exactly what that mode already means to the update plan and
		// to the quit path, and a second spelling for it would be a second opinion
		// about ownership (design §3.7).
		this.startupMode = LocalOperatorStartupMode.EXISTING_SERVER;
		logger.info(
			`Attached to daemon ${candidate.address} (pid ${candidate.record.pid}, v${candidate.identity.version}, ${candidate.record.install_kind || "kind unknown"}, record ${candidate.file})${previousUrl !== candidate.address ? ` - backend URL moved from ${previousUrl}` : ""}`,
			LogFileType.BACKEND,
		);
		this.daemonState.attach(
			{
				url: candidate.address,
				instanceId: candidate.identity.instanceId,
				pid: candidate.record.pid,
				version: candidate.identity.version,
				prefix: candidate.identity.prefix || candidate.record.prefix,
				installKind:
					candidate.identity.installKind || candidate.record.install_kind,
			},
			{ owned: false },
		);
		this.daemonState.setDesktopAvailable(true);
		if (candidate.record.retiring_to) {
			/*
			 * The record announces that the INSTALLED build changed under this
			 * daemon. It is NOT a handover: the daemon keeps serving, and no
			 * successor is promised, so this only names what was observed. Reading
			 * it as "handing over" and moving the state would detach the event
			 * stream and abandon in-flight turns over an announcement. Acting on it
			 * is the update-continuity work, which needs a verified idle-boundary
			 * handoff from the backend before the app may do anything at all.
			 */
			this.daemonState.observe({
				kind: "build-announced",
				detail: `Daemon ${candidate.address} reports a new installed build (v${candidate.record.retiring_from ?? "?"} -> v${candidate.record.retiring_to}); it is still serving on this connection.`,
			});
		}
		this.notifyStatus();
		this.notifyBackendReady();
	}

	/**
	 * The origins a claim may declare, or none.
	 *
	 * Only a real `http(s)` origin is declarable. The packaged app renders from
	 * `file://`, whose origin is the literal `"null"` that the backend refuses to
	 * install - it names every opaque document rather than this application - so
	 * a packaged claim declares nothing, and because an EMPTY allowlist keeps the
	 * daemon's historical CORS echo, the renderer's remaining direct reads keep
	 * working. In development the renderer is served from an http origin, and
	 * declaring it is what admits that origin once the claim tightens the plane.
	 */
	private rendererOrigins(): string[] {
		const url = process.env.ELECTRON_RENDERER_URL;
		if (!url) return [];
		const origin = normaliseAddress(url);
		return origin ? [origin] : [];
	}

	/**
	 * The ONE-release fallback for a daemon that predates the rendezvous record.
	 *
	 * This is the previous adoption path, kept verbatim in intent and renamed for
	 * what it now is (design §8): reachable ONLY when the record directory holds
	 * no record at all, i.e. the daemon serving this machine was built before
	 * `run/serve` existed. Without it a UI update would strand every user whose
	 * daemon is older than the UI; with it, that user keeps exactly the behaviour
	 * they had, including the pairing gate: a listener is adopted only when this
	 * app can authenticate to it.
	 *
	 * It is NOT reachable when records exist. There, a listener that is not the
	 * daemon a record describes is refused by the identity check - precisely the
	 * bug that admitted a stale dev server eleven releases behind - and the
	 * configured URL can only rank a candidate last, never admit one.
	 */
	private async legacyFixedPortAdoption(): Promise<boolean> {
		if (!this.canAuthenticate()) {
			logger.info(
				"No desktop pairing token for the configured backend; not adopting an external backend.",
				LogFileType.BACKEND,
			);
			return false;
		}
		try {
			logger.warn(
				`Deprecated: no serve records found. Falling back to the fixed-port probe at ${this.backendUrl}/health for a daemon predating the record format. This fallback is scheduled for removal (design §8).`,
				LogFileType.BACKEND,
			);
			const response = await fetch(`${this.backendUrl}${HEALTH_PATH}`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS * 2),
			});
			if (!response.ok) {
				logger.info(
					`Legacy probe of ${this.backendUrl} answered ${response.status}; not adopting.`,
					LogFileType.BACKEND,
				);
				return false;
			}
			const payload = (await response.json().catch(() => null)) as {
				result?: { version?: unknown };
			} | null;
			if (!(await this.authenticatesAgainstBackend())) {
				logger.info(
					"A backend answered health but did not accept this app's desktop credential; not adopting it.",
					LogFileType.BACKEND,
				);
				return false;
			}
			const version =
				typeof payload?.result?.version === "string"
					? payload.result.version
					: "";
			this.attachedRecord = null;
			this.isExternalBackend = true;
			this.startupMode = LocalOperatorStartupMode.EXISTING_SERVER;
			this.daemonState.attach(
				{
					url: this.backendUrl,
					instanceId: "",
					pid: 0,
					version,
					prefix: "",
					installKind: "",
				},
				{ owned: false },
			);
			this.daemonState.setDesktopAvailable(true);
			logger.info(
				`Adopted a pre-record daemon at ${this.backendUrl} (v${version || "unknown"}) through the deprecated fallback.`,
				LogFileType.BACKEND,
			);
			this.notifyStatus();
			this.notifyBackendReady();
			return true;
		} catch (error) {
			logger.info(
				`Legacy fixed-port probe of ${this.backendUrl} failed: ${error instanceof Error ? error.message : String(error)}`,
				LogFileType.BACKEND,
			);
			return false;
		}
	}

	/**
	 * Ask the answering backend whether it will accept this app's bearer.
	 *
	 * Used by the deprecated pre-record fallback, which has no claim key to
	 * present: the only credential there is the token this app already holds.
	 */
	private async authenticatesAgainstBackend(): Promise<boolean> {
		try {
			const result = await this.requestDesktop({
				op: "sessions.list",
				limit: 1,
			});
			return classifyDesktopAnswer(result.status) === "accepted";
		} catch {
			return false;
		}
	}

	/**
	 * Check whether a daemon this app can use is already running, and attach to
	 * it if so.
	 *
	 * Declining is not a failure: `start()` spawns this app's own daemon exactly
	 * as it would on a cold start, and only when the manager is permitted to.
	 *
	 * @returns Promise resolving to true if a daemon was discovered and adopted
	 */
	async checkExistingBackend(): Promise<boolean> {
		return await this.discoverAndAttach();
	}

	/**
	 * Start the backend service
	 * @returns Promise resolving to true if the backend was started successfully, false otherwise
	 */
	/** The global console to launch, resolved the one shell-free way.
	 *
	 * `ownedServeLaunch` still proves the identity of what it is handed rather than
	 * trusting the name it was resolved under - that part is unchanged. What
	 * changed is WHERE the name comes from: this method used to re-resolve a bare
	 * `local-operator` through a shell, in the spawn environment that carries the
	 * login shell's PATH. That is the second resolution `globalConsoleScript`
	 * warns about, and it could name a venv a shell rc file prepends while the
	 * decision above had ranked the operator's real install - two answers to one
	 * question, with the spawn using the one the ranking never saw. Reading the
	 * same helper removes the possibility instead of documenting it.
	 *
	 * The throw is reachable only when the resolution succeeded a moment ago and
	 * the install disappeared since. It is deliberately not swallowed into an
	 * empty string: `consoleInterpreter("")` would report that as an ENOENT on a
	 * path nobody printed, and the caller's own failure report is the honest face
	 * of this.
	 */
	private async resolveGlobalConsole(): Promise<string> {
		const command = this.globalConsoleScript();
		if (!command) {
			throw new Error(
				"No global local-operator command could be resolved, though one was found a moment ago",
			);
		}
		return command;
	}

	/**
	 * Start a daemon this app owns, or attach to one that already exists.
	 *
	 * `stop(false)` is terminal by design: the app is going away or handing the
	 * installation over, and a spawn racing that hand-off is the double-serve
	 * case. A restart asks for `stop(true)`, which leaves this flag alone.
	 *
	 * Discovery runs FIRST, because this method is also the watchdog's recovery
	 * path: a daemon that appeared (or came back) after the app lost the one it
	 * had must be found again before a second one is ever spawned.
	 *
	 * @param options.quiet set by the watchdog, whose retries would otherwise
	 * raise one modal error dialog per attempt for a failure the app is already
	 * reporting in its status surface
	 * @param options.reuseDiscovery the caller has JUST run discovery in this same
	 * startup tick and its verdict - `discoveryBlocksSpawn`, the wedged records,
	 * the configured/remote flag - is what the decision below reads. Never pass it
	 * where time has passed in between - an installer, a dialog, anything that can
	 * let a daemon appear - because then the verdict is stale and spawning over a
	 * live daemon is the failure this path exists to prevent.
	 * @returns Promise resolving to true if the backend was started successfully, false otherwise
	 */
	start(options: StartOptions = {}): Promise<boolean> {
		if (this.isAppClosing) return Promise.resolve(false);
		if (this.startPromise) return this.startPromise;
		this.startPromise = this.startOwned(this.startEpoch, options).finally(
			() => {
				this.startPromise = null;
			},
		);
		return this.startPromise;
	}

	private async startOwned(
		epoch: number,
		options: StartOptions = {},
	): Promise<boolean> {
		if (this.ownedServe?.stop) return false;
		if (this.ownedServe) return this.isRunning;

		/*
		 * Discovery, unless the caller has just run it in this same startup tick.
		 *
		 * `checkExistingBackend()` publishes the attached state when it finds one,
		 * and it fires `notifyBackendReady()` AFTER the URL rotation - which is the
		 * ordering a consumer re-reading capabilities needs. Firing it again here
		 * raised two concurrent capability probes on the ordinary external-backend
		 * start, doubling that traffic and letting the OLDER read decide the result
		 * by settling last (review round 2, R2-2).
		 */
		if (!options.reuseDiscovery && (await this.checkExistingBackend())) {
			this.isRunning = true;
			this.startHealthCheck();
			return true;
		}
		if (epoch !== this.startEpoch || this.isAppClosing) return false;

		if (
			!this.managerMaySpawn ||
			this.remoteConfigured ||
			this.discoveryBlocksSpawn
		) {
			/*
			 * `VITE_DISABLE_BACKEND_MANAGER=true` means "do not spawn or kill a
			 * daemon", NOT "assume one exists". Discovery found nothing, so there
			 * is nothing to attach to and nothing this app is allowed to start:
			 * the honest outcome is a named state plus a probe loop that keeps
			 * re-discovering, so the daemon the operator starts a minute later is
			 * attached without restarting the app. Returning true here, as the old
			 * early return did, is what made every conversation open empty.
			 */
			/*
			 * Three different reasons reach this branch, and a log that named the
			 * disable flag for all of them sent whoever read it looking in the wrong
			 * place - a remote target reported as "VITE_DISABLE_BACKEND_MANAGER=true"
			 * is a config file that is not the one in play.
			 */
			const noSpawnReason = this.managerMaySpawn
				? this.remoteConfigured
					? `the configured target (${this.backendUrl}) is remote`
					: "a local daemon may still be running and could not be attached"
				: "VITE_DISABLE_BACKEND_MANAGER=true";
			logger.info(
				`No daemon discovered, and this app is configured not to spawn one (${noSpawnReason}).`,
				LogFileType.BACKEND,
			);
			this.observeNoCandidate();
			this.startHealthCheck();
			return false;
		}

		/*
		 * NEVER SPAWN ONTO A PORT A LOCAL OPERATOR DAEMON IS ANSWERING.
		 *
		 * WHY this runs before every spawn attempt rather than only at discovery.
		 * Discovery's verdict answers "is there a daemon I may attach to"; this
		 * answers "would a child of mine be able to bind that port". They came apart
		 * on the operator's machine: discovery had no record to work with (`0
		 * record(s)`) so it reported nothing to attach to, the app spawned onto a
		 * port where a Local Operator daemon was already serving, and the child died
		 * with `[Errno 48] Address already in use` - every ~10 s, each an orphan,
		 * while `/health` and `/v1/desktop/sessions` kept answering 200 to the app's
		 * own reads in between. The spawner was the only process that could have
		 * known, and it was asking too late.
		 *
		 * Four answers stop the spawn, and the distinction between them is what the
		 * app can honestly act on:
		 *
		 *   - a daemon identifies itself at that address, and no record this app can
		 *     read gives it a credential: the app takes the capability path instead
		 *     (recorded as `unattachable`, never as "offline");
		 *   - the address did not answer in time: something may well be listening, and
		 *     a busy daemon missing a 2 s budget is exactly the condition this file's
		 *     probe rules exist for, so the port is not treated as free;
		 *   - the address ANSWERED with a status that is not 200: a daemon starting up,
		 *     one that is unhealthy or shutting down, or a proxy fronting one. A
		 *     status is not an identity, but it is an occupant, and this one is
		 *     counted because the two costs are not symmetric: declining to start
		 *     costs one recovery tick, and starting over that answer costs the
		 *     credential (the token is minted before the spawn, so the pairing for the
		 *     daemon actually serving there is already overwritten) plus an orphan on
		 *     an `[Errno 48]` loop every ~10 s;
		 *   - nothing answered and the socket was REFUSED: that is the one answer
		 *     that proves the port free, and it is the ordinary first run.
		 *
		 * A 200 that names no daemon identity does not stop the spawn: this app cannot
		 * tell a reverse proxy or a development fixture from a port it may use,
		 * refusing would leave it with no backend and no path to one, and the cost of
		 * being wrong there - one child that cannot bind, reported by the readiness
		 * loop - is smaller than the cost of never starting one. The observation still
		 * goes to the log, so the case is diagnosable. That licence does NOT extend to
		 * a non-200 answer, which is the case above and was the review's F-2: a
		 * listener answering 503 while it starts says nothing about whether the port is
		 * free, and reading it as free is exactly how the app spawned onto a serving
		 * daemon.
		 *
		 * Retried on the next recovery tick, so a port that frees up is spawned onto
		 * without an app restart.
		 */
		const occupancy = await this.configuredOriginOccupancy();
		if (occupancy) {
			this.observeOriginOccupancy(occupancy);
			this.startHealthCheck();
			return false;
		}

		// No external backend, start our own. The token is minted and persisted
		// here, and the START is where it rotates: see the field's own note for why
		// a launch reads it back before rotating it.
		this.desktopToken = this.mintDesktopToken();
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
				const executable = await this.resolveGlobalConsole();
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
					// Registered BEFORE readiness is announced: the Settings row's
					// version comes from this registration, and a consumer that
					// re-reads capabilities on `backendReady` must already see it.
					await this.registerOwnedDaemon(child);
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

			this.reportStartOutcome(
				options,
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

			this.reportStartOutcome(
				options,
				`Error starting the Local Operator backend service: ${error}`,
			);

			return false;
		}
	}

	/**
	 * Register the daemon this app just spawned with the state machine.
	 *
	 * WHY this exists. `attach()` used to be called only for a daemon this app
	 * DISCOVERED (plus a spawn that asked for an ephemeral port), so the ordinary
	 * fixed-port spawn - the path every user without a global `lop` takes -
	 * returned `true` without registering anything. The snapshot then described
	 * an app with no daemon (`owned: false`, no version, no pid), Settings printed
	 * `Unknown (update required)` for a backend the app had started seconds ago,
	 * and the death notice called it "the attached backend". Registering here is
	 * also what makes the app's own daemon reachable by the same rules as every
	 * other one: the probe loop can compare an `instance_id`, and the renderer can
	 * name which daemon the number describes.
	 *
	 * Identity comes from the child's own record when it publishes one - the only
	 * source of the `instance_id` a later probe compares against - and otherwise
	 * from the address that just answered, where the identity question for a
	 * process this app spawned itself is "is the answering pid my child". That
	 * second arm is the case of an install predating the record format, which is
	 * reachable on a fixed port exactly as the deprecated adoption path allows.
	 */
	private async registerOwnedDaemon(child: ChildProcess): Promise<void> {
		const identity = await this.ownedDaemonIdentity(child);
		if (!identity) {
			/*
			 * Nothing could be established: no record, and the address either did
			 * not answer or was answered by a process that is not this child.
			 * Registering a guess is the failure mode this whole module exists to
			 * remove, so the manager reports and leaves the state alone - and the
			 * sentence below names what that means for the row: nothing
			 * re-registers this child, so a later discovery pass can only re-find
			 * it as an EXTERNAL daemon (`owned: false`, no ownership re-derived).
			 * It used to promise the daemon "stays unregistered until the next
			 * probe", which is a re-registration that does not exist (review
			 * round 3, R3-4).
			 */
			logger.warn(
				`Started a daemon at ${this.backendUrl} (pid ${child.pid}) but could not establish its identity; it is left unregistered rather than guessed, and a later discovery pass can only re-find it as a DISCOVERED daemon - not as the child this app started.`,
				LogFileType.BACKEND,
			);
			return;
		}
		this.daemonState.attach(identity, { owned: true });
		// Spawned by this app with this app's desktop token, so the plane accepts
		// it. Never asserted for a daemon this app did not start.
		this.daemonState.setDesktopAvailable(true);
		this.notifyStatus();
		logger.info(
			`Registered this app's own daemon: ${identity.url} (pid ${identity.pid}, v${identity.version || "unknown"}, ${identity.installKind || "kind unknown"}).`,
			LogFileType.BACKEND,
		);
	}

	/**
	 * The identity of a daemon this app spawned, or null when it cannot be proved.
	 *
	 * The record is preferred and is asked for with the SHORT registration window:
	 * the child has already answered `/health` here, and a record is published
	 * with the listener, so the file is either already there or this install does
	 * not write one at all (see `OWNED_REGISTRATION_WINDOW_MS`).
	 */
	private async ownedDaemonIdentity(
		child: ChildProcess,
	): Promise<DaemonIdentity | null> {
		const pid = child.pid;
		if (pid === undefined) return null;
		const resolved = await this.resolveOwnedAddress(
			child,
			OWNED_REGISTRATION_WINDOW_MS,
		);
		if (resolved) {
			/*
			 * The URL stays the address the app is dialling and just proved healthy:
			 * the record's spelling of the same listener (`localhost` for
			 * `127.0.0.1`, say) is a second place for the two to disagree, and every
			 * later request resolves against this field.
			 */
			return {
				url: this.backendUrl,
				instanceId: resolved.instanceId,
				pid,
				version: resolved.version,
				prefix: resolved.prefix,
				installKind: resolved.installKind,
			};
		}
		try {
			const response = await fetch(`${this.backendUrl}${HEALTH_PATH}`, {
				method: "GET",
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			});
			if (!response.ok) return null;
			const payload = (await response.json().catch(() => null)) as {
				result?: { version?: unknown };
			} | null;
			const health = readIdentity(payload);
			// A daemon that names a DIFFERENT process is somebody else's: the port
			// was taken, and registering it would label a stranger as this app's
			// child - the conflation the identity check exists to prevent.
			if (health && health.pid !== 0 && health.pid !== pid) return null;
			const version =
				health?.version ||
				(typeof payload?.result?.version === "string"
					? payload.result.version
					: "");
			return {
				url: this.backendUrl,
				// Empty for an install predating `instance_id`, which is what the
				// deprecated adoption path publishes for the same reason: there is
				// nothing to compare a later probe against, and the state machine
				// says so rather than inventing one.
				instanceId: health?.instanceId ?? "",
				pid,
				version,
				prefix: health?.prefix ?? "",
				installKind: health?.installKind ?? "",
			};
		} catch {
			return null;
		}
	}

	/**
	 * Wait for the child to publish its own record, then prove the address it
	 * names is the child.
	 *
	 * The record is keyed by pid, which is why this is scoped to THIS child: a
	 * record for any other pid is somebody else's daemon and is never adopted
	 * here. The `/health` identity check afterwards is what makes the record's
	 * claim trustworthy rather than merely plausible - the same rule discovery
	 * applies to every other candidate.
	 */
	private async resolveOwnedAddress(
		child: ChildProcess,
		windowMs: number = OWNED_RECORD_WINDOW_MS,
	): Promise<{
		address: string;
		port: number;
		instanceId: string;
		version: string;
		prefix: string;
		installKind: string;
	} | null> {
		if (!child.pid) return null;
		const deadline = Date.now() + windowMs;
		while (Date.now() < deadline) {
			if (this.process !== child) return null;
			const file = join(serveRunDir(), `${child.pid}.json`);
			try {
				const entry = parseRecord(
					JSON.parse(fs.readFileSync(file, "utf8")),
					file,
				);
				if (entry.record && entry.record.pid === child.pid) {
					const address = recordAddress(entry.record);
					const probe = await probeIdentity(address, entry.record.instance_id, {
						timeoutMs: PROBE_TIMEOUT_MS,
					});
					if (probe.outcome === "identified") {
						return {
							address,
							port: entry.record.port,
							instanceId: probe.identity.instanceId,
							version: probe.identity.version || entry.record.version,
							prefix: probe.identity.prefix || entry.record.prefix,
							installKind:
								probe.identity.installKind || entry.record.install_kind,
						};
					}
				}
			} catch {
				// No record yet (or a torn read): the child publishes once it has
				// bound its listener, which is what this loop waits for.
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		return null;
	}

	/** Report a start failure, honouring the watchdog's `quiet` retry.
	 *
	 * A retry the status surface is already reporting must not raise one modal per
	 * attempt; every other caller goes through `reportStartFailure`, which keeps
	 * the quit-path suppression that stops a modal parking the main thread. */
	private reportStartOutcome(options: StartOptions, message: string): void {
		if (options.quiet) {
			logger.error(
				`Backend Error (not shown; a retry is already reported in the status surface): ${message}`,
				LogFileType.BACKEND,
			);
			return;
		}
		this.reportStartFailure("Backend Error", message);
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

			// An answer of ANY status proves the transport reached the daemon, so the
			// failure cause is cleared here and set only by the catch below.
			this.lastHealthFailure = null;
			return response.ok;
		} catch (error) {
			/*
			 * Remember WHY this failed, not just that it did. The caller above reports
			 * an unattached daemon from this boolean alone, and a refused socket is
			 * evidence of absence while an expired budget is not - so the cause has to
			 * survive the fold into a boolean rather than being re-guessed upstream.
			 */
			this.lastHealthFailure = classifyUnreachable(error);
			return false;
		}
	}

	/**
	 * What is answering the address this app is configured to serve on, if
	 * anything that stops it starting a daemon there.
	 *
	 * `null` means "start it": either the socket was refused (the one answer that
	 * proves a port free), or something answered 200 without identifying as a Local
	 * Operator daemon. The second arm is deliberate and narrow - see the spawn gate
	 * in `startOwned()` - and the observation is logged either way. An answer whose
	 * STATUS is not 200 is not in that arm: it is an occupant (review round 1,
	 * F-2), and it returns a `silent` occupancy below rather than a licence to
	 * spawn.
	 */
	private async configuredOriginOccupancy(): Promise<OriginOccupancy | null> {
		const probe = await probeUnidentified(this.backendUrl, {
			timeoutMs: PROBE_TIMEOUT_MS,
		});
		switch (probe.reason) {
			case "identity-mismatch":
				return {
					kind: "daemon",
					pid: probe.identity?.pid ?? null,
					version: probe.identity?.version ?? "",
					detail: probe.detail,
				};
			/*
			 * A status that is not 200 is an OCCUPANT, not a licence to spawn, and it
			 * is handled here rather than by the `default` arm below so the decision is
			 * the one a reader finds rather than the one the switch happens to fall
			 * into (review round 1, F-2). It covers a Local Operator daemon starting up,
			 * unhealthy or shutting down, and a proxy that fronts one and answers 5xx:
			 * in every one of them the socket is bound, so a child spawned onto it dies
			 * on `[Errno 48]` - after `mintDesktopToken()` has already overwritten the
			 * credential for the daemon actually serving there. The answer does not
			 * prove a daemon this app may attach to, so the gate declines to start one
			 * and keeps probing; that is the safe direction, because the failure mode of
			 * the other one is unrecoverable loss of the pairing token.
			 */
			case "unready-answer":
				return {
					kind: "silent",
					cause: "other",
					detail: probe.detail,
				};
			case "not-a-daemon":
				logger.info(
					`${this.backendUrl}${HEALTH_PATH} answered and is not a Local Operator daemon (${probe.detail}); starting a daemon anyway, as this app always has.`,
					LogFileType.BACKEND,
				);
				return null;
			case "unreachable":
				return probe.cause === "refused"
					? null
					: {
							kind: "silent",
							cause: probe.cause ?? "other",
							detail: probe.detail,
						};
			default:
				// Any other verdict is still an ANSWER, so the address is not free.
				return {
					kind: "silent",
					cause: "other",
					detail: probe.detail,
				};
		}
	}

	/**
	 * Publish what the spawn gate saw, in the vocabulary the copy already uses.
	 *
	 * Two outcomes reach here and each gets the state that names it: a Local
	 * Operator daemon this app may not drive is `unattachable` (state `wedged` - a
	 * server IS running and this app did not attach to it, no banner claiming it is
	 * offline), and an address that did not answer in time is `unanswered` -
	 * `degraded`, usable, no banner, and still counted, because a budget that
	 * expired is not evidence of absence either way.
	 */
	private observeOriginOccupancy(occupancy: OriginOccupancy): void {
		const daemonLine = occupancy.kind === "daemon";
		const what = daemonLine
			? "This app was not given the key to that server, so it did not start a second one"
			: `${this.backendUrl} answered without proving it is a Local Operator daemon, so this app did not start one there`;
		/*
		 * The sentence, and what it may and may not spend words on (design round 1,
		 * D7). It used to be ~470 characters that restated its own title twice,
		 * narrated what a program WOULD do ("a new daemon there would fail to bind
		 * while that answer stands") rather than what happened, and named the serve
		 * record twice - once as the cause and once as the condition for attaching.
		 * § 8 asks for the event and the app's own next step, in the operator's
		 * words: one path, one action, and the identifiers set apart as machine
		 * voice rather than wrapped in prose (the identity line is the banner's; see
		 * the note on what this string deliberately no longer carries).
		 *
		 * The tail is a PROMISE, so it may only name futures this app can actually
		 * reach (review round 1, F-3). What IS reachable is "keeps probing" and "does
		 * not start a second one here" - and the attach half is not this window's to
		 * produce, which is why the sentence no longer offers it.
		 */
		const detail = `${what}. It keeps probing for a server it can open.`;
		this.daemonState.observe(
			occupancy.kind === "silent"
				? { kind: "unanswered", cause: occupancy.cause, detail }
				: { kind: "unattachable", detail },
		);
		logger.info(`Not spawning a daemon: ${detail}`, LogFileType.BACKEND);
		this.notifyStatus();
	}

	/**
	 * The token governing the daemon this app spawned in a PREVIOUS run, read from
	 * the 0600 file beside the app's other per-user state, or null.
	 *
	 * Read-only on purpose: a launch that has not spawned anything yet must not
	 * create a credential, or "this app holds no token" (a first run, and the
	 * honest reason to decline a daemon it cannot open) would become unreachable.
	 */
	private persistedDesktopToken(): string | null {
		try {
			const stored = fs.readFileSync(this.desktopTokenFile(), "utf8").trim();
			return stored || null;
		} catch {
			// Absent or unreadable: this is a first run as far as re-attaching goes.
			return null;
		}
	}

	/**
	 * Mint the token for a daemon this app is about to spawn, and persist it so the
	 * next launch can re-attach to that daemon instead of starting a second one.
	 *
	 * A token that cannot be written still governs this run's child - failing to
	 * start over a cache file would be the worse trade - and the log line names
	 * the cost, which is the stranded daemon next launch.
	 */
	private mintDesktopToken(): string {
		const token = randomBytes(32).toString("hex");
		try {
			const file = this.desktopTokenFile();
			fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
			fs.writeFileSync(file, token, { mode: 0o600 });
		} catch (error) {
			logger.warn(
				"Could not persist the desktop token; a daemon spawned now will not be re-attachable after a restart.",
				LogFileType.BACKEND,
				error,
			);
		}
		return token;
	}

	private desktopTokenPath: string | null = null;

	private desktopTokenFile(): string {
		if (this.desktopTokenPath === null) {
			this.desktopTokenPath = join(this.appDataPath, DESKTOP_TOKEN_FILENAME);
		}
		return this.desktopTokenPath;
	}

	/**
	 * One probe of the daemon this app is attached to.
	 *
	 * "Identified" means the answer came from the process we attached to, which
	 * is a strictly stronger question than "something answered 200". A 200 from a
	 * DIFFERENT process means the daemon was replaced under us or its port was
	 * taken, and that is a failure of the attachment, not a success.
	 *
	 * `/health` carries no authorization, so a gated route's 401/403/503 can
	 * never be read as a liveness answer here - which is the conflation this
	 * whole change is about. Those statuses surface through `requestDesktop`, and
	 * `DaemonStateMachine` records them BESIDE the state.
	 */
	private async probeAttachedDaemon(): Promise<ProbeObservation> {
		const expected = this.daemonState.expectedInstanceId();
		if (!expected) {
			// No identity to compare against (only reachable through the
			// deprecated pre-record path): a 200 is the most that can be known,
			// and it is reported as what it is.
			const ok = await this.checkHealth();
			if (ok) return { kind: "identified" };
			/*
			 * `checkHealth` cannot tell a refusal from an expired budget, so the cause it
			 * captured decides which of the three facts this observation is:
			 *
			 *   - nothing captured: the address ANSWERED, with a status this path does not
			 *     accept. A process is there and says it is not ready, which is an owned
			 *     child this app must replace, so it counts like a refusal;
			 *   - a refused socket: nothing is accepting on that port, which is evidence
			 *     of absence and may detach on the ordinary three misses;
			 *   - anything else (a budget that expired, an unknown throw): the address may
			 *     well be listening and busy, so it is counted as `unanswered` and needs
			 *     `UNANSWERED_BEFORE_DETACHED` of them.
			 */
			const failure = this.lastHealthFailure;
			return {
				kind:
					failure === null || failure === "refused" ? "failed" : "unanswered",
				cause: failure ?? "other",
				detail:
					failure === null
						? `${this.backendUrl}${HEALTH_PATH} answered a status this app does not accept`
						: `No answer from ${this.backendUrl}${HEALTH_PATH}`,
			};
		}
		const probe = await probeIdentity(this.backendUrl, expected, {
			timeoutMs: PROBE_TIMEOUT_MS,
		});
		switch (probe.outcome) {
			case "identified":
				return probe.identity.pid === this.daemonState.snapshot().pid
					? { kind: "identified" }
					: {
							kind: "failed",
							detail:
								"The answering daemon's PID no longer matches the attachment.",
						};
			case "identity-mismatch":
				return {
					kind: "failed",
					detail: `Another process is answering at ${this.backendUrl} (${probe.detail})`,
				};
			case "not-a-daemon":
				return {
					kind: "failed",
					detail: `${this.backendUrl} answered but is not a Local Operator daemon (${probe.detail})`,
				};
			case "unreachable":
				/*
				 * THE fix for the operator's report, and the reason the cause is carried
				 * this far. A refused socket means nothing is accepting on the port - the
				 * daemon is gone, and three of those may detach. A budget that expired with
				 * no answer means the opposite: something is listening and was busy. One
				 * long agent turn was enough to produce three of those while every session
				 * read succeeded, and the app reported its server offline for it.
				 */
				return probe.cause === "refused"
					? {
							kind: "failed",
							detail: `${this.backendUrl} refused the connection (${probe.detail})`,
						}
					: {
							kind: "unanswered",
							cause: probe.cause,
							detail: `${this.backendUrl} did not answer (${probe.detail})`,
						};
		}
	}

	/**
	 * Start health check interval.
	 *
	 * 10 s rather than 30 s, because the loop is now cheap and non-destructive:
	 * it observes, and the state machine - not the clock - decides whether
	 * anything is done about what it saw. A single missed probe changes nothing
	 * at all.
	 */
	private startHealthCheck(): void {
		// Clear existing interval if any
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
		}

		// Start new interval
		this.healthCheckInterval = setInterval(() => {
			void this.checkBackendHealth();
		}, PROBE_INTERVAL_MS);
	}

	/**
	 * One watchdog tick: observe the daemon, then act only where the state
	 * machine says action is warranted.
	 *
	 * The previous loop restarted the backend on ONE failed 30 s sample - for a
	 * daemon that might have been mid-restart, busy with someone else's turn, or
	 * serving another app - and, for an external daemon, adopted it as "ours" and
	 * started a second one. Neither is possible here: `degraded` never starts
	 * anything, and only `detached` reaches {@link recoverFromDetachment}.
	 */
	private async checkBackendHealth(): Promise<void> {
		if (this.isAppClosing) return;

		// A child of ours whose pid is gone is EVIDENCE, not a timeout to
		// interpret: no probe is needed to learn something we already know.
		// The pid may belong to an EXTERNAL daemon this app discovered, so the
		// sentence names which one it was: reporting a discovered daemon as
		// "owned" tells the operator this app was managing it, which is exactly
		// the claim the no-replacement rules exist to make false.
		const snapshot = this.daemonState.snapshot();
		const pid = this.remoteConfigured
			? null
			: snapshot.pid || this.process?.pid;
		if (pid && pidLiveness(pid) === "dead") {
			logger.info(
				`${snapshot.owned ? "The backend this app started" : "The attached backend"} (pid ${pid}, ${snapshot.installKind ?? "unknown install"}) is gone; detaching immediately.`,
				LogFileType.BACKEND,
			);
			this.daemonState.observe({ kind: "pid-dead" });
			this.notifyStatus();
			await this.recoverFromDetachment();
			return;
		}

		if (
			this.daemonState.getState() === "detached" ||
			this.daemonState.getState() === "wedged"
		) {
			// Already without a usable daemon: this tick is a re-discovery, never a
			// restart of the daemon that was lost. `wedged` takes the same path for
			// the same reason - a record whose heartbeat stopped may resume, may die
			// (and then be reaped), or may be replaced by a daemon the operator
			// starts, and all three are found by looking, not by spawning.
			await this.recoverFromDetachment();
			return;
		}

		const observation = await this.probeAttachedDaemon();
		const before = this.daemonState.snapshot();
		const next = this.daemonState.observe(observation);
		const after = this.daemonState.snapshot();
		// Push only a real change: a probe that found what the last probe found is
		// not news, and a status event per 10 s tick would be one IPC wake-up per
		// interval forever.
		if (after.state !== before.state || after.detail !== before.detail) {
			this.notifyStatus();
		}
		if (next === "detached") {
			logger.warn(
				`Backend detached: ${this.daemonState.snapshot().detail}`,
				LogFileType.BACKEND,
			);
			await this.recoverFromDetachment();
		}
	}

	/**
	 * Re-discover NOW, on the renderer's request, and answer with the snapshot.
	 *
	 * The connectivity banner's Retry needs this. Recovery is paced by
	 * `nextRecoveryAt`, so once the liveness signal moved to MAIN a renderer that
	 * only re-read the snapshot could not cause an attempt the timer was not
	 * already going to make - an inert control in the one state that offers it.
	 * This clears the pacing for this attempt (a user asking IS the reason to try
	 * now) and runs the same recovery path the timer runs, so the two cannot
	 * drift apart about what trying means.
	 *
	 * @returns the snapshot as it stands when the attempt has finished, so the
	 * caller renders what main observed rather than what it hoped for
	 */
	async reconnectNow(): Promise<DaemonStatusSnapshot> {
		this.nextRecoveryAt = 0;
		await this.recoverFromDetachment();
		return this.getStatusSnapshot();
	}

	/**
	 * Recover from a lost daemon - by RE-DISCOVERING, and only then by starting
	 * one.
	 *
	 * The order is the whole safety property: a daemon that a TUI (or a previous
	 * app run) owns may still be there on a port this app has not looked at yet,
	 * and starting a second one because the first did not answer would leave two
	 * servers writing one transcript. An external daemon is never restarted or
	 * replaced at all: if it is gone, the app says so.
	 */
	private async recoverFromDetachment(): Promise<void> {
		if (this.isAppClosing || this.isAutoUpdating || this.recoveryInFlight)
			return;
		// Backoff applies to a daemon we HAD (re-attaching to a specific daemon
		// on a specific address is the case worth pacing). With no daemon at all,
		// a tick is one directory read plus a couple of loopback probes, and
		// discovering one the operator starts a minute later is the entire point.
		if (this.daemonState.expectedInstanceId() !== null) {
			const now = Date.now();
			if (now < this.nextRecoveryAt) return;
			// Advance only on a real attempt, not each skipped timer tick.
			this.nextRecoveryAt = now + this.daemonState.nextBackoff();
		}
		if (this.daemonState.isReportablyGone()) {
			// Named with the record that described it: "the daemon my TUI started
			// is gone" is diagnosable only if the log says which record was
			// behind the attachment.
			logger.info(
				`No daemon at ${this.backendUrl} for over ${DETACHED_AFTER_MS / 1000}s${this.attachedRecord ? ` (its record was ${this.attachedRecord.file})` : ""}; reporting it as stopped rather than reconnecting.`,
				LogFileType.BACKEND,
			);
		}
		this.recoveryInFlight = true;
		try {
			// Recover the selected daemon first. Re-discovery must not silently switch
			// installs during a transient outage, especially with an active turn.
			if (this.daemonState.expectedInstanceId()) {
				const observation = await this.probeAttachedDaemon();
				if (observation.kind === "identified") {
					this.daemonState.observe(observation);
					this.nextRecoveryAt = 0;
					this.notifyStatus();
					this.notifyBackendReady();
					return;
				}
				/*
				 * WHAT the probe found is folded into the state on EVERY branch, not only
				 * on `identified`.
				 *
				 * Recovery is the only path a renderer can trigger (`reconnectNow()`,
				 * the banner's Retry), and it is the only path that can correct a stale
				 * attachment when nothing ticks: dropping a `failed`/`pid-dead` verdict
				 * here left the machine on `attached` while the probe had just answered
				 * that the daemon was gone, so `reconnectNow()` returned the same stale
				 * pid and detail it was asked to refresh - a Retry that could not retry,
				 * and a status claiming a dead daemon was connected (QA round 3, Q-2).
				 *
				 * A pid that is gone is EVIDENCE rather than a timeout to interpret, and
				 * is recorded as such - the same rule `checkBackendHealth` applies before
				 * it comes here, which is why the two cannot disagree about what a dead
				 * process means.
				 */
				const selectedPid = this.daemonState.snapshot().pid;
				const processGone =
					selectedPid !== null && pidLiveness(selectedPid) === "dead";
				const before = this.daemonState.snapshot();
				this.daemonState.observe(
					processGone ? { kind: "pid-dead" } : observation,
				);
				const after = this.daemonState.snapshot();
				// The same push discipline the tick uses: a probe that found what the
				// last one found is not news.
				if (after.state !== before.state || after.detail !== before.detail) {
					this.notifyStatus();
				}
				// A process that is still there is not ours to replace on a failed
				// probe: paced and retried, never spawned over.
				if (!processGone) return;
			}
			// A live owned ChildProcess (including a legacy daemon without records)
			// is not ours to kill just because HTTP timed out.
			if (
				this.process &&
				this.process.exitCode === null &&
				this.process.signalCode == null
			)
				return;
			if (await this.discoverAndAttach()) return;
			if (
				!this.managerMaySpawn ||
				this.remoteConfigured ||
				this.isExternalBackend ||
				this.discoveryBlocksSpawn
			)
				return;
			await this.start({ quiet: true });
		} finally {
			this.recoveryInFlight = false;
		}
	}
	/**
	 * Get the port number used by the backend service
	 * @returns The port number
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * The pid of the process this app SPAWNED, or null.
	 *
	 * The one way any caller may learn what this app is allowed to signal. It is
	 * deliberately not "the backend's pid": an attached daemon has a pid too, and
	 * it is not this app's to kill - the invariant is `owned <-> this.process`.
	 *
	 * Used by the quit path's last-resort handler, which must be synchronous and
	 * therefore cannot go through `stop()`.
	 */
	getOwnedPid(): number | null {
		return this.process?.pid ?? null;
	}

	/**
	 * The version the daemon serving this app BOOTED with, from its own record.
	 *
	 * WHAT THIS IS NOT, and the mistake it exists to prevent: it is not
	 * `getStatusSnapshot().version` and it is not `/health`'s `version`. Both carry
	 * what the daemon computes from the metadata installed ON DISK when it answers,
	 * so a process running old code out of memory reports the NEWER version and the
	 * skew disappears exactly when a reader needs to see it. The serve record
	 * (`server/registry.py`) is written once at process start and never re-read, so
	 * its `version` is the build the running process actually loaded.
	 *
	 * Two arms, because the record is reached two ways: a daemon discovery ADOPTED
	 * keeps its parsed record on this manager, while one this app SPAWNED is keyed by
	 * its own pid in the record directory. Both are the same field of the same
	 * document.
	 *
	 * A record that carries no version (an install predating the field), a record
	 * that cannot be read, and no daemon at all are all `null` - an absence to be
	 * reported, never a version to be compared.
	 */
	getAttachedBootVersion(): string | null {
		const adopted = this.attachedRecord?.record.version?.trim() ?? "";
		if (adopted !== "") return adopted;
		return serveRecordVersion(this.process?.pid ?? null, serveRunDir());
	}

	/**
	 * Whether the renderer holds any session stream open right now.
	 *
	 * The only in-flight-ish evidence main has: it counts conversations being
	 * VIEWED, not turns running (a mounted chat holds its subscription while idle),
	 * which is why the drift restart treats an open stream as a reason to wait one
	 * check cycle rather than as proof that nothing is in flight.
	 */
	hasOpenSessionStreams(): boolean {
		return (this.streamRelay?.openStreamCount() ?? 0) > 0;
	}

	/**
	 * The address this app is talking to RIGHT NOW.
	 *
	 * Not the configured target: `attachTo` rotates `backendUrl` onto the daemon
	 * discovery adopted, and everything that queries the backend resolves against
	 * it at call time. A consumer that instead read the configured URL described a
	 * daemon the app is not talking to - the update service's `/health` read did
	 * exactly that, so for an adopted daemon every version read failed and the
	 * panel could neither name the build being served nor report the skew after an
	 * install moved (QA Q-2, UX U1).
	 */
	getBackendUrl(): string {
		return this.backendUrl;
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
