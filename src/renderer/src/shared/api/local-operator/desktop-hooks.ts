/**
 * Renderer hooks for the typed desktop control plane.
 *
 * Every privileged control goes through `desktopRequest` (main-process IPC in
 * Electron, the server-side `/__desktop` proxy in browser development). The
 * renderer never holds the bearer, a URL, or an HTTP method — it picks an
 * operation from the closed vocabulary in `desktop-contract.ts`.
 *
 * Capability negotiation is fail-closed by design: a missing feature version
 * means the backend predates the control, and the UI must show an update
 * action rather than an unauthenticated legacy fallback.
 */

import { useQuery } from "@tanstack/react-query";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";
import type { DesktopCapabilities, DesktopProvider } from "./desktop-api";

export const desktopKeys = {
	capabilities: ["desktop", "capabilities"] as const,
	providers: ["desktop", "auth", "providers"] as const,
	commands: ["desktop", "commands"] as const,
	accounts: ["desktop", "auth", "accounts"] as const,
};

/**
 * Feature negotiation. `desktop_available` is false when this app did not
 * start the backend and therefore cannot supply the bearer — protected
 * controls stay hidden/disabled rather than falling back to an open route.
 */
export function useDesktopCapabilities() {
	return useQuery({
		queryKey: desktopKeys.capabilities,
		queryFn: async () => {
			try {
				return await desktopResult<DesktopCapabilities>({ op: "capabilities" });
			} catch (error) {
				// Collapsing every failure to `null` made the banner assert "this
				// backend is older than the app expects" for four different
				// situations, three of which an "Update backend" button cannot fix
				// (UX, design and QA all hit this). Fail-closed is about what we
				// ENABLE, not about how much we are allowed to know: the surfaces
				// stay gated either way (`desktopFeatureEnabled` still sees no
				// capabilities), and the reason is preserved so the banner can say
				// what actually happened and offer the action that matches.
				throw error instanceof Error ? error : new Error(String(error));
			}
		},
		staleTime: 60_000,
		retry: false,
	});
}

export type DesktopFeature =
	| "auth"
	| "settings"
	| "commands"
	| "catalogues"
	| "profile_catalogue"
	| "team_catalogue"
	| "session_catalogue"
	/*
	 * A session's code memory (the `sessions.variables.*` ops). A backend that
	 * predates the surface simply does not advertise the key, so
	 * `desktopFeatureEnabled` answers false and the panel offers "Update the
	 * backend" rather than firing a call it knows will 404.
	 */
	| "session_variables"
	// Content search over past conversations. Its own feature rather than part
	// of `session_catalogue`: a client renders the catalogue perfectly well
	// against a backend without the search route, so gating the list on the
	// search version would hide a working surface because a newer one is
	// missing. A caller that cannot negotiate it searches names only.
	| "session_search"
	/**
	 * `sessions.preview`: the readings a new-conversation pane can show before a
	 * session exists (`POST /v1/desktop/sessions/preview`). Its own key rather
	 * than a bump of `session_catalogue`: the draft strip must be gated
	 * separately, and a bump here would collide with any in-flight PR that has
	 * already claimed the next `session_catalogue` version.
	 */
	| "draft_preview"
	/**
	 * `sessions.preview` and `sessions.create` accepting a `model` selection: the
	 * draft pane's model and effort chips can be PICKED, not merely read.
	 *
	 * Its own key rather than a bump of `draft_preview`, for the same reason
	 * `draft_preview` has one: the inert draft strip is useful on its own, so a
	 * backend that can preview but cannot birth a conversation on a choice must
	 * leave the chips inert rather than dead — the copy says the model is used,
	 * and a control that opens a picker whose pick cannot reach the session the
	 * first send creates is the dead affordance R20 forbids.
	 */
	| "draft_selection"
	| "lifecycle"
	| "mcp"
	| "mcp_auth"
	/**
	 * The run panel's child reader (`docs/run-sidebar.md` § 10.3).
	 *
	 * The reader is the ONE part of that panel that needs a route older backends
	 * do not have, so it is the part that negotiates: the roster, the plan, the
	 * swap and the attention dot all ship with the renderer and work against any
	 * backend the app can talk to. Absent here means `§ 10.2`'s honest degraded
	 * state — rows that are visible and deliberately not openable — rather than a
	 * reader that fails silently when a row is clicked.
	 */
	| "subagent_transcript"
	| "radient"
	/*
	 * The two diagnostics reads (`info.get`, `sessions.report`). A SEPARATE key
	 * rather than a bump of `catalogues`, because `/analytics` and
	 * `/failovers` must keep working against a backend that lacks the two new
	 * routes — a bumped shared key would gate the working panels behind an
	 * update they do not need.
	 */
	| "diagnostics"
	/**
	 * The machine-wide feed: `GET /v1/desktop/events` and `POST
	 * /v1/desktop/presence`, with their frame and lease shapes. The consumer gate
	 * is BOTH directions: when the backend does not advertise it the renderer
	 * keeps the 5 s catalogue poll and the per-session notification path
	 * verbatim, and when this app is old enough not to open the feed nothing on
	 * the backend changes either. Neither skew can double-toast.
	 */
	| "desktop_feed"
	/**
	 * `sessions.move`: moving a LIVE session's working directory
	 * (`POST /v1/desktop/sessions/{id}/working-directory`).
	 *
	 * Its OWN key rather than a bump of `commands` or `session_catalogue`, on the
	 * rule `session_search` and `draft_preview` state above: an EXISTING surface
	 * must keep working against a backend that lacks the new route. Here the
	 * existing surface is the working-directory chip, which is exactly what a
	 * renderer that sees no `session_move` keeps rendering - read-only, with a
	 * sentence that says why. Bumping `commands` would be the wrong lever twice
	 * over: a client renders the command palette perfectly well without this
	 * route, and `/move`'s presentation already exists on older backends (it
	 * answers its `native_action` today), so the chip is the only surface this
	 * negotiation actually protects.
	 */
	| "session_move"
	/**
	 * `frontend.replace`: the desktop-only replacement frame that carries an
	 * accepted move's directory to an already-mounted viewer.
	 *
	 * Its OWN key, and it must gate INDEPENDENTLY of `session_move`, because the
	 * two are independently useful: a backend can accept a move (so the route
	 * works) while a viewer that cannot repaint is mounted next to it, and a move
	 * whose accepted directory no mounted viewer can render is exactly the
	 * stale-paint defect the frame exists to fix. The move controls therefore
	 * require `session_move >= 2` AND `frontend_replace >= 1` - see
	 * `sessionMoveEnabled`, which is the ONE place that pair is written down.
	 */
	| "frontend_replace";

/**
 * Resolve whether a negotiated feature surface may be offered.
 *
 * A feature requires BOTH the backend advertising its version AND the managed
 * pairing being available: the routes sit behind the desktop bearer, so a
 * surface without `desktop_available` would render a wall of 401s.
 */
export function desktopFeatureEnabled(
	capabilities: DesktopCapabilities | null | undefined,
	feature: DesktopFeature,
	minimumVersion = 1,
): boolean {
	if (!capabilities || !capabilities.desktop_available) return false;
	return (capabilities.features?.[feature] ?? 0) >= minimumVersion;
}

/** Canonical provider registry rows, including aliases folded into methods. */
export function useDesktopProviders(enabled: boolean) {
	return useQuery({
		queryKey: desktopKeys.providers,
		queryFn: () =>
			desktopResult<{ providers: DesktopProvider[] }>({
				op: "providers.list",
			}).then((result) => result.providers),
		enabled,
		staleTime: 30_000,
		// Same reasoning as `useConfig`: a `status: null` failure already spent
		// the transport's whole deadline learning nothing, so retrying it doubles
		// the wait to ~60s without a chance of a different answer. A failure that
		// carries a status came from a backend that answered and is still worth
		// one retry.
		retry: retryDesktopQuery,
	});
}
