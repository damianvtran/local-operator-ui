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
import { ResizableDivider } from "@shared/components/common/resizable-divider";
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
	LIBRARY_CATEGORIES,
	LIBRARY_SORTS,
	type LibraryListFilters,
	NO_LIBRARY_FILTERS,
	defaultOrder,
	hasActiveFilters,
	originGroupLabelKey,
} from "../library-model";
import { LibraryGrid, LibraryGridSkeleton } from "./library-card";
import { LibraryFilterRail } from "./library-filter-rail";
import { LibraryPreview, type LibraryPreviewFocus } from "./library-preview";

const VIEW_STORAGE_KEY = "library-view";
const FILTER_STORAGE_KEY = "library-filters";
const DOCK_WIDTH_STORAGE_KEY = "library-details-width";

/** The dock's minimum workspace width, from the design spec's own budget. */
const DOCK_MIN_WORKSPACE_PX = 1152;
const DOCK_DEFAULT_WIDTH_PX = 448;
const DOCK_MIN_WIDTH_PX = 320;
const DOCK_MAX_WIDTH_PX = 720;
/* Resizing may spend the surplus, never the results column's reading measure. */
const DOCK_MIN_RESULTS_PX = 320;
const FILTER_RAIL_WIDTH_PX = 192;
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

function readDockWidth(): number {
	try {
		const raw = localStorage.getItem(DOCK_WIDTH_STORAGE_KEY);
		if (!raw) return DOCK_DEFAULT_WIDTH_PX;
		const parsed = Number(raw);
		return Number.isFinite(parsed)
			? Math.min(
					DOCK_MAX_WIDTH_PX,
					Math.max(DOCK_MIN_WIDTH_PX, Math.round(parsed)),
				)
			: DOCK_DEFAULT_WIDTH_PX;
	} catch {
		return DOCK_DEFAULT_WIDTH_PX;
	}
}

function readFilters(): LibraryListFilters {
	try {
		const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
		if (!raw) return NO_LIBRARY_FILTERS;
		const parsed = JSON.parse(raw) as Partial<LibraryListFilters>;
		/*
		 * A session written before the scope existed has no `scope` key; the
		 * migration is the default itself (`final`), not a one-time rewrite, so
		 * an unknown value also falls back rather than reaching the request.
		 */
		return {
			...NO_LIBRARY_FILTERS,
			...parsed,
			scope: parsed.scope === "all" ? "all" : "final",
			q: "",
		};
	} catch {
		return NO_LIBRARY_FILTERS;
	}
}

function writeDockWidth(width: number) {
	try {
		localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(width));
	} catch {
		/* a storage refusal must not disable resizing */
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
	/*
	 * A CALLBACK REF, not a ref read in a one-shot layout effect. The page's
	 * capability gate returns before the workspace node exists on a cold mount,
	 * so an effect with `[]` measured `null` once and kept the width at 0 after
	 * the gate resolved - which is how a fresh 1440 mount rendered the narrow
	 * Filters button and a standalone preview until a resize forced a second
	 * pass. Keying the observer on the node makes the measurement attach the
	 * moment the real page renders, and re-attach if React replaces it.
	 */
	const [node, setNode] = useState<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		if (!node) return;
		setWidth(node.getBoundingClientRect().width);
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) setWidth(entry.contentRect.width);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, [node]);
	return { ref: setNode, width };
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

/**
 * The Librarian's compact status row, inside the reserved 40px header track.
 *
 * THE 40px IS A FLOOR, NOT A FIXED HEIGHT. The row wraps (`flex-wrap`) because
 * a translation can outgrow one line — ru's "Упорядочить"/"Открыть" pair plus
 * the unorganized count is 604px of content in a 536px track at the preview-dock
 * width — and a fixed `h-10` with `overflow-hidden` silently clipped the lower
 * 9.4px of both 28px buttons, leaving only 18.6px hit-testable. `min-h-10` lets
 * the wrapped second line grow the row (and the header, whose 136px is also a
 * floor), so nothing is drawn outside its own box; the track's reserved height
 * while the status loads is unchanged because one line still fills 40px.
 */
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
			className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden text-meta text-ink-muted"
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
			<div className="ms-auto flex items-center gap-1">
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

/**
 * The Librarian status row's age, as a localized fragment.
 *
 * Deliberately NOT `relativeTime`: this row has always started at the hour unit
 * (a run under an hour old reads "0h", not "just now"), and it renders in the
 * 40px header track where the shorter ladder is the contract. The thresholds,
 * the `Math.max(0, …)` clamp and the rounding are untouched; only the words are
 * translated now (`ui.library.time.hours_h_ago` / `days_d_ago`).
 */
function relative(seconds: number, nowMs: number): string {
	const delta = Math.max(0, nowMs - seconds * 1000);
	const hours = Math.floor(delta / 3_600_000);
	if (hours < 24) return t("ui.library.time.hours_h_ago", { hours });
	return t("ui.library.time.days_d_ago", {
		days: Math.floor(hours / 24),
	});
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
	/*
	 * Read the Librarian status at the page level for the scope section's
	 * catalog-wide total. It is the same query key the Librarian row uses, so
	 * React Query shares one request; the call sits above every early return
	 * because a hook may not appear on only some renders.
	 */
	const librarianStatus = useLibrarianStatus(enabled);
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
	const [dockWidthPreference, setDockWidthPreference] = useState(readDockWidth);
	const updateDockWidth = useCallback((width: number) => {
		setDockWidthPreference(width);
		writeDockWidth(width);
	}, []);
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
	const maxDockWidth = Math.max(
		DOCK_MIN_WIDTH_PX,
		Math.min(
			DOCK_MAX_WIDTH_PX,
			workspaceWidth -
				(railVisible ? FILTER_RAIL_WIDTH_PX : 0) -
				DOCK_MIN_RESULTS_PX,
		),
	);
	/* Keep the preference intact while a smaller workspace temporarily clamps it. */
	const dockWidth = Math.min(dockWidthPreference, maxDockWidth);

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
	/*
	 * The siblings the media viewer's full-screen lightbox walks: the current
	 * listing's images and clips, in display order. Display order is the page's,
	 * not the lightbox's — the strip has to read the way the grid does — and the
	 * filter drops every kind the lightbox cannot show rather than letting it
	 * walk onto a document.
	 */
	const mediaSiblings = useMemo(
		() => rows.filter((row) => row.kind === "image" || row.kind === "video"),
		[rows],
	);
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
	/*
	 * ONE PRESS PER ASSET UNTIL ITS WRITE SETTLES. The menu item and the preview
	 * heart both land here, and a double press used to compute the toggle from
	 * the SAME stale `asset.favorite` twice - two writes of the same value, and
	 * with an optimistic row the second press could be read as a flip back. The
	 * guard is per asset id rather than one global flag, because two cards are
	 * two independent toggles.
	 */
	const favoriteWrites = useRef(new Set<string>());
	const toggleFavorite = useCallback(
		(asset: DesktopLibraryAsset) => {
			if (favoriteWrites.current.has(asset.id)) return;
			favoriteWrites.current.add(asset.id);
			update.mutate(
				{ id: asset.id, fields: { favorite: !asset.favorite } },
				{
					onSettled: () => {
						favoriteWrites.current.delete(asset.id);
					},
					/*
					 * A REFUSAL MUST SAY SO, because the optimistic paint has just
					 * been rolled back and the heart's disappearance is otherwise the
					 * only trace. The toast lives HERE rather than in the mutation's
					 * `onError` so it is reported once (the hook is shared with the
					 * inline edits, which own their own error copy).
					 */
					onError: (error) => {
						showErrorToast(
							error instanceof Error && error.message
								? error.message
								: t("ui.library.preview.not_saved"),
						);
					},
				},
			);
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
			/*
			 * A MODAL OWNS ITS KEYS. The preview's media lightbox parks focus inside
			 * its dialog and Radix handles Escape there; this page's Escape would
			 * otherwise also run `goBack()` and dismiss the preview underneath the
			 * overlay (measured in the media-lightbox story: Escape closed the
			 * viewer AND navigated back to the grid). Page shortcuts resume as soon
			 * as focus is back on the page.
			 */
			if (target?.closest('[role="dialog"]')) return;
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
				/* A preview can be open from the story/selection state even when the
				 * route has not caught up; close on either, not only on the id. */
				if (selectedId || selected) goBack();
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
	}, [goBack, goToAsset, rows, selected, selectedId, standalone]);

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

	/*
	 * The scope section's "All inclusions" count is catalog-wide, and a final
	 * listing answers per-scope totals only. The Librarian status route carries
	 * the catalog-wide total independently of the page, so read it here; the
	 * row's own query is shared by key, not repeated on the wire.
	 */
	const allScopeTotal = librarianStatus.data?.library?.total ?? null;
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
			scopeTotal={allScopeTotal}
		/>
	);

	const empty = rows.length === 0 && !listing.isLoading;
	const matching = hasActiveFilters(filters) || Boolean(search.trim());

	/*
	 * THE AND IS SHOWN, NOT EXPLAINED. One chip per active narrowing; the rail
	 * applies every field together. Each chip removes only its own field; Clear
	 * all resets the narrowing and keeps the reader's sort/order.
	 */
	const activeChips = (() => {
		type Chip = { key: string; label: string; clear: () => void };
		const chips: Chip[] = [];
		if (search.trim()) {
			chips.push({
				key: "search",
				label: `${t("ui.library.page.search")}: ${search.trim()}`,
				clear: () => setSearch(""),
			});
		}
		if (filters.category) {
			const known = LIBRARY_CATEGORIES.find(
				(category) => category.key === filters.category,
			);
			chips.push({
				key: "category",
				label: known ? t(known.labelKey) : filters.category,
				clear: () =>
					setFilters((current) => ({ ...current, category: undefined })),
			});
		}
		if (filters.originGroup) {
			chips.push({
				key: "origin",
				label: t(originGroupLabelKey(filters.originGroup)),
				clear: () =>
					setFilters((current) => ({ ...current, originGroup: undefined })),
			});
		}
		if (filters.status) {
			const statusKey =
				filters.status === "highlighted"
					? "ui.library.status.highlighted"
					: filters.status === "unorganized"
						? "ui.library.status.unorganized"
						: "ui.library.status.favorites";
			chips.push({
				key: "status",
				label: t(statusKey),
				clear: () =>
					setFilters((current) => ({ ...current, status: undefined })),
			});
		}
		if (filters.highlighted && filters.status !== "highlighted") {
			chips.push({
				key: "highlighted",
				label: t("ui.library.status.highlighted"),
				clear: () =>
					setFilters((current) => ({ ...current, highlighted: false })),
			});
		}
		if (filters.tag) {
			chips.push({
				key: "tag",
				label: `${t("ui.library.filter.tags")}: ${filters.tag}`,
				clear: () => setFilters((current) => ({ ...current, tag: undefined })),
			});
		}
		if (filters.session) {
			chips.push({
				key: "session",
				label: t("ui.library.filter.one_conversation"),
				clear: () =>
					setFilters((current) => ({ ...current, session: undefined })),
			});
		}
		/*
		 * THE SCOPE IS A POPULATION, NOT A NARROWING (the rail's own rule since
		 * #1210): it is shown when the reader is on the wider population or when
		 * another chip is present, so an AND result states what it was drawn from.
		 * It is never silently reset by Clear all.
		 */
		if (filters.scope !== "final" || chips.length > 0) {
			chips.push({
				key: "scope",
				label: `${t("ui.library.filter.scope")}: ${
					filters.scope === "all"
						? t("ui.library.filter.scope_all")
						: t("ui.library.filter.scope_final")
				}`,
				clear: () => setFilters((current) => ({ ...current, scope: "final" })),
			});
		}
		return chips;
	})();

	const clearAllFilters = () => {
		setFilters((current) => ({
			...NO_LIBRARY_FILTERS,
			scope: current.scope,
			sort: current.sort,
			order: current.order,
		}));
		setSearch("");
	};
	/*
	 * The listing error text is shared by the blocking first-load state and the
	 * inline partial-data warning, so one failure reads the same in both.
	 */
	const listingErrorText =
		listing.error instanceof Error && listing.error.message
			? listing.error.message
			: t("ui.library.page.load_failed");

	return (
		<div
			ref={workspaceRef}
			data-library-page=""
			data-glass-region="canvas"
			data-glass-split=""
			/*
			 * A FULL-HEIGHT PANEL: the page owns `canvas` from y0 and its columns
			 * each pad their own content (`panel-top-pad`). `panel-flush` cancels
			 * the shell's ordinary-content pad; `flex-1` is what gives the box the
			 * 32px back at the bottom, which is the pair the utility's note states.
			 */
			className="panel-flush flex min-h-0 flex-1 overflow-hidden bg-canvas"
		>
			{/*
			 * THE RAIL RUNS THE FULL PAGE HEIGHT, as the first column of a
			 * horizontal page root. It used to sit inside the results row, so the
			 * header above it was full-width and the rail began under the search
			 * bar. The right column now owns the header and the results, which
			 * makes the rail's top line the page's top line (matching the app
			 * sidebar/canvas split) and the search bar start to its right.
			 */}
			{railVisible && !standalone && (
				<aside
					data-library-rail=""
					data-glass-region="page-sidebar"
					aria-label={t("ui.library.page.filters")}
					className="panel-top-pad flex h-full w-48 shrink-0 flex-col overflow-hidden bg-surface"
				>
					{rail}
				</aside>
			)}
			{!standalone && (
				<div
					data-glass-region="canvas-content"
					className="panel-top-pad flex min-w-0 flex-1 flex-col"
				>
					{/*
					 * THE HEADER SIZES TO ITS CONTENT, with the design's 136px as a FLOOR.
					 * A fixed `h-[136px]` held two 48px rows plus the 40px Librarian track
					 * only by ignoring the 4px row gaps and the 24px vertical padding; when
					 * the building line rendered, the remaining tracks overflowed the box and
					 * painted over the results (the flex parent had already given the header
					 * its fixed share). `min-h` keeps the reserved track from shrinking
					 * below the spec's height while every rendered row - including the
					 * building line - stays in flow and pushes the results down.
					 */}
					<header
						data-library-header=""
						className="flex shrink-0 flex-col gap-1 px-6 pt-4 pb-2 min-[800px]:min-h-[136px]"
					>
						<div className="flex h-12 min-w-0 items-center gap-2">
							<LibraryBig
								size={20}
								aria-hidden="true"
								className="text-ink-muted"
							/>
							<h1 className="text-title text-ink">
								{t("ui.library.page.title")}
							</h1>
							<span className="ms-2 text-meta tabular-nums text-ink-dim">
								{t("ui.library.page.loaded_count", {
									loaded: String(rows.length),
									total: String(total),
								})}
							</span>
							<div className="ms-auto flex items-center rounded-sm border border-control">
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
						<div
							data-library-toolbar=""
							className="flex h-12 min-w-0 items-center gap-2"
						>
							<div className="relative min-w-0 flex-1">
								<Search
									size={14}
									aria-hidden="true"
									className="pointer-events-none absolute top-1/2 start-2.5 -translate-y-1/2 text-ink-dim"
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
									className="border-0 bg-elevated ps-8"
								/>
							</div>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="sm"
										className="shrink-0 bg-elevated text-ink"
									>
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
								className="shrink-0"
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
							{!railVisible && !standalone && (
								<Button
									variant="ghost"
									size="sm"
									className="bg-elevated text-ink"
									onClick={() => setFilterSheetOpen(true)}
								>
									<SlidersHorizontal aria-hidden="true" />
									{t("ui.library.page.filters")}
								</Button>
							)}
						</div>
						{/*
						 * THE LIBRARIAN TRACK IS RESERVED WHILE ITS STATUS LOADS. The row itself
						 * renders null until the status answers, so without this wrapper the
						 * header grew by 40px when it arrived and pushed the results down. The
						 * wrapper keeps the design's track whether or not the row has content.
						 */}
						{activeChips.length > 0 && (
							<div className="flex flex-wrap items-center gap-1.5">
								{activeChips.map((chip, index) => (
									<span key={chip.key} className="contents">
										{index > 0 && (
											<span aria-hidden="true" className="text-ink-dim">
												+
											</span>
										)}
										<span className="inline-flex h-7 max-w-full items-center gap-1 rounded-sm bg-elevated px-2 text-meta text-ink-muted">
											<span className="min-w-0 truncate">{chip.label}</span>
											<button
												type="button"
												aria-label={`${t("ui.library.filter.clear_filters")} — ${chip.label}`}
												onClick={chip.clear}
												className="inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-ink-dim hover:bg-row-hover hover:text-ink"
											>
												<X size={12} aria-hidden="true" />
											</button>
										</span>
									</span>
								))}
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-1.5 text-meta"
									onClick={clearAllFilters}
								>
									{t("ui.library.page.clear_all")}
								</Button>
							</div>
						)}
						<div data-library-librarian-track="" className="min-h-10 shrink-0">
							<LibrarianRow enabled={enabled} nowMs={clock} />
						</div>
						{lastPage?.state === "building" && (
							<div
								data-library-building=""
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
						<div className="flex min-w-0 flex-1">
							{!standalone && (
								<section
									data-library-results=""
									aria-label={t("ui.library.page.results")}
									aria-busy={listing.isLoading || listing.isFetching}
									className="min-w-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]"
								>
									{listing.isLoading ? (
										<LibraryGridSkeleton view={view} />
									) : listing.isError && rows.length === 0 ? (
										<div className="flex flex-col items-start gap-3 py-10">
											<Alert variant="warning">{listingErrorText}</Alert>
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
													? `${t("ui.library.page.no_matches")}: ${activeChips
															.map((chip) => chip.label)
															.join(" + ")}`
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
													onClick={clearAllFilters}
												>
													{t("ui.library.page.clear_all")}
												</Button>
											)}
										</div>
									) : (
										<>
											{/*
											 * ERROR WITH DATA KEEPS THE PAINTED ROWS. A failed REFETCH (the
											 * desktop's own 20s deadline is one such failure) leaves the last
											 * good pages in `listing.data`; replacing them with the full-page
											 * error block erased content the reader was already using. The
											 * warning is a compact in-flow row above the grid, so it announces
											 * the failure without taking the page away. `isRefetchError`
											 * excludes a failed `fetchNextPage`; that failure has its own
											 * surface beside the load-more control, and showing both would
											 * stack two warnings and two Retry buttons.
											 */}
											{listing.isRefetchError && (
												<Alert
													variant="warning"
													role="alert"
													data-library-partial-error=""
													className="mb-3 items-center gap-2 py-2"
												>
													<div
														data-library-partial-row=""
														className="flex w-full min-w-0 items-center gap-2"
													>
														<span className="min-w-0 flex-1">
															{listingErrorText}
														</span>
														<Button
															variant="secondary"
															size="sm"
															className="shrink-0"
															onClick={() => void listing.refetch()}
														>
															<RefreshCw aria-hidden="true" />
															{t("ui.library.page.retry")}
														</Button>
													</div>
												</Alert>
											)}
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
						</div>
					</div>
				</div>
			)}

			{dockEligible && selected && (
				<>
					<ResizableDivider
						sidebarWidth={dockWidth}
						onSidebarWidthChange={updateDockWidth}
						minWidth={DOCK_MIN_WIDTH_PX}
						maxWidth={maxDockWidth}
						side="left"
						homeEnd="value"
						onDoubleClick={() => updateDockWidth(DOCK_DEFAULT_WIDTH_PX)}
						label={t("ui.library.page.resize_preview")}
					/>
					<aside
						/*
						 * THE DOCK IS A PANEL: its `surface` starts at y0 and its header and
						 * scroller begin below the strip. This is the aside the operator's
						 * screenshot caught beginning 32px down. The OUTER padded box must
						 * own the pane alpha too: marking only the inner preview made the
						 * 32px lane opaque while the content below it was translucent.
						 */
						data-library-dock=""
						data-glass-region="pane"
						style={{ width: dockWidth }}
						className="panel-top-pad flex h-full shrink-0 bg-surface"
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
							mediaSiblings={mediaSiblings}
						/>
					</aside>
				</>
			)}
			{standalone && (
				<div
					/*
					 * `bg-surface` HERE, on the padded box, and not only on
					 * `LibraryPreview`'s root: the pad is inside this wrapper, so the
					 * preview's own ground begins at y32 and a groundless wrapper let the
					 * page root's `canvas` show through the strip as a band (design round
					 * 1, D2). The panel that owns the pad owns the ground, which also
					 * grounds the spinner and `UnavailableAsset` arms.
					 */
					/* Standalone has the same outer alpha owner as the docked panel. */
					data-glass-region="pane"
					className="panel-top-pad min-w-0 flex-1 bg-surface"
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
							mediaSiblings={mediaSiblings}
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
				<>
					<ResizableDivider
						sidebarWidth={dockWidth}
						onSidebarWidthChange={updateDockWidth}
						minWidth={DOCK_MIN_WIDTH_PX}
						maxWidth={maxDockWidth}
						side="left"
						homeEnd="value"
						onDoubleClick={() => updateDockWidth(DOCK_DEFAULT_WIDTH_PX)}
						label={t("ui.library.page.resize_preview")}
					/>
					<div
						data-library-dock=""
						/* No inner preview exists here, so this root owns the whole pane. */
						data-glass-region="pane"
						style={{ width: dockWidth }}
						className="panel-top-pad hidden h-full shrink-0 items-start justify-center bg-surface p-8 lg:flex"
					>
						<p className="max-w-60 text-center text-body-sm text-ink-dim">
							{t("ui.library.page.select_asset")}
						</p>
					</div>
				</>
			)}

			<Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
				<SheetContent
					side="start"
					className="w-80 max-w-[calc(100vw-32px)] p-0"
				>
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
						<div
							data-library-filter-sheet=""
							className="min-h-0 flex-1 overflow-y-auto bg-surface"
						>
							{rail}
						</div>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
};
