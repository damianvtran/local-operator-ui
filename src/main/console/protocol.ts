/**
 * The console method namespace, its params, and its typed errors.
 *
 * Design: docs/design/ui-console-tab.md 10.2 (the vocabulary, both sides), 10.6
 * (the failure taxonomy), 15 (what each actor reads).
 *
 * WHY THIS IS ITS OWN MODULE rather than a second list inside
 * `browser/protocol.ts`: the console rides the same wire, the same endpoint and
 * the same key (§10.1), but its names are a namespace. `browser/protocol.ts`
 * spreads these into the two lists that must stay total — `METHODS` (the closed
 * gate `isMethod` enforces) and `COMMAND_TIMEOUTS_S` — so the wire has one
 * vocabulary with one source per namespace instead of two hand-kept copies.
 *
 * PROTO_VERSION DOES NOT MOVE. Every addition here is additive: new methods an
 * old peer never calls, new `ErrorCode`s an old peer never emits, and new
 * optional params. Per the rule `protocol.py` states, the floor moves only for a
 * commit that changes the *meaning* of an existing frame or method, and nothing
 * here does.
 */

/** The console namespace's method names, in the order §10.2 lists them. */
export const CONSOLE_METHODS = [
	"console_list",
	"console_create",
	"console_status",
	"console_read",
	"console_screenshot",
	"console_input",
	"console_keys",
	"console_resize",
	"console_secure",
	"console_close",
] as const;

export type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

const CONSOLE_METHOD_SET: ReadonlySet<string> = new Set<string>(
	CONSOLE_METHODS,
);

/** Whether a raw string names a console method. */
export function isConsoleMethod(value: unknown): value is ConsoleMethod {
	return typeof value === "string" && CONSOLE_METHOD_SET.has(value);
}

/**
 * The typed refusals the console adds to the shared vocabulary (§10.6).
 *
 * Named with the reason the existing value would be a lie, and every one of them
 * is a value a *released* peer never emits — which is what keeps the proto floor
 * where it is. `capture_unavailable` is the one addition the design does not
 * list: §13.2's offscreen capture view is PR B's (§17.1), so in PR A a surface
 * with no displayed pane has no honest `rendered` value to answer with, and this
 * code says so rather than pretending. It is replaced by `rendered:
 * "offscreen"` in B and is recorded as the deviation it is.
 */
export const CONSOLE_ERROR_CODES = [
	"unsupported_method",
	"surface_unavailable",
	"surface_not_owned",
	"process_exited",
	"input_queue_full",
	"unknown_key",
	"secure_input_active",
	"console_unavailable",
	"invalid_grid",
	"capture_unavailable",
] as const;

export type ConsoleErrorCode = (typeof CONSOLE_ERROR_CODES)[number];

/** Who created a surface. Provenance, never authority: both values may be read
 * by the owning session's agent (§6.5). */
export type SurfaceOrigin = "user" | "agent";

/**
 * Per-method budgets, in the same shape and on the same scale as the browser
 * namespace's `COMMAND_TIMEOUTS_S`.
 *
 * These are the numbers the session's own client sizes its HTTP budget from, so
 * they are stated here rather than left to the Python side to invent: two hand-kept
 * copies is how the two drift, and a budget smaller than the work is a command
 * that reads as "the host did not answer". `create` is the widest because it
 * forks a process, `close` because it waits out a bounded grace before SIGKILL,
 * and `screenshot` because a capture may retry once against a hidden window.
 * PR C mirrors these into `protocol.py`'s `COMMAND_TIMEOUTS`.
 */
export const CONSOLE_COMMAND_TIMEOUTS_S: Record<ConsoleMethod, number> = {
	console_list: 20.0,
	console_create: 30.0,
	console_status: 20.0,
	console_read: 20.0,
	console_screenshot: 30.0,
	console_input: 20.0,
	console_keys: 20.0,
	console_resize: 20.0,
	console_secure: 20.0,
	console_close: 25.0,
};

/** `reveal`, and the focus-intent allowlist (§10.4). No value raises the OS
 * window: a `reveal` that would have to is downgraded to `none`. */
export type ConsoleReveal = "none" | "session" | "open";

/** A surface as `console_list` reports it (§10.2). */
export interface ConsoleSurfaceListing {
	surface: string;
	session_id: string;
	origin: SurfaceOrigin;
	command: string;
	argv_tail: string;
	cwd: string;
	cols: number;
	rows: number;
	running: boolean;
	exit_code: number | null;
	/** Seconds since the epoch, matching the record's own clock. */
	last_activity: number;
	/** False for a surface reconstructed from persisted history after a relaunch
	 * (§7.3): nothing is running and nothing will be. */
	live: boolean;
	/** The browser's own vocabulary for the same fact as `origin` (§6.5): kept
	 * because a caller that reads the browser's listings should not have to learn
	 * a second spelling. */
	agent_owned: boolean;
}
