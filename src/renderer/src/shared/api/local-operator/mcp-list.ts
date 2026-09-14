/**
 * The `mcp.list` document: one key, one fetch, one shape.
 *
 * ## Why this module exists (the defect it closes)
 *
 * `["desktop","mcp",sessionId]` was one React Query key with TWO query
 * functions caching DIFFERENT shapes, each surface reading its own:
 *
 *   - the run panel (`use-mcp-servers.ts`) cached the transport envelope
 *     `{data: {servers, operations}, replayed}` and read `query.data?.data?.servers`;
 *   - the Settings section (`mcp-management-section.tsx`) resolved
 *     `.then((result) => result.data)` and read `listQuery.data?.servers`.
 *
 * Both type-check, so nothing caught it: whichever queryFn wrote the entry last
 * decided what the other read. The panel polls every 15 s while a chat is open,
 * so it is nearly always the last writer, and the Settings section then read
 * `undefined` inside its own 10 s `staleTime` and rendered "No MCP servers
 * configured yet. Add one below." with twelve servers configured.
 * `docs/run-sidebar.md` § 7.4's claim that the two surfaces share "one answer"
 * was true of the key and false of the value.
 *
 * The fetch and the key live in the shared API layer rather than beside either
 * consumer because the chat feature already imported UP into the settings
 * feature, and that is the direction that let two shapes drift: a shared api
 * module is a place a third consumer cannot invent a third shape in.
 *
 * ## The shape is `GET /v1/desktop/sessions/{id}/mcp`'s
 *
 * Lifecycle routes wrap their result as `{data, replayed?}`, and the document
 * itself is `DesktopMcpState` — `{servers, operations, cold?}`. Both consumers
 * read the SAME level, which is the whole point of the module; the readers below
 * are exported so a consumer states "the servers out of the shared document"
 * rather than re-deriving that from an envelope it would have to unwrap first.
 */

import type {
	DesktopControlResult,
	DesktopMcpState,
} from "../../../../../shared/desktop-control-contract";
import { desktopResult } from "./desktop-api";

/** The one cache key for one session's MCP document. */
export const mcpKeys = {
	list: (sessionId: string) => ["desktop", "mcp", sessionId] as const,
};

/** The route's own envelope, named here so no consumer repeats the literal. */
export type McpListEnvelope = DesktopControlResult<DesktopMcpState>;

/**
 * Read the session's MCP document, unwrapped.
 *
 * The single place in the renderer that knows `mcp.list` answers inside a
 * `{data, replayed}` envelope: a caller that unwraps it again reads one level
 * too deep and sees no servers, which is exactly the failure this module was
 * extracted to make impossible.
 */
export const fetchMcpList = async (
	sessionId: string,
): Promise<DesktopMcpState> => {
	const envelope = await desktopResult<McpListEnvelope>({
		op: "mcp.list",
		sessionId,
	});
	return envelope.data;
};

/**
 * The document's server rows, or none.
 *
 * `undefined` (no read has settled, or it failed) and an empty document are the
 * same thing to a caller that renders a list, and folding them here is what
 * keeps a consumer from writing `?? []` beside a second shape read.
 */
export const mcpListServers = (
	state: DesktopMcpState | undefined,
): DesktopMcpState["servers"] => state?.servers ?? [];

/**
 * The document's grant operations.
 *
 * Present on every `mcp.list` answer (`MCPDesktop.snapshot()` returns them
 * beside the servers), and the run panel derives a row's in-flight grant from
 * them rather than from a second query: the list is already polled at 5 s while
 * the panel is open, so one read answers "is this server connected" and "is a
 * sign-in running for it" together, and cannot disagree with itself.
 */
export const mcpListOperations = (
	state: DesktopMcpState | undefined,
): DesktopMcpState["operations"] => state?.operations ?? [];
