import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult } from "./desktop-api";
import { teamDisplayName } from "./team-display";

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
	/**
	 * The agent's action class, in its EFFECTIVE spelling (`reactive` |
	 * `proactive`), as the backend's own `action_class.normalize` answers it.
	 *
	 * ADDITIVE and optional, the same shape as `already_installed` below and for
	 * the same reason: the field shipped after this client did, so a backend
	 * older than it answers a payload with no `action_class` at all. Absence is
	 * not an unknown here — it IS `reactive`, which is what the wire encodes (the
	 * backend writes a `class:proactive` tag and leaves it off otherwise) and
	 * what every consumer in it reads for an unrecognised value. The reading
	 * lives in `features/agents/utils/agent-class.ts` rather than at each call
	 * site so the rule is stated once.
	 */
	action_class?: "reactive" | "proactive";
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
	/**
	 * The opaque definition revision this editable snapshot was read at.
	 *
	 * ADDITIVE (proposed additive wire, b-wire-receipt-definition-cas-and-adopt):
	 * the editor echoes it as `expected_definition_revision` on save so a write
	 * based on a stale snapshot is refused 409 rather than silently reverting a
	 * concurrent edit. ABSENT (not null) where no editable local definition exists
	 * (a pure builtin seed with no installed row). Never derived on the client —
	 * the backend owns the digest; this app only reads it and sends it back.
	 */
	definition_revision?: string;
};
export type TeamMember = {
	role: string;
	count: number;
	kind: "agent" | "team";
	/**
	 * The slot's MODEL tier override, or absent for "no override on this layer".
	 *
	 * ADDITIVE: a backend older than the member-override contract ignores the key
	 * on write and never answers it on read, so absence is the only value such a
	 * server can produce and every reader below treats it as the fall-through it
	 * is. The words are the tier map's own (`lo` | `med` | `hi`).
	 */
	tier?: MemberTier | null;
	/**
	 * The slot's REASONING effort override, or absent for no override.
	 *
	 * `auto` is a VALUE, not an absence: it overrides the layer below to the
	 * model's own default, where an absent key falls through to whatever the tier
	 * map says. Cleared by sending `null` (the backend accepts it as "no
	 * override").
	 */
	effort?: MemberEffort | null;
};

/** The tier words the wire and the tier map share. */
export type MemberTier = "lo" | "med" | "hi";

/**
 * The reasoning efforts a slot may name, in the backend's own spelling.
 *
 * A UNION RATHER THAN `string`, so the payload's type and the vocabulary cannot
 * drift: the contract refuses anything outside these eight words, and a member row
 * that could hold a ninth would only be discoverable by a refused write.
 */
export type MemberEffort =
	| "auto"
	| "none"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

/*
 * The `/effective` reading (P3).
 *
 * WHAT IT ANSWERS, and why it is a route rather than a client-side derivation:
 * the model a member will run on is decided by up to three layers (the team's
 * launch suggestion, the slot's own override, the agent row's `effort:` tag) and
 * the answer is only true on the machine holding the tier map. Deriving it here
 * would be a second opinion about a resolution the backend owns - the same
 * reason `definition_revision` is never client-derived.
 *
 * EVERY `source` IS A LITERAL UNION rather than a string: the labels are drawn
 * from them, and an unrecognised word must fail the type-check rather than
 * render as an empty label. Both `value`s may be null, and each means something
 * specific - see the fields.
 */
export type TeamEffectiveSource = "team" | "row" | "none";
export type TeamEffectiveModelSource = "tier" | "session";
export type TeamEffectiveEffortSource = "team" | "tier" | "model_default";
export type TeamEffectiveMember = {
	role: string;
	kind: "agent" | "team";
	tier: { value: string | null; source: TeamEffectiveSource };
	/** `value: null` = this member runs on the LAUNCHING SESSION's model. */
	model: { value: string | null; source: TeamEffectiveModelSource };
	/**
	 * `value` is clamped against the model's ladder when the model is known,
	 * `requested` is what the layers actually asked for, and the two differ when a
	 * model's own ladder tops out below the request.
	 */
	effort: {
		value: string | null;
		requested: string | null;
		source: TeamEffectiveEffortSource;
	};
	/** False = this member could not start as configured; `reason` says why. */
	available: boolean;
	reason: string;
};
export type TeamEffective = {
	team: string;
	members: TeamEffectiveMember[];
};
export type ReusableTeam = {
	id: string;
	/**
	 * The team's TUI-safe slug: the key EVERY surface addresses it by (`/team`
	 * arguments, session bindings, catalogue keys, the agents route). Never
	 * replaced by the label below - aliases may add more keys, but this one is
	 * the name the wire and the terminal share.
	 */
	name: string;
	/**
	 * A free-text name a person reads, spaces allowed.
	 *
	 * ADDITIVE and optional: a backend that predates the label omits it, and
	 * every reader falls back to `name` (`teamDisplayName` in
	 * `team-display.ts` states the rule once). LOCAL display metadata - it does
	 * not ride the hub publish wire, and nothing a request carries may be the
	 * label when a name is expected.
	 */
	label?: string;
	/**
	 * Extra TUI-safe keys that resolve to this team, beside `name`.
	 *
	 * Optional for the same compatibility reason as `label`. The renderer keeps
	 * them typed so a row carrying them round-trips unchanged; addressing in
	 * this app stays on `name` (the backend is what resolves an alias).
	 */
	aliases?: string[];
	description: string;
	manager: string;
	members: TeamMember[];
	instructions?: string;
	project?: string;
	/**
	 * The opaque definition revision this editable team snapshot was read at.
	 *
	 * The team sibling of `ReusableProfile.definition_revision` (same additive
	 * CAS contract): absent where no editable local definition exists, echoed as
	 * `expected_definition_revision` on save. Backend-owned; never client-derived.
	 */
	definition_revision?: string;
};
export type ChatTarget = { kind: "agent" | "team"; name: string };

/**
 * One definition's detail, refreshed by the authoring frame AND by a
 * configuration run's own settle.
 *
 * WHAT IS TRUE HERE, stated without the overclaim the first version carried
 * (agent review round 1, m4): the frame's invalidation of `["desktop", kind]`
 * as a PREFIX already reaches this hook's key, and the subscription that does
 * that lives in `useProfiles`/`useTeams` — which run it whether or not their own
 * query is `enabled`. So the detail does NOT depend on the subscription below to
 * be refreshed; the list's effect is what refreshes it in practice, and the
 * 14 s symptom the design consult reported is not explained by a missing
 * subscription.
 *
 * WHY IT STAYS ANYWAY. `useAuthoringRefresh` is a no-op while the revision has
 * not moved, and the cost of the duplicate is one already-scheduled
 * invalidation (`invalidateQueries` on an unmounted-or-fresh key does no
 * request). What it buys is that this hook is CORRECT ON ITS OWN: a caller that
 * reads a detail without mounting the list query — a future pane, a story, a
 * test — still follows the frame, rather than silently relying on a sibling
 * component being on screen. The gap it closes is real for that caller and
 * merely redundant for the page.
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
 * One team's EFFECTIVE model and reasoning effort per member, with the layer
 * each was set on.
 *
 * WHY A SEPARATE QUERY RATHER THAN A FIELD ON THE TEAM. It is a resolution, not
 * a stored value: it moves when the tier map in Settings moves, when the agent
 * row's own pin moves, or when another window edits the roster - none of which
 * touch this team's record. Folding it into `teams.get`'s answer would make
 * every roster read pay for a resolution most of them do not display, and would
 * give the reading the team record's cache lifetime, which is the wrong one.
 *
 * IT REFUSES TO RETRY for `useTeamDetail`'s reason, and one more: a 404 here is
 * the CAPABILITY PROBE rather than a failure (an older server has no such route),
 * so a retry would ask a question whose answer cannot change. The caller decides
 * what a 404 means - the editor hides its override controls - and that decision
 * lives in `features/agents/utils/member-overrides`.
 */
export function useTeamEffective(name: string | null, enabled: boolean) {
	return useQuery<TeamEffective>({
		queryKey: ["desktop", "team", name, "effective"],
		enabled: enabled && Boolean(name),
		queryFn: () =>
			desktopResult<TeamEffective>({ op: "teams.effective", name: name ?? "" }),
		retry: false,
		/*
		 * NOT `useAuthoringRefresh`'s subject, deliberately: that hook watches the
		 * authoring revision, and a tier map edited in Settings publishes none of it.
		 * The editor re-reads this after its own save, which is the write that can
		 * change it from inside this app.
		 */
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
		/*
		 * THE SKILL LIBRARY AND ITS HUB LINKS (seam note §4). A run on a core with
		 * `agents_config_skills` may write a skill, and the live `authoring` frame
		 * stats only `agents/` and `teams/`, so without these the Skills tab and a
		 * linked skill's Modified state stay stale until something else refetches.
		 * The library key is a prefix of every skill's detail key, so one entry
		 * covers the list and the open skill. Spelled out rather than imported:
		 * this shared module must not depend on a feature's hook file.
		 */
		["desktop", "skills", "library"],
		["desktop", "hub-links"],
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

/**
 * The slug->label resolver for surfaces that carry only a binding's SLUG.
 *
 * WHY A HOOK AND NOT ONE MORE INLINE MAP. The rule is read from a growing set
 * of surfaces — the draft title, the session rows' team slots, the project
 * pages' team lines and group headings, the `/info` panel's Active row, the
 * session-search haystack — and each one used to re-derive it from
 * `useTeams(...).data` with its own three-line memo. That is how one of them
 * eventually disagrees with the others, which is the same defect
 * `teamDisplayName` exists to prevent one layer down; this hook is that
 * module's read-side twin, sharing the same query key and therefore the same
 * cache entry the sidebar's own fetch populates.
 *
 * A resolver rather than a map because both call shapes are then one line: a
 * lookup for a known slug, or a `map()` over rows. A slug the catalogue cannot
 * resolve — the gate is off, the list is still landing, the team was deleted —
 * answers with the slug itself, which is exactly what those surfaces drew
 * before labels existed, so nothing here can blank a name.
 */
export function useTeamLabelFor(enabled: boolean): (slug: string) => string {
	const teams = useTeams(enabled);
	return useMemo(() => {
		const labels = new Map(
			(teams.data ?? []).map((row) => [row.name, teamDisplayName(row)]),
		);
		return (slug: string) => labels.get(slug) ?? slug;
	}, [teams.data]);
}
