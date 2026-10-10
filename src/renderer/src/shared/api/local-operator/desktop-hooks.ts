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

import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { useQuery } from "@tanstack/react-query";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";
import type { DesktopCapabilities, DesktopProvider } from "./desktop-api";

export const desktopKeys = {
	capabilities: ["desktop", "capabilities"] as const,
	providers: ["desktop", "auth", "providers"] as const,
	commands: ["desktop", "commands"] as const,
	accounts: ["desktop", "auth", "accounts"] as const,
	/**
	 * The model catalogues, keyed by the `live` flag the read carried.
	 *
	 * A PREFIX rather than a leaf, because two readers ask for two different
	 * listings: the picker asks `live: false` (the shipped registry, painted on
	 * the keystroke) and then `live: true` (the providers' own listing), while the
	 * settings combobox asks only the first. Invalidating the prefix therefore
	 * drops BOTH documents, which is what every caller below actually needs.
	 *
	 * It is here, rather than spelled at each reader, because THREE sites now have
	 * to agree on it: `destination-pickers.tsx`'s picker, the settings combobox
	 * (which shares the picker's `live: false` entry rather than fetching the same
	 * catalogue twice), and the two credential-change points that have to forget
	 * it - `provider-detail.tsx` when a sign-in succeeds and `LogoutPicker` when an
	 * account is removed. The failure a second spelling produces is silent: an
	 * invalidation against a key nobody reads leaves the stale rows painted and
	 * reports success.
	 */
	catalogue: ["desktop", "models"] as const,
	/**
	 * One session's stored credential NAMES, as the picker's list reads them.
	 *
	 * A factory rather than a constant because the key carries the session, and it
	 * is here rather than at its readers because TWO of them exist now: the picker
	 * that lists the names (`destination-pickers.tsx`) and the composer's store seam,
	 * which has to invalidate this key after a store. QA round 1's Q-5 is what a
	 * second copy of the string costs — the picker mounted over a list it had cached
	 * five minutes earlier and rendered "No credentials stored yet." while the same
	 * route answered with the name that had just been stored, so the row the user
	 * came for was not on screen to click.
	 */
	credentials: (sessionId: string) =>
		["desktop", "credentials", sessionId] as const,
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
	const { client, provided } = useOptionalQueryClient();
	return useQuery(
		{
			/*
			 * THE PROVIDER GATE. `useQuery` cannot be called at all without a client
			 * (it throws "No QueryClient set" before any option is read), so a document
			 * with no `QueryClientProvider` - the mini view mounts none - reads this
			 * hook through `useOptionalQueryClient` and must NOT fetch from its private
			 * fallback: with no provider there is no capabilities answer, and every
			 * gate downstream already reads absence as "feature off"
			 * (`desktopFeatureEnabled` and `desktopPlaneOpen` both take `undefined`).
			 * In the app `provided` is always true, so this is a no-op there.
			 */
			enabled: provided,
			queryKey: desktopKeys.capabilities,
			queryFn: async () => {
				try {
					return await desktopResult<DesktopCapabilities>({
						op: "capabilities",
					});
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
		},
		client,
	);
}

export type DesktopFeature =
	| "auth"
	| "settings"
	| "commands"
	| "catalogues"
	/**
	 * The SESSIONLESS skills read: `skills.list` answers with NO session — an
	 * explicit `cwd` (the daemon's home roots when omitted) or the session form —
	 * and carries a `version` for the vocabulary.
	 *
	 * ITS OWN KEY rather than a bump of `catalogues`, on the rule this union
	 * states in several places: a released backend serves `skills.list` only with
	 * `session_id` (it answers a masked 422 for anything else), so the composer
	 * must be able to ASK before sending a sessionless call an older surface
	 * cannot honour. Absent here means the composer fires NO skills query and
	 * shows the update-the-backend notice; the session arm keeps serving the
	 * `/skills` panel and released clients unchanged. NOT in
	 * `REQUIRED_BACKEND_FEATURES`: an optional feature, like `radient_org` — the
	 * compatibility banner must not hold every older backend to it.
	 */
	| "skill_catalogue"
	/**
	 * The four closed ORGANIZATION operations the merged local server exposes
	 * (`memberships.list`, `org_agents.list`, `org_team.get`, `org_teams.list`).
	 *
	 * ITS OWN KEY because a backend that predates them answers an unknown operation
	 * with a MASKED 422 ("The request has invalid fields."), which is
	 * indistinguishable from a malformed call — so a surface that simply attempted
	 * them would report a mistake the user did not make, and could not tell whether
	 * to offer a retry or a backend update (local-operator `capabilities.py`, agent
	 * review round 1's M2). A `below-version` answer here means "update the
	 * backend", which is the remedy the org surfaces render.
	 */
	| "radient_org"
	/**
	 * The hub auto-update plane (`GET /v1/desktop/hub/updates` and its five
	 * mutations). ITS OWN KEY so a backend that predates it is never asked: an
	 * unknown `/v1/desktop/hub/...` path would answer 404 on every poll, and the
	 * sidebar would either log that forever or have to guess whether to stop.
	 */
	| "hub_updates"
	| "profile_catalogue"
	| "team_catalogue"
	| "session_catalogue"
	/**
	 * `sessions.list` can be SCOPED, PAGED and COUNTED: `scope_kind`/`scope_name`,
	 * `cursor`, `with_counts`, answered with `next_cursor`/`cursor_missing`/`scope`/
	 * `counts`.
	 *
	 * ITS OWN KEY RATHER THAN A BUMP OF `session_catalogue` TO 4, on the rule this
	 * union states in several places: an EXISTING surface must keep working against
	 * a backend that lacks the new one. The existing surface here is the whole chats
	 * list, and it keeps working only if the client can ASK whether the daemon
	 * understands the new parameters - which matters because FastAPI silently
	 * ignores unknown query parameters, so an un-gated `scope_kind=team&
	 * scope_name=lopdev` would receive the UNSCOPED page and draw other teams' rows
	 * under that team, and an un-gated `cursor` would receive page one again and
	 * duplicate it. A bump to 4 would also overload "the catalogue's shape changed"
	 * with "the catalogue can be paged", and would have to be bumped again by the
	 * next shape change.
	 *
	 * It gates THREE promises together - the scope, the cursor and the census -
	 * because they are one contract revision: a client that had the counts without
	 * the scope could not render a group's count consistently with that group's
	 * paged rows.
	 *
	 * ABSENT MEANS TODAY'S BEHAVIOUR EXACTLY: one unscoped `limit=500` request, the
	 * badge from the rows the client holds, and every group expanded client-side
	 * over that one page.
	 */
	| "session_catalogue_page"
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
	/**
	 * `sessions.draft` plus the draft allow-list on `events`/`watch`/`warm`, and
	 * `sessions.create` accepting `draft_id`: a NEW chat's runtime can be engaged
	 * from the first keystroke instead of on the send.
	 *
	 * Its own key rather than a bump of `draft_preview`/`draft_selection`, for
	 * the rule this union states in several places: the draft pane is fully
	 * useful without this — it simply pays the engage on the first send, exactly
	 * as it always has — so a backend that cannot warm drafts must leave today's
	 * wiring rather than lose the preview or the chips with it. Absent also
	 * means NO mint call at all: the mint would spend a round trip learning 404
	 * against every older daemon, from a keystroke, for nothing.
	 */
	| "session_draft_warm"
	| "lifecycle"
	| "mcp"
	| "mcp_auth"
	/**
	 * The sessionless MCP catalog (`GET|POST /v1/desktop/mcp`,
	 * `mcp.catalog*` ops). Its own key rather than a bump of `mcp`: the session
	 * route is a working surface on every backend that has it, and Settings >
	 * Integrations falls back to it when this key is absent rather than telling
	 * the user to update for a page that still works.
	 */
	| "mcp_catalog"
	/**
	 * The provider-catalogue contract: the census's additive row fields
	 * (`brand`, `capabilities`, `state`, `identity`, `account_count`) AND the
	 * licence for the composer's `/login` and `/logout` inline lists. Its own
	 * key, in the `<subsystem>_catalogue` family: the provider grids and the
	 * two pickers render fine against a backend without it — only the composer
	 * lists and the optional row fields are gated by it, and both degrade to
	 * what the older snapshot carries.
	 */
	| "provider_catalogue"
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
	 * Conversational configuration: `sessions.create` accepting a `purpose`
	 * (`agents-config`), which makes the backend start a SUPERVISED BACKGROUND
	 * RUN that edits this device's agent and team registries without ever
	 * entering the operator's conversation.
	 *
	 * ITS OWN KEY, for the reason every key in this union is: a backend that
	 * predates the field validates the create body with `extra="forbid"` and
	 * answers a masked 422, so an un-gated composer would report a malformed
	 * request for a request the app deliberately made — and could not tell
	 * "update the backend" from "the app is broken". Absent here means the
	 * composer is not rendered at all and the structured editor is the only
	 * path, with one honest line saying why (the `session_interrupt` precedent).
	 */
	| "agents_config"
	/**
	 * `input_mode` on `sessions.message`: the harness carries the composer's own
	 * record of how a message was produced (`typed` / `dictated` / `mixed`, see
	 * arch §4.2).
	 *
	 * ITS OWN KEY, and the gate is the whole point of it: the field is metadata
	 * the app never renders, but an OLDER harness validates the message body with
	 * `extra="forbid"` and would refuse a body that carried it - so the app sends
	 * the legacy body (field absent) unless the backend advertises this key, and
	 * nothing else in the app reads it. See `admitChatDraft`'s pinning note for
	 * the replay rule that goes with it.
	 */
	| "input_mode"
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
	 * Durable conversation pinning: the `pinned` flag on every catalogue row and
	 * the `sessions.pin` write (`POST /v1/desktop/sessions/{id}/pin`).
	 *
	 * Its OWN key rather than a bump of `session_catalogue`, on the rule
	 * `session_search` states above: the existing surface is the WHOLE chats list,
	 * which renders perfectly well against a backend whose pin store does not
	 * exist, so gating the list on a newer catalogue version would hide a working
	 * surface behind an update it does not need. A backend that predates the pin
	 * store advertises neither the key nor the row field, and the sidebar mounts
	 * no affordance at all for it - see `pinSections`, which is the ONE place
	 * that decision is written down. Absent means NO slot, no reveal and no
	 * handler: the row's DOM and class set stay byte-identical to the panel
	 * without the feature, because a reserved empty slot advertises something the
	 * user cannot get and a disabled pin reads as a feature they have not
	 * unlocked (the `session_interrupt` precedent).
	 */
	| "session_pins"
	/**
	 * `references`: the harness expands a draft's `@path` tokens into file content
	 * before the message reaches the model.
	 *
	 * THE COMPOSER'S `@` AFFORDANCE IS GATED ON THIS, and this key's writer now
	 * exists: `local_operator/server/routes/capabilities.py` publishes
	 * `"references": 1` whenever `at_references_enabled()` is true, so a backend
	 * built from that tree lights the picker, the chips and the composer tip up by
	 * itself. Nothing else about this app changed to enable them, which is what the
	 * key was for: the app shipped the affordance DARK, withheld until a backend
	 * said it could carry a reference, because a composer that offered a picker and
	 * painted chips on a backend that does not expand would promise an expansion
	 * nothing on the machine performs — the user picks a file, gets a chip that says
	 * "this is a reference", and the model receives the literal characters.
	 *
	 * THE KEY IS THE ONE CAPABILITY HERE THAT A CURRENT BACKEND MAY OMIT, because
	 * the harness's expansion has a per-call kill switch
	 * (`LOCAL_OPERATOR_AT_REFERENCES`). A process told not to expand advertises
	 * nothing rather than advertising `0`, so ABSENT covers two cases a client
	 * cannot tell apart and must answer identically: a backend older than the key,
	 * and a current one whose operator turned the expansion off. Both mean the same
	 * thing to this composer — send the draft as typed, offer no affordance, and say
	 * why when the user's own `@` brings the notice up.
	 *
	 * `desktopFeatureEnabled` fails closed, so absent (or an absent
	 * `desktop_available`, which means no credential for the routes) means the picker
	 * never opens and no chip is ever painted. A caller that has not read this far
	 * gets the honest state by default.
	 */
	| "references"
	/**
	 * This machine's remote-access state and the verdict on the Radient login
	 * that owns it: `GET /v1/desktop/tunnel`, plus `radient_login` and
	 * `tunnel_remedy` on `GET /v1/auth/status`.
	 *
	 * ITS OWN key rather than a bump of `auth` or `radient`, on the rule
	 * `references` states above and for a sharper version of it: the two keys it
	 * sits beside gate surfaces that ALREADY WORK, and this one gates one narrow
	 * thing - whether the app may tell a user that their stored Radient sign-in
	 * is no longer accepted, and whether it may offer the sign-in that fixes it.
	 * The account section must keep its current wording against a backend that
	 * cannot answer, because a surface that reads an ABSENT verdict as "the login
	 * is fine" is the silent-health lie the whole change exists to remove - and
	 * one that reads it as "the login is dead" sends an offline machine to a
	 * sign-in it does not need. Both halves of that pair are why the gate is
	 * `enabled`-shaped and fails closed in `useRadientSessionIssue` rather than
	 * defaulting either way.
	 *
	 * WHAT HAS TO HAPPEN FOR THE SURFACE TO APPEAR: the harness advertises
	 * `"tunnel": 1` in `local_operator/server/routes/capabilities.py`, which is
	 * what PR #1342 (`fix/tunnel-login-resilience`, merged as `50635770`) does.
	 * Named here where a reader will meet it, exactly as `references` names its
	 * own counterpart on the other side of this contract.
	 */
	| "tunnel"
	/**
	 * `attention.seen`: marking MANY completions read in one gesture
	 * (`POST /v1/desktop/attention/seen`), which the sidebar's "Mark all as read"
	 * control rides.
	 *
	 * Its OWN key rather than a bump of `completion_ack`, on the rule
	 * `session_search` and `draft_preview` state above: the per-session receipt is
	 * an EXISTING surface that must keep working against a backend which has the
	 * single route and not the batch one, and nothing else is gated on
	 * `completion_ack`'s version. Absent here means the control is not rendered at
	 * all — never a control that 404s when it is clicked, because a mark cleared
	 * by a request that failed is a mark the user believes is gone while it is
	 * still there.
	 */
	| "completion_ack_bulk"
	/**
	 * Archived conversations: the `archived` flag on every catalogue row and search
	 * hit, `include_archived` on both reads, and the `sessions.archive` write
	 * (`POST /v1/desktop/sessions/{id}/archive`).
	 *
	 * Its OWN key rather than a bump of `session_catalogue`, on the rule
	 * `session_search` states above: the catalogue surface is the WHOLE chats list,
	 * which renders perfectly well against a backend whose archive store does not
	 * exist, so gating the list on a newer catalogue version would hide a working
	 * surface behind an update it does not need. A backend that predates archiving
	 * advertises neither the key nor the row field, and the sidebar then mounts no
	 * control, marks nothing and partitions nothing - see `visibleRows` in
	 * `features/chat/chat-archived`, which is the ONE place that decision is
	 * written down. Absent means the panel mounts no control, marks no row and
	 * partitions nothing: every row it draws is a row an enabled panel also draws,
	 * with the same classes, and the only difference is the archived set - an
	 * ENABLED panel hides those, and this one cannot (see the withdrawn pair in
	 * `docs/evidence/session-archive/README.md`, which measures a 690x60 band around
	 * a live row as byte-identical and the panel's row COUNT as one apart).
	 */
	| "session_archive"
	/**
	 * Permanent deletion of one conversation (`DELETE /v1/desktop/sessions/{id}`).
	 *
	 * SEPARATE from `session_archive`, and the separation is the point rather than
	 * bookkeeping: the two have different blast radii (one is recoverable, one is
	 * not) and a backend can legitimately host the archive store without offering a
	 * delete route. A shared key would mean an archive rollout that ships a delete
	 * control against a route the daemon does not have - a danger dialog whose
	 * confirm button 404s, which is worse than no dialog at all. Absent here means
	 * no delete affordance is drawn anywhere, from the header menu or from a typed
	 * `/delete`.
	 */
	| "session_delete"
	/**
	 * The mesh: this DAEMON can serve the peer catalogue and the network catalogue.
	 *
	 * `mesh-session-mobility.md` §9.3's key, unchanged: the peer catalogue
	 * (`GET /v1/desktop/peers`), the networks read (`GET /v1/desktop/networks`) and
	 * the locality fields on the session rows behind them.
	 *
	 * IT IS A CAPABILITY, NOT A MEMBERSHIP, and review round 1 (R1-1) caught this
	 * comment claiming the opposite. lop advertises `peers` unconditionally, on
	 * purpose - `local_operator/server/routes/capabilities.py`: "the KEYS answer 'what
	 * can this backend do' rather than 'is this machine in a mesh'" - so a device in NO
	 * network carries the key too. The backend names where the membership fact lives
	 * instead: "a device in no network answers an empty catalogue, and an empty
	 * catalogue mounts nothing". `useMeshMembership` reads exactly that, and it is what
	 * the rail row and the palette destination are gated on.
	 *
	 * ABSENT MEANS NOT MOUNTED, never mounted-disabled: no Mesh rail row, no `/mesh`
	 * route, no peer sections and no device choice on `/new`. A reserved empty
	 * destination advertises a feature the user does not have - the argument
	 * `session_pins` makes above.
	 *
	 * WHAT A USER WITH NO NETWORK SEES, stated the way it actually happens rather than
	 * as "no call at all": ONE read-only catalogue read is issued when the window starts
	 * - a `networks.list`, which the backend serves after an `is_dir` test with no mkdir,
	 * so nothing is created - and because the rail is mounted on every route that read
	 * carries NO interval (`useMeshMembership` asks for `poll: false`; review round 2,
	 * R2-1, caught the 30 s interval reaching an always-mounted component and dialling
	 * every peer on every screen). The catalogue's 30 s cadence belongs to the TAB, and
	 * the rail rides that observer's cache entry while the tab is open. So: no rail row,
	 * no route content and no peer section mounts, the chrome is today's, and the frames
	 * in `docs/evidence/mesh-tab/` measure the TAB rather than that chrome - the chrome
	 * claim is pinned in `scripts/mesh-tab.test.mjs` instead.
	 *
	 * SLICE 2 ADDS `session_transfer`, which is the surface this paragraph reserved
	 * the key for: it gates the MOVE affordance (a chip's drop targets and the
	 * panel's action). The two keys are deliberately separate, and the backend's own
	 * register states why: a backend can show a peer's sessions and be unable to move
	 * one, and on `peers` alone this app would draw its move control against a route
	 * that 404s. Absent ⇒ the control is not mounted — not mounted-disabled — and
	 * every drag outcome falls back to the read-only row.
	 */
	| "peers"
	/*
	 * The Projects surface: the tab, its CRUD, the milestone routes and the `@`
	 * picker's project section (`/v1/desktop/projects*`).
	 *
	 * ONE key for the whole surface rather than one per route, because the store
	 * ships as a unit: the backend release that serves the listing is the release
	 * that serves the milestones. Absent here means the sidebar mounts no
	 * Projects row, the palette offers no entry, and the `@` picker keeps its
	 * file-only shape - an older backend renders EXACTLY the surface this app
	 * shipped before, rather than a tab that 404s on its first read.
	 */
	| "projects"
	/**
	 * `projects.request_update`: the check-in fan-out
	 * (`POST /v1/desktop/projects/{project}/request-update`).
	 *
	 * ITS OWN KEY rather than a bump of `projects`, on the rule this union
	 * states in several places: the Projects surface itself - the tab, its
	 * CRUD, the milestones, the `@` picker's section - renders perfectly well
	 * against a backend that cannot ASK its sessions for anything, so a bump
	 * would hide a whole working surface behind an update it does not need.
	 *
	 * Absent means the two entry points are NOT MOUNTED (never
	 * mounted-and-disabled): the card menu's item and the detail header's
	 * button - see `ProjectRequestUpdateButton` and the board's menu. A control
	 * whose only press would 404 is exactly the dead affordance the fail-closed
	 * rule exists to omit.
	 */
	| "projects_request_update"
	/**
	 * `projects.update` with `force_done`: closing a project over milestones that
	 * are still open, on purpose (`PATCH /v1/desktop/projects/{key}` with
	 * `force_done: true`; the refusal it answers is the 422
	 * `project_done_incomplete`).
	 *
	 * ITS OWN KEY rather than a bump of `projects` (which stays 2): the tab, its
	 * CRUD and the search index all work on a daemon that cannot force a close,
	 * and a version bump would hide that working surface. Absent means the
	 * confirm dialog is NOT offered - the refusal is only SAID (toast on the
	 * board, inline sentence on the detail) - because an older daemon 422s the
	 * extra body key, which would turn a deliberate choice into a second refusal.
	 */
	| "projects_force_done"
	/**
	 * Moving a conversation between devices: `POST /v1/desktop/sessions/{id}/transfer`.
	 *
	 * ITS OWN KEY rather than a version of `peers`, and the split is the backend's
	 * (`routes/capabilities.py`): a backend can list a peer's sessions and be unable
	 * to move one, so on `peers` alone the canvas would offer drop targets for a route
	 * that 404s. Advertised unconditionally by the backend — the keys answer "what can
	 * this backend do", not "is this machine in a mesh" — so the gate here is about
	 * the BACKEND's age, not about the mesh's existence.
	 */
	| "session_transfer"
	/**
	 * The onboarding approval surface (`features.approvals`): the badge read
	 * (`GET /v1/desktop/approvals`) plus the two decision posts, and nothing else.
	 *
	 * WHY A KEY AT ALL, given the routes are additive and an old renderer never
	 * calls one (the backend's own comment): it is how THIS renderer learns the
	 * surface EXISTS before it builds a Mesh-tab affordance whose POST would 404
	 * on a backend without it. Absent ⇒ the tab mounts no approval tray and the
	 * rail no badge — not a disabled one — and every other mesh surface serves
	 * exactly as it did before, which is the pre-onboarding state.
	 *
	 * ONE KEY FOR THE FAMILY, because it is one contract revision and one flow: a
	 * renderer that can draw the record can answer it (the decision posts take no
	 * body, so there is nothing else to negotiate).
	 */
	| "approvals"
	/*
	 * AIDA'S CONTROL PLANE (`features.aida`): the read and the control op the
	 * sidebar's row and the composer's `/aida` share. ITS OWN KEY rather than a
	 * bump of anything, because a client that does not read it must keep working
	 * unchanged: absent means "this backend has no Aida", which hides the row and
	 * forbids her route (`design.md` § 3.4/§ 4), while every other surface serves
	 * exactly as it did before.
	 */
	| "aida"
	/**
	 * THE VOICING SURFACE (`features.tts`): `GET /v1/tts/paths`, the synthesis
	 * availability report a speak control asks before it offers itself.
	 *
	 * ITS OWN KEY, and a separate one from `stt` on the daemon's own reasoning
	 * (the two directions ship independently, and a client that can read one
	 * report is not necessarily the client that can send the other's payload),
	 * which is the rule this union states for every member: a backend that serves
	 * the registry and predates voicing must not be asked for a route it does not
	 * have, because the 404 it answers is indistinguishable from this app making a
	 * malformed call. Absent ⇒ the Speech settings group renders the honest
	 * "this backend does not serve the voicing surface" state and fires no read at
	 * all, which is the pre-voicing behaviour rather than a degraded one.
	 */
	| "tts"
	/**
	 * THE PUBLISHED CHANNEL SPEND (`features.cost_channels`): the
	 * `spend_channels` object on the canonical session state — session money
	 * beyond inference (images, speech, search) folded by the BACKEND into one
	 * object every surface renders.
	 *
	 * ITS OWN KEY rather than a bump of the state stream's shape, on the rule
	 * this union states for every member: the wire field is additive, so an old
	 * reader ignores it and keeps its current numbers, and an old backend is
	 * never asked to honour semantics it does not have. Absent ⇒ the composer
	 * strip and `/analytics` render exactly today's inference-only figures and
	 * say nothing about channels — never a zero for spend they cannot see.
	 */
	| "cost_channels";

/**
 * WHY a negotiated feature surface may not be offered.
 *
 * `desktopFeatureEnabled` answers one boolean for two conditions - the desktop
 * plane not being available, and the backend not advertising the feature's
 * version - and every surface that read only the boolean had to guess which half
 * had closed. Two guessed DIFFERENTLY and both were wrong in the operator's own
 * screenshot: the chat pane told them their server was out of date when the fact
 * was that this app held no credential for it, while the sidebar had already been
 * corrected to one cause-neutral sentence (design § 1.3).
 *
 * So the decision is a tri-state with an `unknown` that is a real member rather
 * than a default: `unknown` means no capability answer has arrived, where a
 * surface must not assert either cause. `desktopFeatureEnabled` stays as this
 * function's `=== "enabled"` projection, so no existing call site changes
 * meaning and there is one predicate rather than a fifth copy of it.
 */
export type DesktopFeatureState =
	| "enabled"
	| "unpaired"
	| "below-version"
	| "unknown";

/**
 * WHICH of the two conditions closed a surface, or `unknown` before an answer.
 *
 * Pairing is asked FIRST and it is not an ordering nicety: the same payload
 * carries both answers, and a daemon this app holds no credential for is a
 * pairing fact no matter what its feature list says - reporting the feature
 * version for it is the sentence the operator was shown for a pairing condition.
 */
export function desktopFeatureState(
	capabilities: DesktopCapabilities | null | undefined,
	feature: DesktopFeature,
	minimumVersion = 1,
): DesktopFeatureState {
	if (!capabilities) return "unknown";
	if (!capabilities.desktop_available) return "unpaired";
	return (capabilities.features?.[feature] ?? 0) >= minimumVersion
		? "enabled"
		: "below-version";
}

/**
 * Resolve whether a negotiated feature surface may be offered.
 *
 * A feature requires BOTH the backend advertising its version AND the managed
 * pairing being available: the routes sit behind the desktop bearer, so a
 * surface without `desktop_available` would render a wall of 401s. Kept as
 * {@link desktopFeatureState}'s projection rather than as the predicate itself,
 * so the surfaces that need the CAUSE now have it without a second definition.
 */
export function desktopFeatureEnabled(
	capabilities: DesktopCapabilities | null | undefined,
	feature: DesktopFeature,
	minimumVersion = 1,
): boolean {
	return (
		desktopFeatureState(capabilities, feature, minimumVersion) === "enabled"
	);
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
