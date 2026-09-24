/**
 * The data half of Settings > Integrations: one document, whichever route
 * serves it, plus the controls that change it.
 *
 * ## Two routes, picked by capability
 *
 * - `mcp_catalog` advertised: the SESSIONLESS catalog. Nothing here needs a
 *   conversation, a runtime or a model provider - the page can be set up on a
 *   fresh install (UX walk U5). The active conversation, when there is one,
 *   only lends its cwd (so project servers show) and its id (so a warm runtime
 *   overlays live status).
 * - Absent: the session route this page used before. It still needs a
 *   conversation, so with none active it borrows the newest roster row as it
 *   always did. The rows go through `catalogFromSessionState` so the page
 *   renders one vocabulary on both routes.
 *
 * ## Polling
 *
 * The list re-reads every 2 s ONLY while a row is connecting or an operation is
 * running (`integrationsPollInterval`), and a control's answer is written
 * straight into the cache: every catalog POST returns the whole document, so
 * invalidate-and-refetch - which read back the transitional "connecting" a
 * reload had just produced and then never asked again - is gone.
 */

import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	controlMcpCatalog,
	fetchMcpCatalog,
	mcpCatalogKeys,
	storeMcpCatalogCredentials,
} from "@shared/api/local-operator/mcp-catalog";
import { fetchMcpList, mcpKeys } from "@shared/api/local-operator/mcp-list";
import {
	type CanonicalSessionRow,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopRequest } from "../../../../../../shared/desktop-contract";
import type {
	DesktopMcpState,
	McpCatalog,
} from "../../../../../../shared/desktop-control-contract";
import {
	CONTROL_SETTLE_MS,
	INTEGRATIONS_POLL_MS,
	type IntegrationDocument,
	ROW_MEMORY_STORAGE_KEY,
	type RowMemories,
	type RowMemory,
	advanceMemories,
	catalogFromSessionState,
	folderUnavailableFor,
	integrationsPollInterval,
	memoriesTable,
	memoryFor,
	replaceControlLabel,
	seedMemories,
} from "./integration-model";

/**
 * The conversation the FALLBACK route borrows when none is active.
 *
 * Only the session route needs this: its reads and writes are addressed to a
 * session. Newest by `updated_at`, the roster's own order breaking ties.
 */
export const newestRosterRow = (
	rows: readonly CanonicalSessionRow[],
): CanonicalSessionRow | null =>
	rows.reduce<CanonicalSessionRow | null>((best, row) => {
		if (!best) return row;
		return (row.updated_at ?? 0) > (best.updated_at ?? 0) ? row : best;
	}, null);

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/**
 * The cwd a conversation lends the catalog, or null for the backend's default.
 *
 * Only an ABSOLUTE path is lent: the store's default cwd is the literal `~`,
 * which the backend would refuse with a 422, and which means the home directory
 * anyway - exactly what an omitted cwd resolves to.
 */
export const catalogCwdFor = (
	cwd: string | null | undefined,
): string | null => {
	const value = cwd?.trim();
	if (!value) return null;
	return value.startsWith("/") || WINDOWS_ABSOLUTE.test(value) ? value : null;
};

/**
 * The folder a conversation works in, read out of its snapshot.
 *
 * WHY THE ROSTER IS NOT ENOUGH (QA round 1, Q1). `GET /v1/desktop/sessions`
 * rows carry no `cwd`: only a row that THIS renderer created in its lifetime
 * has one, so after an app reload - or for a chat started in the TUI - the page
 * asked for the HOME catalog and every project-scoped server disappeared. The
 * snapshot carries it (`GET /v1/desktop/sessions/<id>` answers
 * `payload.frontend.snapshot.cwd`, verified against the backend head), so that
 * is where it is resolved from.
 *
 * Every step is defensive: this walks a document that is not part of the typed
 * contract, and a layer that is missing must answer "unknown folder" - which
 * falls back to the home catalog - rather than throw inside a render.
 */
export function sessionCwdFromSnapshot(snapshot: unknown): string | null {
	const payload = (snapshot as { payload?: unknown } | null | undefined)
		?.payload;
	const frontend = (payload as { frontend?: unknown } | null | undefined)
		?.frontend;
	const state = (frontend as { snapshot?: unknown } | null | undefined)
		?.snapshot;
	const cwd = (state as { cwd?: unknown } | null | undefined)?.cwd;
	return typeof cwd === "string" && cwd.trim() ? cwd : null;
}

/**
 * Where the last known folder per conversation is kept.
 *
 * The snapshot read is a round trip, and the reload case is exactly the one
 * where the page would otherwise paint the home catalog first and the project
 * rows a moment later. Storage is passed in rather than reached for, so the
 * resolution can be tested without a DOM.
 */
export const CATALOG_CWD_STORAGE_KEY =
	"local-operator.settings.integrations.last-cwd";
export type CwdStorage = Pick<Storage, "getItem" | "setItem">;

export function rememberCatalogCwd(
	sessionId: string,
	cwd: string | null,
	storage: CwdStorage | null = typeof localStorage === "undefined"
		? null
		: localStorage,
): void {
	/*
	 * Only an absolute path is stored, through the same predicate that decides
	 * what the page may LEND: the store's default cwd is the literal `~`, and a
	 * remembered `~` would overwrite a real folder and send the next reload back
	 * to the home catalog - which is the regression this exists to fix.
	 */
	const remembered = catalogCwdFor(cwd);
	if (!sessionId || !remembered || !storage) return;
	try {
		const raw = storage.getItem(CATALOG_CWD_STORAGE_KEY);
		const table = raw ? (JSON.parse(raw) as Record<string, string>) : {};
		if (table[sessionId] === remembered) return;
		storage.setItem(
			CATALOG_CWD_STORAGE_KEY,
			JSON.stringify({ ...table, [sessionId]: remembered }),
		);
	} catch {
		// A full or unavailable store is not a reason to fail a render: the
		// snapshot read is still the authority, and this is only the first paint.
	}
}

/**
 * Where the SETTLED row memories are kept between reloads.
 *
 * WHY: the backend publishes no observation time on a `stored` row, so a reading
 * this page holds only in a ref dies with the reload and the row decays to
 * "Ready" - measured twice from a real reload of an expired check (U10/Q1). The
 * page is the only party that watched the transition, so this is where it is
 * kept. The pure half (which entries, and how they are validated) is in
 * `integration-model.ts`; this half is only the I/O.
 */
export type MemoryStorage = Pick<Storage, "getItem" | "setItem">;

/** The store's own shape, kept as `unknown` until each entry is validated. */
const memoryStorage = (): MemoryStorage | null =>
	typeof localStorage === "undefined" ? null : localStorage;

export function readRowMemoryTable(
	storage: MemoryStorage | null = memoryStorage(),
): Record<string, unknown> {
	if (!storage) return {};
	try {
		const raw = storage.getItem(ROW_MEMORY_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		return parsed as Record<string, unknown>;
	} catch {
		/*
		 * A store that cannot be read is a page with NO memory, not a failed
		 * render: every row still paints, reading exactly as it would on a first
		 * run, which is the honest answer when nothing can be recalled.
		 */
		return {};
	}
}

/**
 * The most entries the store keeps.
 *
 * MERGED, not replaced, because a document is not the whole picture: the session
 * route lists a subset of the rows the catalog route does, so pruning to the
 * rows in hand would throw away readings a later route still needs (U17's lesson
 * one layer down). The cap is the bound on that growth, and it is far above the
 * handful of entries a machine with, say, a dozen servers and a few projects
 * ever produces.
 */
export const ROW_MEMORY_STORAGE_LIMIT = 256;

export function writeRowMemories(
	table: Record<string, RowMemory>,
	storage: MemoryStorage | null = memoryStorage(),
): void {
	if (!storage) return;
	try {
		const next: Record<string, unknown> = {
			...readRowMemoryTable(storage),
			...table,
		};
		const keys = Object.keys(next);
		if (keys.length > ROW_MEMORY_STORAGE_LIMIT) {
			const kept: Record<string, unknown> = {};
			for (const key of keys.slice(-ROW_MEMORY_STORAGE_LIMIT))
				kept[key] = next[key];
			storage.setItem(ROW_MEMORY_STORAGE_KEY, JSON.stringify(kept));
			return;
		}
		storage.setItem(ROW_MEMORY_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Same rule as the reader: a full or unavailable store is not a failed
		// render, and every rule that needs memory stands down without it.
	}
}

/**
 * What a credentials write answers with, in the page's own words.
 *
 * Extracted from the two routes that call it - catalog and session - which had
 * drifted into two copies of the same sentences, and made a value the suite can
 * assert: rewording or deleting the `invalid_target` sentence used to leave the
 * suite green, because it existed only inside a callback (n-3).
 */
export function credentialsRefusalMessage(
	code: string | null | undefined,
	failedIds: readonly string[],
	values: Record<string, string>,
): string | null {
	if (code === "saved") return null;
	if (code === "replace_confirmation_required") {
		/*
		 * NAME THE CONTROL THE DIALOG ACTUALLY DRAWS. The sentence used to say
		 * "Replace saved values", a plural label the dialog stopped using in round
		 * 2 - and on a keyless row it named a control that was not on screen at
		 * all, which is the dead end U15 was raised for. The label is derived the
		 * same way the checkbox derives it, so the two cannot drift again.
		 */
		const label = replaceControlLabel(Object.keys(values).length);
		return `A saved value already exists for this key. Tick \u201c${label}\u201d to overwrite it.`;
	}
	if (code === "invalid_target")
		/*
		 * `add_key`'s own refusal (backend #1511), and it is nothing to do with the
		 * store: the header cannot carry the key - the transport owns it, it is
		 * already set on the server, or the name is not a header. NOTHING WAS
		 * WRITTEN, and saying so is the difference between a user fixing the header
		 * and a user hunting a lock that is not locked (R2-1).
		 */
		return "That header can't carry this key. It may already be set on the server, or belong to the transport - try a different header name. Nothing was saved.";
	const failed = failedIds.length ? failedIds : Object.keys(values);
	return `Not saved: ${failed.join(", ")}. The encrypted store may be locked.`;
}

/**
 * Forget a conversation's remembered folder.
 *
 * Called when the backend refuses the folder itself (`invalid_cwd`): the
 * directory was deleted or renamed under the app, so the remembered path is not
 * a fact any more, and leaving it in place would re-ask with it on the next
 * reload and dead-end the page again (R2-4).
 */
export function forgetCatalogCwd(
	sessionId: string | undefined,
	storage: CwdStorage | null = typeof localStorage === "undefined"
		? null
		: localStorage,
): void {
	if (!sessionId || !storage) return;
	try {
		const raw = storage.getItem(CATALOG_CWD_STORAGE_KEY);
		if (!raw) return;
		const table = JSON.parse(raw) as Record<string, string>;
		if (!(sessionId in table)) return;
		const next = { ...table };
		delete next[sessionId];
		storage.setItem(CATALOG_CWD_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Same rule as the writer: a store that fails is not a failed render.
	}
}

/**
 * Whether a query error is the backend refusing the FOLDER.
 *
 * Read by code, not by message: `invalid_cwd` is a contract value, and matching
 * a sentence would break the moment the backend reworded its own text (R2-4).
 */
export const catalogQueryErrorIsInvalidCwd = (error: unknown): boolean =>
	Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			(error as { code?: unknown }).code === "invalid_cwd",
	);

/**
 * The folder to ask with, given one the backend has refused.
 *
 * A refused folder is DROPPED rather than retried: `invalid_cwd` says the path
 * does not exist, so every ask with it repeats the refusal, and the page a user
 * then sees is one error screen, no rows, and a Retry that cannot work. Dropped,
 * the query re-keys to the folderless (global) catalog - the most useful thing
 * that is still true (R2-4).
 */
export const cwdAfterRefusal = (
	resolved: string | null,
	refused: string | null,
): string | null =>
	refused !== null && resolved === refused ? null : resolved;

export function rememberedCatalogCwd(
	sessionId: string | undefined,
	storage: CwdStorage | null = typeof localStorage === "undefined"
		? null
		: localStorage,
): string | null {
	if (!sessionId || !storage) return null;
	try {
		const raw = storage.getItem(CATALOG_CWD_STORAGE_KEY);
		if (!raw) return null;
		const table = JSON.parse(raw) as Record<string, unknown>;
		const value = table[sessionId];
		return typeof value === "string" ? value : null;
	} catch {
		return null;
	}
}

/** A catalog control, as the section asks for one. */
export type IntegrationControl =
	| { action: "test" | "login" | "reauth" | "logout"; name: string }
	| { action: "remove"; name: string; scope: "global" | "project" }
	| { action: "cancel"; operationId: string }
	| {
			action: "add";
			name: string;
			scope: "global" | "project";
			command?: string;
			args?: string[];
			url?: string;
	  }
	/** Session-route only: a warm runtime's live connection. */
	| { action: "connect" | "disconnect" | "reload"; name: string };

type CatalogControlBody = Extract<
	DesktopRequest,
	{ op: "mcp.catalog.control" }
>["control"];
type SessionControlBody = Extract<
	DesktopRequest,
	{ op: "mcp.control" }
>["control"];

/**
 * A control as the catalog route takes it, or null for a verb it does not have.
 *
 * `connect`/`disconnect`/`reload` are about ONE runtime's live connection and
 * stay on the session route (contract delta c), so they have no catalog body.
 * Writes and grants carry `confirmed: true` because the press IS the
 * confirmation - Remove has already asked "Remove X?" by the time it gets here.
 */
export function catalogControlBody(
	request: IntegrationControl,
): CatalogControlBody | null {
	switch (request.action) {
		case "cancel":
			return { action: "cancel", operation_id: request.operationId };
		case "connect":
		case "disconnect":
		case "reload":
			return null;
		case "test":
			return { action: "test", name: request.name };
		default:
			return { ...request, confirmed: true };
	}
}

/**
 * The same control as the older session route takes it.
 *
 * That route has no probe-only verb, so `test` becomes its awaited reconnect -
 * the nearest thing it has that answers "does this server start".
 */
export function sessionControlBody(
	request: IntegrationControl,
): SessionControlBody {
	switch (request.action) {
		case "cancel":
			return { action: "cancel", operation_id: request.operationId };
		case "test":
		case "connect":
			return { action: "connect", name: request.name };
		case "reload":
			return { action: "reload", name: request.name };
		case "add":
			return request;
		case "remove":
			return { ...request, confirmed: true };
		default:
			// login | reauth | logout | disconnect: the grant verbs and the one
			// live verb that asks, all confirmed by the press itself.
			return { action: request.action, name: request.name, confirmed: true };
	}
}

export type UseIntegrations = {
	/** Whether the page can do anything at all (either route negotiated). */
	enabled: boolean;
	/** Which route is serving the document. */
	route: "catalog" | "session" | null;
	/** The session the fallback route is reading, when it is one. */
	sessionId: string | null;
	/** The conversation the fallback BORROWED, so the page can say which. */
	borrowed: CanonicalSessionRow | null;
	/** True when the fallback has no conversation at all to read through. */
	noConversation: boolean;
	document: IntegrationDocument | undefined;
	isLoading: boolean;
	isError: boolean;
	/** True while the chat's folder is one the backend refused (`invalid_cwd`). */
	folderUnavailable: boolean;
	refetch: () => void;
	/**
	 * Run a control. Resolves to the id of the operation it started (a sign-in or
	 * a test), or null when it started none; rejects with the transport's error.
	 */
	control: (request: IntegrationControl) => Promise<string | null>;
	/**
	 * What the page remembers about each row between reads (see `RowMemory`):
	 * the last good check, the group a running operation is pinned to, and
	 * whether a sign-in revealed that the server takes a key rather than a grant.
	 */
	memories: RowMemories;
	/**
	 * Record that a row's sign-in was refused because the server publishes no
	 * OAuth metadata (`oauth_unsupported`), which is what makes the key route
	 * the one to offer (U3). A refusal carries no operation, so this cannot be
	 * derived from the document the way a failed sign-in can.
	 */
	markNeedsKey: (name: string) => void;
	/** Store a server's key values, then test it. Resolves whether it saved. */
	storeKeys: (
		name: string,
		values: Record<string, string>,
		confirmedReplace: string[],
		/** `add_key`'s header: set only when the config declares no reference. */
		header?: string,
	) => Promise<{ saved: boolean; message: string | null }>;
};

export function useIntegrations({
	sessionId: activeSessionId,
}: {
	sessionId?: string;
}): UseIntegrations {
	const capabilities = useDesktopCapabilities();
	const catalogEnabled = desktopFeatureEnabled(
		capabilities.data,
		"mcp_catalog",
	);
	const sessionEnabled = desktopFeatureEnabled(capabilities.data, "mcp");
	const route = catalogEnabled ? "catalog" : sessionEnabled ? "session" : null;
	/*
	 * A folder the backend refused with `invalid_cwd`. Kept for the mount rather
	 * than persisted, because it is a fact about the DIRECTORY: what survives a
	 * reload is the forgetting below (R2-4).
	 */
	const [refusedCwd, setRefusedCwd] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const roster = useCanonicalSessionsStore((state) => state.sessions);
	const fetchSessions = useCanonicalSessionsStore(
		(state) => state.fetchSessions,
	);
	const rosterLoading = useCanonicalSessionsStore((state) => state.loading);
	const active = useMemo(
		() => roster.find((row) => row.session_id === activeSessionId) ?? null,
		[roster, activeSessionId],
	);
	const borrowed = useMemo(
		() =>
			route === "session" && !activeSessionId ? newestRosterRow(roster) : null,
		[route, activeSessionId, roster],
	);
	const readSessionId =
		route === "session"
			? (activeSessionId ?? borrowed?.session_id ?? null)
			: null;

	// The fallback's roster read, only when there is nothing to borrow yet.
	useEffect(() => {
		if (route !== "session" || activeSessionId || roster.length > 0) return;
		void fetchSessions();
	}, [route, activeSessionId, roster.length, fetchSessions]);

	/*
	 * The folder an active conversation lends the catalog (Q1). The roster row
	 * is the freshest source when it has one; otherwise the conversation's
	 * snapshot is asked, because a reload or a chat started elsewhere leaves the
	 * roster row without a cwd and the project-scoped rows would vanish.
	 */
	const rosterCwd = route === "catalog" ? catalogCwdFor(active?.cwd) : null;
	const needsSnapshotCwd =
		route === "catalog" && Boolean(activeSessionId) && rosterCwd === null;
	const snapshotCwdQuery = useQuery<unknown, Error>({
		queryKey: ["desktop", "session-cwd", activeSessionId ?? ""],
		queryFn: () =>
			desktopResult<unknown>({
				op: "sessions.get",
				sessionId: activeSessionId ?? "",
			}),
		enabled: needsSnapshotCwd,
		// A conversation's folder does not move on its own; re-asking on every
		// focus would spend a round trip on the answer we already hold.
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const resolvingCwd = needsSnapshotCwd && !snapshotCwdQuery.isFetched;
	const resolvedCwd =
		rosterCwd ??
		catalogCwdFor(sessionCwdFromSnapshot(snapshotCwdQuery.data)) ??
		// Only after the snapshot has ANSWERED with nothing: until then a
		// remembered folder could be the one the user has since changed.
		(snapshotCwdQuery.isFetched
			? catalogCwdFor(rememberedCatalogCwd(activeSessionId))
			: null);
	const liveCwd = cwdAfterRefusal(resolvedCwd, refusedCwd);
	const cwd = route === "catalog" ? liveCwd : null;
	const overlay = route === "catalog" ? (activeSessionId ?? null) : null;
	const catalogKey = mcpCatalogKeys.catalog(cwd, overlay);

	// Every resolution is remembered, so the NEXT reload paints the right
	// catalog on its first frame instead of the home one.
	useEffect(() => {
		if (route !== "catalog" || !activeSessionId || !cwd) return;
		rememberCatalogCwd(activeSessionId, cwd);
	}, [route, activeSessionId, cwd]);

	/*
	 * THE WINDOW IS SET UP HERE, ABOVE THE QUERIES, and that placement is the
	 * point: React Query calls `refetchInterval` during the render that builds its
	 * options, so a `pollIntervalFor` declared later in this component body is in
	 * its temporal dead zone when it is first asked - measured on the built app as
	 * `ReferenceError: Cannot access 'ee' before initialization`, which took the
	 * whole Settings page down to a blank screen.
	 */
	/*
	 * After a control, the page keeps asking for a short BOUNDED window.
	 *
	 * Why it is needed at all: a live overlay answers or degrades inside the same
	 * second when it is up, and the query stops polling the moment nothing is
	 * "moving" - so without a window the page may never see a `live` read after
	 * the press, which is the only read that can CONFIRM what the user just did.
	 * Why it is bounded: a page that always asks spends a read every 2 s on a
	 * screen that is usually idle, and the window closes early as soon as a live
	 * read arrives.
	 */
	const settleUntilRef = useRef(0);
	const [settleUntil, setSettleUntil] = useState(0);
	const startSettling = useCallback(() => {
		const until = Date.now() + CONTROL_SETTLE_MS;
		settleUntilRef.current = until;
		setSettleUntil(until);
	}, []);

	const pollIntervalFor = useCallback(
		(data: IntegrationDocument | undefined): number | false =>
			Date.now() < settleUntilRef.current
				? INTEGRATIONS_POLL_MS
				: integrationsPollInterval(data),
		[],
	);

	const catalogQuery = useQuery<McpCatalog, Error>({
		queryKey: catalogKey,
		queryFn: () => fetchMcpCatalog(cwd, overlay),
		/*
		 * Held until the folder is known: asking now would read the home
		 * catalog, paint an empty list, and then re-read - which is the reload
		 * regression (Q1) with extra steps.
		 */
		enabled: route === "catalog" && !resolvingCwd,
		staleTime: 10_000,
		refetchInterval: (query) => pollIntervalFor(query.state.data),
	});

	/*
	 * The refusal itself: note that this folder is gone and forget it, so the
	 * next reload cannot resolve back to it. `cwd` is null while this is true, so
	 * the query above has re-keyed to the global catalog by then and the page
	 * paints rows instead of an error (R2-4).
	 */
	const refusedFolder = catalogQueryErrorIsInvalidCwd(catalogQuery.error);
	useEffect(() => {
		if (!refusedFolder || !resolvedCwd || refusedCwd === resolvedCwd) return;
		setRefusedCwd(resolvedCwd);
		forgetCatalogCwd(activeSessionId);
	}, [refusedFolder, resolvedCwd, refusedCwd, activeSessionId]);

	/*
	 * The session route's document, under `mcp-list.ts`'s own key and fetch so the
	 * run panel and this page still share one cache entry for one session.
	 */
	const sessionQuery = useQuery<DesktopMcpState, Error>({
		queryKey: mcpKeys.list(readSessionId ?? ""),
		queryFn: () => fetchMcpList(readSessionId ?? ""),
		enabled: route === "session" && Boolean(readSessionId),
		staleTime: 10_000,
		refetchInterval: (query) =>
			pollIntervalFor(
				query.state.data
					? catalogFromSessionState(query.state.data, readSessionId ?? "")
					: undefined,
			),
	});

	const document = useMemo<IntegrationDocument | undefined>(() => {
		if (route === "catalog") return catalogQuery.data;
		if (route === "session" && sessionQuery.data && readSessionId)
			return catalogFromSessionState(sessionQuery.data, readSessionId);
		return undefined;
	}, [route, catalogQuery.data, sessionQuery.data, readSessionId]);

	/*
	 * A live read is the CONFIRMATION the window is waiting for, so it closes as
	 * soon as one arrives: the row is now being described by the runtime itself,
	 * which is the authority `memory.disconnectedAt` was standing in for.
	 */
	useEffect(() => {
		if (!settleUntil) return;
		const live =
			document?.servers.some((row) => row.status_basis === "live") ?? false;
		if (!live) return;
		settleUntilRef.current = 0;
		setSettleUntil(0);
	}, [document, settleUntil]);

	/*
	 * The memories are advanced INSIDE the memo rather than in an effect,
	 * because the group a running operation pins must be known to the very
	 * render that first sees the operation: an effect would lag one paint, which
	 * is precisely the frame the row would visibly jump on (F5). The reducer is
	 * idempotent for one document, so a double-invoked render cannot drift it.
	 */
	const memoriesRef = useRef<RowMemories>({});
	const [memoryEpoch, setMemoryEpoch] = useState(0);
	const memories = useMemo(() => {
		void memoryEpoch;
		memoriesRef.current = advanceMemories(
			/*
			 * Seeded from the store for the rows this page has not seen yet, and
			 * only those: a row already in the map carries a LATER reading than
			 * the store does - including a deliberate clear - so re-seeding would
			 * resurrect the value that clear removed (`seedMemories`). Read inside
			 * the memo rather than into a ref so a reload's FIRST render already
			 * has the reading, which is the frame the row paints on (Q1).
			 */
			seedMemories(memoriesRef.current, document, readRowMemoryTable()),
			document,
		);
		return memoriesRef.current;
	}, [document, memoryEpoch]);

	/*
	 * The store is written from the same object the rules read, and only when the
	 * entries changed: this effect runs on every poll tick while something is
	 * moving, and an unconditional write would be a `localStorage` write every
	 * 2 s for a page that is merely watching.
	 */
	const persistedRef = useRef("");
	useEffect(() => {
		const table = memoriesTable(memories, document);
		if (!Object.keys(table).length) return;
		const serialised = JSON.stringify(table);
		if (serialised === persistedRef.current) return;
		persistedRef.current = serialised;
		writeRowMemories(table);
	}, [memories, document]);

	const markNeedsKey = useCallback((name: string) => {
		const before = memoryFor(memoriesRef.current, name);
		if (before.needsKey) return;
		memoriesRef.current = {
			...memoriesRef.current,
			[name]: { ...before, needsKey: true },
		};
		setMemoryEpoch((epoch) => epoch + 1);
	}, []);

	/*
	 * The row's memory after a control the USER pressed (Q2).
	 *
	 * A Disconnect is the one that matters: the page re-reads the list once
	 * afterwards and then stops polling, and that read is measured landing on the
	 * config-only answer (the live overlay flapped 12 live / 8 config across 20
	 * reads inside a second), so the row went on saying "Worked just now" under
	 * Connected with no Connect offered while the backend said not connected. The
	 * user's own act contradicts "worked" whatever the next read says, so the
	 * remembered reading is dropped here and the row stops claiming health until
	 * a read says it is connected again - which is what clears `disconnectedAt`
	 * (`advanceMemories`).
	 */
	const markControlMemory = useCallback((request: IntegrationControl) => {
		if (request.action !== "disconnect" && request.action !== "connect") return;
		const before = memoryFor(memoriesRef.current, request.name);
		const next: RowMemory =
			request.action === "disconnect"
				? { ...before, connectedAt: null, disconnectedAt: Date.now() }
				: // Connecting clears the claim: the user is asking for it back, and
					// the read that follows is what confirms it.
					{ ...before, disconnectedAt: null };
		memoriesRef.current = { ...memoriesRef.current, [request.name]: next };
		setMemoryEpoch((epoch) => epoch + 1);
	}, []);

	const control = useCallback(
		async (request: IntegrationControl): Promise<string | null> => {
			if (route === "catalog") {
				const body = catalogControlBody(request);
				// A live-runtime verb has no catalog form; `liveControl` routes it.
				if (!body) return null;
				try {
					const next = await controlMcpCatalog(cwd, body);
					queryClient.setQueryData(catalogKey, next);
					markControlMemory(request);
					startSettling();
					return next.operation?.id ?? null;
				} catch (cause) {
					/*
					 * A REFUSAL CARRIES NO DOCUMENT (backend § 4.5), so the copy
					 * that says the list was refreshed is only true once it IS
					 * refreshed: the row the user just acted on may not exist any
					 * more, and `unknown_server` is the code that says so
					 * outright. Invalidate before rethrowing, so the refused
					 * control both reports the refusal and re-reads the rows (F2).
					 */
					if (cause instanceof DesktopControlError && cause.status === 409)
						void queryClient.invalidateQueries({ queryKey: catalogKey });
					throw cause;
				}
			}
			if (route === "session" && readSessionId) {
				const envelope = await desktopResult<{
					data?: DesktopMcpState | { id?: string };
				}>({
					op: "mcp.control",
					sessionId: readSessionId,
					control: sessionControlBody(request),
				});
				markControlMemory(request);
				startSettling();
				const key = mcpKeys.list(readSessionId);
				// `connect`/`reload`/`remove` answer with the snapshot; a grant answers
				// with its operation, so only a document-shaped answer is written.
				const data = envelope?.data;
				if (data && "servers" in data && Array.isArray(data.servers)) {
					queryClient.setQueryData(key, data);
					return null;
				}
				void queryClient.invalidateQueries({ queryKey: key });
				return data && "id" in data && typeof data.id === "string"
					? data.id
					: null;
			}
			return null;
		},
		[
			route,
			cwd,
			catalogKey,
			queryClient,
			readSessionId,
			markControlMemory,
			startSettling,
		],
	);

	/*
	 * A live-runtime verb (connect/disconnect/reload) on a catalog backend goes to
	 * the overlay session's own route, and the catalog is re-read afterwards so
	 * the overlay reflects it.
	 */
	const liveControl = useCallback(
		async (request: IntegrationControl): Promise<string | null> => {
			if (
				route === "catalog" &&
				overlay &&
				(request.action === "connect" ||
					request.action === "disconnect" ||
					request.action === "reload")
			) {
				try {
					await desktopResult({
						op: "mcp.control",
						sessionId: overlay,
						control: {
							action: request.action,
							name: request.name,
							...(request.action === "disconnect" ? { confirmed: true } : {}),
						},
					});
				} catch (cause) {
					/*
					 * EVERY refusal, not only the 409s `control` recognises: the row's
					 * sentence says the list was refreshed, and the refresh used to
					 * happen only on the success path, so a refused connect or
					 * disconnect left the page on a document the backend had just
					 * contradicted (R2-5). Before the throw, so the sentence is true by
					 * the time it is printed.
					 */
					void queryClient.invalidateQueries({ queryKey: catalogKey });
					throw cause;
				}
				/*
				 * The user's own Disconnect is remembered BEFORE the re-read is
				 * awaited: the read can legitimately come back on the config-only
				 * answer, which is measured flapping with the live one inside the
				 * same second, and a row that then read "Worked just now" told the
				 * user their Disconnect had done nothing (Q2).
				 */
				markControlMemory(request);
				startSettling();
				await queryClient.invalidateQueries({ queryKey: catalogKey });
				return null;
			}
			return control(request);
		},
		[
			route,
			overlay,
			queryClient,
			catalogKey,
			control,
			markControlMemory,
			startSettling,
		],
	);

	const storeKeys = useCallback(
		async (
			name: string,
			values: Record<string, string>,
			confirmedReplace: string[],
			header?: string,
		): Promise<{ saved: boolean; message: string | null }> => {
			if (route === "catalog") {
				const result = await storeMcpCatalogCredentials(
					cwd,
					name,
					values,
					confirmedReplace,
					header,
				);
				if (result.catalog)
					queryClient.setQueryData(catalogKey, result.catalog);
				if (result.code !== "saved")
					return {
						saved: false,
						message: credentialsRefusalMessage(
							result.code,
							result.failed_ids,
							values,
						),
					};
				/*
				 * A saved key is only worth something once the server accepts it, so
				 * the save is followed by a test and the row settles from that.
				 *
				 * The follow-up is caught HERE rather than left to the caller: it
				 * runs after the values are already stored, and a failure reaching
				 * the dialog printed "The keys were not saved" about keys that
				 * were - inviting a re-entry that then answers
				 * `replace_confirmation_required` (F4). The row shows the server's
				 * state from here, and a failed follow-up is the row's news, not
				 * the dialog's.
				 */
				try {
					await control({ action: "test", name });
				} catch {
					// Deliberately swallowed: the save is the promise this call
					// makes, and it is kept.
				}
				return { saved: true, message: null };
			}
			if (route === "session" && readSessionId) {
				const stored = await desktopResult<{
					data?: { code?: string; failed_ids?: string[] };
				}>({
					op: "mcp.credentials.store",
					sessionId: readSessionId,
					name,
					values,
					confirmedReplace,
				});
				if (stored.data?.code !== "saved")
					return {
						saved: false,
						message: credentialsRefusalMessage(
							stored.data?.code,
							stored.data?.failed_ids ?? [],
							values,
						),
					};
				try {
					await control({ action: "connect", name });
				} catch {
					// Same reasoning as the catalog branch above (F4).
				}
				return { saved: true, message: null };
			}
			return { saved: false, message: null };
		},
		[route, cwd, catalogKey, queryClient, control, readSessionId],
	);

	const activeQuery = route === "catalog" ? catalogQuery : sessionQuery;
	const refetch = useCallback(() => {
		void activeQuery.refetch();
	}, [activeQuery]);

	return {
		enabled: route !== null,
		route,
		sessionId: route === "catalog" ? overlay : readSessionId,
		borrowed,
		noConversation: route === "session" && !readSessionId && !rosterLoading,
		document,
		isLoading:
			capabilities.isLoading ||
			(route === "catalog" && (resolvingCwd || catalogQuery.isLoading)) ||
			(route === "session" &&
				(readSessionId ? sessionQuery.isLoading : rosterLoading)),
		isError: activeQuery.isError,
		/*
		 * "Only global integrations are shown" has to be sayable: a user whose
		 * chat folder was deleted must be told why the project rows are missing,
		 * rather than left to conclude the page is broken (R2-4).
		 */
		folderUnavailable: folderUnavailableFor(refusedCwd, resolvedCwd),
		refetch,
		control: liveControl,
		storeKeys,
		memories,
		markNeedsKey,
	};
}
