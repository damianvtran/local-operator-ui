/**
 * The sessionless MCP catalog: one key, one fetch, one document shape.
 *
 * `mcp-list.ts` owns the SESSION route's document; this module owns the
 * catalog route's (`GET|POST /v1/desktop/mcp`, capability `mcp_catalog`). They
 * are separate keys on purpose: the two documents have different row shapes
 * (the catalog's `status` is a plain-language enum, the session route's is the
 * runtime's own words), and caching both under one key is the exact defect
 * `mcp-list.ts` was extracted to close.
 *
 * Every POST answers with the WHOLE document (plus the `operation` it started),
 * so a caller writes that answer into the cache with `setQueryData` instead of
 * invalidating and re-reading. Re-reading is what used to show a transitional
 * "connecting" as the result of a press (architect § 1.2): the POST's own
 * answer is the freshest state there is.
 */

import {
	type DesktopRequest,
	mcpCatalogCwdPattern,
	sessionIdPattern,
} from "../../../../../shared/desktop-contract";
import type {
	DesktopControlResult,
	McpCatalog,
	McpCatalogCredentialsResult,
} from "../../../../../shared/desktop-control-contract";
import { desktopResult } from "./desktop-api";

type CatalogControl = Extract<
	DesktopRequest,
	{ op: "mcp.catalog.control" }
>["control"];

export const mcpCatalogKeys = {
	/**
	 * Keyed by the cwd and the overlay session, because the backend computes a
	 * different document for each: project rows depend on the cwd, and live
	 * statuses on the session.
	 *
	 * CALLERS PASS THE COERCED VALUES (`mcpTransportCwd`/`mcpTransportSession`),
	 * not the raw pane props: the composer's `cwd` is a display token and a
	 * draft pane's session key is synthetic, and keying on those would hold a
	 * cache entry for a document that can never be fetched (the schema refuses
	 * the payload) — beside the entry Settings reads for the same home.
	 */
	catalog: (cwd: string | null, sessionId: string | null) =>
		["desktop", "mcp-catalog", cwd ?? "", sessionId ?? ""] as const,
	all: ["desktop", "mcp-catalog"] as const,
};

/**
 * The wire's own shapes, applied to a caller's raw values — THE coercion the
 * sessionless read needs, and the only place it happens.
 *
 * The composer sends the pane's `cwd` (its DISPLAY string, "~" for home) and
 * its `sessionId` (on a draft pane a synthetic "draft:<uuid>" key). Both are
 * refused by the op schema (`desktop-contract.ts`) BEFORE any byte reaches the
 * backend, so the live app's `mcp.catalog` call 422'd and `/mcp` offered an
 * empty list while every fixture-staged run passed — the transport was the
 * one surface no fixture stood in for (PR #726, QA Q-1).
 *
 * A value that is not a real path or a real session id is not a value to send:
 * both fields are optional (the backend defaults the cwd to the user's home),
 * and the length bound mirrors the schema's own so a coerced value cannot fail
 * a term the pattern does not check.
 */
export const mcpTransportCwd = (
	cwd: string | null | undefined,
): string | null =>
	cwd && cwd.length <= 4096 && mcpCatalogCwdPattern.test(cwd) ? cwd : null;
export const mcpTransportSession = (
	sessionId: string | null | undefined,
): string | null =>
	sessionId && sessionIdPattern.test(sessionId) ? sessionId : null;

/**
 * The op object the sessionless READ sends, composed from raw caller values.
 *
 * Named and exported so the wire shape is a testable value rather than three
 * spreads inside `fetchMcpCatalog`: `scripts/mcp-catalog-transport.test.mjs`
 * parses it with the REAL `desktopRequestSchema` and with the raw draft values
 * that must fail it, so the draft-pane class (Q-1) can never be masked by a
 * fixture standing in for the transport again.
 */
export const mcpCatalogRequest = (
	cwd: string | null | undefined,
	sessionId: string | null | undefined,
): Extract<DesktopRequest, { op: "mcp.catalog" }> => {
	const wireCwd = mcpTransportCwd(cwd);
	const wireSession = mcpTransportSession(sessionId);
	return {
		op: "mcp.catalog",
		...(wireCwd ? { cwd: wireCwd } : {}),
		...(wireSession ? { sessionId: wireSession } : {}),
	};
};

/** The catalog for a cwd, with a live overlay when `sessionId` is warm. */
export const fetchMcpCatalog = async (
	cwd: string | null,
	sessionId: string | null,
): Promise<McpCatalog> => {
	const envelope = await desktopResult<DesktopControlResult<McpCatalog>>(
		mcpCatalogRequest(cwd, sessionId),
	);
	return envelope.data;
};

/** Run one catalog control and answer the document the backend returned. */
export const controlMcpCatalog = async (
	cwd: string | null,
	control: CatalogControl,
): Promise<McpCatalog> => {
	const wireCwd = mcpTransportCwd(cwd);
	const envelope = await desktopResult<DesktopControlResult<McpCatalog>>({
		op: "mcp.catalog.control",
		...(wireCwd ? { cwd: wireCwd } : {}),
		control,
	});
	return envelope.data;
};

/**
 * Store a server's secret values; the answer carries the refreshed document.
 *
 * `header` is `add_key`'s one extra field (backend #1511 `aa927158a`): the HTTP
 * header the key travels in, for a remote server that declares no `${ID}` yet,
 * in which case `values` must hold exactly one id and the backend binds it as
 * `headers[header] = "${ID}"`.
 */
export const storeMcpCatalogCredentials = async (
	cwd: string | null,
	name: string,
	values: Record<string, string>,
	confirmedReplace: string[],
	header?: string,
): Promise<McpCatalogCredentialsResult> => {
	const wireCwd = mcpTransportCwd(cwd);
	const envelope = await desktopResult<
		DesktopControlResult<McpCatalogCredentialsResult>
	>({
		op: "mcp.catalog.credentials",
		...(wireCwd ? { cwd: wireCwd } : {}),
		name,
		values,
		confirmedReplace,
		...(header ? { header } : {}),
	});
	return envelope.data;
};
