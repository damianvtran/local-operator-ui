/**
 * What the pane reads out of `console-state`, and how it decides what it shows.
 *
 * Design: `docs/design/ui-console-tab.md` 6.1 (the pane and its lens), 6.2 (recall
 * on session switch), 6.5 (provenance: what the listing says and what the pane
 * shows beside it), 7.3 (a replayed surface is `live: false`), 8.2/8.5 (the grid
 * is main's).
 *
 * WHY THIS PARSES RATHER THAN TRUSTING A TYPE. `window.api.console.state()` is
 * typed `Promise<unknown>` on purpose: main owns the projection, and a mirrored
 * interface in the preload would be a second copy of a shape that can drift from
 * the one main actually sends. Every value below is therefore validated once, at
 * this boundary, and everything downstream works with the narrowed result. A field
 * main omits arrives as the documented default rather than as `undefined` in a
 * comparison.
 *
 * The surface id is the only field with no default: a listing without one is not a
 * surface, and a pane that rendered it would be rendering a row that cannot be
 * subscribed to, resized or closed.
 */

/** Top-level so the split in `surfaceTitle` is not recompiled per call. */
const WHITESPACE = /\s+/;

/** One surface, as `console_list`/`console-state` report it (§6.5, §10.2). */
export interface ConsoleSurface {
	/** `con:<n>:<nonce>` — the handle's own prefix names its host, so a trace, an
	 * error and this pane all say which console they mean. */
	surface: string;
	sessionId: string;
	/** Who created it. Provenance, not authority: both are readable by that
	 * session's agent (§6.5). */
	origin: "user" | "agent";
	/** The program, as the creator asked for it. */
	command: string;
	/** Everything after the program, for the pane's own subtitle. */
	argvTail: string;
	cwd: string;
	cols: number;
	rows: number;
	/** Whether the process is alive. False is the ended state (§7.3). */
	running: boolean;
	exitCode: number | null;
	/** Seconds since the epoch, on the record's clock. */
	lastActivity: number;
	/** False for a surface reconstructed from persisted history after a relaunch:
	 * nothing is running and nothing will be (§7.3's "this terminal has ended"). */
	live: boolean;
	/** The browser's own spelling of `origin === "agent"`, kept because the
	 * listings carry both (§6.5). */
	agentOwned: boolean;
	/** Who drove the pty last (§13.4's co-pilot cell): `"agent"` once an agent has
	 * typed into this surface — including one the USER opened — `"user"` once the
	 * pane has, and `null` until either does. `agentOwned` cannot answer this: it
	 * reports who CREATED the surface and never changes. */
	lastActor: "user" | "agent" | null;
	/** Secure input (§11.4): the surface's bytes reach the record, and nothing
	 * else — no case is retained in the byte log while it is on. */
	secure: boolean;
	/** Whether this surface's history is persisted (§7.2). */
	retain: boolean;
	/** Whether a pane is showing it right now, by main's own record. */
	displayed: boolean;
	/** The most recent OSC 133 mark, for the blip (§12.1 rung 2). `null` until the
	 * shell emits one, and on every surface whose shell has no integration. */
	lastMark: ConsoleMark | null;
}

/**
 * One OSC 133 semantic mark, as the host records it (`./osc133.ts`'s own type,
 * narrowed at this boundary like every other projection).
 *
 * `exitCode` is the one field the blip reads beyond the kind: a `command-finished`
 * mark carries the status, and a shell that omitted it leaves null rather than a
 * guessed zero.
 */
export interface ConsoleMark {
	kind?: string;
	/** The status the shell reported on a `D` mark, or null. */
	exitCode?: number | null;
	/** Absolute offset of the sequence's first byte, counted from the first byte ever
	 * fed — the coordinate that makes two marks distinguishable rather than merely
	 * two instances of the same value. */
	offset?: number;
}

/** The whole projection, narrowed. */
export interface ConsoleSnapshot {
	/** False when the console host is off or failed to start (§15): the pane says
	 * so instead of showing an empty list, which would claim there are none. */
	available: boolean;
	total: number;
	agent: number;
	/** Which surface main believes a pane is showing, or null. */
	displayedSurface: string | null;
	/** WHY there is no console, when there is none (§15's two rows plus anything
	 * main reports later): `"disabled"` for the run's own switch,
	 * `"pty_unavailable"` for native terminal support that did not load, anything
	 * else passed through as-is. Null when the console is available.
	 *
	 * The pane's sentence follows this rather than the mere absence of a host,
	 * because the two conditions have opposite remedies — one is a switch the user
	 * (or their launcher) turned off, the other is a broken install — and the
	 * version of this that read a load-failure sentence into both told a user with
	 * the console switched OFF to update the app. */
	reason: string | null;
	/** Main's own words for the refusal, quoted as the machine line. */
	detail: string | null;
	surfaces: ConsoleSurface[];
}

export const EMPTY_SNAPSHOT: ConsoleSnapshot = {
	available: false,
	total: 0,
	agent: 0,
	displayedSurface: null,
	reason: null,
	detail: null,
	surfaces: [],
};

const stringOr = (value: unknown, fallback = ""): string =>
	typeof value === "string" ? value : fallback;

const numberOr = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const booleanOr = (value: unknown, fallback = false): boolean =>
	typeof value === "boolean" ? value : fallback;

/** Narrow one listing. Returns null for anything without a surface id, because
 * every later call in this feature is addressed by that id. */
export const readConsoleSurface = (value: unknown): ConsoleSurface | null => {
	if (!value || typeof value !== "object") return null;
	const row = value as Record<string, unknown>;
	const surface = stringOr(row.surface);
	if (!surface) return null;
	const origin = row.origin === "agent" ? "agent" : "user";
	const mark = row.last_mark;
	return {
		surface,
		sessionId: stringOr(row.session_id),
		origin,
		command: stringOr(row.command),
		argvTail: stringOr(row.argv_tail),
		cwd: stringOr(row.cwd),
		cols: numberOr(row.cols),
		rows: numberOr(row.rows),
		running: booleanOr(row.running),
		exitCode: typeof row.exit_code === "number" ? row.exit_code : null,
		lastActivity: numberOr(row.last_activity),
		live: booleanOr(row.live, true),
		agentOwned: booleanOr(row.agent_owned, origin === "agent"),
		lastActor:
			row.last_actor === "agent" || row.last_actor === "user"
				? row.last_actor
				: null,
		secure: booleanOr(row.secure),
		retain: booleanOr(row.retain),
		displayed: booleanOr(row.displayed),
		lastMark: mark && typeof mark === "object" ? (mark as ConsoleMark) : null,
	};
};

/** Narrow the whole projection. `available` defaults to FALSE: an answer that
 * does not say the console is running is not evidence that it is. */
export const readConsoleSnapshot = (value: unknown): ConsoleSnapshot => {
	if (!value || typeof value !== "object") return { ...EMPTY_SNAPSHOT };
	const state = value as Record<string, unknown>;
	const surfaces = Array.isArray(state.surfaces)
		? state.surfaces
				.map(readConsoleSurface)
				.filter((entry): entry is ConsoleSurface => entry !== null)
		: [];
	return {
		available: booleanOr(state.available),
		reason: typeof state.reason === "string" ? state.reason : null,
		detail: typeof state.detail === "string" ? state.detail : null,
		total: numberOr(state.total, surfaces.length),
		agent: numberOr(state.agent, surfaces.filter((s) => s.agentOwned).length),
		displayedSurface:
			typeof state.displayed_surface === "string"
				? state.displayed_surface
				: null,
		surfaces,
	};
};

/** This session's surfaces, most recently active first.
 *
 * The pane is scoped to ONE session (§6.1, §6.3: the registry is app-global and a
 * session's pane filters by `session_id`), and the order is the listing's own
 * `last_activity` descending — the surface a user just typed into is the one they
 * are most likely to want next.
 */
export const surfacesForSession = (
	snapshot: ConsoleSnapshot,
	sessionId: string | null,
): ConsoleSurface[] => {
	if (sessionId === null) return [];
	return snapshot.surfaces
		.filter((surface) => surface.sessionId === sessionId)
		.sort((a, b) => b.lastActivity - a.lastActivity);
};

/**
 * Which surface the pane shows, given the lens it stored and what exists now.
 *
 * Three rules, in order, and each one is a case that actually happens:
 *
 *  1. the stored lens, when it is still this session's (recall across a switch,
 *     §6.2: the pane re-attaches to the surface it was showing);
 *  2. otherwise the most recent of this session's surfaces — which is the first-run
 *     case, the agent-created case, and the case where the remembered surface was
 *     closed while the user was in another conversation;
 *  3. otherwise nothing, and the pane renders its empty state.
 */
export const pickActiveSurface = (
	snapshot: ConsoleSnapshot,
	sessionId: string | null,
	preferred: string | null,
): ConsoleSurface | null => {
	const mine = surfacesForSession(snapshot, sessionId);
	if (mine.length === 0) return null;
	if (preferred) {
		const remembered = mine.find((surface) => surface.surface === preferred);
		if (remembered) return remembered;
	}
	return mine[0];
};

/**
 * A surface's own name for the pane's header, in the words §6.5 fixes: the
 * command it was created with, or its `argv[0]`, or the id's own tail when the
 * listing carries neither.
 *
 * The point of the marker is that "a person looking at the screen and an agent
 * reading `console_list` describe the same object" — so this is the listing's
 * `command` verbatim rather than a decorated title.
 */
export const surfaceTitle = (surface: ConsoleSurface): string => {
	const command = surface.command.trim();
	if (command) return command;
	const argv = surface.argvTail.trim().split(WHITESPACE)[0] ?? "";
	if (argv) return argv;
	return surface.surface;
};

/**
 * The completion marks a surface is carrying, as a comparable value.
 *
 * Used to decide whether anything has happened on the surface since the pane last
 * showed it — the blip's own question (§12.2). It is built from the FIELDS main
 * publishes (the OSC 133 mark's byte offset and the record's `last_activity`)
 * because a surface's exit generation is not on this listing; see the pane's blip
 * comment for what that costs and why it is the honest half.
 */
export const completionMark = (surface: ConsoleSurface): string => {
	const mark = surface.lastMark;
	const markKey = mark ? `${mark.kind ?? ""}:${mark.offset ?? ""}` : "";
	return `${surface.running ? "run" : "end"}:${surface.exitCode ?? ""}:${surface.lastActivity}:${markKey}`;
};
