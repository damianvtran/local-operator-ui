/**
 * The Projects route: the tab's gate, the List view, and the two-screen shape
 * (`/projects` and `/projects/:projectId`).
 *
 * THE GATE IS THIS SURFACE'S FIRST JOB, because a destination can be reached
 * by URL and by a bookmark as well as by its nav row: a backend that does not
 * advertise `projects` (or a plane this app holds no credential for) must draw
 * an honest sentence rather than a list that 404s on its first read. The
 * sidebar row and the palette entry are hidden on the SAME predicate
 * (`desktopFeatureEnabled`), so the three surfaces cannot disagree about
 * whether Projects exist — see `sidebar-navigation.tsx` and
 * `use-palette-sources.ts` for the two that hide themselves.
 *
 * WHY THE GATE IS A SENTENCE AND NOT A REDIRECT: "Projects is not available"
 * with its cause is a fact the user can act on (update the server, or pair the
 * app), while a silent bounce to another route is the class of dead end this
 * repository's gates exist to remove.
 *
 * THE TWO SCREENS ARE ONE ROUTE ELEMENT on purpose: the list and the detail
 * share the page's own container and the feature's capability gate, and a
 * second route element would duplicate both. The detail's own reads start only
 * once the gate opens, which is what keeps a below-version backend from
 * answering with the 404 the list already knows not to ask for.
 *
 * THE SEARCH CONTROLS NARROW ALL THREE VIEWS (design §2.7): the query joins
 * the listing, the facets narrow the join, and the result is ONE derivation
 * (`visibleProjects`) every view reads — a query that applied to one view
 * would make the three disagree about what exists. Sorting is the LIST's alone
 * (the Board's order is its columns, the Timeline's is the calendar), so the
 * sort spec is applied inside `project-list.tsx`. The Board's own window stays
 * an ADDITIONAL narrowing on top of the filters — `boardVisible` — so the
 * board cannot show a row the search excluded, and its count reports matches
 * within the window rather than ignoring it (U5), in the window's own words
 * (`3 of 6 in window`, U10); when a search's matches all fall outside the
 * window, the no-match block offers the window's recovery beside Clear all
 * (R1).
 *
 * TWO SEARCH ENGINES, ONE ROW SET. The query's membership is decided by
 * exactly one engine at a time, and which one is a capability question rather
 * than a preference: a backend advertising `projects` version 2 ships the
 * derived index (`GET /v1/desktop/projects/search`), and that engine owns the
 * box — its ranked answer replaces the client matcher's rows the moment it
 * lands. A version-1 backend has no such route, so the client matcher
 * (`project-search.ts`) answers, exactly as it shipped. The client matcher is
 * ALSO the answer while the index's request is in flight or after one fails,
 * which is what keeps the list from blanking on every keystroke: the fallback
 * engine is a true answer to the same box, just an incomplete one (it cannot
 * read the detail-only update text). `searchEngine` names which engine's rows
 * are on screen, because the no-match copy has to be true of them and the two
 * engines search different fields.
 */

import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useTeamLabelFor } from "@shared/api/local-operator/profile-hooks";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button, Skeleton } from "@shared/components/ui";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { FolderKanban, Plus, RefreshCw } from "lucide-react";
import type { FC } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
	DesktopProject,
	DesktopProjectStatus,
} from "../../../../../shared/desktop-control-contract";
import {
	useCreateProject,
	useDeleteProject,
	useProjectMilestones,
	useProjectsList,
	useUpdateProject,
} from "../hooks/use-projects-queries";
import { useProjectsSearch } from "../hooks/use-projects-search";
import {
	type FilterFacetKey,
	type FilterOptionValue,
	type FilterState,
	NO_FILTERS,
	applyFilters,
	isFilterEmpty,
	toggleFilterValue,
} from "../project-filters";
import {
	type BoardWindow,
	boardWindowEmptyHeading,
	boardWindowProjects,
	projectStatusMeta,
	readBoardWindow,
	refusalCopy,
	writeBoardWindow,
} from "../project-model";
import {
	PROJECTS_SEARCH_MIN_VERSION,
	SEARCH_SUBLINE,
	projectsForHits,
	projectsSearchQuery,
	searchProjects,
} from "../project-search";
import {
	type SortSpec,
	clearAllAnnouncement,
	readProjectsSort,
	sortAnnouncement,
	writeProjectsSort,
} from "../project-sort";
import { todayUtcMs } from "../timeline-model";

/**
 * The loading skeleton's row keys. A literal list rather than `Array.from`:
 * an index used as a key is exactly what `noArrayIndexKey` exists to refuse,
 * and the skeleton is six identical rows whose only identity is their slot.
 */
const LOADING_SKELETON_ROWS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;
import { BoardWindowSelect } from "./board-window-select";
import { ProjectBoard, useMoveFocusHandoff } from "./project-board";
import { ProjectDeleteDialog } from "./project-delete-dialog";
import { ProjectDetailScreen } from "./project-detail";
import { ProjectFormDialog } from "./project-form-dialog";
import { ProjectList } from "./project-list";
import { ProjectTimeline } from "./project-timeline";
import {
	ProjectsFilterChips,
	ProjectsSearchControls,
} from "./projects-toolbar";
import {
	type ProjectsView,
	ProjectsViewSwitcher,
	readProjectsView,
	writeProjectsView,
} from "./projects-view-switcher";

/**
 * The live region's dwell, the chat sidebar's 4 s (its pin-move announcement):
 * long enough that a polite region has spoken before anything touches it,
 * short enough that the sentence cannot stand over the reader's next actions.
 */
const ANNOUNCEMENT_DWELL_MS = 4000;

const GATE_COPY: Record<string, string> = {
	unpaired:
		"This app is not paired with the Local Operator server, so Projects are unavailable.",
	"below-version":
		"The Local Operator server is older than this app expects, so Projects are unavailable. Update the server and try again.",
	unknown:
		"The server's capabilities could not be read, so Projects are unavailable.",
};

export const ProjectsPage: FC<{ nowMs?: number }> = ({
	nowMs = Date.now(),
}) => {
	const { projectId } = useParams<{ projectId?: string }>();
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	const gate = desktopFeatureState(capabilities.data, "projects", 1);
	const enabled = gate === "enabled";
	/*
	 * THE SEARCH INDEX IS A VERSION OF `projects`, not a key of its own
	 * (`routes/capabilities.py`: `"projects": 2`), because the two new reads rank
	 * over the same store the listing reads and are additive by construction: a
	 * version-1 backend is every backend that can serve the tab at all, and this
	 * app asks it for exactly what it asked before.
	 */
	const searchIndexAvailable = desktopFeatureEnabled(
		capabilities.data,
		"projects",
		PROJECTS_SEARCH_MIN_VERSION,
	);
	/*
	 * The team names the list's group headings draw (round 1, D5). The page owns
	 * the read and hands the resolver down, the same rule `nowMs` follows; the
	 * catalogue query is the one the chat sidebar already populates, so this
	 * costs a cache hit at most.
	 */
	const teamLabelFor = useTeamLabelFor(
		desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
	const list = useProjectsList(enabled);
	const create = useCreateProject();
	const update = useUpdateProject();
	const remove = useDeleteProject();
	const [createOpen, setCreateOpen] = useState(false);
	/*
	 * The view, the board's delete target, and the timeline's fan-out are
	 * declared BEFORE the gate's early returns: a hook cannot sit behind a
	 * branch, and the timeline's reads are gated by their own `enabled` flag
	 * (the same fail-closed rule the list states). The board's Edit item
	 * navigates (see the board's own props below) — the edit dialog retired
	 * with the inline-edit slice, so there is no edit target to hold here.
	 */
	const [view, setView] = useState<ProjectsView>(() => readProjectsView());
	/*
	 * The board's time window, read once at mount like the view above: the
	 * board's own preference (the List and the Timeline stay whole - their job
	 * is the sweep of everything). The session holds it after the first read,
	 * so a locked store cannot unset a choice the reader just made.
	 */
	const [boardWindow, setBoardWindow] = useState<BoardWindow>(() =>
		readBoardWindow(),
	);
	const [deleting, setDeleting] = useState<DesktopProject | null>(null);
	/*
	 * THE SEARCH CONTROLS ARE THE PAGE'S OWN STATE — the query joins the
	 * listing and the facets narrow it, so the two cannot live in either
	 * toolbar component (both the row's field and the chips row act on them).
	 * The query is plain state rather than storage (a search is a session's
	 * intent, not a preference); the filters and the sort persist through the
	 * tab's guarded layout-choice idiom, like the view and the board window.
	 */
	const [query, setQuery] = useState("");
	const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
	const [sort, setSort] = useState<SortSpec | null>(() => readProjectsSort());
	/*
	 * THE SENTENCE A SORT CHANGE OR A CLEAR FEEDS THE LIVE REGION (U15), and
	 * the shape that keeps it AUDIBLE EVERY TIME and HONEST BETWEEN TIMES
	 * (U16). A live region is read from its MUTATIONS, so three rules sit
	 * behind `announceSortText`: (1) a sentence that repeats while the region
	 * still holds it is cleared and re-set across a FRAME — two mutations, so
	 * the platform speaks it again (the chat sidebar's pin-move idiom, born
	 * of the same silence there: setting a region to the string it already
	 * holds is not a change React, the DOM or a screen reader sees); (2) the
	 * region EMPTIES on a dwell once it has had time to be read, so it does
	 * not stand over later states; (3) an action that is not itself announced
	 * — a keystroke, a facet toggle — retires it immediately, so the region
	 * never narrates a clear the reader has moved past.
	 */
	const [sortAnnouncementText, setSortAnnouncementText] = useState("");
	/** The sentence the region holds now; `""` once retired or never spoken. */
	const announcementHeldRef = useRef("");
	/** The pending clear-then-re-set frame, while a repeat is mid-flight. */
	const announcementFrameRef = useRef<number | null>(null);
	/** The dwell that retires a spoken sentence; reset by every announcement. */
	const announcementDwellRef = useRef<number | null>(null);
	const announceSortText = (sentence: string) => {
		if (announcementFrameRef.current !== null) {
			window.cancelAnimationFrame(announcementFrameRef.current);
			announcementFrameRef.current = null;
		}
		if (sentence !== "" && sentence === announcementHeldRef.current) {
			setSortAnnouncementText("");
			announcementFrameRef.current = window.requestAnimationFrame(() => {
				announcementFrameRef.current = null;
				setSortAnnouncementText(sentence);
			});
		} else {
			setSortAnnouncementText(sentence);
		}
		announcementHeldRef.current = sentence;
		if (announcementDwellRef.current !== null) {
			window.clearTimeout(announcementDwellRef.current);
		}
		announcementDwellRef.current = window.setTimeout(() => {
			announcementDwellRef.current = null;
			announcementHeldRef.current = "";
			setSortAnnouncementText("");
		}, ANNOUNCEMENT_DWELL_MS);
	};
	/** Retire the standing sentence — the unrelated-action door (U16). */
	const retireSortAnnouncement = () => {
		if (announcementFrameRef.current !== null) {
			window.cancelAnimationFrame(announcementFrameRef.current);
			announcementFrameRef.current = null;
		}
		if (announcementDwellRef.current !== null) {
			window.clearTimeout(announcementDwellRef.current);
			announcementDwellRef.current = null;
		}
		announcementHeldRef.current = "";
		setSortAnnouncementText("");
	};
	/*
	 * The doors that change search state WITHOUT announcing supersede any
	 * standing clear sentence, so they retire it: a query edit and a facet
	 * change through the two wrappers below, and the list rows' own toggle in
	 * place. The announced doors — a sort change, Clear all — never retire:
	 * their own sentence replaces the standing one in the same commit.
	 */
	const changeQuery = (next: string) => {
		setQuery(next);
		retireSortAnnouncement();
	};
	const changeFilters = (next: FilterState) => {
		setFilters(next);
		retireSortAnnouncement();
	};
	/** The page's handle for `/`, ⌘F and the no-match body's Clear all. */
	const searchFieldRef = useRef<HTMLInputElement>(null);
	/* The caret's hand-back after a status move; see `moveTo` and the hook. */
	const handOffFocus = useMoveFocusHandoff();
	const projects = list.data ?? [];
	/* The page's one day basis for the target facet's windows (UTC, the store's own). */
	const todayMs = todayUtcMs(nowMs);
	/*
	 * THE INDEX'S READ (the architecture's PR-B2), debounced and gated on the
	 * capability: asked only when this backend advertises `projects` version 2
	 * AND the page is past its own gate, and answered only for the box's current
	 * value. The client matcher below is what the page paints until it answers.
	 */
	const search = useProjectsSearch(query, enabled && searchIndexAvailable);
	/*
	 * ONE DERIVATION, THREE VIEWS (design §2.7): the query joins first — the
	 * admitted rows, in the order the serving engine ranked them — then the
	 * facets narrow, and every view below reads THIS array. The LIST is the only
	 * view that re-orders it (relevance under a query, an explicit sort
	 * otherwise), which is what "sorting is not page-wide" means in practice;
	 * the Board and the Timeline keep their own spatial order and just draw
	 * fewer objects.
	 *
	 * WHICH ENGINE WON THE JOIN is a capability, not a preference: with the
	 * index advertised the backend's ranked answer IS the join the moment it
	 * lands, and the client matcher's rows are the join while that request is in
	 * flight, after it fails, and always on a version-1 backend (no route to
	 * answer). `searchEngine` records which one produced the rows on screen,
	 * because the no-match copy below has to be TRUE of them and the two engines
	 * search different fields.
	 */
	/*
	 * THE ONE STRING BOTH ENGINES ARE ASKED: the index's request, the echo it is
	 * checked against and the FALLBACK's own ranking all take this value
	 * (`projectsSearchQuery`), so a paste longer than the route's 256-character
	 * bound cannot make the engines answer different questions — the case where
	 * the list would change when the index's answer landed, for a reason that has
	 * nothing to do with the store (review round 1, MINOR-2). `queryActive` is
	 * this string's emptiness rather than the raw box's, for the same reason.
	 */
	const asked = projectsSearchQuery(query);
	const backendRows = useMemo(
		() =>
			search.answer ? projectsForHits(projects, search.answer.projects) : null,
		[projects, search.answer],
	);
	const queryActive = asked !== "";
	const matchedProjects = useMemo(() => {
		if (!queryActive) return projects;
		return backendRows ?? searchProjects(projects, asked);
	}, [projects, asked, queryActive, backendRows]);
	const searchEngine: "backend" | "client" =
		backendRows === null ? "client" : "backend";
	const visibleProjects = useMemo(
		() => applyFilters(matchedProjects, filters, todayMs),
		[matchedProjects, filters, todayMs],
	);
	/*
	 * Whether the box is still OWED an answer by the engine that owns it: the
	 * index is advertised, a query is on, and the answer has neither landed nor
	 * failed. Every zero-result state below is held back while this is true — a
	 * "nothing matches" sentence painted a debounce before the index answers is
	 * a claim the page cannot yet make, and it would flip the moment the answer
	 * landed. The client matcher's rows are still drawn throughout, so the list
	 * never blanks.
	 */
	const searchAwaiting = searchIndexAvailable && queryActive && search.pending;
	/* Whether the toolbar's count and chips are live — its own "is a search on" predicate. */
	const searchActive = queryActive || !isFilterEmpty(filters);
	/*
	 * THE WINDOW NARROWS THE BOARD, ON TOP OF THE FILTERS (U5). `boardProjects`
	 * is the board's underlying set — every row the window admits — and is the
	 * count's DENOMINATOR; `boardVisible` is the window applied to the search
	 * and filter set, which is what the board draws and what the count counts.
	 * Keeping the two separate is what stops `12 of 74` from describing a
	 * board that shows three cards. The count also SAYS it is windowed (U10):
	 * the denominator is the window's population, so the sentence carries the
	 * word `window` rather than making a reader infer it from the control
	 * beside it (the two views can report different totals of one store).
	 */
	const boardProjects = useMemo(
		() => boardWindowProjects(projects, boardWindow, nowMs),
		[projects, boardWindow, nowMs],
	);
	const boardVisible = useMemo(
		() => boardWindowProjects(visibleProjects, boardWindow, nowMs),
		[visibleProjects, boardWindow, nowMs],
	);
	/* The empty-window heading; `null` at `all`, where the state is unreachable. */
	const boardWindowHeading = boardWindowEmptyHeading(boardWindow);
	/*
	 * The toolbar's result line, per view: the List and the Timeline report
	 * against the whole listing; the Board reports against its WINDOW (U5) —
	 * `3 of 6 in window` is the only sentence true of a board that draws six
	 * cards at most — and `null` renders nothing at all: no query and no facet
	 * means there is nothing to count, and a read that has not SUCCEEDED means
	 * the count is not known (R4: `0 of 0 projects` beside a skeleton, or
	 * beside an alert, is a number nobody has).
	 */
	const matchCount =
		view === "board" ? boardVisible.length : visibleProjects.length;
	const resultText =
		!searchActive || !list.isSuccess
			? null
			: view === "board"
				? `${boardVisible.length} of ${boardProjects.length} in window`
				: `${visibleProjects.length} of ${projects.length} projects`;
	const listReady = list.isSuccess && projects.length > 0;
	/*
	 * THE EMPTY-STATE PRECEDENCE, stated once (U5): with a search on and zero
	 * matches the NO-MATCH block wins — over the board's empty-window state
	 * included — and only with no search does an empty window get to name
	 * itself. Loading and failure render first either way: a skeleton or an
	 * error is not a search result.
	 *
	 * ONE CASE THE PRECEDENCE OWES A RECOVERY (R1): on the Board, zero matches
	 * WITHIN THE WINDOW under a search is not "nothing matches" — the window is
	 * what hid them (matches exist outside it: `visibleProjects.length > 0`),
	 * and Clear all cannot reveal them. That state offers the window's own
	 * action, `Show all time`, beneath Clear all, reusing the empty-window
	 * block's recovery path verbatim; the no-match block's own comment below
	 * states the same precedence in the copy's words.
	 */
	const noMatch =
		listReady && searchActive && matchCount === 0 && !searchAwaiting;
	/*
	 * THE INDEX OWES THE BOX AN ANSWER AND HAS DRAWN NOTHING YET: the zero-RESULT
	 * states are held back (`noMatch` above carries the same term, so the board
	 * guard below keeps its `listReady && !noMatch` shape), and this is what
	 * stands in their place. It is not a spinner over the list — the client
	 * matcher's rows are still drawn the moment it has any — it is the honest
	 * "still asking" for the one case where the FALLBACK engine also found
	 * nothing, so a reader is never told "nothing matches" by a search that has
	 * not finished.
	 */
	const searchPendingEmpty = searchAwaiting && matchCount === 0 && listReady;
	/*
	 * THE RECOVERY HANDS THE CARET BACK (UX round 1, U3). "Show all time"
	 * unmounts the button the press came from, so focus falls to the body - a
	 * keyboard reader is dropped at the top of the document with the state they
	 * just changed behind them. This is `useMoveFocusHandoff`'s shape in this
	 * same feature (it waits for the commit that mounts the target rather than
	 * reaching across renders, and retries on the next render), pointed at the
	 * window control the press just changed.
	 */
	const [handBackToWindow, setHandBackToWindow] = useState(false);
	useEffect(() => {
		if (!handBackToWindow) return;
		const node = document.querySelector<HTMLElement>(
			'[data-tour-tag="projects-board-window"]',
		);
		if (!node) return; // the next render retries
		node.focus();
		setHandBackToWindow(false);
	});
	/*
	 * `/` AND ⌘F FOCUS THE SEARCH FIELD (design §2.6). A document listener
	 * because both chords are page-scoped and there is no widget for them to
	 * live on; it stands down in an editable target, inside a dialog (a
	 * popover is one), and while any modifier rides `/` — so Escape and every
	 * printable key keep their ordinary meaning. Page-scoped on purpose: the
	 * app's other ⌘F is the chat transcript's own find and lives on another
	 * route.
	 */
	useEffect(() => {
		if (!enabled || projectId) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target || target.isContentEditable) return;
			if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
			if (target.closest('[role="dialog"]')) return;
			const slash =
				event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
			const find =
				(event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";
			if (!slash && !find) return;
			event.preventDefault();
			searchFieldRef.current?.focus();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [enabled, projectId]);
	/*
	 * THE DETAIL SCROLLER STARTS AT THE TOP ON EVERY ENTRY (UX round 1, U1;
	 * operator: "we should stay scrolled at the top when clicking in"). The list
	 * and the detail return a `div` at the same position from this component, so
	 * React REUSES one DOM node across `/projects` <-> `/projects/:projectId` —
	 * and the scroll offset is a property of that NODE, not of the route: a
	 * reader who left the detail scrolled re-opened the same project at the
	 * abandoned offset (measured: 200 / 800 / 1096), which is exactly what "land
	 * at the top" promises not to happen. A LAYOUT effect rather than a passive
	 * one so the reset lands before paint (no frame ever shows the old offset),
	 * keyed on `projectId` because entry to any project — the same one again
	 * (`undefined -> id` is a change) or a different one — is what it answers.
	 */
	const detailScrollerRef = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		if (!projectId) return;
		const scroller = detailScrollerRef.current;
		if (scroller === null) return;
		scroller.scrollTop = 0;
	}, [projectId]);
	const details = useProjectMilestones(
		view === "timeline" ? projects.map((project) => project.id) : [],
		enabled,
	);
	/*
	 * The detail reads stay keyed to the WHOLE listing (a filter change must
	 * not refetch), so the view maps the FILTERED rows back onto them by id —
	 * `details[index]` used to line up with `projects[index]`, an alignment the
	 * moment one of the two arrays is filtered it no longer has.
	 */
	const detailById = new Map(
		projects.map((project, index) => [project.id, details[index]]),
	);
	const timelineItems = visibleProjects.map((project) => ({
		project,
		milestones: detailById.get(project.id)?.data?.project.milestones ?? [],
	}));
	/*
	 * The counts describe the rows ON SCREEN: a read that belongs to a filtered-
	 * out project is not something this reader is waiting for.
	 */
	const pendingDetails =
		view === "timeline"
			? visibleProjects.filter(
					(project) => detailById.get(project.id)?.isLoading,
				).length
			: 0;
	const failedDetails =
		view === "timeline"
			? visibleProjects.filter((project) => detailById.get(project.id)?.isError)
					.length
			: 0;
	/* The retry the timeline's toolbar offers: only the reads that failed. */
	const retryDetails = () => {
		for (const query of details) {
			if (query.isError) void query.refetch();
		}
	};
	/*
	 * THE SORT'S ONE DOOR: every sort change — a column menu's radio, the sort
	 * chip's removal — writes through the guarded store and announces itself in
	 * the app's own words ("Sorted by Target, latest first." / "Sort
	 * cleared."), which is the sentence the strip's `aria-sort` cannot say for
	 * a reader who was not on the header when it changed.
	 */
	const changeSort = (next: SortSpec | null) => {
		setSort(next);
		writeProjectsSort(next);
		announceSortText(sortAnnouncement(next));
	};
	const toggleFilter = (facet: FilterFacetKey, value: FilterOptionValue) => {
		setFilters((current) => toggleFilterValue(current, facet, value));
		retireSortAnnouncement();
	};
	/* `Clear all`'s action wherever it sits: the query, every facet AND the sort
	 * (→ Default). The sort is not a facet, but leaving it out made Clear all a
	 * no-op on a chips row built from a sort alone and left the sort standing
	 * beside a facet chip (design round 2, D7); it takes the sort chip's own
	 * removal path (U6), so the live-region sentence and the persisted write
	 * match the chip exactly. */
	const clearSearchAndFilters = () => {
		const hadSearch = query.trim() !== "";
		const hadFilters = !isFilterEmpty(filters);
		const hadSort = sort !== null;
		setQuery("");
		setFilters(NO_FILTERS);
		if (sort !== null) changeSort(null);
		/* ONE sentence for what the press actually cleared (U15): the sort's
		 * own announcement would name only itself, and the query and facets
		 * cleared silently beside it. Overwrites `changeSort`'s text in the
		 * same commit, so the region speaks once. */
		announceSortText(
			clearAllAnnouncement({
				search: hadSearch,
				filters: hadFilters,
				sort: hadSort,
			}),
		);
	};
	/*
	 * THE WINDOW'S OWN RECOVERY, one implementation for its two homes (the
	 * empty-window block and the board's within-window no-match R1): widen to
	 * `all` — at both states guaranteed to fill, since every exclusion was the
	 * window's — persist it like any other window change, and hand the caret
	 * back to the control the press just changed, because the press unmounts
	 * the button it came from (the `handBackToWindow` effect above).
	 */
	const showAllTime = () => {
		setBoardWindow("all");
		writeBoardWindow("all");
		setHandBackToWindow(true);
	};
	const moveTo = (project: DesktopProject, status: string) => {
		update.mutate(
			{
				key: project.id,
				fields: { status: status as DesktopProjectStatus },
			},
			{
				onSuccess: () => {
					showSuccessToast(`Moved to ${projectStatusMeta(status).label}`);
					/*
					 * THE CARET COMES BACK AFTER THE LIST SETTLES, from here rather than
					 * from the card: the refetch re-parents the card into its new column,
					 * which DETACHES the trigger the user pressed (UX round 2, Q-2/U2 -
					 * the card-local effect restored focus to a detached node and the
					 * caret fell to `<body>`). The refetch's resolution is the settle
					 * signal, and `useMoveFocusHandoff` focuses the trigger wherever the
					 * card now lives.
					 */
					void list.refetch().then(() => handOffFocus(project.id));
				},
			},
		);
	};

	/*
	 * One clock per render, read HERE (or handed in by a story's fixture): a
	 * row's age label ("2h ago") is true of the moment it is drawn, and the
	 * listing's own refetch is what moves it on — the `schedules-page.tsx` rule
	 * for its due labels. `nowMs` is a parameter for the same reason that page
	 * states: an unpinned clock makes every committed frame churn.
	 */

	if (!enabled) {
		return (
			<div className="flex h-full flex-col gap-8 p-6">
				<PageHeader title="Projects" icon={FolderKanban} />
				{capabilities.isLoading ? (
					<div className="flex justify-center py-16">
						<Spinner label="Checking the server's Projects support" />
					</div>
				) : (
					<Alert variant="warning">
						{GATE_COPY[gate] ?? GATE_COPY.unknown}
					</Alert>
				)}
			</div>
		);
	}

	if (projectId) {
		return (
			/*
			 * THE DETAIL'S SCROLL REGION IS THE VIEW, NOT THE COLUMN (operator,
			 * 2026-09-30): the scroller used to be the 800px column itself, so its
			 * bar rode the column's edge; the mechanism this matches is chat's
			 * transcript (`canonical-transcript.tsx`) - one full-width scroller
			 * whose content is centred inside it. The gutter is reserved on BOTH
			 * edges for the same reason chat reserves it there: the column is
			 * `mx-auto`, and a one-sided reservation would centre it 4px left of
			 * the view (that file's own measurement).
			 */
			<div
				ref={detailScrollerRef}
				className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden p-6 [scrollbar-gutter:stable_both-edges]"
			>
				<ProjectDetailScreen projectKey={projectId} nowMs={nowMs} />
			</div>
		);
	}

	return (
		/*
		 * THE PAGE'S BODY IS FULL-BLEED AND THE GUTTER MOVED INSIDE THE VIEWS
		 * (operator, 2026-09-30): the root used to inset everything by 24px, so
		 * every scroll region's bar rode that inset instead of the view's own
		 * edge. The reference mechanism is chat's transcript - one full-width
		 * scroller whose content carries the padding - so here the header keeps
		 * the old gutter (`px-6 pt-6`), and each view's scroller below spans the
		 * body carrying its own padding. Strips that are NOT scrollers but align
		 * with a scrolled row restate the sum (24 + the row's own 12).
		 */
		<div className="flex h-full min-h-0 flex-col">
			{/*
			 * THE VIEW SWITCHER sits under the header rather than inside it: the
			 * switcher names the VIEW and the search cluster narrows it, two
			 * questions one row can carry at rest. The row is also the `@container`
			 * for U7's count shed below (the header block's content width IS the
			 * row's width); `data-project-search-row` is the rig's handle for
			 * measuring that row's height, the same way `data-project-count`
			 * names the count.
			 */}
			<div className="@container flex shrink-0 flex-col gap-8 px-6 pt-6">
				<PageHeader
					title="Projects"
					icon={FolderKanban}
					subtitle="Workstreams you and your agents track across sessions."
				>
					<div className="flex items-center gap-2">
						<Button
							variant="secondary"
							size="icon"
							aria-label="Refresh projects"
							title="Refresh projects"
							disabled={list.isFetching}
							onClick={() => void list.refetch()}
							data-tour-tag="refresh-projects-button"
						>
							<RefreshCw />
						</Button>
						<Button
							variant="secondary"
							onClick={() => setCreateOpen(true)}
							data-tour-tag="create-project-button"
						>
							<Plus />
							New project
						</Button>
					</div>
				</PageHeader>

				{/*
				 * THE VIEW SWITCHER sits under the header rather than inside it: the
				 * header's actions are the page's commands (refresh, new), while the
				 * switcher is a mode of the BODY — and at the app's narrowest window the
				 * two in one row would squeeze the subtitle to a stub.
				 *
				 * THE SEARCH CLUSTER JOINS THIS ROW (U1): the field, the Filters button,
				 * the result count and — on the Board — the window control share the
				 * switcher's line, so no NEW row mounts on the first keystroke; the chips
				 * row below appears only when a facet or a sort is set. `flex-wrap`
				 * carries the narrow case by wrapping the cluster under the tabs rather
				 * than squeezing either.
				 */}
				<div className="flex shrink-0 flex-col gap-2">
					<div
						className="flex flex-wrap items-center gap-3"
						data-project-search-row=""
					>
						<ProjectsViewSwitcher
							value={view}
							onChange={(next) => {
								setView(next);
								writeProjectsView(next);
							}}
						/>
						<ProjectsSearchControls
							projects={matchedProjects}
							query={query}
							onQueryChange={changeQuery}
							filters={filters}
							onFiltersChange={changeFilters}
							onClearAll={clearSearchAndFilters}
							todayMs={todayMs}
							resultText={resultText}
							/* The Board's row carries the window control, so its count waits
							 * for a wider container than the List/Timeline's (U7's measured
							 * fit boundaries; the control's default is the narrower one). */
							countRevealClass={
								view === "board" ? "@[47rem]:inline" : undefined
							}
							/* The failed read closes the Filters door (R2); the field stays
							 * enabled so the query survives the retry. */
							disabled={list.isError}
							searchFieldRef={searchFieldRef}
							trailing={
								/*
								 * The window control is the BOARD's, so it appears only where the
								 * board does: not in List/Timeline, and not over the store-empty
								 * state (whose message already sends the reader to create a project
								 * - a window over nothing has nothing to widen). It is otherwise
								 * not data-gated, so a loading or failed read still shows the
								 * reader's stored choice.
								 */
								view === "board" &&
								!(list.isSuccess && list.data.length === 0) ? (
									<BoardWindowSelect
										value={boardWindow}
										onChange={(next) => {
											setBoardWindow(next);
											writeBoardWindow(next);
										}}
									/>
								) : null
							}
						/>
					</div>
					<ProjectsFilterChips
						filters={filters}
						sort={sort}
						onFiltersChange={changeFilters}
						onSortChange={changeSort}
						onClearAll={clearSearchAndFilters}
						/* The no-match block below carries its own Clear all (U14). */
						hideClearAll={noMatch}
						searchFieldRef={searchFieldRef}
					/>
					{/*
					 * ONE POLITE LIVE REGION for sort changes (U3): `aria-sort` states the
					 * sort a reader lands on, but not the CHANGE, and a reader who was not
					 * on the header when a chip cleared the sort would otherwise learn
					 * nothing. `<output>` is this tree's own announcement element. The data
					 * attribute is what tells this region from the toolbar's count
					 * announcement (both are `output`s with `aria-live`), for a rig and for
					 * the behaviour suite.
					 */}
					<output
						data-project-announcement=""
						className="sr-only"
						aria-live="polite"
					>
						{sortAnnouncementText}
					</output>
				</div>
			</div>

			<div className="mt-8 flex min-h-0 flex-1 flex-col">
				{list.isLoading && (
					/*
					 * THE LOADING STATE WEARS THE LIST'S OWN GEOMETRY (design round 1, D1):
					 * skeleton rows in the list's column plan over the canvas - the panel
					 * the spinner sat in retired with the views' (slice 3), and a spinner
					 * cannot promise the height a row can, so the frame does not jump when
					 * rows arrive. `<output>` is the semantic status region (the mesh
					 * page's own rule), and the bars take `elevated` because on canvas the
					 * skeleton is the raised stand-in for content, not a recessed well.
					 */
					<div className="flex min-h-0 flex-1 flex-col">
						<output className="px-9 py-2 text-meta text-ink-dim">
							Loading projects…
						</output>
						{LOADING_SKELETON_ROWS.map((key) => (
							<div
								key={key}
								className="flex items-center gap-3 px-9 py-2"
								aria-hidden="true"
							>
								<Skeleton className="h-4 min-w-0 flex-1 bg-elevated" />
								<Skeleton className="h-4 w-20 shrink-0 bg-elevated" />
								<Skeleton className="h-4 w-32 shrink-0 bg-elevated" />
								<Skeleton className="h-4 w-16 shrink-0 bg-elevated" />
								<Skeleton className="h-4 w-20 shrink-0 bg-elevated" />
								<Skeleton className="h-4 w-40 shrink-0 bg-elevated" />
							</div>
						))}
					</div>
				)}

				{list.isError && (
					/*
					 * THE FAILURE OFFERS ITS OWN WAY BACK (design round 1, D5): the alert is
					 * the page's statement, and the recovery the schedules page pairs with
					 * each of its failure alerts is the same `refetch` this route already
					 * wires — the header's icon-only refresh was one tooltip away from being
					 * findable.
					 */
					<div className="flex flex-col items-start gap-2 px-6">
						<Alert variant="danger">
							{list.error instanceof Error && list.error.message
								? list.error.message
								: "The projects could not be read."}
						</Alert>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void list.refetch()}
						>
							Try again
						</Button>
					</div>
				)}

				{list.isSuccess && list.data.length === 0 && (
					/*
					 * THE EMPTY STATE IS A MESSAGE BLOCK ON THE CANVAS (design round 1, D1):
					 * the panel retired with the views' - an empty store should not keep a
					 * framed ground forever while every populated state is borderless. The
					 * height promise D3 set stays: this container is still the page's one
					 * body (`flex-1`), so nothing collapses under the message.
					 */
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
						<p className="text-heading text-ink">No projects yet.</p>
						<p className="max-w-140 text-center text-body-sm text-ink-muted">
							Create one here, or ask an agent to create one and link this
							session.
						</p>
						<Button
							variant="primary"
							onClick={() => setCreateOpen(true)}
							data-tour-tag="create-project-empty-button"
						>
							<Plus />
							New project
						</Button>
					</div>
				)}

				{searchPendingEmpty && (
					/*
					 * THE INDEX HAS NOT ANSWERED YET, AND THE FALLBACK FOUND NOTHING.
					 * Every other zero-result state is held back while `searchAwaiting` is
					 * true, so this stands in their place: it says the only thing that is true
					 * yet — the search is still running — rather than "nothing matches", which
					 * the index may be about to contradict.
					 *
					 * IT TAKES THE LOADING STATE'S OWN PLACE IN THE BODY, which is a
					 * correction (design round 1, D1) rather than the flourish the first
					 * version described. `flex-1` here means "the page's one body", the way it
					 * does for `Loading projects…` and for the other row-less states — and the
					 * first version rendered ALONGSIDE the List, which is also `flex-1`, so the
					 * two split the body between them and the List's `shrink-0` column header
					 * landed mid-canvas (measured: y 552-562 here against 191-201 in `served`
					 * and `pending`, identical in both palettes — a 361 px jump on the way to
					 * an answer, and this is the headline path: a word that lives only in
					 * update text is exactly when the fallback is empty). The List is therefore
					 * held back while this block stands, the way the Board's empty-window block
					 * is held back below: there is nothing to list, and a header promising rows
					 * that are not coming is the dangling frame, not the container's height.
					 *
					 * IT IS NOT A SPINNER OVER THE LIST. Whenever the fallback engine has rows
					 * they are drawn normally (nothing here is gated on the rows' absence), and
					 * this block is then unreachable — which is why it costs nothing at the
					 * board's ordinary scale, where the client matcher almost always has
					 * something to show within the debounce window.
					 */
					<div className="flex min-h-0 flex-1 flex-col">
						<output className="px-9 py-2 text-meta text-ink-dim">
							Searching…
						</output>
					</div>
				)}

				{listReady && noMatch && (
					/*
					 * THE NO-MATCH STATE (design §2.3 as amended): the search stays
					 * visible and editable above, this block says what happened and what
					 * to do — and its subline names the pool the SERVING ENGINE actually
					 * searched (U5/M3), so a reader whose word was not found is told which
					 * fields were read rather than concluding the project does not exist.
					 *
					 * THE SUBLINE IS THE ENGINE'S OWN (`SEARCH_SUBLINE`), and that is a
					 * correction rather than a flourish: the shipped sentence said "Update
					 * text is not searched", which is TRUE of the client matcher and FALSE
					 * the moment the index serves — the index reads `updates[]` and the
					 * progress snippet, which is the whole reason it exists (they are the
					 * largest slice of the store). One string could not be honest under
					 * both engines, so each engine carries its own, and `searchEngine`
					 * (which produced the rows on screen) selects it.
					 *
					 * PRECEDENCE, in the copy's own words: this is "within-window zero
					 * under a search" on the Board — the matches exist, the WINDOW hid
					 * them — so the window's recovery joins Clear all as the second
					 * action (R1). On the List and the Timeline the window is not a
					 * factor and one action is the honest set.
					 */
					<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
						<p className="text-heading text-ink">
							{query.trim()
								? `No projects match "${query.trim()}".`
								: "No projects match."}
						</p>
						<p className="max-w-140 text-center text-body-sm text-ink-muted">
							{query.trim()
								? SEARCH_SUBLINE[searchEngine]
								: "Try removing a filter. Clearing the filters restores the list."}
						</p>
						<div className="flex flex-col items-center gap-2">
							<Button
								variant="secondary"
								onClick={() => {
									clearSearchAndFilters();
									/* The field itself never unmounts, so the handoff is direct
									 * rather than the wait-for-commit kind: by the time the click
									 * handler returns, the node it focuses is the same node the
									 * next render shows. */
									searchFieldRef.current?.focus();
								}}
							>
								Clear all
							</Button>
							{view === "board" && visibleProjects.length > 0 && (
								/* The window, not the search, hid the matches: matches exist
								 * outside it, and this is the action that reveals them. */
								<Button variant="secondary" onClick={showAllTime}>
									Show all time
								</Button>
							)}
						</div>
					</div>
				)}

				{listReady && !noMatch && !searchPendingEmpty && view === "list" && (
					<ProjectList
						projects={visibleProjects}
						nowMs={nowMs}
						onOpen={(project) => void navigate(`/projects/${project.id}`)}
						sort={sort}
						onSortChange={changeSort}
						searchPopulation={matchedProjects}
						filters={filters}
						query={query}
						todayMs={todayMs}
						onToggleFilter={toggleFilter}
						onClearFilters={clearSearchAndFilters}
						teamLabelFor={teamLabelFor}
					/>
				)}

				{/*
				 * EDIT NAVIGATES NOW (the inline-edit slice, operator 2026-09-30):
				 * the card menu's item used to open the edit dialog, and every
				 * field is edited in place on the detail page since. It keeps
				 * `onEdit` rather than folding into `onOpen` so the two are still
				 * separate intents here — design may drop the item, and a board
				 * card menu that lands on the record it edits is the honest
				 * behaviour meanwhile.
				 */}
				{listReady &&
					!noMatch &&
					view === "board" &&
					boardVisible.length > 0 && (
						<ProjectBoard
							projects={boardVisible}
							nowMs={nowMs}
							onOpen={(project) => void navigate(`/projects/${project.id}`)}
							onEdit={(project) => void navigate(`/projects/${project.id}`)}
							onDelete={setDeleting}
							onMove={moveTo}
							teamLabelFor={teamLabelFor}
							movingKeys={
								update.isPending && update.variables
									? [update.variables.key]
									: []
							}
						/>
					)}

				{listReady &&
					!noMatch &&
					!searchPendingEmpty &&
					view === "board" &&
					boardVisible.length === 0 &&
					boardWindowHeading !== null && (
						/*
						 * THE EMPTY WINDOW IS NOT "NO PROJECTS": the store holds rows; the
						 * window just excludes all of them. So the copy names the window (the
						 * heading's phrase comes from the ladder itself), the recovery
						 * widens to `all` - the next rung can be empty too, while at this
						 * state `all` is guaranteed to fill - and the action persists like
						 * any other window change. Unreachable at `all` itself: no predicate
						 * can narrow a non-empty listing to nothing, which is why the heading
						 * is null there and this branch cannot render. It mirrors the
						 * store-empty block's idiom class for class - same container, same
						 * heading and body steps, one secondary action - and shares its
						 * action with the board's within-window no-match (R1).
						 *
						 * Also held back while the index owes the box an answer
						 * (`!searchPendingEmpty`): "the window hid them" is a claim about a
						 * search result, and there is no search result yet.
						 */
						<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
							<p className="text-heading text-ink">{boardWindowHeading}</p>
							<p className="max-w-140 text-center text-body-sm text-ink-muted">
								Older projects are hidden by the window.
							</p>
							<Button variant="secondary" onClick={showAllTime}>
								Show all time
							</Button>
						</div>
					)}

				{/*
				 * THE TIMELINE CARRIES THE SAME TERM AS THE LIST, and it did not until
				 * design round 2 (D5): this panel's root is the same
				 * `flex min-h-0 flex-1 flex-col` with a `shrink-0` strip as its first child
				 * (`project-timeline.tsx`), which is the List's own arrangement — the one
				 * that put a header at the canvas' midpoint under D1's split. `noMatch`
				 * cannot stand in for the term: it carries `!searchAwaiting`, so it is
				 * FALSE for exactly the window in which the in-flight block is up, which
				 * is how the panel came to render beside it with an empty rail under its
				 * strip. The Board needs no term of its own (its item guard already
				 * excludes the state) and its empty-window block states one explicitly, so
				 * all three views now read one idiom rather than two.
				 */}
				{listReady &&
					!noMatch &&
					!searchPendingEmpty &&
					view === "timeline" && (
						<ProjectTimeline
							items={timelineItems}
							nowMs={nowMs}
							onOpen={(item) => void navigate(`/projects/${item.project.id}`)}
							pendingDetails={pendingDetails}
							failedDetails={failedDetails}
							onRetryDetails={retryDetails}
							teamLabelFor={teamLabelFor}
						/>
					)}
			</div>

			<ProjectDeleteDialog
				open={deleting !== null}
				projectName={deleting?.name ?? ""}
				onClose={() => setDeleting(null)}
				onConfirm={async (typedName) => {
					if (!deleting) return;
					await remove.mutateAsync({
						key: deleting.id,
						confirmedName: typedName,
					});
					showSuccessToast("Project deleted");
					setDeleting(null);
				}}
			/>

			<ProjectFormDialog
				open={createOpen}
				onClose={() => setCreateOpen(false)}
				onSubmit={async (payload) => {
					const created = await create.mutateAsync(payload.fields);
					/*
					 * The toasts name the TITLE when the author gave one (UX round 1,
					 * U4): the machine key is the route's identity, not the author's —
					 * "Project S6d-ii part 2 created" reads back what was typed.
					 */
					const label = payload.followUp?.title ?? payload.fields.name;
					/*
					 * The follow-up patch carries what the create route cannot (title,
					 * owner/team, the dates, the estimate). It runs ONLY after the create
					 * landed, and a refusal here means the project EXISTS and only the
					 * extras were lost — so it leaves as an error toast naming exactly
					 * that and the way back in (UX round 1, U6), rather than the
					 * dialog's in-place sentence, which would read as "the create
					 * failed" while a resubmit would name-conflict.
					 */
					if (payload.followUp) {
						try {
							await update.mutateAsync({
								key: created.id,
								fields: payload.followUp,
							});
						} catch (error) {
							const message =
								error instanceof Error && error.message ? error.message : "";
							showErrorToast(
								`Project ${label} was created, but the extra fields were not saved: ${refusalCopy(message) || "the server refused them."} Open the project to set them in place.`,
							);
							return;
						}
					}
					showSuccessToast(`Project ${label} created`);
				}}
			/>
		</div>
	);
};
