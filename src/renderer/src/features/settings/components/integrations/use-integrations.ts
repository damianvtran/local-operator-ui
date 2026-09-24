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

import { desktopResult } from "@shared/api/local-operator/desktop-api";
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
import { useCallback, useEffect, useMemo } from "react";
import type { DesktopRequest } from "../../../../../../shared/desktop-contract";
import type {
	DesktopMcpState,
	McpCatalog,
} from "../../../../../../shared/desktop-control-contract";
import {
	type IntegrationDocument,
	catalogFromSessionState,
	integrationsPollInterval,
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
	refetch: () => void;
	/**
	 * Run a control. Resolves to the id of the operation it started (a sign-in or
	 * a test), or null when it started none; rejects with the transport's error.
	 */
	control: (request: IntegrationControl) => Promise<string | null>;
	/** Store a server's key values, then test it. Resolves whether it saved. */
	storeKeys: (
		name: string,
		values: Record<string, string>,
		confirmedReplace: string[],
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

	const cwd = route === "catalog" ? catalogCwdFor(active?.cwd) : null;
	const overlay = route === "catalog" ? (activeSessionId ?? null) : null;
	const catalogKey = mcpCatalogKeys.catalog(cwd, overlay);

	const catalogQuery = useQuery<McpCatalog, Error>({
		queryKey: catalogKey,
		queryFn: () => fetchMcpCatalog(cwd, overlay),
		enabled: route === "catalog",
		staleTime: 10_000,
		refetchInterval: (query) => integrationsPollInterval(query.state.data),
	});

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
			integrationsPollInterval(
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

	const control = useCallback(
		async (request: IntegrationControl): Promise<string | null> => {
			if (route === "catalog") {
				const body = catalogControlBody(request);
				// A live-runtime verb has no catalog form; `liveControl` routes it.
				if (!body) return null;
				const next = await controlMcpCatalog(cwd, body);
				queryClient.setQueryData(catalogKey, next);
				return next.operation?.id ?? null;
			}
			if (route === "session" && readSessionId) {
				const envelope = await desktopResult<{
					data?: DesktopMcpState | { id?: string };
				}>({
					op: "mcp.control",
					sessionId: readSessionId,
					control: sessionControlBody(request),
				});
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
		[route, cwd, catalogKey, queryClient, readSessionId],
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
				await desktopResult({
					op: "mcp.control",
					sessionId: overlay,
					control: {
						action: request.action,
						name: request.name,
						...(request.action === "disconnect" ? { confirmed: true } : {}),
					},
				});
				await queryClient.invalidateQueries({ queryKey: catalogKey });
				return null;
			}
			return control(request);
		},
		[route, overlay, queryClient, catalogKey, control],
	);

	const storeKeys = useCallback(
		async (
			name: string,
			values: Record<string, string>,
			confirmedReplace: string[],
		): Promise<{ saved: boolean; message: string | null }> => {
			if (route === "catalog") {
				const result = await storeMcpCatalogCredentials(
					cwd,
					name,
					values,
					confirmedReplace,
				);
				if (result.catalog)
					queryClient.setQueryData(catalogKey, result.catalog);
				if (result.code !== "saved")
					return {
						saved: false,
						message:
							result.code === "replace_confirmation_required"
								? "A saved value already exists for this key. Tick “Replace saved values” to overwrite it."
								: `Not saved: ${(result.failed_ids.length ? result.failed_ids : Object.keys(values)).join(", ")}. The encrypted store may be locked.`,
					};
				// A saved key is only worth something once the server accepts it, so
				// the save is followed by a test and the row settles from that.
				await control({ action: "test", name });
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
						message:
							stored.data?.code === "replace_confirmation_required"
								? "A saved value already exists for this key. Tick “Replace saved values” to overwrite it."
								: `Not saved: ${(stored.data?.failed_ids?.length ? stored.data.failed_ids : Object.keys(values)).join(", ")}. The encrypted store may be locked.`,
					};
				await control({ action: "connect", name });
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
			(route === "catalog" && catalogQuery.isLoading) ||
			(route === "session" &&
				(readSessionId ? sessionQuery.isLoading : rosterLoading)),
		isError: activeQuery.isError,
		refetch,
		control: liveControl,
		storeKeys,
	};
}
