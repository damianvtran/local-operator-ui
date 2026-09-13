/**
 * The MCP server list the run panel renders, and the cadence it is read at
 * (`docs/run-sidebar.md` § 7.4).
 *
 * ## Why this is its own query
 *
 * The run panel's other two sections are derived from the session's canonical
 * stream: `frontend.jobs` and `frontend.todos` arrive as frames, so a reader's own
 * state keeps them current and they cost nothing. MCP status does not work that
 * way. It changes with NO frontend frame — a grant expires, a server process
 * dies, a reconnect lands — so a section wired to the canonical stream would show
 * whatever was true when the session last published a delta, which is exactly the
 * "I could not see that my Notion sign-in had expired" failure the operator
 * reported.
 *
 * So `mcp.list` (`desktop-contract.ts:527` → `GET /v1/desktop/sessions/{id}/mcp`)
 * is the one RENDERING source. It is a session-scoped read op and route that
 * already ship: no backend change, no new route, no capability bump. The
 * canonical projection (`frontend.mcp_servers`) is used as a CHANGE SIGNAL only —
 * it can be minutes stale on an idle session, and it cannot render this section's
 * row at all (no `tool_count`, no `owned_scope`, and no `error` for a server that
 * dropped after boot). It is never painted, so it can never disagree on screen
 * with what the rows say.
 *
 * ## The cadence, and what it costs
 *
 * The dot has to be right while the panel is CLOSED — that IS the operator's ask,
 * and a section that only refreshed while it was open would report a problem only
 * to someone already looking at MCP servers. So this polls:
 *
 * - **15s while the panel is closed, 5s while it is open.** The closed cadence is
 *   what pays for the indication to exist at all, and it is four times finer than
 *   the backend's own recover-a-grant clock
 *   (`AUTH_REVALIDATE_INTERVAL_S = 60.0`), so a drop is visible long before the
 *   runtime would have retried it. The open cadence is faster because the reader
 *   is looking at the rows.
 * - **At most ONE tick in flight per app, and never a queue behind a slow
 *   backend.** A module-level counter is what makes that true by construction
 *   rather than by trusting a timer: the interval callback returns a short retry
 *   while a tick is outstanding and `false` while the window is unwatched, so a
 *   backend that takes 30s to answer costs one request per 30s instead of one
 *   every 5s stacking up behind it. It is per APP rather than per query because
 *   the cost being bounded is the backend's, and several open sessions would
 *   otherwise multiply it.
 * - **It stops on two facts.** The document is hidden, or the window is not
 *   focused — `document.visibilityState` and `document.hasFocus()` are different
 *   questions (a backgrounded window, a visible but inactive one), and there is
 *   nobody to inform when nobody is at the machine. Coming back refetches
 *   immediately through React Query's own focus behaviour, so the first frame
 *   after the user returns is current rather than 15s stale.
 * - **It is disabled entirely without a session id, without the `mcp` capability
 *   (or with the pairing unavailable), or without a canonical frontend.** The
 *   last one matters: a legacy chat grows no trigger and therefore no dot, so a
 *   poll there would be pure waste for an indication no surface could show.
 *   Nothing is issued at all in those states, which is what `§ 10.5` requires of
 *   a backend that does not advertise `mcp`.
 *
 * ## The cost, stated
 *
 * One tick is an IPC hop, an HTTP GET with the desktop bearer, a bridge
 * acquisition from the session pool (the bridge is usually already held by the
 * open chat's own stream; when nothing else holds it, a cold facade is built and
 * torn down), and on the runtime's loop `MCPDesktop.snapshot()`: up to eight
 * config files plus one `get_server_tools` per server. There is no MCP protocol
 * traffic in it and it never wakes a runtime. That is four requests a minute per
 * watched session with the panel closed, twelve with it open — deliberately the
 * slower instrument beside § 5.3's 1 Hz child pulse, and bounded for the opposite
 * reason: the pulse is driven by work the user started, while this runs when
 * nothing else is happening, which is why this is the one that needs an interval
 * and a window gate rather than a signal.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { mcpKeys } from "../../../settings/components/mcp-management-section";
import { type McpServerRow, deriveMcpServers } from "./run-detail-model";

/** The closed-panel cadence: the dot's own freshness while nobody is looking. */
const CLOSED_INTERVAL_MS = 15_000;
/** The open-panel cadence: a reader watching the rows deserves a current list. */
const OPEN_INTERVAL_MS = 5_000;
/** How soon to re-ask while a tick is still outstanding, and while unwatched. */
const BUSY_RETRY_MS = 1_000;

/**
 * Ticks currently in flight, across every run-panel MCP query in this app.
 *
 * Module-level rather than per hook because the resource being protected is the
 * BACKEND's: several open sessions each with their own interval would multiply
 * exactly the cost § 7.4 quantifies, and a per-query guard could not see its
 * neighbours.
 */
let ticksInFlight = 0;

/**
 * Whether the machine is being watched at all.
 *
 * Both halves are required and they answer different questions: `visibilityState`
 * is false for a backgrounded window, `hasFocus` for a visible-but-inactive one.
 * Neither is a permission check — this is a polling cadence, and the cost of
 * guessing wrong in the strict direction is one refetch on the next focus.
 */
const isWatched = (): boolean =>
	document.visibilityState === "visible" && document.hasFocus();

/** The `mcp.list` payload, narrowed to the field this surface reads.
 *
 * Lifecycle routes wrap their result as `{ data, replayed? }` — the same envelope
 * `mcp-management-section.tsx` unwraps — and the servers live inside `data`.
 * `cold` is read only to document the case, not to branch on: the route stamps
 * every row's own `status: "cold"` in that branch, so the rows already say it.
 */
type McpListPayload = { data?: { servers?: unknown; cold?: boolean } };

export function useRunPanelMcpServers({
	sessionId,
	/**
	 * A value that changes when the canonical `frontend.mcp_servers` changes.
	 *
	 * The ACCELERATOR (§ 7.4): a published transition — a startup settle, a
	 * reconnect, an auth block discovered at boot — should reach the panel in about
	 * a frame rather than within the next 15 s tick. The canonical value is never
	 * rendered; it is only a signal, and a signal has no paint, so it cannot
	 * disagree on screen with what the rows say. `null` means "no canonical
	 * frontend", which disables the query outright.
	 */
	accelerator,
}: {
	sessionId: string | null | undefined;
	accelerator: string | null;
}): McpServerRow[] {
	const capabilities = useDesktopCapabilities();
	const enabled =
		Boolean(sessionId) &&
		accelerator !== null &&
		desktopFeatureEnabled(capabilities.data, "mcp");
	const isRunPanelOpen = useUiPreferencesStore((state) => state.isRunPanelOpen);
	const queryClient = useQueryClient();
	const key = mcpKeys.list(sessionId ?? "");

	const query = useQuery({
		// The SETTINGS page's own key, deliberately: the two surfaces read one
		// document, and a second key would be a second cache entry, two polls and
		// two answers to "is this server connected" on one screen.
		queryKey: key,
		queryFn: async () => {
			ticksInFlight += 1;
			try {
				return await desktopResult<McpListPayload>({
					op: "mcp.list",
					sessionId: sessionId as string,
				});
			} finally {
				ticksInFlight -= 1;
			}
		},
		enabled,
		staleTime: 5_000,
		/*
		 * A FAILING list keeps its cadence rather than being retried on React
		 * Query's default retry: an unreachable backend is a state this surface
		 * shows, not a transient to hammer, and the poll below already re-asks on a
		 * fixed clock. `§ 10.5` is explicit that a read that fails is a STALE state
		 * and never an empty one, so the last good rows stay and the dot keeps its
		 * last known answer.
		 */
		retry: false,
		refetchInterval: () => {
			if (!isWatched()) return false;
			if (ticksInFlight > 0) return BUSY_RETRY_MS;
			return isRunPanelOpen ? OPEN_INTERVAL_MS : CLOSED_INTERVAL_MS;
		},
		refetchIntervalInBackground: false,
	});

	/*
	 * The accelerator. Skipped on the first render so mounting the panel does not
	 * cost an invalidation beside its own initial fetch; a burst of canonical
	 * changes within one refetch costs one request, because React Query coalesces
	 * concurrent refetches of one key.
	 */
	const lastSignal = useRef(accelerator);
	useEffect(() => {
		if (lastSignal.current === accelerator) return;
		lastSignal.current = accelerator;
		if (!enabled) return;
		void queryClient.invalidateQueries({ queryKey: key });
	}, [accelerator, enabled, key, queryClient]);

	// A failed read is the LAST KNOWN rows rather than an empty list: the section
	// must not render "no servers configured" for a read it could not complete.
	return deriveMcpServers(query.data?.data?.servers);
}
