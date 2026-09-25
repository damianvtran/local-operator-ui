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

import type { DesktopRequest } from "../../../../../shared/desktop-contract";
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
	 */
	catalog: (cwd: string | null, sessionId: string | null) =>
		["desktop", "mcp-catalog", cwd ?? "", sessionId ?? ""] as const,
	all: ["desktop", "mcp-catalog"] as const,
};

/** The catalog for a cwd, with a live overlay when `sessionId` is warm. */
export const fetchMcpCatalog = async (
	cwd: string | null,
	sessionId: string | null,
): Promise<McpCatalog> => {
	const envelope = await desktopResult<DesktopControlResult<McpCatalog>>({
		op: "mcp.catalog",
		...(cwd ? { cwd } : {}),
		...(sessionId ? { sessionId } : {}),
	});
	return envelope.data;
};

/** Run one catalog control and answer the document the backend returned. */
export const controlMcpCatalog = async (
	cwd: string | null,
	control: CatalogControl,
): Promise<McpCatalog> => {
	const envelope = await desktopResult<DesktopControlResult<McpCatalog>>({
		op: "mcp.catalog.control",
		...(cwd ? { cwd } : {}),
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
	const envelope = await desktopResult<
		DesktopControlResult<McpCatalogCredentialsResult>
	>({
		op: "mcp.catalog.credentials",
		...(cwd ? { cwd } : {}),
		name,
		values,
		confirmedReplace,
		...(header ? { header } : {}),
	});
	return envelope.data;
};
