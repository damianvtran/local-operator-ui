import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";

/** Reusable instructions, never a conversation or a legacy agent history. */
export type ReusableProfile = {
	name: string;
	kind: "role" | "specialist";
	source: "builtin" | "installed" | "custom";
	agent_id: string | null;
	description: string;
	instructions?: string;
	packaged_instructions?: string;
	tools: string[] | null;
	effort: string | null;
	delegate: boolean;
	seed_origin?: string | null;
	divergent_fields?: string[];
	/**
	 * Set by `profiles.install` when the copy was already there.
	 *
	 * ADDITIVE and optional: install is idempotent, and the backend that answers
	 * this gains the field alongside the hub standard. A backend older than that
	 * omits it, which the caller reads as "installed" rather than as a failure —
	 * see `install-builtin-agents.tsx` for why that is the honest reading.
	 */
	already_installed?: boolean;
};
export type TeamMember = {
	role: string;
	count: number;
	kind: "agent" | "team";
};
export type ReusableTeam = {
	id: string;
	name: string;
	description: string;
	manager: string;
	members: TeamMember[];
	instructions?: string;
	project?: string;
};
export type ChatTarget = { kind: "agent" | "team"; name: string };

/**
 * One definition's detail, refreshed by the authoring frame AND by a
 * configuration run's own settle.
 *
 * WHY THE DETAIL OWNS ITS OWN AUTHORING SUBSCRIPTION rather than relying on the
 * list's. The frame's invalidation of `["desktop","profile"]` as a PREFIX does
 * reach this key, but only while the hook that owns that effect is MOUNTED — and
 * the reported defect (UX exploration U6) is exactly a case where it was not
 * enough: an open detail kept rendering the pre-write text for 14 s+ while the
 * lists refreshed in ~4 s. Two independent reasons it can be missed, and the
 * subscription here closes both: a run's write can land while the page is
 * showing a detail whose LIST query is disabled (the page only enables the
 * mounted tab's list), and a query that a user has been reading for minutes is
 * `staleTime: 0` but has no active refetch of its own until something
 * invalidates it. A detail that is on screen is the surface the operator is
 * actually reading, so it subscribes rather than borrows.
 */
export function useProfileDetail(name: string | null, enabled: boolean) {
	useAuthoringRefresh("profiles");
	return useQuery<ReusableProfile>({
		queryKey: ["desktop", "profile", name],
		enabled: enabled && Boolean(name),
		queryFn: () =>
			desktopResult<ReusableProfile>({
				op: "profiles.get",
				name: name ?? "",
			}),
		/*
		 * NOT retried: a `profiles.get` refusal is about the row (a name that is not
		 * in the catalogue, a 404 after a delete elsewhere) and asking again is the
		 * same question — the page answers it with the pane's own error sentence and
		 * a retry the user presses.
		 */
		retry: false,
	});
}

export function useTeamDetail(name: string | null, enabled: boolean) {
	useAuthoringRefresh("teams");
	return useQuery<ReusableTeam>({
		queryKey: ["desktop", "team", name],
		enabled: enabled && Boolean(name),
		queryFn: () =>
			desktopResult<ReusableTeam>({ op: "teams.get", name: name ?? "" }),
		retry: false,
	});
}

/**
 * Mark the catalogues (and every open detail) stale, unconditionally.
 *
 * CALLED WHERE A CHANGE IS KNOWN TO HAVE HAPPENED RATHER THAN OBSERVED. The
 * `authoring` frame is the ordinary path — and it is capability-gated in both
 * directions, so on a backend without the feed, or through a socket that went
 * down while the machine slept, no frame arrives and the run's results would
 * sit invisible on the very page that asked for them. A run that has SETTLED
 * does not need the frame to know its writes are on disk.
 *
 * The singular keys are named as well as the lists, for the reason
 * `useAuthoringRefresh` states: a `prefix` match on the list key does not reach
 * `["desktop","profile",name]`.
 */
export function invalidateAuthoring(queryClient: QueryClient): void {
	for (const key of [
		["desktop", "profiles"],
		["desktop", "teams"],
		["desktop", "profile"],
		["desktop", "team"],
	] as const) {
		void queryClient.invalidateQueries({ queryKey: [...key] });
	}
}

export function useProfiles(enabled: boolean) {
	useAuthoringRefresh("profiles");
	return useQuery({
		queryKey: ["desktop", "profiles"],
		enabled,
		queryFn: () =>
			desktopResult<{ profiles: ReusableProfile[] }>({
				op: "profiles.list",
			}).then((result) => result.profiles),
		retry: retryDesktopQuery,
		staleTime: 10_000,
	});
}

/**
 * Refresh one authoring list, and its detail entry, when the backend publishes
 * a new `authoring` revision.
 *
 * WHY THE EFFECT LIVES HERE, IN THE QUERY'S OWN HOOK, rather than once in
 * `chat-sidebar.tsx` beside the catalogue invalidation. The sidebar is
 * ROUTE-SCOPED (mounted by the chat page, not by the app shell), so an effect
 * there is absent on `/agents` - the one page whose entire subject is these two
 * lists, and therefore the page a stale authoring list is most visible on. The
 * invalidation has to own the same lifetime as the query it refreshes, which is
 * what putting it in the query's hook buys: whichever page mounts the list is
 * the page that refreshes it.
 *
 * WHAT IT INVALIDATES, and why both keys. The list key is the row that has to
 * appear, but `prefix`-matching does not reach the detail entry: `["desktop",
 * "profiles"]` and `["desktop", "profile", name]` differ in their second
 * element, so neither key covers the other and the singular - the key
 * `agents-page.tsx` builds - would keep rendering a profile an agent has since
 * edited or deleted. `["desktop", "profile"]` as a PREFIX does reach every
 * name, which is how one call covers the detail without knowing which entry is
 * on screen.
 *
 * NULL IS NOT A REVISION, it is the absence of one: an older backend never
 * publishes the frame, so the guard returns before touching the query client
 * and the baseline rate is bit-for-bit today's. `applied` is what makes a
 * duplicate delivery free - a re-delivered revision reaches the effect as the
 * same number, and comparing it is cheaper than an invalidation that would
 * refetch a list nobody's data changed. It is initialised from the revision on
 * first render rather than to `null`, so a hook that mounts AFTER a frame (a
 * page entered late) does not fire a redundant invalidation on top of the fetch
 * its own mount just started.
 */
function useAuthoringRefresh(kind: "profiles" | "teams") {
	const { authoringRevision, authoringReconnectRevision } = useDesktopFeed();
	const queryClient = useQueryClient();
	const applied = useRef<number | null>(authoringRevision);
	const appliedReconnect = useRef(authoringReconnectRevision);

	useEffect(() => {
		if (authoringRevision !== null && authoringRevision !== applied.current) {
			applied.current = authoringRevision;
			// This revision-triggered refresh also covers a reconnect observed in
			// the same render, so do not spend it again on the next render.
			appliedReconnect.current = authoringReconnectRevision;
			void queryClient.invalidateQueries({ queryKey: ["desktop", kind] });
			void queryClient.invalidateQueries({
				queryKey: ["desktop", kind === "profiles" ? "profile" : "team"],
			});
			return;
		}
		if (authoringReconnectRevision === appliedReconnect.current) return;
		appliedReconnect.current = authoringReconnectRevision;
		void queryClient.invalidateQueries({ queryKey: ["desktop", kind] });
		void queryClient.invalidateQueries({
			queryKey: ["desktop", kind === "profiles" ? "profile" : "team"],
		});
	}, [authoringRevision, authoringReconnectRevision, kind, queryClient]);
}

export function useTeams(enabled: boolean) {
	useAuthoringRefresh("teams");
	return useQuery({
		queryKey: ["desktop", "teams"],
		enabled,
		queryFn: () =>
			desktopResult<{ teams: ReusableTeam[] }>({ op: "teams.list" }).then(
				(result) => result.teams,
			),
		retry: retryDesktopQuery,
		staleTime: 10_000,
	});
}
