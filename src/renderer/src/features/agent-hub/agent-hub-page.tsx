import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import {
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { Agent } from "@shared/api/radient/types";
import { PageHeader } from "@shared/components/common/page-header";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Skeleton,
	TabPanel,
	Tabs,
	TabsList,
	TabsTrigger,
} from "@shared/components/ui";
import { usePairingCause } from "@shared/hooks/use-pairing-cause";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { cn } from "@shared/lib/utils";
import { Building2, Globe, Store } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentCardContainer } from "./components/agent-card-container";
import { AgentCategoriesSidebar } from "./components/agent-categories-sidebar";
import { categoryEntry } from "./components/agent-tags-and-categories";
import { HubPager } from "./components/hub-pager";
import { OrgTeamsList } from "./components/org-teams-list";
import { PublicTeamsLibrary } from "./components/public-teams-library";
import {
	isAgentStatusKnown,
	useAgentStatusesQuery,
} from "./hooks/use-agent-statuses-query";
import { useDebouncedValue } from "./hooks/use-debounced-value";
import { useMembershipsQuery } from "./hooks/use-memberships-query";
import { useOrgTeamsQuery } from "./hooks/use-org-teams-query";
import {
	type PublicAgentSort,
	usePublicAgentsQuery,
} from "./hooks/use-public-agents-query";
import { orgRefusalFromError, usableOrgs } from "./org-access";
import { orgSurfaceNotice, orgSurfaceReady } from "./org-surface-gate";

/**
 * The hub's sort control, as the list control it really is.
 *
 * One option per (sort, order) pair the repository whitelists
 * (`agent_repository.go`, `allowedSortFields`), labelled by what a person is
 * choosing between: an unknown sort silently falls back to `created_at desc`
 * upstream, so an option this control offered that the API does not implement
 * would be a sort that does not happen.
 */
const SORT_OPTIONS: {
	value: string;
	label: string;
	sort: PublicAgentSort;
	order: "asc" | "desc";
}[] = [
	{
		value: "download_count:desc",
		label: "Most downloaded",
		sort: "download_count",
		order: "desc",
	},
	{
		value: "like_count:desc",
		label: "Most liked",
		sort: "like_count",
		order: "desc",
	},
	{
		value: "favourite_count:desc",
		label: "Most favourited",
		sort: "favourite_count",
		order: "desc",
	},
	{
		value: "created_at:desc",
		label: "Newest",
		sort: "created_at",
		order: "desc",
	},
	{
		value: "updated_at:desc",
		label: "Recently updated",
		sort: "updated_at",
		order: "desc",
	},
	{ value: "name:asc", label: "Name (A to Z)", sort: "name", order: "asc" },
];

/**
 * Which field the search box searches.
 *
 * Two scopes rather than one, because the API has two: the backend puts `name`
 * and `description` on the same Mongo filter, so passing both for one query
 * string asks for records matching the name AND the description — which is why
 * a single free-text box cannot honestly search "either". The scope selector is
 * the control that says which question is being asked.
 */
const SEARCH_SCOPES = [
	{ value: "name", label: "Name" },
	{ value: "description", label: "Description" },
] as const;

const SEARCH_DEBOUNCE_MS = 300;

/** The scope value that means the public hub, and the one value no tenant can be. */
const PUBLIC_SCOPE = "public";

/**
 * What the hub is showing OF: agents, or teams.
 *
 * A VIEW of one page rather than a second route (design §8.4: "no new top-level
 * navigation"), and the reason it is a control at all: teams used to be a roster
 * below the agent grid and its pager, so a reader learned they existed by
 * scrolling past twelve cards. The tab is on screen from the first paint, and it
 * is one view for BOTH places teams come from — the public catalogue and the
 * organization the scope selector names.
 */
type HubView = "agents" | "teams";

/**
 * The tab and panel ids the Teams/Agents strip and its panel point at each other
 * with. Radix's `TabsTrigger` emits `aria-controls` for a `TabsContent` in the
 * same root, and this page has none (the panel wraps content that is not a child
 * of the root), so both halves are supplied by hand - the `chat-tabs.tsx`
 * pattern - rather than left announcing a region that is not in the document.
 */
const VIEW_TAB_IDS: Record<HubView, string> = {
	agents: "agent-hub-view-agents",
	teams: "agent-hub-view-teams",
};
const VIEW_PANEL_ID = "agent-hub-view-panel";

/**
 * The placeholder card, at the SETTLED card's own geometry.
 *
 * It is a placeholder of the shape that is coming, which only works if the
 * shape is the one that arrives: an earlier version drew a title and three
 * text lines and then jumped to the footer, omitting the tag row and the author
 * line that make a settled card 37px taller, so every first paint moved the
 * grid twice — the first row down, then each row growing (design round 1, D1:
 * placeholder box 220px against the settled card's 257px, row pitch 248 against
 * 283). The blocks below mirror `AgentCard`'s own: same `p-4`, same `gap-2`,
 * title, three clamped description lines, the tag group and author line where
 * the card's `mt-auto` group puts them, then the same divider above the same
 * footer with the counters and the action in their real sizes.
 *
 * THE TAG GROUP IS TWO ROWS, because the settled card's is. `AgentCard`'s
 * `flex-wrap` group wraps on every record this hub serves and at both widths
 * the grid gives it — 306px cards in the four-column grid and 292px under
 * `narrow-columns` — so the placeholder was drawing a 20px group where the card
 * draws 50px (two 22px pill rows and the group's own `gap-1.5`), measured as a
 * 225-228px box against the settled 259-263px and a 249-250px pitch against
 * 282-285 in all twelve themes (design round 2, D1). Two explicit rows of
 * `min-h-5.5` — the pill's own floor — are that 50px in every theme, and unlike
 * three chips long enough to wrap in a `flex-wrap` group they do not depend on
 * the column width the grid happens to hand them, so the box holds whatever the
 * window is. The title takes `h-5.5` for the same reason: `text-heading`'s line
 * box is 22.4px, not the 20px an `h-5` block stands in with.
 *
 * Six of them, which is what a grid at the hub's narrowest supported column
 * shows; the count is a deliberate choice of its own and not this comment's
 * subject.
 */
const AgentCardSkeleton: React.FC = () => (
	<div className="flex h-full flex-col overflow-hidden rounded-md bg-surface">
		<div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
			<Skeleton className="h-5.5 w-2/3" />
			<Skeleton className="h-3.5 w-full" />
			<Skeleton className="h-3.5 w-full" />
			<Skeleton className="h-3.5 w-1/2" />
			{/* The `mt-auto` group: tag rows, then the author line. */}
			<div className="mt-auto flex flex-col gap-2 pt-2">
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-1.5">
						<Skeleton className="h-5.5 w-24" />
						<Skeleton className="h-5.5 w-20" />
					</div>
					<div className="flex items-center gap-1.5">
						<Skeleton className="h-5.5 w-24" />
					</div>
				</div>
				{/*
				 * `h-4.5` rather than `h-4`: the author line stands in for a
				 * `text-meta` line box, which is 17.4px, and this is the step that
				 * keeps the whole card on the settled height rather than 2.3px under
				 * it (`h-4`) or 2.7px over (`h-5`).
				 */}
				<Skeleton className="h-4.5 w-32" />
			</div>
		</div>
		{/* The settled card's own footer: same divider, same padding, same sizes. */}
		<div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
			<Skeleton className="size-4" />
			<Skeleton className="h-4 w-6" />
			<Skeleton className="size-4" />
			<Skeleton className="h-4 w-6" />
			<Skeleton className="ml-auto h-7 w-16" />
		</div>
	</div>
);

/**
 * Renders the Agent Hub page, displaying a marketplace of public agents.
 */
export const AgentHubPage: React.FC = () => {
	const navigate = useNavigate();
	const { isAuthenticated } = useRadientAuth();
	const [page, setPage] = useState(1);
	const [perPage] = useState(12); // Adjust items per page as needed
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
	const [searchText, setSearchText] = useState("");
	const [searchScope, setSearchScope] =
		useState<(typeof SEARCH_SCOPES)[number]["value"]>("name");
	const [sortValue, setSortValue] = useState(SORT_OPTIONS[0].value);
	/*
	 * WHICH NAMESPACE THE HUB IS SHOWING: the public hub, or one organization's
	 * private workspace (design §8.4). The value is a tenant id, or the sentinel
	 * above, and it is deliberately ONE piece of state: the scope decides the key
	 * the list registers under and the route it is read from, so a second copy of
	 * "which org" anywhere on this page is a second place for them to disagree.
	 */
	const [scope, setScope] = useState<string>(PUBLIC_SCOPE);
	const [view, setView] = useState<HubView>("agents");
	/*
	 * Categories seen on the hub, so the rail does not empty itself.
	 *
	 * The rail lists what the records carry, and a filtered result only carries
	 * the category that was selected — so a rail rebuilt from each response
	 * would leave one row and no way back. Everything the hub has shown stays on
	 * the rail; nothing it has never carried ever appears on it.
	 */
	const [seenCategories, setSeenCategories] = useState<string[]>([]);

	// The box stays bound to `searchText` so typing never lags; only the request
	// waits for the caret to settle.
	const debouncedSearch = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);

	const sort =
		SORT_OPTIONS.find((option) => option.value === sortValue) ??
		SORT_OPTIONS[0];

	/*
	 * WHETHER THE ORG SURFACE MAY RENDER AT ALL (agent review round 1's M2).
	 *
	 * The four operations ride the `radient_org` capability, and a backend that
	 * predates them answers with a MASKED 422 — indistinguishable from a malformed
	 * call — so the reads are never issued against it (`enabled: orgSurfaceReady`)
	 * and the surface says which remedy applies instead. `usePairingCause` is the
	 * same seam the banner and the sidebar catalogue gate read, so an unpaired
	 * backend gets that table's sentence rather than a restatement of it.
	 */
	const capabilities = useDesktopCapabilities();
	const pairingCause = usePairingCause();
	const orgState = desktopFeatureState(capabilities.data, "radient_org");
	const orgNotice = isAuthenticated
		? /*
			 * `?? null`: `undefined` (no answer yet) owes the same nothing as `null`
			 * (no cause) on this surface — see the hook's three states; only a
			 * consumer that FIRES work on the answer reads the third state.
			 */
			orgSurfaceNotice(orgState, pairingCause ?? null)
		: null;
	/*
	 * The viewer's organizations (§4.1), read once for the whole surface.
	 *
	 * The query is disabled for a signed-out viewer (there is no membership to
	 * read), and a failure degrades to the PUBLIC hub alone rather than to a wrong
	 * org: an empty list is the same reading as "this account holds none", which
	 * is exactly why the publish picker says when the read failed rather than
	 * claiming the user has no organizations.
	 *
	 * It is ALSO gated on the backend advertising `radient_org` (§8.4, M2): a
	 * backend without it answers these operations with a masked 422, so this app
	 * asks for nothing and says which remedy applies instead — see
	 * `org-surface-gate.ts`.
	 */
	const { memberships } = useMembershipsQuery({
		enabled: orgSurfaceReady(orgState),
	});
	const selectableOrgs = useMemo(() => usableOrgs(memberships), [memberships]);

	/*
	 * The scope falls back to the public hub when the org it names stops being
	 * usable — the plan behind a selected org can lapse while the page is open, and
	 * a scope the selector no longer offers must not keep sending reads to a route
	 * that now refuses them. An EFFECT rather than a guard in render, because the
	 * list is read from the scope value and this is the one place that changes it
	 * for a reason other than a press.
	 */
	const scopeIsAvailable =
		scope === PUBLIC_SCOPE ||
		selectableOrgs.some((org) => org.tenant_id === scope);
	useEffect(() => {
		if (!scopeIsAvailable) setScope(PUBLIC_SCOPE);
	}, [scopeIsAvailable]);

	const activeOrg =
		scope === PUBLIC_SCOPE
			? null
			: (selectableOrgs.find((org) => org.tenant_id === scope) ?? null);
	const orgScopeId = activeOrg?.tenant_id;
	const orgName = activeOrg?.tenant_name || null;

	/*
	 * Whether a filter is narrowing the list. Declared HERE, above both tab counts,
	 * because both of them suppress themselves while it is true (UX round 2, U11).
	 */
	const hasFilters = selectedCategory !== null || debouncedSearch !== "";

	/*
	 * THE TEAMS READ RIDES SCOPE ENTRY, not the Teams tab.
	 *
	 * Eager on purpose: the tab carries its count ("Teams 2") so the split is
	 * legible without visiting it, and that number cannot exist without the read.
	 * It costs nothing over the old layout, which mounted the roster (and so read
	 * the list) on every org-scope entry too. `OrgTeamsList` calls the same hook
	 * with the same key, so the two observers share ONE request; a tab switch
	 * re-issues neither list (`staleTime` five minutes, focus refetch off), and a
	 * refused read is not re-issued by the roster mounting either
	 * (`retryOnMount: false` in the hook - QA round 1, Q1). The public scope passes
	 * no tenant, so THIS query is disabled and issues zero reads: the public
	 * catalogue has a query of its own (`usePublicTeamsQuery`, read by the library
	 * the public Teams view mounts), which the tab's count deliberately does not
	 * observe - its total is already on the library's own line, and a second
	 * observer here would re-issue the read every time the library pages.
	 *
	 * The count is the number of rows LOADED: `org_teams.list` returns the whole
	 * unpaginated roster and reports no total, so no other number exists to show.
	 */
	const teamsQuery = useOrgTeamsQuery({ tenantId: orgScopeId });
	/*
	 * THE TEAMS COUNT IS SUPPRESSED UNDER THE SAME FILTER AS THE AGENTS ONE (UX
	 * round 2, U11). It is not a filtered number - `org_teams.list` takes no
	 * filters - but leaving it up while "Agents" went bare read as an asymmetric
	 * pair ("Agents   Teams 2") with nothing saying which quiet count meant what.
	 * Both tabs now say nothing while a search or category is active, and the
	 * status line carries the filtered figure; the counts come back the moment the
	 * filter is cleared.
	 */
	const teamsCount =
		orgScopeId && teamsQuery.isSuccess && !hasFilters
			? teamsQuery.teams.length
			: null;

	/*
	 * Publishing INTO an organization needs the admin rank or above (§4.4), so the
	 * empty org workspace offers its "Publish an agent" action only to a viewer the
	 * hub would accept one from. Reading the rank off the same membership row the
	 * scope came from is deliberate: a second source for "what may I do here" is a
	 * second answer, and a member whose press is refused would have been offered a
	 * control the server was always going to refuse.
	 */
	const canPublishToOrg =
		activeOrg?.role === "owner" || activeOrg?.role === "admin";

	/*
	 * Tenant id to organization name, from the memberships this page already read.
	 *
	 * The org badge names the organization a row came from, and the row carries
	 * only its `tenant_id` — so the name has to come from here. A Map rather than a
	 * lookup per card, because the grid renders twelve of them.
	 */
	const membershipNames = useMemo(
		() => new Map(memberships.map((row) => [row.tenant_id, row.tenant_name])),
		[memberships],
	);

	const {
		data: agentsData,
		agents: listedAgents,
		isLoading,
		isFetching,
		error,
		refetch,
		pagination,
	} = usePublicAgentsQuery({
		page,
		perPage,
		categories: selectedCategory ? [selectedCategory] : undefined,
		name: searchScope === "name" ? debouncedSearch || undefined : undefined,
		description:
			searchScope === "description" ? debouncedSearch || undefined : undefined,
		sort: sort.sort,
		order: sort.order,
		// Absent means the public hub; present means `org_agents.list`.
		tenantId: orgScopeId,
	});

	/*
	 * The frozen org refusals this read can be answered with (§2.2): a revoked or
	 * not-yet-active membership and a lapsed plan are NOT outages, and design §8.4
	 * renders them as "no access" rather than as the failure panel below. Read off
	 * the error's own code, so a backend that is simply unreachable keeps the
	 * failure treatment it has always had.
	 */
	const orgRefusal = activeOrg ? orgRefusalFromError(error) : null;

	/*
	 * `keepPreviousData` leaves the previous page's records in `data` while the
	 * next one loads, so the grid is never empty between pages: what is on
	 * screen stays until what replaces it is ready.
	 */
	const agents: Agent[] = listedAgents ?? [];
	const isRefreshing = isFetching && agentsData !== undefined;

	/*
	 * ONE status read for the page.
	 *
	 * Every card used to ask for its own like and favourite state, which is
	 * twenty-four requests for the records below at the moment the signed-in
	 * hub opens; this is one, keyed on exactly the ids on screen.
	 *
	 * INSIDE AN ORG IT IS NOT ASKED AT ALL: liking, favouriting and commenting are
	 * public-only interactions (§4.4 answers 404 to them on an org row), and the
	 * cards hide those affordances for org rows — so a read whose answer nothing
	 * renders would be a round trip bought and thrown away. The empty id list
	 * disables the query on the hook's own rule rather than by a second flag.
	 */
	const {
		statuses,
		isKnown: viewerStateIsKnown,
		isError: viewerStateFailed,
		isFetching: viewerStateIsFetching,
		refetch: refetchViewerState,
	} = useAgentStatusesQuery({
		agentIds: orgScopeId ? [] : agents.map((agent) => agent.id),
	});

	/*
	 * The search box, so a cleared filter can put focus back in it: the panel the
	 * button lived in is gone by the time the press is handled, and the browser's
	 * own answer to that is to drop focus on the document body (UX round 1, U2).
	 */
	const searchRef = useRef<HTMLInputElement>(null);
	const publishRef = useRef<HTMLButtonElement>(null);
	const [clearFocusNonce, setClearFocusNonce] = useState(0);
	useEffect(() => {
		if (clearFocusNonce === 0) return;
		/*
		 * Read AFTER the re-render, and read defensively: clearing the LAST filter
		 * on a hub with nothing published reveals the empty hub, which hides the
		 * controls row, so the search box is not always the target that exists. The
		 * empty panel's own action is the other one, and it is where the user is
		 * standing after the panel changes under them.
		 */
		(searchRef.current ?? publishRef.current)?.focus();
	}, [clearFocusNonce]);

	/*
	 * The retry, and where focus goes when it comes back.
	 *
	 * The alert and its retry unmount the moment a press is answered — the
	 * skeleton grid IS the answer (UX round 1, U1) — so the browser drops focus
	 * on `document.body` and the user's next Tab restarts at the top of the
	 * window. A retry that fails AGAIN then returns the alert with nothing
	 * announced and focus still on the body, because the failure is not an answer
	 * the surface hands anywhere (UX round 2, U9). Same treatment as the cleared
	 * filter above: read the DOM after the re-render, then move focus.
	 *
	 * BOTH ARMS OWE A HAND-OFF, because the alert unmounts in both. The failure
	 * arm returns a control of its own to land on; the SUCCESS arm takes the alert
	 * away and leaves whatever the retry fetched, which is where the user is now
	 * standing - and it was the arm left on the body, measured there from +250ms
	 * through +5s (design round 3, D2). It lands on the same two targets, and for
	 * the same reason, as the cleared filter: the controls row when records came
	 * back, and the empty panel's own action when none did, because an empty or
	 * failed hub hides that row and `searchRef` is null with it.
	 */
	const retryRef = useRef<HTMLButtonElement>(null);
	const retryPressedRef = useRef(false);

	// Accumulated rather than derived per render: see `seenCategories`.
	const presentCategories = useMemo(
		() => [
			...new Set(
				(agentsData?.records ?? []).flatMap(
					(record) => record.categories ?? [],
				),
			),
		],
		[agentsData],
	);
	useEffect(() => {
		setSeenCategories((previous) => {
			if (presentCategories.every((category) => previous.includes(category))) {
				return previous;
			}
			return [...new Set([...previous, ...presentCategories])];
		});
	}, [presentCategories]);

	const handleClearFilters = () => {
		setSelectedCategory(null);
		setSearchText("");
		setPage(1);
		setClearFocusNonce((nonce) => nonce + 1);
	};

	/*
	 * The cold-load state: the list read is in flight and there is nothing to
	 * show yet. That is the first paint AND a retry after a failure — the same
	 * state from the user's side, which is why the alert below is gated on the
	 * complement rather than on `isLoading` alone: a retry that left the alert's
	 * own skeleton state unshown was measured as "nothing happened" 150ms and
	 * 4.5s after the press (UX round 1, U1).
	 */
	const isColdLoading = (isLoading || isFetching) && agentsData === undefined;
	/*
	 * Whether the filter surfaces can change anything.
	 *
	 * Three filter controls over zero records crowd the one action that matters,
	 * "Publish an agent" (UX round 1, U3), and round 2 measured two states that
	 * rule left covered in controls it had not considered: a hub whose read FAILED
	 * still drew the full search/scope/sort row above the alert, over zero records
	 * and with no query to clear, and the rail still offered its lone "All
	 * categories" row — the current selection, which cannot change anything — on
	 * the settled empty hub (UX round 2, U12 and U13). One condition governs both
	 * now, so they cannot disagree about the same question a third time.
	 *
	 * Two states keep everything: a filter that IS active (`!hasFilters`), else the
	 * user could not clear it, and the cold load, so the grid does not reflow when
	 * the records land.
	 */
	const browseControlsAreInert =
		!isColdLoading && !hasFilters && (error !== null || agents.length === 0);

	/*
	 * Focus comes back to the control that was pressed, and only for a press this
	 * surface made: a first paint's own failure moves nothing, which is the
	 * difference between recovering a user's place and stealing it. It waits for
	 * the press to settle (`isColdLoading` is the skeleton the retry shows) so the
	 * target exists when it is read.
	 */
	useEffect(() => {
		if (!retryPressedRef.current || isColdLoading) return;
		retryPressedRef.current = false;
		if (error) retryRef.current?.focus();
		else (searchRef.current ?? publishRef.current)?.focus();
	}, [isColdLoading, error]);

	/*
	 * The status line, which is the top of the list's own content: a page change
	 * brings it into view (UX round 1, U3). The pager sits at the bottom of a long
	 * inner scroll column, so without this the new page's cards showed from their
	 * last rows and the reader had to scroll up to start it. `block: "nearest"`
	 * scrolls only when the line is off screen, so a short page does not jump.
	 */
	const statusRef = useRef<HTMLParagraphElement>(null);
	const handlePageChange = (newPage: number) => {
		setPage(newPage);
		statusRef.current?.scrollIntoView({ block: "nearest" });
	};

	const handleSelectCategory = (category: string | null) => {
		setSelectedCategory(category);
		setPage(1); // Reset to first page on filter change
	};

	const handleSearchChange = (value: string) => {
		setSearchText(value);
		setPage(1); // A new query is a new result set; page 1 is where it starts
	};

	/*
	 * A scope press, from the chip group in the browse bar. The page resets to 1
	 * because page 3 of one list is not a place in another, and the view is KEPT: a
	 * reader on Teams who picks an organization wants that organization's teams,
	 * not the agents they had left.
	 */
	const handleHubScopeChange = (value: string) => {
		setScope(value);
		setPage(1);
	};

	const scopeChips = useRef(new Map<string, HTMLButtonElement>());

	const handleScopeChange = (value: string) => {
		setSearchScope(value as (typeof SEARCH_SCOPES)[number]["value"]);
		setPage(1);
	};

	/*
	 * The agents tab's count: the list's own total, and nothing while it is cold.
	 * A count read from a placeholder or a guess would be a number the hub never
	 * said. It follows the scope (the key does), so it is the public total in the
	 * public scope and the organization's in an organization.
	 */
	/*
	 * NOT UNDER A FILTER (UX round 1, U2). `total_records` answers the QUERY, so
	 * with a search or a category active the tab read "Agents 0" over a hub that
	 * has agents - a total that was not one, changing under the box the reader was
	 * typing in. The tab is the scope's own size, so it says nothing while a filter
	 * narrows it; the status line carries the filtered figure ("0 agents in the
	 * public hub"), which is where a filtered number belongs.
	 */
	const agentsTabCount =
		pagination && !hasFilters ? pagination.totalRecords : null;

	/*
	 * The one status sentence, for both views and every scope (see the element).
	 * `agent`/`team` pluralise on the number, the scope phrase is "in the public
	 * hub" or "shared with <org>", and a state with no number yet says what it is
	 * waiting for instead of an empty line - an empty line is a line box less of
	 * layout (D1).
	 */
	const scopePhrase = orgScopeId
		? `shared with ${orgName ?? "this organization"}`
		: "in the public hub";
	const countPhrase = (count: number, noun: string) =>
		`${count} ${noun}${count === 1 ? "" : "s"} ${scopePhrase}`;
	let statusSentence: string;
	if (view === "teams") {
		/*
		 * The PUBLIC Teams view says nothing here: the catalogue's own line names
		 * what it loaded and how much of it the search covers, and a second count
		 * over the same rows restated it (design round 1, D4, on the panel this
		 * replaced). A non-breaking space, not "", so the line keeps its box (D1).
		 */
		if (!orgScopeId) statusSentence = "\u00a0";
		else if (teamsQuery.isLoading) statusSentence = "Loading teams…";
		else if (teamsCount !== null)
			statusSentence = countPhrase(teamsCount, "team");
		/*
		 * A refused or failed read still says WHOSE view this is (agent review
		 * round 1, m5): the line used to go to zero height here and the roster's
		 * alert landed 17px higher than in every other state.
		 */ else statusSentence = `Teams ${scopePhrase}`;
	} else if (isColdLoading) {
		statusSentence = "Loading agents…";
	} else if (pagination) {
		statusSentence = countPhrase(pagination.totalRecords, "agent");
	} else {
		statusSentence = `Agents ${scopePhrase}`;
	}

	return (
		/* `gap-8`: `PageHeader` no longer ships its own bottom margin. */
		<div className="flex h-full flex-col gap-8 p-6">
			<PageHeader
				title="Agent hub"
				subtitle="Discover and download community agents on Radient"
				icon={Store}
			/>
			{/*
			 * Everything under the header is ONE column with a tighter rhythm than the
			 * page's `gap-8` (header to content): the notice, the browse bar and the
			 * panel are one control surface and its content, and 32px between a
			 * control and what it controls reads as two unrelated blocks.
			 */}
			<div className="flex min-h-0 flex-1 flex-col gap-4">
				{/*
				 * The CAPABILITY notice, in the scope row's own place: without
				 * `radient_org` there is no scope to offer, and the reader is owed the
				 * reason rather than silence (agent review round 1's M2). It sits above
				 * the controls row and outside every gate, like the scope row it replaces,
				 * because the fact is about the BACKEND and not about the records.
				 *
				 * AND THAT IS WHY IT BANDS DIFFERENTLY FROM THE REFUSALS (design round 2,
				 * D7). This notice is PAGE-WIDE: it says the backend cannot serve
				 * organizations at all, so it sits above the browse bar and pushes the
				 * strip down (measured y224 in `teams-public-unavailable`). A refusal
				 * ("that organization needs an active Team plan", a revoked membership) is
				 * VIEW-SCOPED: it is a property of ONE organization's read, so it renders
				 * inside the view it belongs to and the strip stays where it always is
				 * (y119 in `org-teams-plan-lapsed`). Two findings, two bands, on purpose.
				 */}
				{orgNotice && (
					/*
					 * `warning`, not `info` (design review round 2, D5): this notice
					 * belongs to the app's "needs a newer backend" family, and every other
					 * member of it — backend settings, MCP, Radient sign-in, projects —
					 * renders `warning`. It also carries the pairing sentence verbatim
					 * when the cause is a pairing fact, and the banner states that one at
					 * `warning`; one fact in two registers reads as two facts.
					 */
					<Alert
						variant="warning"
						className="max-w-2xl"
						data-testid="agent-hub-org-unavailable"
					>
						<AlertTitle>Organizations are unavailable</AlertTitle>
						<AlertDescription>{orgNotice}</AlertDescription>
					</Alert>
				)}
				{/*
				 * THE BROWSE BAR: what the hub is showing OF (Agents | Teams) and WHOSE (the
				 * public hub or one organization), above the fold and outside every gate.
				 *
				 * It replaces a "Showing [select]" row that hid the scope behind a click and
				 * a roster that hid the teams behind a scroll. Both are now controls on
				 * screen from the first paint, each with the count that says what is behind
				 * it (operator report, 2026-09-29).
				 *
				 * It spans the page rather than the content column, so it does not move
				 * sideways when the category rail comes and goes with the view - a control
				 * that shifts under the pointer as you press it is the failure the D1
				 * reflow rounds were about.
				 *
				 * THE SCOPE GROUP IS PINNED TO THE FAR EDGE (`ml-auto`), not set after the
				 * tabs. Sitting beside them, it moved 6px whenever a tab count changed width
				 * ("Agents 30" to "Agents 6", "Teams" gaining a count) - under the pointer
				 * that had just pressed the chip (design round 1, D2; agent review m1). At
				 * the edge nothing to its left can push it, and each count also holds a
				 * two-digit slot so the tab itself does not breathe.
				 *
				 * Outside `browseControlsAreInert` for the old scope row's reason: that gate
				 * hides the search row when an org has no agents, and a scope control that
				 * disappeared with the records it scopes would strand the user in an empty
				 * organization with no way back to the hub.
				 */}
				<div
					className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2"
					data-testid="agent-hub-browse-bar"
				>
					<Tabs value={view} onValueChange={(next) => setView(next as HubView)}>
						<TabsList aria-label="Browse the hub by type">
							{(["agents", "teams"] as const).map((value) => (
								<TabsTrigger
									key={value}
									value={value}
									id={VIEW_TAB_IDS[value]}
									/* The panel below is one element for both views; only the selected tab claims it. */
									aria-controls={view === value ? VIEW_PANEL_ID : undefined}
									data-testid={`agent-hub-view-${value}`}
								>
									{value === "agents" ? "Agents" : "Teams"}
									{(value === "agents" ? agentsTabCount : teamsCount) !==
										null && (
										<span className="min-w-[2ch] font-normal text-ink-dim tabular-nums">
											{value === "agents" ? agentsTabCount : teamsCount}
										</span>
									)}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
					{/*
					 * The SCOPE: one chip per place the hub can be read from, rendered only
					 * when the viewer has an organization to switch to ("Public hub" alone is
					 * a control that cannot change anything). A segmented `aria-pressed` group
					 * rather than `Tabs`, the settings usage-metric's call: the chips change
					 * WHICH list this is, they do not swap panels, and a `TabsTrigger` would
					 * point `aria-controls` at one.
					 *
					 * Visible chips instead of a select because the choice is the page's
					 * primary axis and a select hides both the options and which is current
					 * until it is pressed. The organization's name is user data of unknown
					 * length, so its label truncates (`max-w-40`) and the full name rides the
					 * title.
					 */}
					{selectableOrgs.length > 0 && (
						<div className="ml-auto flex min-w-0 items-center gap-2">
							{/*
							 * A VISIBLE LABEL for the second axis (design round 1, D5; UX round 1,
							 * U6). The tab strip and the chips share the segmented control's
							 * selected step by design (the app's one idiom, so no new token), which
							 * left "Agents | Teams" and "Public hub | Minerva" as twin pills a gap
							 * apart. The group sits at the bar's far edge and says what it chooses;
							 * the legend below stays for assistive tech, so the label is
							 * `aria-hidden` rather than announced twice.
							 */}
							<span aria-hidden="true" className="text-meta text-ink-muted">
								Showing
							</span>
							<fieldset
								className="m-0 min-w-0 border-0 p-0"
								data-testid="agent-hub-scope"
							>
								<legend className="sr-only">Show the hub of</legend>
								<div className="flex flex-wrap gap-0.5 rounded-md bg-sunken p-0.5">
									{[
										{
											value: PUBLIC_SCOPE,
											label: "Public hub",
											Icon: Globe,
										},
										...selectableOrgs.map((org) => ({
											value: org.tenant_id,
											label: org.tenant_name || "Organization",
											Icon: Building2,
										})),
									].map(({ value, label, Icon }) => (
										<Button
											key={value}
											ref={(node) => {
												if (node) scopeChips.current.set(value, node);
												else scopeChips.current.delete(value);
											}}
											variant="ghost"
											size="sm"
											aria-pressed={scope === value}
											onClick={() => handleHubScopeChange(value)}
											title={label}
											data-testid={`agent-hub-scope-${value === PUBLIC_SCOPE ? "public" : `org-${value}`}`}
											className={cn(
												"max-w-48",
												scope === value &&
													"bg-surface text-ink hover:bg-surface",
											)}
										>
											<Icon aria-hidden="true" />
											<span className="truncate">{label}</span>
										</Button>
									))}
								</div>
							</fieldset>
						</div>
					)}
				</div>
				<TabPanel id={VIEW_PANEL_ID} labelledBy={VIEW_TAB_IDS[view]}>
					<div className="flex min-h-0 flex-1 flex-row overflow-hidden">
						{view === "agents" && (
							<>
								{/* The category rail is hidden below the first grid breakpoint,
				    where the cards are already full-width. */}
								{/*
								 * A RAIL, NOT A CARD — and it is a PANEL now, because it paints row states.
								 *
								 * The selected category carries `rowCurrent` and its neighbours take
								 * `hover:bg-row-hover`, and both roles are steps of the palette's own
								 * `surface` (docs/design/row-states-refinement.md § 4). Painted on the
								 * page's `canvas` — which is what this column left them on — the current
								 * row's fill measured ΔE00 0.83 on `kanagawaLotus`, and 7 of the 59
								 * palettes sat under the file's own 2.0 field floor.
								 *
								 * That is a REVISION of the reasoning this element carried, and the
								 * revision is the ground rather than the border: a ninth bordered box
								 * around the filter list was refused because it carried no information,
								 * and this is not that — it IS the information the row state is drawn
								 * against. No border (the cards beside it own those), and `p-2` insets the
								 * rows the way the app rail's own list does, so the two rails read as the
								 * same construction.
								 */}
								<div
									className="mr-6 hidden w-60 shrink-0 rounded-md bg-surface p-2 md:block"
									data-tour-tag="agent-hub-sidebar-container"
								>
									{/*
									 * The rail's rows go with `browseControlsAreInert`, but the 240px
									 * column stays: it is the grid's gutter, so the content column keeps
									 * the centre it is measured against and the cards do not reflow when
									 * records land. The heading goes too — a rail labelled "Categories"
									 * over nothing is the same inert affordance in a different shape.
									 */}
									{!browseControlsAreInert && (
										<AgentCategoriesSidebar
											selectedCategory={selectedCategory}
											onSelectCategory={handleSelectCategory}
											categories={seenCategories}
										/>
									)}
								</div>
							</>
						)}
						<div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
							{/*
							 * The controls row, and its hierarchy.
							 *
							 * The scope is a SEGMENT INSIDE the search box's own edge rather than a peer
							 * trigger beside it. As a separate 32px select at the same 8px gap and the
							 * same trigger weight as the sort, the row read as three controls of equal
							 * authority with nothing to say which one qualified the box — and the box's
							 * scope-derived placeholder restated the scope's own label immediately
							 * beside it ("Search by agent name" next to "Search name"), so one concept
							 * appeared twice and only clicking resolved it (design round 1, D4). One
							 * bordered group with one placeholder, and the sort left as the only
							 * free-standing control on the right.
							 *
							 * The group draws the focus ring for both of its controls, and that is
							 * deliberate rather than the composer's scoped form: the composer frames a
							 * toolbar of independent controls, where a box-wide ring points at the wrong
							 * thing, while these two are the two halves of one field.
							 */}
							{view === "agents" && !browseControlsAreInert && (
								<div className="mb-4 flex flex-wrap items-center gap-2">
									<div
										className={cn(
											"flex min-w-56 flex-1 items-center rounded-sm border border-control bg-surface",
											"transition-colors duration-fast ease-out-quart",
											"has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2",
											"has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2",
										)}
									>
										<Input
											ref={searchRef}
											type="search"
											value={searchText}
											onChange={(event) =>
												handleSearchChange(event.target.value)
											}
											/*
											 * ONE placeholder, and it does not name the scope: the segment to its
											 * right already says which field is searched, and a placeholder
											 * derived from it was the same sentence twice.
											 */
											placeholder="Search agents"
											aria-label="Search agents"
											className="h-8 min-w-0 flex-1 border-0 bg-transparent outline-none"
											data-testid="agent-hub-search"
										/>
										<Select
											value={searchScope}
											onValueChange={handleScopeChange}
										>
											<SelectTrigger
												/*
												 * Borderless except for the hairline that separates the segment
												 * from the text: a decorative divider inside one control, not a
												 * control's own boundary — the group's `border-control` edge is
												 * that. `w-auto` because the trigger's own variant is full-width.
												 */
												className="w-auto shrink-0 border-y-0 border-l border-hairline border-r-0 bg-transparent pl-2 outline-none"
												aria-label="Search in"
												data-testid="agent-hub-search-scope"
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{SEARCH_SCOPES.map((scope) => (
													<SelectItem key={scope.value} value={scope.value}>
														{scope.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
									<Select value={sortValue} onValueChange={setSortValue}>
										<SelectTrigger
											className="w-48"
											aria-label="Sort agents"
											data-testid="agent-hub-sort"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{SORT_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
							{/*
							 * One line for "how many" and "still loading", announced rather
							 * than animated: a page change that keeps the previous records on
							 * screen needs something that says they are about to be replaced,
							 * and `aria-live` is the half a screen reader can hear.
							 *
							 * SCOPE-AWARE, and one sentence for both views: it says what is on
							 * screen AND whose it is ("30 agents in the public hub", "6 agents
							 * shared with Minerva", "2 teams shared with Minerva"), which is the
							 * public-versus-organization distinction the card badges only make row
							 * by row. The Teams roster used to print its own count line; this is
							 * that line, promoted, so the sentence is said once.
							 */}
							<p
								ref={statusRef}
								aria-live="polite"
								className="mb-3 text-meta text-ink-dim"
								data-testid="agent-hub-status"
							>
								{/*
								 * The line holds its own height from the first paint. It rendered empty
								 * while loading, which is a line box less of layout - measured as the
								 * first row of cards landing 17px higher than settled (design round 1,
								 * D1) - and "Loading agents…" is also the honest thing for a reader
								 * waiting on the read.
								 */}
								{statusSentence}
								{/*
								 * `{" "}` rather than `ml-2` alone: the gap is a layout decision, but
								 * the SPACE is what stops the live region announcing
								 * "30 agentsUpdating" - the two spans are one sentence. The word sits in a
								 * span of its own so it is addressable (the page-change story waits on
								 * it) without becoming a second live region.
								 */}
								{view === "agents" && isRefreshing ? (
									<>
										{" "}
										<span data-testid="agent-hub-updating">Updating…</span>
									</>
								) : null}
							</p>
							{view === "agents" && (
								<>
									{/*
									 * The viewer's own state failed to load, and it is one read for the
									 * whole page: without this line every card would be the only evidence,
									 * and twelve cards showing "not liked" is exactly what a failed read
									 * must not look like. The cards say "unavailable" per control
									 * (`AgentCard`); this says why, once, and offers the retry the hook
									 * deliberately does not run on its own.
									 */}
									{isAuthenticated && viewerStateFailed && (
										/*
										 * `<output>` rather than a `div` with `role="status"`: the element
										 * carries that role itself, which is the same reason the card's own
										 * action failure uses it — and the reason a reader measuring the
										 * `role` ATTRIBUTE sees nothing while the region is still announced.
										 */
										<output
											className="mb-3 flex flex-wrap items-center gap-2 text-meta text-warning"
											data-testid="agent-hub-status-unknown"
										>
											<span>
												Your likes and favourites could not be read, so no card
												shows a viewer state.
											</span>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => void refetchViewerState()}
												disabled={viewerStateIsFetching}
												aria-busy={viewerStateIsFetching}
											>
												{viewerStateIsFetching ? "Trying…" : "Try again"}
											</Button>
										</output>
									)}
									{isColdLoading && (
										<div
											data-testid="agent-hub-loading"
											className="grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-6"
										>
											{Array.from({ length: 6 }, (_, index) => (
												// biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
												<AgentCardSkeleton key={index} />
											))}
										</div>
									)}
									{/*
									 * The pager's own height, reserved while the page count is unknown.
									 *
									 * `HubPager` is 52px tall (`min-h-13`) and absent at one page, so without
									 * this the settled grid is a bar taller than the placeholder that
									 * preceded it and the first paint moves a second time (design round 1,
									 * D1: "no pagination bar once the list lands"). Decorative here, so it
									 * is hidden from assistive tech rather than announced as a pager.
									 */}
									{isColdLoading && pagination === undefined && (
										<div
											aria-hidden="true"
											className="mt-6 flex min-h-13 items-center justify-center"
											data-testid="agent-hub-pager-placeholder"
										>
											<Skeleton className="h-4 w-24" />
										</div>
									)}
									{/*
									 * A failed read is a sentence and the control that retries it, in
									 * the surface, in the same voice the card's failed action uses.
									 * The description is the SHARED backend sentence rather than
									 * `error.message`, which for a transport failure is the internal
									 * "Desktop controls could not reach the backend process." — a
									 * sentence about the app's own plumbing, and the reason this
									 * component's user-facing fallback was unreachable (UX round 1, U5).
									 * `backendLoadErrorMessage` is the app's own answer and names the
									 * server in the user's words.
									 *
									 * The LEAD names this surface's scope and no culprit of its own. It
									 * used to read "The Radient agent catalogue did not answer.", which
									 * blamed the remote catalogue while the shared diagnosis beside it
									 * blamed the local server — two causes for one failure the app cannot
									 * tell apart, and the reader had no way to choose between them
									 * (design round 2, D2). Every other surface pairs its own scope with
									 * this same diagnosis, which is what the helper is for; for `unknown`
									 * the lead is the whole sentence, which is why it must stand alone.
									 *
									 * The region is ALWAYS MOUNTED and written into, rather than the
									 * alert being inserted already carrying its text: a live region that
									 * is present and empty either side of the press is what makes a retry
									 * that fails AGAIN announce its outcome, and `sr-only` costs no line
									 * and no gap while there is nothing to report (UX round 2, U9).
									 */}
									<output
										aria-live="polite"
										data-testid="agent-hub-outage"
										className={cn(
											!isColdLoading && error && !orgRefusal
												? "block"
												: "sr-only",
										)}
									>
										{!isColdLoading && error && !orgRefusal && (
											<Alert
												variant="danger"
												className="max-w-2xl"
												aria-busy={isFetching}
												data-testid="agent-hub-error"
											>
												<AlertTitle>
													{isAuthenticated
														? "The hub could not be loaded"
														: "Sign in to use the hub"}
												</AlertTitle>
												<AlertDescription>
													{/*
													 * A signed-out viewer's failure is NOT an outage, and this surface used
													 * to paint it as one: `agents.list` answers 409 with no credential, so
													 * the page said "The hub could not be loaded / The agent list could not
													 * be loaded" over a retry that re-issues the same unauthenticated read
													 * and cannot help. Main painted nothing there, so the report was an
													 * improvement that could not be told apart from a real outage (QA round
													 * 1, Q2). The diagnosis helper is right for every failure the credential
													 * is not the story of, which is why it keeps this arm alone.
													 *
													 * The retry stays, because here it is not empty: signing in happens on
													 * another surface, and the read does not necessarily re-run when the user
													 * comes back to a page whose query is still cached, so this is the control
													 * that gets them out of the state they signed in to fix.
													 */}
													{isAuthenticated
														? backendLoadErrorMessage(
																"The agent list could not be loaded.",
																error,
															)
														: "You are not signed in to Radient, so the hub has no credential to read the agent list with. Sign in on the settings page, then try again."}
												</AlertDescription>
												{/*
												 * The retry is a SIBLING of the description, not a child of it:
												 * `AlertDescription` renders a `<p>`, and a button inside it is a
												 * block inside a paragraph — invalid nesting React reports and the
												 * browser silently re-parents. Both of this surface's error
												 * treatments had it.
												 *
												 * It reports its own in-flight state. Measured before this: the
												 * alert and the button were byte-identical 150ms after the press and
												 * still identical at 4.5s, while the ledger grew by one request —
												 * the hub's only recovery control looked dead (UX round 1, U1).
												 *
												 * It takes focus back when the press fails again (UX round 2, U9).
												 */}
												<div className="mt-2">
													<Button
														ref={retryRef}
														variant="outline"
														size="sm"
														onClick={() => {
															retryPressedRef.current = true;
															void refetch();
														}}
														disabled={isFetching}
														aria-busy={isFetching}
													>
														{isFetching ? "Trying…" : "Try again"}
													</Button>
												</div>
											</Alert>
										)}
									</output>
									{/*
									 * THE ORG'S OWN REFUSAL, which is a state of this surface rather than a
									 * failure of it (design §8.4: "empty/revoked states render as 'no access'
									 * per plan status, not as errors").
									 *
									 * The three frozen codes (§2.2) are what separates it from the outage arm
									 * above, and the distinction is not cosmetic: a lapsed plan is retried into
									 * the same answer, and rendering it as "The hub could not be loaded" over a
									 * Try again sends the user to do the one thing that cannot work.
									 *
									 * A `warning` rather than `danger`: nothing about the user's own agent or
									 * account is broken — an authority or a subscription outside this window is
									 * what has to change — and the accent budget has no call for an alarm here.
									 * The retry is kept for the plan arm only, where it is not empty: an owner
									 * can activate the plan on the console and come back to a page whose query is
									 * still cached, so this is the control that gets them out of the state they
									 * went to fix (the outage arm's own reasoning).
									 */}
									{!isColdLoading && orgRefusal && activeOrg && (
										<Alert
											variant="warning"
											className="max-w-2xl"
											data-testid="agent-hub-org-no-access"
										>
											<AlertTitle>
												{orgRefusal === "plan"
													? "That organization needs an active Team plan"
													: "You do not have access to that organization"}
											</AlertTitle>
											<AlertDescription>
												{orgRefusal === "plan"
													? `Sharing agents inside an organization is part of the Team plan. An owner of ${activeOrg.tenant_name || "this organization"} can activate it in the Radient console, and then its agents will be listed here.`
													: `You are not a member of ${activeOrg.tenant_name || "that organization"}, so its agents are not listed here. An owner can invite you again.`}
											</AlertDescription>
											{orgRefusal === "plan" && (
												<div className="mt-2">
													{/*
													 * `primary`, not `outline` (design round 1, D1): an outlined
													 * control's only boundary is its own edge against the alert's wash,
													 * and `borderControl` against `warningWash`/`dangerWash` is below
													 * the repo's own 3:1 non-text floor in 7 and 2 of the 59 palettes
													 * respectively — the same measurement that moved
													 * `update-error-alert`'s retry onto `primary`
													 * (`contrast-contract.mjs`, "THE FAILURE ALERT'S OWN CONTROL").
													 */}
													<Button
														variant="primary"
														size="sm"
														onClick={() => void refetch()}
														disabled={isFetching}
														aria-busy={isFetching}
													>
														{isFetching ? "Trying…" : "Try again"}
													</Button>
												</div>
											)}
										</Alert>
									)}
									{!isColdLoading && !error && (
										/*
										 * The column count comes from the room the grid actually has,
										 * not from the window. Viewport breakpoints asked for four
										 * columns at 1280 after the sidebar had already taken 264px
										 * of that 1280, which left 224px cards — narrower than the
										 * card footer needs, so the Get button was clipped off every
										 * one of them.
										 *
										 * `minmax(17.5rem,1fr)`: 17.5rem is the narrowest COLUMN, and
										 * what sets it is the footer at the count widths this hub
										 * actually serves — three five-figure counters and a labelled
										 * action on one line at 306px, with around 50px to spare.
										 *
										 * It is NOT a claim that they always fit on one line, and an
										 * earlier version of this comment said exactly that until a
										 * frame disproved it: measured on
										 * `agent-hub-page--narrow-columns` (920x900, the narrowest
										 * supported viewport, cards 292px wide, counts 1,204,583 /
										 * 121,408 / 84,903) the footer WRAPS — the card goes from
										 * 257px to 290px tall and the row pitch from 283px to 315px.
										 *
										 * That wrap is the intended degradation rather than a defect
										 * to rule out: `flex-wrap` with `ml-auto` keeps the counters
										 * whole and lands the action on the right edge beneath them.
										 * The one-line alternatives all lose information this surface
										 * exists to compare — truncating a count states a wrong
										 * number, and hiding the numbers or the action's label drops
										 * one altogether (design round 1, D5).
										 */
										<div
											className="grid grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-6"
											aria-busy={isRefreshing}
										>
											{agents.length === 0 ? (
												/*
												 * `max-w-2xl`, and centred, because the OTHER "nothing here" panel —
												 * the load-failure alert that can occupy this same slot — is capped at
												 * the same width. Two panels for the same moment, 295px apart, one of
												 * which was a full-bleed 967px slab holding two centred sentences
												 * (design round 1, D6).
												 *
												 * AN ORGANIZATION'S SCOPE KEEPS THE ROSTER'S WIDTH INSTEAD: there
												 * this panel is the grid's only child, and its company is not the
												 * load-failure alert but the Teams roster below — which spans the
												 * content column. A 672px island centred in a 968px column, with a
												 * full-width card flush beneath it, read as a panel that had lost its
												 * width (the operator's report of 2026-09-27), so here the panel takes
												 * the roster's own width. The public shapes — the ones D6 is about —
												 * keep the capped, centred form.
												 */
												<div
													data-testid="agent-hub-empty"
													className={cn(
														"col-span-full w-full flex flex-col items-center gap-2 rounded-md bg-surface px-6 py-10 text-center",
														!orgScopeId && "max-w-2xl justify-self-center",
													)}
												>
													<p className="text-heading text-ink">
														{orgScopeId
															? "This organization has no shared agents yet."
															: selectedCategory
																? `No agents in ${categoryEntry(selectedCategory).label}.`
																: hasFilters
																	? "No agents match that search."
																	: "The hub is empty."}
													</p>
													<p className="max-w-md text-body-sm text-ink-muted">
														{/*
														 * Three sentences, not two. The category miss and the text miss
														 * shared one — "Nothing here carries that filter yet" — which is
														 * written for a category a user switched to and reads wrong for a
														 * query they TYPED: nothing "carries" what they searched for
														 * (design round 1, D8a).
														 *
														 * The ORG sentence is its own because the public hub's is about
														 * publishing to the world: "Yours could be the first" invites a public
														 * publication on a surface whose rows are visible to one organization
														 * (design §8.4 keeps the two namespaces distinct).
														 */}
														{orgScopeId
															? `Agents published into ${activeOrg?.tenant_name || "this organization"} appear here for its members.`
															: selectedCategory
																? "Nothing in this category yet. Clear the filter to see the whole hub."
																: hasFilters
																	? "No agent's name or description carries that. Clear it to see the whole hub."
																	: "Nobody has published an agent yet. Yours could be the first."}
													</p>
													<div className="mt-2 flex flex-wrap items-center justify-center gap-2">
														{hasFilters ? (
															/*
															 * Focus is moved deliberately rather than left to the browser:
															 * the panel this button lives in is unmounted by the press, and
															 * the browser drops the user on `document.body`, restarting
															 * their Tab from the top of the window (UX round 1, U2).
															 *
															 * The LABEL uses the word of the control the user actually used.
															 * Both misses clear the same two fields, but the query miss is
															 * answered by the search box — whose own clear affordance sits in
															 * its edge a few pixels away — while the category miss is a
															 * filter, which is what "Clear filter" was written for (design
															 * round 2, D5).
															 */
															<Button
																variant="secondary"
																onClick={handleClearFilters}
															>
																{selectedCategory
																	? "Clear filter"
																	: "Clear search"}
															</Button>
														) : orgScopeId && !canPublishToOrg ? /*
														 * A MEMBER WHO CANNOT PUBLISH GETS NO CONTROL, rather than one the hub
														 * would refuse: publishing into an org needs admin+ (§4.4), and the
														 * sentence above already says whose job it is. `null` renders no action
														 * row at all, which is the honest shape of "there is nothing you can do
														 * here".
														 */
														null : (
															<Button
																ref={publishRef}
																variant="secondary"
																onClick={() => navigate("/agents")}
															>
																Publish an agent
															</Button>
														)}
													</div>
												</div>
											) : (
												agents.map((agent) => (
													<AgentCardContainer
														key={agent.id}
														agent={agent}
														/*
														 * Signed out, the viewer has no state to show and the batched
														 * read does not run: passing the map through unchanged would
														 * render a false "not liked" for a signed-out look at
														 * someone else's hub.
														 */
														status={
															isAuthenticated ? statuses[agent.id] : undefined
														}
														/*
														 * And signed IN, the card only claims a state the read actually
														 * answered — for this id, not just for the page: a 200 that
														 * carries fewer entries than ids leaves the ids it omits with
														 * no answer, which `isAgentStatusKnown` states as the one
														 * thing they are, `liked: false` does not.
														 */
														viewerStateKnown={
															isAuthenticated &&
															isAgentStatusKnown(
																viewerStateIsKnown,
																statuses,
																agent.id,
															)
														}
														/*
														 * The organization an org row came from, resolved through the memberships
														 * this page already read — and `null` for a public row, which has no
														 * organization to name and gets no badge.
														 */
														orgName={
															agent.visibility === "org"
																? (membershipNames.get(agent.tenant_id) ?? null)
																: null
														}
													/>
												))
											)}
										</div>
									)}
									{/*
									 * The pager, and it is absent while the list is cold: the placeholder
									 * above already holds its height, and a bar over placeholder cards would
									 * be a real control for a page count nobody knows yet. `HubPager` is the
									 * hub's own footer - see its docstring for why it is not the sidebar's
									 * `CompactPagination`.
									 */}
									{!isColdLoading &&
										pagination &&
										pagination.totalPages > 1 && (
											<HubPager
												count={pagination.totalPages}
												page={pagination.page}
												onChange={handlePageChange}
											/>
										)}
								</>
							)}
							{/*
							 * THE TEAMS VIEW (design §8.4: v1's whole team surface is a list on this
							 * page with a pull action, and no new top-level navigation).
							 *
							 * It used to be a roster BELOW the agent grid and its pager, so a reader
							 * learned teams existed by scrolling past twelve cards. It is a view of
							 * the hub now, one press from the top.
							 *
							 * ONE MOUNT, and it serves BOTH scopes: an organization's published
							 * teams read `org_teams.list` (whose refusals are the membership and plan
							 * codes, so the roster stays mounted on its own refusal arms rather than
							 * this page pretending the org has no teams), and the public catalogue
							 * reads the hub's anonymous public listing, which the old explanatory
							 * notice said did not exist (§11 O-7's premise).
							 */}
							{view === "teams" &&
								(activeOrg ? (
									<OrgTeamsList
										tenantId={activeOrg.tenant_id}
										orgName={orgName}
									/>
								) : (
									<PublicTeamsLibrary
										signedIn={isAuthenticated}
										onOpenSettings={() => navigate("/settings")}
									/>
								))}
						</div>
					</div>
				</TabPanel>
			</div>
		</div>
	);
};
