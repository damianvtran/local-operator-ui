import { randomBytes } from "node:crypto";
import { ConsoleError } from "./errors";
import type { SurfaceOrigin } from "./protocol";

/**
 * The surface registry: what surfaces exist, what they are, and how many.
 *
 * Design: docs/design/ui-console-tab.md 6.3 (the registry and its caps), 6.5
 * (provenance and the `con:` handle grammar), 6.7 (surface identity and
 * lifetime), 8.4 (the grid a surface is born with).
 *
 * WHY IT IS APP-GLOBAL RATHER THAN PER-SESSION. §6.3 makes cross-session
 * multiplexing the default: one registry in main, each surface keyed by the
 * session that created it, and a session's pane filters the listing. There is no
 * per-session daemon to start, and a session that switched away keeps its
 * surfaces because the registry never learned about the switch.
 *
 * WHY IT HOLDS NO PTY. This module is deliberately generic over the runtime an
 * entry carries (`R`), so the caps, the token grammar and the lifetime rules are
 * testable in-process with no native module, no emulator and no Electron. The
 * host is the only thing that fills the slot, and the only thing that removes an
 * entry.
 */

/** The surface-token prefix this host owns. `ui:` belongs to the browser host
 * and `bridge:` to the extension (§6.5); a handle names its host everywhere it
 * appears — a trace, an error, a listing. */
export const SURFACE_PREFIX = "con";

/** How many surfaces one session's *agent* may hold, mirroring the browser's
 * `MAX_AGENT_TABS = 8` and its reasoning: nothing else bounds how many an agent
 * fleet can open. A user's own surfaces are not capped within the app total. */
export const MAX_AGENT_SURFACES_PER_SESSION = 8;

/** The app-wide bound, user and agent surfaces together. This is a resource
 * bound, not a UI one: every surface holds a pty, a byte log (≤16 MiB) and a
 * headless terminal. */
export const MAX_SURFACES_PER_APP = 32;

/** How much of a nonce a redacted handle shows: enough to prefix-match your own
 * token against a listing, far too little to reconstruct it. Same rule and same
 * number as the browser's registry. */
const REDACTED_NONCE_CHARS = 6;

/** The handle grammar, anchored: it is parsed on every command that carries one. */
const SURFACE_TOKEN = /^con:(\d+):([A-Za-z0-9_-]+)$/;

/** Bytes of nonce entropy. 16 bytes base64url is 22 characters, which is what the
 * grammar above accepts. */
const NONCE_BYTES = 16;

export interface ParsedSurface {
	slot: number;
	nonce: string;
}

/** The mutable facts about one surface. Everything time-shaped is seconds since
 * the epoch, matching the discovery record's own clock. */
export interface ConsoleSurfaceRecord {
	surface: string;
	sessionId: string;
	origin: SurfaceOrigin;
	/** The program's display name: `argv[0]`'s basename for a command, the shell's
	 * name for a plain shell. */
	command: string;
	/** The rest of argv, space-joined, for a listing. Never the environment. */
	argvTail: string;
	cwd: string;
	cols: number;
	rows: number;
	running: boolean;
	exitCode: number | null;
	/** Seconds: the last byte the surface emitted, or its creation. */
	lastActivity: number;
	/** False once the process is gone AND nothing can bring it back. A surface
	 * reconstructed from history after a relaunch is `live: false` from birth
	 * (§7.3) and never becomes true. */
	live: boolean;
	/** Whether this surface's bytes are persisted (§7.2). */
	retain: boolean;
	/** Whether reads and captures of this surface are refused (§11.4.4). */
	secure: boolean;
	/** `fixed` refuses `console_resize` and refuses a pane's rect (§8.4): the
	 * escape hatch a test needs for frame-exact output. */
	sizing: "auto" | "fixed";
}

/** One registry entry: the wire facts, and the host's own handles for them. */
export interface ConsoleRegistryEntry<R> {
	record: ConsoleSurfaceRecord;
	/** Set by the host immediately after `create`/`adopt`. Null only in the
	 * window between the two, and for a reconstructed surface that has no
	 * runtime at all. */
	runtime: R | null;
}

export interface CreateSurfaceInput {
	/**
	 * The handle to adopt, for a surface reconstructed from history.
	 *
	 * A surface's handle is what a caller HOLDS — a notification's click payload, an
	 * agent's own record of a surface it opened — so a relaunch that minted a new one
	 * would break every reference to a surface that is still listed, which is exactly
	 * the state design 7.3 wants to be honest about rather than a state to make
	 * unreachable. Absent for every ordinary create, which mints one.
	 */
	surface?: string;
	sessionId: string;
	origin: SurfaceOrigin;
	command: string;
	argvTail: string;
	cwd: string;
	cols: number;
	rows: number;
	retain: boolean;
	sizing: "auto" | "fixed";
}

export interface ConsoleRegistryOptions {
	now?: () => number;
	nonce?: () => string;
}

export class ConsoleRegistry<R> {
	private readonly entries = new Map<string, ConsoleRegistryEntry<R>>();
	private readonly now: () => number;
	private readonly nonce: () => string;
	/** Monotonic slot number: the `<n>` in `con:<n>:<nonce>`. A counter rather
	 * than a reuse of the current size, so a handle never names a surface that was
	 * closed and a later one that took its place. */
	private nextSlot = 1;

	constructor(options: ConsoleRegistryOptions = {}) {
		this.now = options.now ?? (() => Date.now() / 1000);
		this.nonce =
			options.nonce ?? (() => randomBytes(NONCE_BYTES).toString("base64url"));
	}

	/** Every entry, oldest first, optionally filtered to one session. */
	list(sessionId?: string): ConsoleRegistryEntry<R>[] {
		const all = [...this.entries.values()];
		return sessionId === undefined
			? all
			: all.filter((entry) => entry.record.sessionId === sessionId);
	}

	/** How many surfaces exist, app-wide. */
	count(): number {
		return this.entries.size;
	}

	/** How many were created by that session's agent. */
	agentCount(sessionId: string): number {
		return this.list(sessionId).filter(
			(entry) => entry.record.origin === "agent",
		).length;
	}

	/**
	 * Create an entry, enforcing the caps in the order §6.3 states them.
	 *
	 * The refusals are the browser's own code for the same fact (`tab_limit`) with
	 * `data.limit` and the scope that bound, rather than a console-specific
	 * vocabulary for a generic condition — the same choice the design makes
	 * everywhere the existing taxonomy fits (§10.6).
	 */
	create(input: CreateSurfaceInput): ConsoleRegistryEntry<R> {
		if (this.count() >= MAX_SURFACES_PER_APP) {
			throw new ConsoleError(
				"tab_limit",
				`this app is already holding ${MAX_SURFACES_PER_APP} console surfaces; close one first`,
				{ limit: MAX_SURFACES_PER_APP, scope: "app" },
			);
		}
		if (
			input.origin === "agent" &&
			this.agentCount(input.sessionId) >= MAX_AGENT_SURFACES_PER_SESSION
		) {
			throw new ConsoleError(
				"tab_limit",
				`this session's agent is already running ${MAX_AGENT_SURFACES_PER_SESSION} console surfaces; close one first`,
				{ limit: MAX_AGENT_SURFACES_PER_SESSION, scope: "session" },
			);
		}
		const adopted = input.surface ? parseSurface(input.surface) : null;
		const slot = adopted ? adopted.slot : this.nextSlot;
		// The counter never goes backwards: an adopted handle's slot is honoured, and
		// the next minted one still cannot collide with it.
		this.nextSlot = Math.max(this.nextSlot, slot + 1);
		const record: ConsoleSurfaceRecord = {
			surface: input.surface ?? `${SURFACE_PREFIX}:${slot}:${this.nonce()}`,
			sessionId: input.sessionId,
			origin: input.origin,
			command: input.command,
			argvTail: input.argvTail,
			cwd: input.cwd,
			cols: input.cols,
			rows: input.rows,
			running: true,
			exitCode: null,
			lastActivity: this.now(),
			live: true,
			retain: input.retain,
			secure: false,
			sizing: input.sizing,
		};
		const entry: ConsoleRegistryEntry<R> = { record, runtime: null };
		this.entries.set(record.surface, entry);
		return entry;
	}

	/** Attach the host's runtime to an entry it just created. */
	attach(surface: string, runtime: R): void {
		this.require(surface).runtime = runtime;
	}

	/**
	 * Look up an entry, or refuse with the typed `surface_unavailable`.
	 *
	 * The message names the handle and how many exist, per §15: a caller that
	 * mis-typed a handle can tell "nothing like this" from "not this one".
	 */
	require(surface: string): ConsoleRegistryEntry<R> {
		const entry = this.entries.get(surface);
		if (!entry) {
			throw new ConsoleError(
				"surface_unavailable",
				`no console surface named ${redactSurface(surface)}; ${this.entries.size} exist`,
				{ surface: redactSurface(surface), count: this.entries.size },
			);
		}
		return entry;
	}

	/**
	 * Look up an entry without raising, for the asynchronous paths.
	 *
	 * A pty's data and exit callbacks fire after a surface may already have been
	 * closed, and a throw inside an event handler is an unhandled exception rather
	 * than a typed refusal a caller can read. Those paths use this and treat "gone"
	 * as "nothing left to do".
	 */
	find(surface: string): ConsoleRegistryEntry<R> | null {
		return this.entries.get(surface) ?? null;
	}

	/**
	 * Require an entry AND that a session owns it.
	 *
	 * Ownership is a fence, not a filter: §15 has the pane show only a session's
	 * own surfaces, and an agent that names another session's handle gets a typed
	 * refusal rather than a read of somebody else's terminal — the browser's
	 * `owner_refused` precedent, spelled the console's way so a caller need not
	 * substring-match a message.
	 *
	 * WHO CALLS IT, stated because a fence nobody stands at is theatre: the
	 * session-scoped callers are the pane's own ops and the harness tool, and neither
	 * is in this PR — the RPC call carries no session identity (the key is per-host,
	 * §10.1), so there is nothing for THIS process to compare a handle against. What
	 * PR A does enforce is the filter half of §15: `console-state`/`console_list`
	 * answer one session's surfaces, which is what the pane renders and what the tool
	 * reads. The refusal is defined and tested here so the seam exists when a caller
	 * has an identity to check.
	 */
	requireOwned(
		surface: string,
		sessionId: string | undefined,
	): ConsoleRegistryEntry<R> {
		const entry = this.require(surface);
		if (sessionId !== undefined && entry.record.sessionId !== sessionId) {
			throw new ConsoleError(
				"surface_not_owned",
				`${redactSurface(surface)} belongs to another session`,
				{ surface: redactSurface(surface) },
			);
		}
		return entry;
	}

	/** Patch the mutable facts. The handle, the session and the origin never move. */
	update(surface: string, patch: Partial<ConsoleSurfaceRecord>): void {
		const entry = this.require(surface);
		entry.record = { ...entry.record, ...patch, surface: entry.record.surface };
	}

	/**
	 * Drop an entry.
	 *
	 * Returns the entry it removed, or null when it was already gone — the same
	 * "already gone is the finished state" contract the browser's ownership ledger
	 * uses, so a close is idempotent without a second lookup.
	 */
	remove(surface: string): ConsoleRegistryEntry<R> | null {
		const entry = this.entries.get(surface);
		if (!entry) return null;
		this.entries.delete(surface);
		return entry;
	}

	/** Drop every entry and every runtime. The host's stop path, and the one place
	 * a caller may assume the map is empty afterwards. */
	clear(): ConsoleRegistryEntry<R>[] {
		const all = [...this.entries.values()];
		this.entries.clear();
		return all;
	}
}

/** The token for a slot and nonce. Exists so the grammar has one writer. */
export function surfaceToken(slot: number, nonce: string): string {
	return `${SURFACE_PREFIX}:${slot}:${nonce}`;
}

/** Parse a handle, or null. */
export function parseSurface(token: string): ParsedSurface | null {
	const match = SURFACE_TOKEN.exec(token);
	if (!match) return null;
	return { slot: Number.parseInt(match[1], 10), nonce: match[2] };
}

/** A handle shortened for a message, per the browser's redaction rule: enough to
 * match your own, too few characters to reconstruct. */
export function redactSurface(surface: string): string {
	const parsed = parseSurface(surface);
	if (!parsed) return "(malformed handle)";
	return `${SURFACE_PREFIX}:${parsed.slot}:${parsed.nonce.slice(0, REDACTED_NONCE_CHARS)}…`;
}
