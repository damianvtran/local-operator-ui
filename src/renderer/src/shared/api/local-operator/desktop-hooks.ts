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
 * How often this app re-asks what the backend can do, WHILE THE PLANE IS OPEN.
 *
 * WHY the open state polls at all, when the shut state's interval was the
 * obvious fix. A withdrawal of the plane is not observable from anything else
 * the renderer holds: main's own status stays attached while the backend starts
 * refusing this app's desktop calls (that is the operator's own log - 401 on
 * `/v1/desktop/sessions` under a backend that answered `/health` the whole
 * time), and nothing in the renderer turns a refused read into a capability
 * re-ask. So a query that only polls once the plane is SHUT can never learn that
 * the plane shut: measured in this PR's own frame rig, the withdrawal produced
 * no re-ask at all and the two frames came out byte-identical, which is exactly
 * the "it needs a refresh" half of the report.
 *
 * What is bounded: one local IPC call per interval, always, and the interval is
 * asymmetric on purpose - the OPEN cadence is the slow one, because it is a
 * watch for a change nothing announces, while the SHUT cadence
 * (`CAPABILITY_RENEGOTIATE_MS`) is the operator's own wait and ends the moment
 * the gate re-opens.
 */
export const CAPABILITY_WATCH_MS = 30_000;

/**
 * How long this app waits before asking again what the backend can do, while the
 * answer does not open the desktop plane at all.
 *
 * WHY a query that is otherwise fetched once has a poll at all. The operator's
 * report is "all the active chats and teams disappear and it needs a refresh ...
 * after sitting a while they come back on their own". One of the two ways that
 * happens is a capabilities answer that SUCCEEDS while withdrawing the plane - a
 * daemon this app holds no token for answers `desktop_available: false`, which is
 * the state the operator's own log shows beside 26 refused desktop reads. The
 * gate is shut, `error` is null, and nothing re-asked: `staleTime` only decides
 * when a fetch may be reused, `retry: false` covers the failing arm only, and
 * with no interval the gate stayed shut until a window focus or an unrelated
 * invalidation happened to refetch it. That is why the recovery read as "it needs
 * a refresh, and later it comes back by itself".
 *
 * WHY a fixed cadence rather than a doubling backoff. What this waits for is
 * MAIN's re-negotiation - its probe loop, re-discovery, and the adoption of a
 * daemon it can open - and that is already backed off with its own ceiling
 * (`DaemonStateMachine.nextBackoff`). A second backoff stacked in front of it
 * would only add latency to the moment the gate re-opens, which is the thing the
 * operator is waiting for. What is bounded is the RATE: one local IPC call per
 * interval while the plane is shut, and none at all once it opens - the same
 * shape `use-mcp-servers.ts` uses for a read whose failures are a state to show
 * rather than a transient to hammer.
 */
export const CAPABILITY_RENEGOTIATE_MS = 15_000;

/**
 * Whether this answer opens the desktop control plane at all.
 *
 * Deliberately the weakest question in the vocabulary, because it is the one the
 * re-negotiation above can act on: a plane that is unavailable is a state main
 * can still leave (it acquires a token, attaches, or a daemon publishes a record
 * it can read), whereas a plane that is open and merely missing ONE feature is a
 * fact about that backend's version which no amount of re-asking changes.
 */
export function desktopPlaneOpen(
	capabilities: DesktopCapabilities | null | undefined,
): boolean {
	return capabilities?.desktop_available === true;
}

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
		/*
		 * The re-negotiation, and both of its cadences. While the plane is SHUT the
		 * interval is `CAPABILITY_RENEGOTIATE_MS`, the operator's own wait, and it ends
		 * the moment an answer opens the plane. While it is OPEN the interval is the
		 * slower `CAPABILITY_WATCH_MS`, because a withdrawal is announced by nothing
		 * else this renderer can see - see that constant for the measurement that made
		 * the single-cadence version wrong. `refetchInterval` fires whether or not the
		 * last answer was an error, which is deliberate: the failing arm is the other
		 * half of the same freeze, and `retry: false` above says only that React Query
		 * will not back off on its own.
		 */
		refetchInterval: (query) =>
			desktopPlaneOpen(query.state.data)
				? CAPABILITY_WATCH_MS
				: CAPABILITY_RENEGOTIATE_MS,
		/*
		 * The one poll in this app that runs while the window is in the background,
		 * and the exception is the whole requirement. "After sitting a while they
		 * come back on their own" is a recovery that needs the operator to come back
		 * and wave the mouse at the window; a gate that heals on attention is the bug
		 * rather than the cure, so this cadence deliberately does NOT pause when
		 * nothing is focused. One local IPC call per interval.
		 */
		refetchIntervalInBackground: true,
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
	 * `sessions.interrupt`: stopping the session's CURRENT TURN and its children
	 * without ending the session (`POST /v1/desktop/sessions/{id}/interrupt`).
	 *
	 * A NEW key, never a bump of `lifecycle`, and the reason is a skew the bump
	 * would get wrong in the direction that costs a user their session: a backend
	 * that can stop a session but cannot interrupt a turn must keep `/stop`
	 * working, and must NOT be told it can interrupt, because the composer's Stop
	 * control promises THIS TURN rather than a lifetime. Absent here means the
	 * control is not rendered at all - see `sessionInterruptEnabled` - rather than
	 * falling back to something that ends the session.
	 */
	| "session_interrupt"
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
	| "frontend_replace"
	/**
	 * `references`: the harness expands a draft's `@path` tokens into file content
	 * before the message reaches the model.
	 *
	 * THE COMPOSER'S `@` AFFORDANCE IS GATED ON THIS, and it is the one gate in
	 * this file whose key no backend advertises yet. That is the point of it rather
	 * than an oversight: the expansion is a HARNESS behaviour, it is not released
	 * (no tag through `v0.56.8` carries `local_operator/references.py`, and the half
	 * that adds it is PR #1220, in review), and the harness publishes no route for
	 * it — the whole feature is two Python modules, with no server surface at all.
	 * So a composer that offered a picker and painted chips on today's install would
	 * be promising an expansion nothing on the machine performs: the user picks a
	 * file, gets a chip that says "this is a reference", and the model receives the
	 * literal characters. `desktopFeatureEnabled` fails closed, so absent (or
	 * absent `desktop_available`) means the picker never opens and no chip is ever
	 * painted — the honest state, and the reason this key is here before its writer.
	 *
	 * WHAT HAS TO HAPPEN FOR THE AFFORDANCE TO APPEAR: the harness half adds
	 * `"references": 1` to `features` in
	 * `local_operator/server/routes/capabilities.py`. That is a one-line change on
	 * the other side of this contract and it is NOT part of this repository. Named
	 * where a reader will meet it (the PR body, the review finding) because it is
	 * load-bearing for the release: until it lands, this feature ships dark by
	 * design.
	 */
	| "references";

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
