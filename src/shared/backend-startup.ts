/**
 * The owned server's START-UP, as one record main publishes and the renderer
 * draws: is it starting, did it fail, and why.
 *
 * WHY THIS EXISTS BESIDE THE CONNECTION STATE. `DaemonConnectionState` answers
 * "is this app attached to a server", and a start that has not finished and a
 * start that failed both read `connecting` / `detached` there. What a first-run
 * user saw instead was the generic "Failed to start ... check the logs" box,
 * then (where the app stayed up) a scatter of "Server is offline. Please check
 * your connection." from every hook that gates on the server - true of the
 * symptom, and silent about the cause main had in hand: the child's exit code,
 * its last stderr lines, the errno its spawn failed with. PostHog, 30 days to
 * 2026-11-17: those connectivity errors appear in 82 Windows users' sessions,
 * 26% of Windows users, against 3 on macOS.
 *
 * The record is pure data plus pure functions so main, the renderer and the
 * tests read the same rules; the sentences a person reads are catalogue keys
 * resolved in the renderer (`ui.common.backend_startup.*`).
 */

/** Where the owned server's start-up is. `ready` is the success terminal. */
export type BackendStartupPhase = "starting" | "ready" | "failed";

/**
 * Why a start failed, as a category a person can act on.
 *
 * Ordered by how specific the evidence is; `classifyStartupFailure` tests them
 * in that order.
 */
export const BACKEND_STARTUP_CATEGORIES = [
	/** Another program holds the port the server tried to bind. */
	"port_in_use",
	/** The OS refused the bind itself: on Windows, a reserved port range. */
	"port_forbidden",
	/** The executable could not be run: denied, or quarantined by antivirus. */
	"executable_blocked",
	/** The executable is not where it was: removed, or never installed. */
	"executable_missing",
	/** The server's Python raised during start-up. */
	"crashed",
	/** The process ended before answering, with no more specific cause. */
	"exited",
	/** The process kept running and never answered within the start budget. */
	"timed_out",
	"unknown",
] as const;
export type BackendStartupCategory =
	(typeof BACKEND_STARTUP_CATEGORIES)[number];

export interface BackendStartupFailure {
	category: BackendStartupCategory;
	/** The child's exit code, when it exited. */
	exitCode: number | null;
	/** The signal that ended it, when one did. */
	signal: string | null;
	/** The errno-style code of a spawn that never produced a process. */
	spawnErrorCode: string | null;
	/** The last lines the child wrote to stderr, bounded (see STDERR_TAIL_CHARS). */
	stderrTail: string;
	/** Main's own technical account, not for sharing. */
	message: string;
	/**
	 * The server had reached `ready` and then died (UX round 1, U2). Such a
	 * failure is not a failed START: the band says "stopped unexpectedly", not
	 * "could not start", and `backend_status` reports it with `after_ready` and
	 * no start-up duration, so session uptime never enters the start-up
	 * distribution (review round 1, R2). Optional so a record from a build that
	 * predates the flag reads as a start-up failure, which is what it was then.
	 */
	afterReady?: boolean;
}

export interface BackendStartup {
	phase: BackendStartupPhase;
	/** Epoch ms the current attempt spawned. */
	startedAt: number;
	/**
	 * The readiness budget this attempt runs against - main's existing
	 * `READINESS_BUDGET_MS`, carried rather than re-declared so the progress the
	 * renderer draws is measured against the bound main actually enforces.
	 */
	budgetMs: number;
	/** 1-based attempt number within this app session. */
	attempt: number;
	/** Epoch ms the attempt reached `ready` or `failed`; null while starting.
	 * With `startedAt` it is the start-up duration the `backend_status` event
	 * reports - the distribution any change to the budget must be measured on. */
	settledAt: number | null;
	failure: BackendStartupFailure | null;
	/**
	 * Failed starts since the server was last ready, excluding a stop after
	 * Ready (U9). A failed start includes the current attempt (UX
	 * round 1, U4): a Restart that fails again must not look identical to the
	 * first failure, which is what drove the repeated Retry presses in the D1/D2
	 * replays. Reset to 0 by `ready`. Optional for records from older builds.
	 */
	failuresInRow?: number;
}

/**
 * How much stderr is kept: a MEMORY bound on a ring, not a time bound. 4 KiB
 * holds a full Python traceback's tail (the exception line is last) without
 * letting a chatty child grow main's heap.
 */
export const STDERR_TAIL_CHARS = 4096;

/** Append a chunk to a bounded tail, keeping the most recent characters. */
export function appendStderrTail(tail: string, chunk: string): string {
	const next = tail + chunk;
	return next.length > STDERR_TAIL_CHARS
		? next.slice(next.length - STDERR_TAIL_CHARS)
		: next;
}

/*
 * Windows NTSTATUS exit codes as Node reports them (unsigned 32-bit).
 * 0xC0000022 STATUS_ACCESS_DENIED: the image was denied execution - the shape
 * an antivirus block or an AppLocker policy takes. 0xC0000135
 * STATUS_DLL_NOT_FOUND: a runtime DLL is missing, i.e. the install is broken.
 */
const WIN_ACCESS_DENIED = 0xc0000022;
const WIN_DLL_NOT_FOUND = 0xc0000135;

/*
 * The patterns read the machine's own words (Python's errno text, Winsock's),
 * so they stay English whatever the UI locale. `Errno 98` is Linux EADDRINUSE,
 * `Errno 48` macOS, `WinError 10048` Winsock WSAEADDRINUSE; `WinError 10013`
 * (WSAEACCES) is what binding a port inside a Hyper-V/WinNAT excluded range
 * answers, which no port check before the spawn can see.
 */
const PORT_IN_USE =
	/address already in use|\[Errno (?:98|48)\]|WinError 10048|only one usage of each socket address/i;
const PORT_FORBIDDEN =
	/WinError 10013|forbidden by its access permissions|\[Errno 13\][^\n]*(?:bind|address)/i;
const ACCESS_DENIED =
	/Access is denied|operation did not complete successfully because the file contains a virus|blocked by group policy/i;
const PYTHON_RAISED = /Traceback \(most recent call last\)|^\w*Error: /m;

/**
 * Classify a failed start from the evidence main collected.
 *
 * `timedOut` means the readiness budget ran out while the process was still
 * alive; every other arm reads what the process left behind.
 */
export function classifyStartupFailure(input: {
	spawnErrorCode?: string | null;
	exitCode?: number | null;
	signal?: string | null;
	stderrTail?: string;
	timedOut?: boolean;
}): BackendStartupCategory {
	const stderr = input.stderrTail ?? "";
	const spawnCode = input.spawnErrorCode ?? null;
	if (PORT_IN_USE.test(stderr)) return "port_in_use";
	if (PORT_FORBIDDEN.test(stderr)) return "port_forbidden";
	if (spawnCode === "EACCES" || spawnCode === "EPERM")
		return "executable_blocked";
	if (spawnCode === "ENOENT") return "executable_missing";
	if (
		input.exitCode === WIN_ACCESS_DENIED ||
		input.exitCode === WIN_ACCESS_DENIED - 0x100000000 ||
		ACCESS_DENIED.test(stderr)
	)
		return "executable_blocked";
	if (
		input.exitCode === WIN_DLL_NOT_FOUND ||
		input.exitCode === WIN_DLL_NOT_FOUND - 0x100000000
	)
		return "executable_missing";
	if (PYTHON_RAISED.test(stderr)) return "crashed";
	if (input.timedOut) return "timed_out";
	if (input.exitCode != null || input.signal != null) return "exited";
	return spawnCode ? "executable_blocked" : "unknown";
}

/*
 * Best-effort masking for the local Show details view only. An unknown secret
 * shape can still get through, so this must never be the clipboard boundary.
 */
const SECRET_PATTERNS: readonly [RegExp, string][] = [
	// Strip the whole URL userinfo, not just the password.
	[/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/<>"'?#]+@/gi, "$1[redacted]@"],
	// Consume a complete quoted value (including whitespace and escaped quotes).
	[
		/\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd|credential|auth)[A-Za-z0-9_-]*["']?\s*[:=]\s*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/gi,
		"$1[redacted]",
	],
	// HTTP auth schemes are case-insensitive; mask the payload before the
	// generic assignment pattern can mistake a scheme for the value.
	[/\b(Bearer|Basic)[ \t]+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]"],
	[
		/\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|passwd|credential|auth)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*)(?!\[redacted\]|(?:Bearer|Basic)[ \t])([^\s"',;&]+)/gi,
		"$1$2[redacted]",
	],
	// Provider key prefixes that appear bare (OpenAI/Anthropic `sk-`, GitHub,
	// Slack, Google API keys, AWS access key ids).
	[
		/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16})/g,
		"[redacted]",
	],
	// Long opaque hex runs (the desktop token is 64 hex characters).
	[/\b[a-f0-9]{32,}\b/gi, "[redacted]"],
];

/** Mask known credential shapes in the local stderr view. */
export function redactSecrets(text: string): string {
	let out = text;
	for (const [pattern, replacement] of SECRET_PATTERNS)
		out = out.replace(pattern, replacement);
	return out;
}

const allowlisted = (value: unknown, choices: readonly string[]) =>
	typeof value === "string" && choices.includes(value) ? value : "unknown";
const RELEASE_VERSION = /^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}$/;
const integer = (value: unknown, min: number) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= min
		? value
		: null;

/**
 * Shareable and locale-independent. Only emit validated structured values:
 * even redacted free text can identify the user (e.g. home paths in stderr).
 * In particular, omit exact timestamps and free-form version suffixes.
 */
export function startupDiagnosticsText(
	startup: BackendStartup | null,
	context: {
		appVersion?: string | null;
		platform?: string | null;
		arch?: string | null;
		state?: string | null;
	},
): string {
	const version = context.appVersion;
	const platform = allowlisted(context.platform, ["darwin", "linux", "win32"]);
	const arch = allowlisted(context.arch, ["arm64", "x64", "ia32", "arm"]);
	const state = allowlisted(context.state, [
		"connecting",
		"attached",
		"degraded",
		"detached",
		"replaced",
		"wedged",
	]);
	const lines = [
		"Local Operator start-up diagnostics",
		`app: ${typeof version === "string" && RELEASE_VERSION.test(version) ? version : "unknown"}`,
		`platform: ${platform}${arch === "unknown" ? "" : ` ${arch}`}`,
		`connection: ${state}`,
	];
	if (!startup) {
		lines.push("start: no start-up recorded by this app session");
		return lines.join("\n");
	}
	const phase = allowlisted(startup.phase, ["starting", "ready", "failed"]);
	const attempt = integer(startup.attempt, 1);
	const budget = integer(startup.budgetMs, 1);
	lines.push(
		`start: ${phase}, attempt ${attempt ?? "unknown"}, budget ${budget === null ? "unknown" : `${Math.round(budget / 1000)} s`}`,
	);
	const f = startup.failure;
	if (f) {
		lines.push(
			`category: ${allowlisted(f.category, BACKEND_STARTUP_CATEGORIES)}`,
		);
		if (f.afterReady === true)
			lines.push("stopped after a successful start: yes");
		const exitCode = integer(f.exitCode, -0x80000000);
		if (exitCode !== null && exitCode <= 0xffffffff)
			lines.push(`exit code: ${exitCode}`);
	}
	return lines.join("\n");
}

/** IPC channel: restart the owned server (stop, then start). */
export const BACKEND_RESTART_CHANNEL = "backend-restart";
