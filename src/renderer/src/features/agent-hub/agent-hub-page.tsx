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
import { Store } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentCardContainer } from "./components/agent-card-container";
import { AgentCategoriesSidebar } from "./components/agent-categories-sidebar";
import { categoryEntry } from "./components/agent-tags-and-categories";
import { useAgentStatusesQuery } from "./hooks/use-agent-statuses-query";
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
 * Six placeholder cards, which is the count a grid at the hub's narrowest
 * supported width shows. It replaced a full-region spinner: a spinner says
 * "something is happening somewhere", while a placeholder of the shape that is
 * coming says what is about to be there and holds the layout still when it
 * arrives.
 */
const AgentCardSkeleton: React.FC = () => (
	<div className="flex h-full min-h-56 flex-col gap-3 rounded-lg border border-hairline bg-surface p-4">
		<Skeleton className="h-5 w-2/3" />
		<Skeleton className="h-3.5 w-full" />
		<Skeleton className="h-3.5 w-full" />
		<Skeleton className="h-3.5 w-1/2" />
		<div className="mt-auto flex items-center gap-2 pt-2">
			<Skeleton className="h-4 w-10" />
			<Skeleton className="h-4 w-10" />
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
	const { statuses } = useAgentStatusesQuery({
		agentIds: agents.map((agent) => agent.id),
	});

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
					 * The controls row. The scope selector sits with the search box
					 * rather than inside it because it changes what the box means,
					 * and it is only rendered once there is something to search:
					 * a search form over an empty catalogue is a control that
					 * cannot change anything.
					 */}
					<div className="mb-4 flex flex-wrap items-center gap-2">
						<div className="relative min-w-56 flex-1">
							<Input
								type="search"
								value={searchText}
								onChange={(event) => handleSearchChange(event.target.value)}
								placeholder={
									searchScope === "name"
										? "Search by agent name"
										: "Search descriptions"
								}
								aria-label={
									searchScope === "name"
										? "Search agents by name"
										: "Search agents by description"
								}
								data-testid="agent-hub-search"
							/>
						</div>
						<Select value={searchScope} onValueChange={handleScopeChange}>
							<SelectTrigger
								className="w-40"
								aria-label="Search field"
								data-testid="agent-hub-search-scope"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SEARCH_SCOPES.map((scope) => (
									<SelectItem key={scope.value} value={scope.value}>
										Search {scope.label.toLowerCase()}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
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
						{pagination
							? `${pagination.totalRecords} ${pagination.totalRecords === 1 ? "agent" : "agents"}`
							: ""}
						{/*
						 * `{" "}` rather than `ml-2` alone: the gap is a layout decision, but
						 * the SPACE is what stops the live region announcing
						 * "30 agentsUpdating" — the two spans are one sentence.
						 */}
						{isRefreshing ? <> Updating…</> : null}
					</p>
					{isLoading && (
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
					 * A failed read is a sentence and the control that retries it, in
					 * the surface, in the same voice the card's failed action uses. It
					 * replaces "Failed to load agents: <message>" with no next step,
					 * which left the only recovery a page reload.
					 */}
					{!isLoading && error && (
						<Alert
							variant="danger"
							className="max-w-2xl"
							data-testid="agent-hub-error"
						>
							<AlertTitle>The hub could not be loaded</AlertTitle>
							<AlertDescription>
								{error.message ||
									"The Radient agent catalogue did not answer. Try again."}
							</AlertDescription>
							{/*
							 * The retry is a SIBLING of the description, not a child of it:
							 * `AlertDescription` renders a `<p>`, and a button inside it is a
							 * block inside a paragraph — invalid nesting React reports and the
							 * browser silently re-parents. Both of this surface's error
							 * treatments had it.
							 */}
							<div className="mt-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => void refetch()}
								>
									Try again
								</Button>
							</div>
						</Alert>
					)}
					{!isLoading && !error && (
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
								<div
									data-testid="agent-hub-empty"
									className="col-span-full flex flex-col items-center gap-2 rounded-lg border border-hairline bg-surface px-6 py-10 text-center"
								>
									<p className="text-heading text-ink">
										{selectedCategory
											? `No agents in ${categoryEntry(selectedCategory).label}.`
											: hasFilters
												? "No agents match that search."
												: "The hub is empty."}
									</p>
									<p className="max-w-md text-body-sm text-ink-muted">
										{hasFilters
											? "Nothing here carries that filter yet. Clear it to see the whole hub."
											: "Nobody has published an agent to the hub yet. Yours would be the first one."}
									</p>
									<div className="mt-2 flex flex-wrap items-center justify-center gap-2">
										{hasFilters ? (
											<Button
												variant="secondary"
												onClick={() => {
													setSelectedCategory(null);
													handleSearchChange("");
													setPage(1);
												}}
											>
												Clear filter
											</Button>
										) : (
											<Button
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
										// Signed out, the viewer has no state to show and the
										// batched read does not run: passing the map through
										// unchanged would render a false "not liked" for a
										// signed-out look at someone else's hub.
										status={isAuthenticated ? statuses[agent.id] : undefined}
									/>
								))
							)}
						</div>
					)}
					{pagination && pagination.totalPages > 1 && (
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
