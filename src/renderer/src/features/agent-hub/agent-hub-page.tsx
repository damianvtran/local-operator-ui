import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import type { Agent } from "@shared/api/radient/types";
import { CompactPagination } from "@shared/components/common/compact-pagination";
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
} from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { cn } from "@shared/lib/utils";
import { Store } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentCardContainer } from "./components/agent-card-container";
import { AgentCategoriesSidebar } from "./components/agent-categories-sidebar";
import { categoryEntry } from "./components/agent-tags-and-categories";
import {
	isAgentStatusKnown,
	useAgentStatusesQuery,
} from "./hooks/use-agent-statuses-query";
import { useDebouncedValue } from "./hooks/use-debounced-value";
import {
	type PublicAgentSort,
	usePublicAgentsQuery,
} from "./hooks/use-public-agents-query";

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

/**
 * The placeholder card, at the SETTLED card's own geometry.
 *
 * It is a placeholder of the shape that is coming, which only works if the
 * shape is the one that arrives: the previous version drew a title and three
 * text lines and then jumped to the footer, omitting the tag row and the author
 * line that make a settled card 37px taller, so every first paint moved the
 * grid twice — the first row down, then each row growing (design round 1, D1:
 * placeholder box 220px against the settled card's 257px, row pitch 248 against
 * 283). The blocks below mirror `AgentCard`'s own: same `p-4`, same `gap-2`,
 * title, three clamped description lines, the tag row and author line where the
 * card's `mt-auto` group puts them, then the same divider above the same footer
 * with the counters and the action in their real sizes.
 *
 * Six of them, which is what a grid at the hub's narrowest supported column
 * shows; the count is a deliberate choice of its own and not this comment's
 * subject.
 */
const AgentCardSkeleton: React.FC = () => (
	<div className="flex h-full flex-col overflow-hidden rounded-lg border border-hairline bg-surface">
		<div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
			<Skeleton className="h-5 w-2/3" />
			<Skeleton className="h-3.5 w-full" />
			<Skeleton className="h-3.5 w-full" />
			<Skeleton className="h-3.5 w-1/2" />
			{/* The `mt-auto` group: tag row, then the author line. */}
			<div className="mt-auto flex flex-col gap-2 pt-2">
				<div className="flex flex-wrap items-center gap-1.5">
					<Skeleton className="h-5 w-16" />
					<Skeleton className="h-5 w-20" />
				</div>
				<Skeleton className="h-4 w-32" />
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
	});

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
	 */
	const {
		statuses,
		isKnown: viewerStateIsKnown,
		isError: viewerStateFailed,
		isFetching: viewerStateIsFetching,
		refetch: refetchViewerState,
	} = useAgentStatusesQuery({
		agentIds: agents.map((agent) => agent.id),
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

	const hasFilters = selectedCategory !== null || debouncedSearch !== "";

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
	 * Nothing to browse, so the controls cannot change anything: three filter
	 * controls over zero records crowd the one action that matters, "Publish an
	 * agent" (UX round 1, U3). A filter that IS active keeps them — else the
	 * user could not clear it — and the loading state keeps them too, so the
	 * grid does not reflow when the records land.
	 */
	const hasNothingToBrowse =
		!isColdLoading && !error && agents.length === 0 && !hasFilters;

	const handlePageChange = (newPage: number) => {
		setPage(newPage);
	};

	const handleSelectCategory = (category: string | null) => {
		setSelectedCategory(category);
		setPage(1); // Reset to first page on filter change
	};

	const handleSearchChange = (value: string) => {
		setSearchText(value);
		setPage(1); // A new query is a new result set; page 1 is where it starts
	};

	const handleScopeChange = (value: string) => {
		setSearchScope(value as (typeof SEARCH_SCOPES)[number]["value"]);
		setPage(1);
	};

	return (
		/* `gap-8`: `PageHeader` no longer ships its own bottom margin. */
		<div className="flex h-full flex-col gap-8 p-6">
			<PageHeader
				title="Agent hub"
				subtitle="Discover and download community agents on Radient"
				icon={Store}
			/>
			<div className="flex min-h-0 flex-1 flex-row overflow-hidden">
				{/* The category rail is hidden below the first grid breakpoint,
				    where the cards are already full-width. */}
				<div
					className="mr-6 hidden w-60 shrink-0 md:block"
					data-tour-tag="agent-hub-sidebar-container"
				>
					<AgentCategoriesSidebar
						selectedCategory={selectedCategory}
						onSelectCategory={handleSelectCategory}
						categories={seenCategories}
					/>
				</div>
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
					{!hasNothingToBrowse && (
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
									onChange={(event) => handleSearchChange(event.target.value)}
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
								<Select value={searchScope} onValueChange={handleScopeChange}>
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
					 */}
					<p
						aria-live="polite"
						className="mb-3 text-meta text-ink-dim"
						data-testid="agent-hub-status"
					>
						{/*
						 * The line holds its own height from the first paint. It rendered empty
						 * while loading, which is a line box less of layout — measured as the
						 * first row of cards landing 17px higher than settled (design round 1,
						 * D1) — and "Loading agents…" is also the honest thing for a reader
						 * waiting on the read.
						 */}
						{isColdLoading
							? "Loading agents…"
							: pagination
								? `${pagination.totalRecords} ${pagination.totalRecords === 1 ? "agent" : "agents"}`
								: ""}
						{/*
						 * `{" "}` rather than `ml-2` alone: the gap is a layout decision, but
						 * the SPACE is what stops the live region announcing
						 * "30 agentsUpdating" — the two spans are one sentence.
						 */}
						{isRefreshing ? <> Updating…</> : null}
					</p>
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
								Your likes and favourites could not be read, so no card shows a
								viewer state.
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
					 * `CompactPagination` is 52px tall and absent at one page, so without
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
					 */}
					{!isColdLoading && error && (
						<Alert
							variant="danger"
							className="max-w-2xl"
							aria-busy={isFetching}
							data-testid="agent-hub-error"
						>
							<AlertTitle>The hub could not be loaded</AlertTitle>
							<AlertDescription>
								{backendLoadErrorMessage(
									"The Radient agent catalogue did not answer.",
									error,
								)}
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
							 */}
							<div className="mt-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => void refetch()}
									disabled={isFetching}
									aria-busy={isFetching}
								>
									{isFetching ? "Trying…" : "Try again"}
								</Button>
							</div>
						</Alert>
					)}
					{!isColdLoading && !error && (
						/*
						 * The column count comes from the room the grid actually has,
						 * not from the window. Viewport breakpoints asked for four
						 * columns at 1280 after the sidebar had already taken 264px
						 * of that 1280, which left 224px cards — narrower than the
						 * card footer needs, so the Get button was clipped off every
						 * one of them. 17.5rem is the width at which a card footer
						 * holds three counters and a labelled action on one line.
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
								 */
								<div
									data-testid="agent-hub-empty"
									className="col-span-full w-full max-w-2xl justify-self-center flex flex-col items-center gap-2 rounded-lg border border-hairline bg-surface px-6 py-10 text-center"
								>
									<p className="text-heading text-ink">
										{selectedCategory
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
										 */}
										{selectedCategory
											? "Nothing in this category yet. Clear the filter to see the whole hub."
											: hasFilters
												? "No agent's name or description carries that. Clear it to see the whole hub."
												: "Nobody has published an agent to the hub yet. Yours would be the first one."}
									</p>
									<div className="mt-2 flex flex-wrap items-center justify-center gap-2">
										{hasFilters ? (
											/*
											 * Focus is moved deliberately rather than left to the browser:
											 * the panel this button lives in is unmounted by the press, and
											 * the browser drops the user on `document.body`, restarting
											 * their Tab from the top of the window (UX round 1, U2).
											 */
											<Button variant="secondary" onClick={handleClearFilters}>
												Clear filter
											</Button>
										) : (
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
										status={isAuthenticated ? statuses[agent.id] : undefined}
										/*
										 * And signed IN, the card only claims a state the read actually
										 * answered — for this id, not just for the page: a 200 that
										 * carries fewer entries than ids leaves the ids it omits with
										 * no answer, which `isAgentStatusKnown` states as the one
										 * thing they are, `liked: false` does not.
										 */
										viewerStateKnown={
											isAuthenticated &&
											isAgentStatusKnown(viewerStateIsKnown, statuses, agent.id)
										}
									/>
								))
							)}
						</div>
					)}
					{/*
					 * The pager, and it is absent while the list is cold: the placeholder
					 * above already holds its height, and a bar over placeholder cards would
					 * be a real control for a page count nobody knows yet.
					 */}
					{!isColdLoading && pagination && pagination.totalPages > 1 && (
						<div className="mt-6 flex justify-center">
							<CompactPagination
								count={pagination.totalPages}
								page={pagination.page}
								onChange={handlePageChange}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
