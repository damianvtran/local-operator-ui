/**
 * The Library route: page chrome, filter rail, asset grid/list and the preview
 * dock or standalone preview.
 *
 * THE SELECTED ASSET IS A ROUTE (`/library/assets/:assetId`). Whether it draws
 * beside the results or as a standalone screen is decided by MEASURED workspace
 * width (>= 1152px), never by the viewport alone: the app sidebar's width is
 * part of the budget, so a 1200px window with a 260px sidebar leaves 940px and
 * must not squeeze a 448px dock beside a 192px rail (design spec §2/§4).
 *
 * FILTER STATE LIVES IN MEMORY + SESSION STORAGE. The selected route carries
 * the current `location.search`, so Back restores the query the reader left;
 * putting every facet in the URL would make each keystroke a history entry,
 * and keeping it nowhere would lose the query on the route change selection
 * performs.
 *
 * THE GATE IS THIS SURFACE'S FIRST JOB, exactly as on Projects: a backend that
 * does not advertise `library` draws an honest sentence rather than a grid that
 * 404s. The nav row hides on the same predicate.
 */

import { openConversation } from "@features/chat/open-conversation";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Input,
	Sheet,
	SheetContent,
} from "@shared/components/ui";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { showErrorToast } from "@shared/utils/toast-manager";
import {
	ArrowDownWideNarrow,
	ArrowUpNarrowWide,
	Check,
	ChevronLeft,
	LayoutGrid,
	LibraryBig,
	List,
	RefreshCw,
	Search,
	SlidersHorizontal,
	X,
} from "lucide-react";
import type { FC } from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import {
	useLibrarianControl,
	useLibrarianStatus,
	useLibraryAsset,
	useLibraryAssets,
	useUpdateLibraryAsset,
} from "../hooks/use-library-queries";
import {
	LIBRARY_SORTS,
	type LibraryListFilters,
	NO_LIBRARY_FILTERS,
	defaultOrder,
	hasActiveFilters,
} from "../library-model";
import { LibraryGrid, LibraryGridSkeleton } from "./library-card";
import { LibraryFilterRail } from "./library-filter-rail";
import { LibraryPreview, type LibraryPreviewFocus } from "./library-preview";

const VIEW_STORAGE_KEY = "library-view";
const FILTER_STORAGE_KEY = "library-filters";

/** The dock's minimum workspace width, from the design spec's own budget. */
const DOCK_MIN_WORKSPACE_PX = 1152;
/** The rail's minimum viewport and workspace widths. */
const RAIL_MIN_VIEWPORT_PX = 1200;
const RAIL_MIN_WORKSPACE_PX = 900;

type LibraryView = "grid" | "list";

function readView(): LibraryView {
	try {
		return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
	} catch {
		return "grid";
	}
}

function readFilters(): LibraryListFilters {
	try {
		const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
		if (!raw) return NO_LIBRARY_FILTERS;
		const parsed = JSON.parse(raw) as Partial<LibraryListFilters>;
		return { ...NO_LIBRARY_FILTERS, ...parsed, q: "" };
	} catch {
		return NO_LIBRARY_FILTERS;
	}
}

function writeFilters(filters: LibraryListFilters) {
	try {
		sessionStorage.setItem(
			FILTER_STORAGE_KEY,
			JSON.stringify({ ...filters, q: "" }),
		);
	} catch {
		/* storage is not what this page is about */
	}
}

/** The library page's own width: the page root excludes the app sidebar. */
function useWorkspaceWidth() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		setWidth(node.getBoundingClientRect().width);
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setWidth(entry.contentRect.width);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	return { ref, width };
}

function useViewportWidth() {
	const [width, setWidth] = useState(() => window.innerWidth);
	useEffect(() => {
		const onResize = () => setWidth(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	return width;
}

/** The Librarian's compact status row, inside the reserved 40px header track. */
const LibrarianRow: FC<{ enabled: boolean; nowMs: number }> = ({
	enabled,
	nowMs,
}) => {
	const status = useLibrarianStatus(enabled);
	const control = useLibrarianControl();
	const navigate = useNavigate();
	const librarian = status.data;
	if (!librarian) return null;
	/*
	 * THE ROUTE CARRIES BOTH SHAPES while its status model freezes: the flat
	 * `last_run_at`/`unorganized` aliases and the structured
	 * `last_run.at`/`library.unorganized`. Read the flat field first and fall
	 * back to the structured one; never derive either from a results page.
	 */
	const lastRunAt = librarian.last_run_at ?? librarian.last_run?.at ?? null;
	const unorganized =
		librarian.unorganized ?? librarian.library?.unorganized ?? null;
	return (
		<div
			className="flex h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden text-meta text-ink-muted"
			data-library-librarian=""
		>
			<span className="font-medium text-ink">
				{t("ui.library.librarian.title")}
			</span>
			<span>
				{librarian.paused
					? t("ui.library.librarian.paused")
					: librarian.enabled
						? t("ui.library.librarian.enabled")
						: t("ui.library.librarian.disabled")}
			</span>
			<span>
				{lastRunAt
					? t("ui.library.librarian.last_organized", {
							at: relative(lastRunAt, nowMs),
						})
					: t("ui.library.librarian.never_run")}
			</span>
			{unorganized !== null && unorganized > 0 && (
				<span>
					{t("ui.library.librarian.unorganized", { count: unorganized })}
				</span>
			)}
			<div className="ml-auto flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					disabled={!librarian.enabled || control.isPending}
					onClick={() =>
						control.mutate("run", {
							onError: (error) =>
								showErrorToast(
									error instanceof Error
										? error.message
										: t("ui.library.librarian.control_failed"),
								),
						})
					}
				>
					<RefreshCw aria-hidden="true" />
					{t("ui.library.librarian.organize_now")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={!librarian.session_id || control.isPending}
					onClick={() =>
						control.mutate("open", {
							onSuccess: (next) => {
								if (next?.session_id)
									void openConversation(navigate, next.session_id);
							},
							onError: (error) =>
								showErrorToast(
									error instanceof Error
										? error.message
										: t("ui.library.librarian.control_failed"),
								),
						})
					}
				>
					{t("ui.library.librarian.open")}
				</Button>
			</div>
		</div>
	);
};

function relative(seconds: number, nowMs: number): string {
	const delta = Math.max(0, nowMs - seconds * 1000);
	const hours = Math.floor(delta / 3_600_000);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

/** A stale id: the route exists, the row does not (design spec §8). */
const UnavailableAsset: FC<{ onBack: () => void }> = ({ onBack }) => (
	<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
		<LibraryBig size={28} aria-hidden="true" className="text-ink-dim" />
		<p className="text-body text-ink">{t("ui.library.preview.unavailable")}</p>
		<p className="max-w-90 text-body-sm text-ink-muted">
			{t("ui.library.preview.unavailable_detail")}
		</p>
		<Button variant="secondary" size="sm" onClick={onBack}>
			<ChevronLeft aria-hidden="true" />
			{t("ui.library.page.back")}
		</Button>
	</div>
);

export const LibraryPage: FC<{ nowMs?: number }> = ({ nowMs }) => {
	useI18nLocale();
	const navigate = useNavigate();
	const location = useLocation();
	const params = useParams<{ assetId?: string }>();
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "library", 1);
	const clock = nowMs ?? Date.now();
	const { ref: workspaceRef, width: workspaceWidth } = useWorkspaceWidth();
	const viewportWidth = useViewportWidth();
	/*
	 * FULL VIEW IS A ROUTE FLAG, not a second screen: the same selected route and
	 * the same preview tree render, but the results and rail step aside so the
	 * document gets the workspace. A route change is deliberate - Back returns
	 * to the dock-eligible layout the reader came from - and the shared editor's
	 * buffer owner keeps an unsaved draft across the remount.
	 */
	const fullView = new URLSearchParams(location.search).get("full") === "1";
	const railVisible =
		viewportWidth >= RAIL_MIN_VIEWPORT_PX &&
		workspaceWidth >= RAIL_MIN_WORKSPACE_PX;

	const [filters, setFilters] = useState<LibraryListFilters>(readFilters);
	const [search, setSearch] = useState("");
	const debouncedSearch = useDebouncedValue(search, 200);
	const [view, setView] = useState<LibraryView>(readView);
	const [filterSheetOpen, setFilterSheetOpen] = useState(false);
	const [composerFocusSignal, setComposerFocusSignal] = useState(0);
	const [focusRequest, setFocusRequest] = useState<{
		field: LibraryPreviewFocus;
		signal: number;
	} | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const selectedId = params.assetId ?? null;
	/*
	 * The dock needs MEASURED workspace, a selection and no full-view flag; a
	 * viewport-only rule would offer 448px beside three columns at 1200px with
	 * the expanded sidebar (design spec §2).
	 */
	const dockEligible =
		workspaceWidth >= DOCK_MIN_WORKSPACE_PX && Boolean(selectedId) && !fullView;

	useEffect(() => {
		setFilters((current) =>
			current.q === debouncedSearch
				? current
				: { ...current, q: debouncedSearch },
		);
	}, [debouncedSearch]);

	useEffect(() => writeFilters(filters), [filters]);
	useEffect(() => {
		try {
			localStorage.setItem(VIEW_STORAGE_KEY, view);
		} catch {
			/* storage is not what this page is about */
		}
	}, [view]);

	const listing = useLibraryAssets(filters, enabled);
	const update = useUpdateLibraryAsset();
	const detail = useLibraryAsset(selectedId, enabled);

	const rows = useMemo(() => {
		const pages = listing.data?.pages ?? [];
		/*
		 * A CURSOR RESET REPLACES THE PAGE SET. When the catalog revision moves
		 * under a cursor, the route restarts at the top and says so; appending that
		 * page to stale ones would draw duplicates. The last page is the only one
		 * whose rows are certainly current.
		 */
		const reset = pages.length > 1 && pages.at(-1)?.cursor_reset;
		const source = reset ? [pages.at(-1)] : pages;
		const seen = new Set<string>();
		const flat: DesktopLibraryAsset[] = [];
		for (const page of source) {
			for (const row of page?.rows ?? []) {
				if (seen.has(row.id)) continue;
				seen.add(row.id);
				flat.push(row);
			}
		}
		return flat;
	}, [listing.data]);

	const lastPage = listing.data?.pages.at(-1);
	const total = lastPage?.total ?? 0;
	const selectedFromList = rows.find((row) => row.id === selectedId) ?? null;
	const selected = detail.data ?? selectedFromList;
	/*
	 * Captured OUTSIDE the conditional JSX: TanStack's `isFetchNextPageError`
	 * narrows the result union in a way TS 5.9 reads as `never` inside that
	 * branch, and the retry control would then appear to call a missing method.
	 */
	const loadMore = () => void listing.fetchNextPage();
	const selectedMissing = Boolean(
		selectedId && !selected && !detail.isLoading && detail.isError,
	);
	const standalone = Boolean(selectedId) && !dockEligible;

	const goToAsset = useCallback(
		(id: string) => {
			navigate(`/library/assets/${id}${location.search}`, {
				state: location.state,
			});
		},
		[navigate, location.search, location.state],
	);
	const goBack = useCallback(() => {
		const params = new URLSearchParams(location.search);
		params.delete("full");
		const suffix = params.toString();
		navigate(`/library${suffix ? `?${suffix}` : ""}`);
	}, [navigate, location.search]);
	/*
	 * Full view keeps the selected route and adds its flag: the same preview tree
	 * (and the same shared markdown editor, whose buffer owner holds an unsaved
	 * draft across the remount) gets the whole workspace, and Back returns to
	 * the dock-eligible layout the reader left.
	 */
	const openFullView = useCallback(() => {
		if (!selectedId) return;
		const params = new URLSearchParams(location.search);
		params.set("full", "1");
		navigate(`/library/assets/${selectedId}?${params.toString()}`);
	}, [navigate, selectedId, location.search]);

	const askAsset = useCallback(
		(asset: DesktopLibraryAsset) => {
			goToAsset(asset.id);
			setComposerFocusSignal((value) => value + 1);
		},
		[goToAsset],
	);
	const toggleFavorite = useCallback(
		(asset: DesktopLibraryAsset) => {
			update.mutate({ id: asset.id, fields: { favorite: !asset.favorite } });
		},
		[update],
	);
	const openConversationFor = useCallback(
		(sessionId: string) => void openConversation(navigate, sessionId),
		[navigate],
	);
	const filterSession = useCallback(
		(sessionId: string) => {
			setFilters((current) => ({ ...current, session: sessionId }));
			navigate("/library");
		},
		[navigate],
	);

	const actions = {
		onSelect: goToAsset,
		onAsk: askAsset,
		onEditMetadata: (asset: DesktopLibraryAsset) => {
			goToAsset(asset.id);
			setFocusRequest({ field: "metadata", signal: Date.now() });
		},
		onEditTags: (asset: DesktopLibraryAsset) => {
			goToAsset(asset.id);
			setFocusRequest({ field: "tags", signal: Date.now() });
		},
		onToggleFavorite: toggleFavorite,
		onOpenConversation: openConversationFor,
		onFilterSession: filterSession,
	};

	/*
	 * KEYBOARD: `/` and Cmd/Ctrl+F search, j/k move, Esc clear, g view toggle.
	 * The handler ignores a keystroke that started inside a text field, except
	 * the two search chords: a field that swallowed those could never be left.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const typing =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;
			if (
				(event.key === "f" && (event.metaKey || event.ctrlKey)) ||
				(event.key === "/" && !typing)
			) {
				event.preventDefault();
				searchRef.current?.focus();
				return;
			}
			if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key === "Escape") {
				if (selectedId) goBack();
				return;
			}
			if (event.key.toLowerCase() === "g") {
				event.preventDefault();
				setView((current) => (current === "grid" ? "list" : "grid"));
				return;
			}
			if (event.key.toLowerCase() === "j" || event.key.toLowerCase() === "k") {
				if (standalone || rows.length === 0) return;
				event.preventDefault();
				const index = selectedId
					? rows.findIndex((row) => row.id === selectedId)
					: -1;
				const delta = event.key.toLowerCase() === "j" ? 1 : -1;
				const next = Math.min(
					Math.max(
						index === -1 ? (delta === 1 ? 0 : rows.length - 1) : index + delta,
						0,
					),
					rows.length - 1,
				);
				goToAsset(rows[next].id);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [goBack, goToAsset, rows, selectedId, standalone]);

	if (!enabled) {
		return (
			<div className="flex h-full flex-col gap-8 p-6">
				<PageHeader title={t("ui.library.page.title")} icon={LibraryBig} />
				{capabilities.isLoading ? (
					<div className="flex justify-center py-16">
						<Spinner label={t("ui.library.page.checking")} />
					</div>
				) : (
					<Alert variant="warning">{t("ui.library.page.unavailable")}</Alert>
				)}
			</div>
		);
	}

	const rail = (
		<LibraryFilterRail
			filters={filters}
			onChange={(next) => {
				setFilters({ ...next, q: next.q });
				setSearch(next.q);
			}}
			counts={lastPage?.counts}
			tags={lastPage?.tags ?? []}
			total={total}
		/>
	);

	const empty = rows.length === 0 && !listing.isLoading;
	const matching = hasActiveFilters(filters);

	return (
		<div
			ref={workspaceRef}
			data-glass-region="canvas"
			data-glass-split=""
			className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas"
		>
			<header className="flex shrink-0 flex-col gap-1 px-6 pt-4 pb-2 min-[800px]:h-[136px]">
				<div className="flex h-12 min-w-0 items-center gap-2">
					<LibraryBig size={20} aria-hidden="true" className="text-ink-muted" />
					<h1 className="text-title text-ink">{t("ui.library.page.title")}</h1>
					<span className="ml-2 text-meta tabular-nums text-ink-dim">
						{t("ui.library.page.loaded_count", {
							loaded: String(rows.length),
							total: String(total),
						})}
					</span>
					<div className="ml-auto flex items-center rounded-sm border border-control">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-pressed={view === "grid"}
							aria-label={t("ui.library.page.grid_view")}
							onClick={() => setView("grid")}
						>
							<LayoutGrid aria-hidden="true" />
						</Button>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-pressed={view === "list"}
							aria-label={t("ui.library.page.list_view")}
							onClick={() => setView("list")}
						>
							<List aria-hidden="true" />
						</Button>
					</div>
				</div>
				<div className="flex h-12 min-w-0 items-center gap-2">
					<div className="relative min-w-60 flex-1">
						<Search
							size={14}
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-dim"
						/>
						<Input
							ref={searchRef}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") event.preventDefault();
							}}
							placeholder={t("ui.library.page.search")}
							aria-label={t("ui.library.page.search")}
							data-library-search=""
							className="pl-8"
						/>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="secondary" size="sm">
								<ArrowDownWideNarrow aria-hidden="true" />
								{t("ui.library.page.sort")}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-45">
							{LIBRARY_SORTS.map((sort) => (
								<DropdownMenuItem
									key={sort.key}
									onSelect={() =>
										setFilters((current) => ({
											...current,
											sort: sort.key,
											order: defaultOrder(sort.key),
										}))
									}
								>
									{filters.sort === sort.key ? (
										<Check aria-hidden="true" />
									) : (
										<span className="size-4" />
									)}
									<span>{t(sort.labelKey)}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.library.page.reverse_order")}
						onClick={() =>
							setFilters((current) => ({
								...current,
								order: current.order === "asc" ? "desc" : "asc",
							}))
						}
					>
						{filters.order === "asc" ? (
							<ArrowUpNarrowWide aria-hidden="true" />
						) : (
							<ArrowDownWideNarrow aria-hidden="true" />
						)}
					</Button>
					{!railVisible && (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setFilterSheetOpen(true)}
						>
							<SlidersHorizontal aria-hidden="true" />
							{t("ui.library.page.filters")}
						</Button>
					)}
				</div>
				<LibrarianRow enabled={enabled} nowMs={clock} />
				{lastPage?.state === "building" && (
					<div
						className="flex h-4 items-center gap-2 text-meta text-ink-muted"
						aria-live="polite"
					>
						<span>
							{t("ui.library.page.building", {
								scanned: String(lastPage.scan.sessions_scanned),
								total: String(lastPage.scan.sessions_total),
							})}
						</span>
					</div>
				)}
			</header>
			<div className="flex min-h-0 flex-1">
				{railVisible && (
					<aside
						data-glass-region="page-sidebar"
						aria-label={t("ui.library.page.filters")}
						className="w-48 shrink-0 overflow-hidden border-r border-hairline bg-surface"
					>
						{rail}
					</aside>
				)}
				<div className="flex min-w-0 flex-1">
					{!standalone && (
						<section
							data-glass-region="canvas-content"
							aria-label={t("ui.library.page.results")}
							aria-busy={listing.isLoading || listing.isFetching}
							className="min-w-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]"
						>
							{listing.isLoading ? (
								<LibraryGridSkeleton view={view} />
							) : listing.isError ? (
								<div className="flex flex-col items-start gap-3 py-10">
									<Alert variant="warning">
										{listing.error instanceof Error && listing.error.message
											? listing.error.message
											: t("ui.library.page.load_failed")}
									</Alert>
									<Button
										variant="secondary"
										size="sm"
										onClick={() => void listing.refetch()}
									>
										<RefreshCw aria-hidden="true" />
										{t("ui.library.page.retry")}
									</Button>
								</div>
							) : empty ? (
								<div className="flex flex-col items-center gap-3 py-16 text-center">
									<LibraryBig
										size={28}
										aria-hidden="true"
										className="text-ink-dim"
									/>
									<p className="text-body text-ink">
										{matching
											? t("ui.library.page.no_matches")
											: t("ui.library.page.empty_title")}
									</p>
									<p className="max-w-90 text-body-sm text-ink-muted">
										{matching
											? t("ui.library.page.no_matches_detail")
											: t("ui.library.page.empty_detail")}
									</p>
									{matching && (
										<Button
											variant="secondary"
											size="sm"
											onClick={() => {
												setFilters(NO_LIBRARY_FILTERS);
												setSearch("");
											}}
										>
											{t("ui.library.page.clear_all")}
										</Button>
									)}
								</div>
							) : (
								<>
									<LibraryGrid
										assets={rows}
										selectedId={selectedId}
										view={view}
										hasMore={Boolean(listing.hasNextPage)}
										loadingMore={listing.isFetchingNextPage}
										onLoadMore={loadMore}
										{...actions}
									/>
									{listing.isFetchNextPageError && (
										<div className="flex items-center gap-2 py-3 text-meta text-ink-muted">
											<span>{t("ui.library.page.load_more_failed")}</span>
											<Button variant="ghost" size="sm" onClick={loadMore}>
												{t("ui.library.page.retry")}
											</Button>
										</div>
									)}
								</>
							)}
						</section>
					)}
					{dockEligible && selected && (
						<aside
							className="flex w-[448px] shrink-0 border-l border-hairline"
							aria-label={t("ui.library.page.preview")}
						>
							<LibraryPreview
								asset={selected}
								nowMs={clock}
								onClose={goBack}
								onOpenConversation={openConversationFor}
								onFilterSession={filterSession}
								onAsk={() => setComposerFocusSignal((value) => value + 1)}
								onToggleFavorite={() => toggleFavorite(selected)}
								composerFocusSignal={composerFocusSignal}
								focusRequest={focusRequest}
								onExpand={openFullView}
							/>
						</aside>
					)}
					{standalone && (
						<div
							className="min-w-0 flex-1"
							aria-label={t("ui.library.page.preview")}
						>
							{selectedMissing ? (
								<UnavailableAsset onBack={goBack} />
							) : selected ? (
								<LibraryPreview
									asset={selected}
									nowMs={clock}
									onClose={goBack}
									onOpenConversation={openConversationFor}
									onFilterSession={filterSession}
									onAsk={() => setComposerFocusSignal((value) => value + 1)}
									onToggleFavorite={() => toggleFavorite(selected)}
									composerFocusSignal={composerFocusSignal}
									focusRequest={focusRequest}
									standalone
								/>
							) : (
								<div className="flex h-full items-center justify-center">
									<Spinner label={t("ui.library.preview.loading")} />
								</div>
							)}
						</div>
					)}
					{!standalone && !selected && dockEligible && (
						<div className="hidden w-[448px] shrink-0 items-start justify-center border-l border-hairline p-8 lg:flex">
							<p className="max-w-60 text-center text-body-sm text-ink-dim">
								{t("ui.library.page.select_asset")}
							</p>
						</div>
					)}
				</div>
			</div>

			<Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
				<SheetContent side="left" className="w-80 max-w-[calc(100vw-32px)] p-0">
					<div className="flex h-full flex-col">
						<div className="flex items-center justify-between px-4 py-3">
							<span className="text-heading text-ink">
								{t("ui.library.page.filters")}
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.library.page.close_filters")}
								onClick={() => setFilterSheetOpen(false)}
							>
								<X aria-hidden="true" />
							</Button>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto">{rail}</div>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
};
