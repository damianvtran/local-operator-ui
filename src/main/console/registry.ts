import { randomBytes } from "node:crypto";
import { ConsoleError } from "./errors";
import {
	type ConsolePolicy,
	DEFAULT_LIVE_LIMIT,
	consolePolicy,
} from "./policy";
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

/** Default per-owner STARTING/RUNNING agent allowance. The owner identifier is
 * claimed under the trusted app key, not a new authentication boundary. Keeping
 * this small prevents one ordinary conversation occupying the whole fleet. */
export const MAX_AGENT_SURFACES_PER_SESSION = 8;

/** Default live ceiling only. Archived handles consume no native admission;
 * host byte/cell/native budgets may admit less than the configured ceiling. */
export const MAX_SURFACES_PER_APP = DEFAULT_LIVE_LIMIT;

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
/**
 * Who drove a surface's pty: the human at the pane, or the agent over the RPC.
 *
 * A named type rather than an inline union because it crosses three files (the
 * record, the host's write paths, and the two call sites that name it) and a
 * typo in one of them would be a marker that silently never appears.
 */
export type ConsoleActor = "user" | "agent";

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
	/** The signal that ended the process, when node-pty reported one (Q-3). A
	 * signalled process reports exit code 0, so this is the only durable record
	 * that distinguishes a kill from a clean exit. */
	exitSignal: string | null;
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
	/** Who drove the pty last: the human in the pane, or the agent over the RPC.
	 *
	 * The co-pilot cell (§13.4) is what needs it. `origin` says who CREATED a
	 * surface and never changes, so a surface the user opened and an agent then
	 * typed into keeps `origin: "user"` for ever — which left the pane's agent
	 * marker with nothing to say at exactly the moment two actors were sharing one
	 * pty. `null` until either path writes, because "nobody has typed" is a
	 * different fact from "the user typed". */
	lastActor: "user" | "agent" | null;
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
	/** History is admitted as non-live before the quota check, not patched after
	 * it. Its emulator still consumes the app-wide bound, but it cannot run a pty
	 * and therefore must not consume an agent's live-process allowance. */
	live?: boolean;
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
	policy?: unknown;
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
	policy: ConsolePolicy;
	private generation = 0;
	/** Filled by the owning host; this registry never owns a PTY or its log. */
	refusalMetrics?: () => unknown;

	setPolicy(value: unknown): void {
		this.policy = consolePolicy(value);
		this.generation += 1;
	}

	/** Aggregate-only diagnostics: never leak an owner's identifier or command. */
	metrics() {
		const states = {
			starting: { user: 0, agent: 0 },
			running: { user: 0, agent: 0 },
			exited: { user: 0, agent: 0 },
			restored: { user: 0, agent: 0 },
		};
		for (const entry of this.entries.values()) {
			const state = !entry.record.live
				? "restored"
				: !entry.record.running
					? "exited"
					: entry.runtime === null
						? "starting"
						: "running";
			states[state][entry.record.origin] += 1;
		}
		return {
			generation: this.generation,
			sampled_at: this.now(),
			states,
			caps: { ...this.policy },
		};
	}

	liveCount(): number {
		return this.list().filter((entry) => entry.record.running).length;
	}

	constructor(options: ConsoleRegistryOptions = {}) {
		this.policy = consolePolicy(options.policy);
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

	/** How many STARTING/RUNNING surfaces this owner's agent holds. */
	agentCount(sessionId: string): number {
		return this.list(sessionId).filter(
			(entry) => entry.record.origin === "agent" && entry.record.running,
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
		if (input.live !== false && this.liveCount() >= this.policy.maxLive) {
			throw new ConsoleError(
				"tab_limit",
				`this app has reached its live console limit (${this.policy.maxLive}); completed history does not consume slots`,
				{
					limit: this.policy.maxLive,
					scope: "app",
					metrics: this.refusalMetrics?.() ?? this.metrics(),
				},
			);
		}
		if (
			input.live !== false &&
			input.origin === "agent" &&
			this.agentCount(input.sessionId) >= this.policy.maxOwner
		) {
			throw new ConsoleError(
				"tab_limit",
				`this session's agent has reached its live console allowance (${this.policy.maxOwner})`,
				{
					limit: this.policy.maxOwner,
					scope: "session",
					metrics: this.refusalMetrics?.() ?? this.metrics(),
				},
			);
		}
		if (
			input.live !== false &&
			input.origin === "agent" &&
			this.liveCount() >= this.policy.maxLive - this.policy.userReserved
		) {
			throw new ConsoleError(
				"tab_limit",
				"remaining live console slots are reserved for user terminals",
				{
					scope: "user_reserved",
					limit: this.policy.maxLive - this.policy.userReserved,
					metrics: this.refusalMetrics?.() ?? this.metrics(),
				},
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
			running: input.live !== false,
			exitCode: null,
			exitSignal: null,
			lastActivity: this.now(),
			live: input.live !== false,
			retain: input.retain,
			secure: false,
			lastActor: null,
			sizing: input.sizing,
		};
		const entry: ConsoleRegistryEntry<R> = { record, runtime: null };
		this.entries.set(record.surface, entry);
		this.generation += 1;
		return entry;
	}

	/** Attach the host's runtime to an entry it just created. */
	attach(surface: string, runtime: R): void {
		this.require(surface).runtime = runtime;
		this.generation += 1;
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
	 * Current harness callers include their stable owner on every surface op and
	 * dispatch checks it before accessing the runtime. This is a claimed scope
	 * under the existing trusted host key, not independent authentication. Older
	 * SID-less clients retain nonce-capability compatibility, so no stronger
	 * authorization guarantee is invented for mixed-version deployments.
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
		this.generation += 1;
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
		this.generation += 1;
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
