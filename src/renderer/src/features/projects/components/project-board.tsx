/**
 * The tab's Board view: one column per status, cards of facts.
 *
 * WHAT A CARD SAYS, from the feature's own derivations rather than inline
 * formatting: the name, the meta chips `listRowMeta` already produces for the
 * list ("due Oct 15", "13 pt", "milestones 2/5", "2 live" — ONE derivation,
 * two surfaces, so a card and its list row cannot state two different facts),
 * the progress age with the stale badge, and an OVERDUE chip for a target day
 * that has passed with the work unfinished (`projectOverdue`).
 *
 * COLUMNS REORDER BY THEIR HEADER, AND NOTHING ELSE DRAGS: a card's status
 * still moves through the card menu's `Set status` action, stated in the design
 * (§V2.B.1) — the drag here is about the BOARD'S LAYOUT, which is a preference
 * the user sets by dragging a column's header, or by focusing its grip and
 * pressing the arrow keys. The order is kept between sessions under
 * `projects-board-column-order` (the `projects-view` key style: guarded reads
 * and writes, anything unusable reading as the lifecycle default). A drag arms
 * only after a few pixels of travel and only from the header, so a press on a
 * card can never reorder anything.
 *
 * THE REORDER SNAPS: no column animates to its new place (no FLIP, no
 * transition), so there is no motion to reduce for `prefers-reduced-motion`;
 * what the hand gets while dragging is the lifted column and the drop
 * indicator line in the gap the column would land in.
 *
 * COLUMNS SIZE TO THEIR CARDS AND ONE SCROLLER OWNS THE BOARD (slice 3): the
 * strip scrolls both axes — vertically when the tallest column overflows,
 * horizontally when the window is narrow — and no column keeps a scrollbar of
 * its own. The per-column wells existed to give each column its own height;
 * one scroller is what the operator asked for, and it also means a column's
 * header can pin (`top-0`) with nothing between it and the scrollport.
 *
 * COLUMNS ARE GROUPED BY TEAM, the same `groupByTeam` rule the list and the
 * timeline run: each team's cards sit under a strap pinned just below the
 * column header (`top-11`, that header's own height), so the team you are
 * reading stays named while its cards pass under, and the next strap pushes
 * the previous out — the ordinary sticky contract.
 *
 * THE LIVE CHIP IS A POPOVER, and it is the board's own door into a
 * conversation: the listing carries session COUNTS, not ids, so the popover
 * opens the project's detail read (`projects.get`, cached by react-query after
 * its first open) and lists the linked sessions — each row opens the
 * conversation through the SAME switch the detail and the sidebar use
 * (`openConversation`, the chat feature's one owner of that URL write).
 */

import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Badge, Button } from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
/*
 * THE UNION OF TWO SIDES, both of which changed this import block: the card
 * click target (`fix(projects): make the whole board card the click target`,
 * #616) brings `KeyboardEvent` for its card handler, and this branch brings
 * the grip, the pointer and layout-effect surface for the column reorder.
 * `KeyboardEvent` stays the React alias both sides use, so the grip handler
 * below reads it unaliased; aliasing it twice was the conflict's only real
 * choice and this is the one that keeps one name for one type.
 */
import { GripVertical, MoreHorizontal } from "lucide-react";
import type {
	FC,
	KeyboardEvent,
	PointerEvent as ReactPointerEvent,
} from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopProject } from "../../../../../shared/desktop-control-contract";
import { openConversation } from "../../chat/open-conversation";
import { useProjectDetail } from "../hooks/use-projects-queries";
import { useRequestProjectUpdate } from "../hooks/use-request-update";
import {
	BOARD_COLUMNS,
	BOARD_SIDE_COLUMNS,
	NO_TEAM_LABEL,
	PROGRESS_STALE_LABEL,
	boardColumns,
	boardProgressText,
	groupByTeam,
	listRowMeta,
	progressAge,
	projectDisplayName,
	projectOverdue,
	projectStatusMeta,
	projectTeamName,
	readBoardColumnOrder,
	reorderColumnOrder,
	sessionsTriggerLabel,
	writeBoardColumnOrder,
} from "../project-model";
import { todayUtcMs } from "../timeline-model";

type ProjectBoardProps = {
	projects: DesktopProject[];
	/** Read once per render by the page, the schedules page's own rule. */
	nowMs: number;
	onOpen: (project: DesktopProject) => void;
	onEdit: (project: DesktopProject) => void;
	onDelete: (project: DesktopProject) => void;
	/** The card menu's status move; the page owns the mutation. */
	onMove: (project: DesktopProject, status: string) => void;
	/** The status writes in flight, so their cards can refuse a second press. */
	movingKeys?: string[];
	/**
	 * The team's readable name for the band headers (round 1, D5 — the board
	 * draws the same human-read names the list headings do; the finding named
	 * the list, and this is the same defect on the same data). A prop, because
	 * the page owns the reads.
	 */
	teamLabelFor?: (slug: string) => string;
};

/** The column names, in the fixed order the derivation returns them in. */
const COLUMN_NOTE: Record<string, string> = {
	active: "In flight",
	paused: "On hold",
	done: "Finished",
	/* archived has no note on purpose: a note that repeats the label ("Archived
	 * Archived") is noise, not information (design round 1, D4). */
};

/**
 * WHERE THE CARET GOES AFTER A STATUS MOVE (UX round 2, Q-2/U2).
 *
 * The card cannot do this itself. A move re-parents the card into another
 * column, so React unmounts the old `li` and mounts a new one - by the time the
 * write settles, the instance that pressed the trigger is gone and its ref
 * points at a DETACHED node, which is why the round-1 card-local effect passed
 * its jsdom pin and failed in the live app: the pin never relocated the card.
 *
 * So the page owns the hand-back: after the listing refetches (the write's own
 * settle signal), it calls the returned function with the project's id, and the
 * effect below focuses the trigger wherever the card now lives - one frame
 * after the re-render that re-parented it, and only when a move actually
 * finished. It focuses nothing on mount and nothing on an unrelated render:
 * the pending id is the whole state, and it is cleared once the node is
 * focused.
 */
export function useMoveFocusHandoff(): (projectId: string) => void {
	const [pending, setPending] = useState<string | null>(null);
	useEffect(() => {
		if (!pending) return;
		const node = document.querySelector<HTMLElement>(
			`[data-project-menu="${pending}"]`,
		);
		if (!node) return; // not re-parented yet; the next render retries
		node.focus();
		setPending(null);
	});
	return useCallback((projectId: string) => setPending(projectId), []);
}

/** Pixels of travel before a press on a header becomes a drag (not a press). */
const DRAG_ARM_DISTANCE = 4;

/**
 * The move's route, stated once and said in three places: the grip's tooltip,
 * the described-by hint a screen reader reads on focus, and the live region's
 * answer to Enter/Space (UX round 1, U3 - the route used to live only in the
 * hover tooltip).
 */
const BOARD_MOVE_HINT =
	"Drag the header, or press the arrow keys, to move this column.";
const BOARD_MOVE_HINT_ID = "board-column-move-hint";

/** The live gesture: which column is in the air, and where it would land. */
type DragState = { status: string; over: number };

export const ProjectBoard: FC<ProjectBoardProps> = ({
	projects,
	nowMs,
	onOpen,
	onEdit,
	onDelete,
	onMove,
	movingKeys = [],
	teamLabelFor = (name) => name,
}) => {
	/*
	 * The order is board state, read once per mount from the guarded store the
	 * view switcher also reads, and written on every move: a failed read or
	 * write falls back to the lifecycle and never fails a reorder.
	 */
	const [order, setOrder] = useState<string[]>(readBoardColumnOrder);
	const columns = boardColumns(projects, order);
	/*
	 * THE BANDS: one per team over the WHOLE board (the same `groupByTeam` the
	 * list's sections use), so every column-cell inside a band reads from the
	 * shared `columns` derivation — one column order, one set of counts, and a
	 * team's cards in one band at one scroll point (spec §2).
	 */
	const bands = groupByTeam(projects, projectTeamName);
	const [drag, setDrag] = useState<DragState | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const stripRef = useRef<HTMLDivElement | null>(null);
	const indicatorRef = useRef<HTMLDivElement | null>(null);
	/** The pointer's last client x, read by the auto-scroll loop off-event. */
	const pointerXRef = useRef<number | null>(null);
	/** The auto-scroll loop's frame handle, null when it is not running. */
	const autoScrollRef = useRef<number | null>(null);
	const gesture = useRef<{
		pointerId: number;
		status: string;
		startX: number;
		startY: number;
		armed: boolean;
		over: number;
	} | null>(null);
	const moving = new Set(movingKeys);

	/**
	 * Move a column and say so. The order written is the order of the columns on
	 * SCREEN — a dormant stored rank is not preserved through a reorder (the
	 * merge rule's other half, see `boardColumns`).
	 */
	const commitMove = (status: string, to: number) => {
		const next = reorderColumnOrder(
			columns.map((column) => column.status),
			status,
			to,
		);
		setOrder(next);
		writeBoardColumnOrder(next);
		setAnnouncement(
			`Moved ${projectStatusMeta(status).label} column to position ${next.indexOf(status) + 1} of ${next.length}.`,
		);
	};

	/*
	 * THE DROP INDEX, from the pointer's x against the other columns' midpoints:
	 * the count of columns (the one in the air aside) whose center lies left of
	 * the pointer IS the insertion index among them. Read from live rects rather
	 * than cached layout, because the strip scrolls horizontally.
	 */
	const dropIndexAt = (clientX: number, dragged: string): number => {
		const strip = stripRef.current;
		if (!strip) return 0;
		let index = 0;
		const sections = strip.querySelectorAll<HTMLElement>("[data-board-column]");
		for (const section of sections) {
			if (section.dataset.boardColumn === dragged) continue;
			const rect = section.getBoundingClientRect();
			if (clientX > (rect.left + rect.right) / 2) index += 1;
		}
		return index;
	};

	/** Where the drop would land, in words, for the live region. */
	const dropPhrase = (dragged: string, over: number): string => {
		const others = columns.filter((column) => column.status !== dragged);
		const before = others[over - 1]?.status;
		const after = others[over]?.status;
		if (before && after)
			return `between ${projectStatusMeta(before).label} and ${projectStatusMeta(after).label}`;
		if (after) return `before ${projectStatusMeta(after).label}`;
		if (before) return `after ${projectStatusMeta(before).label}`;
		return "in place";
	};

	/**
	 * Adopt the landing a pointer x implies, if it changed. One function because
	 * THREE things refresh it: the pointer moving, the strip scrolling under a
	 * held pointer (edge auto-scroll and the wheel), and the frame loop that
	 * watches for both.
	 */
	const applyOver = (
		clientX: number,
		live: NonNullable<typeof gesture.current>,
	) => {
		const over = dropIndexAt(clientX, live.status);
		if (over === live.over) return;
		live.over = over;
		setDrag({ status: live.status, over });
		/* Announce the landing, not every pixel of travel. */
		setAnnouncement(
			`Moving ${projectStatusMeta(live.status).label} column; it will drop ${dropPhrase(live.status, over)}.`,
		);
	};

	const stopAutoScroll = () => {
		if (autoScrollRef.current === null) return;
		cancelAnimationFrame(autoScrollRef.current);
		autoScrollRef.current = null;
	};

	/**
	 * EDGE AUTO-SCROLL while a drag is armed (UX round 1, U1): at the app's own
	 * default width two of six columns can sit beyond the strip's right edge,
	 * and without this the end of the board is unreachable in one gesture - the
	 * drag lands short of where it aimed. Holding the pointer in an edge zone
	 * scrolls the strip; the landing is re-derived every frame from the live
	 * rects, so the line and the announcement track the content as it moves
	 * under the handless pointer (which is also what keeps a WHEEL scroll
	 * mid-drag honest, since no pointer event fires for it).
	 *
	 * The loop is cheap by construction: it reads rects and calls setState only
	 * when the landing actually changed, so it idles at ambient cost while the
	 * pointer sits still.
	 */
	const AUTO_SCROLL_ZONE = 32; /* px from the strip's edge */
	const AUTO_SCROLL_STEP = 12; /* px per frame at 60fps */
	const runAutoScroll = () => {
		autoScrollRef.current = null;
		const live = gesture.current;
		const strip = stripRef.current;
		const x = pointerXRef.current;
		if (!live?.armed || !strip || x === null) return;
		const rect = strip.getBoundingClientRect();
		const maxScroll = strip.scrollWidth - strip.clientWidth;
		let dir = 0;
		if (x - rect.left < AUTO_SCROLL_ZONE && strip.scrollLeft > 0) dir = -1;
		else if (rect.right - x < AUTO_SCROLL_ZONE && strip.scrollLeft < maxScroll)
			dir = 1;
		if (dir !== 0) {
			const before = strip.scrollLeft;
			strip.scrollLeft = before + dir * AUTO_SCROLL_STEP;
			if (strip.scrollLeft !== before) applyOver(x, live);
		} else {
			/* No scroll this frame; the content can still have moved (wheel). */
			applyOver(x, live);
		}
		/* Re-pin: the clamp is content-space, so a moved strip must re-place it. */
		placeIndicator(live.status, live.over);
		autoScrollRef.current = requestAnimationFrame(runAutoScroll);
	};

	/* The loop follows the gesture, not the render: it ends with the drag. */
	useEffect(
		() => () => {
			if (autoScrollRef.current !== null)
				cancelAnimationFrame(autoScrollRef.current);
		},
		[],
	);

	const onHeaderPointerDown = (
		event: ReactPointerEvent<HTMLElement>,
		status: string,
	) => {
		if (event.button !== 0) return;
		/*
		 * Pointer capture keeps every move aimed at this header even when the
		 * pointer leaves it. Guarded because a synthetic pointer (a story's
		 * `userEvent`) owns no active pointer and `setPointerCapture` throws
		 * `InvalidPointerId` for one — the mesh canvas's rule.
		 */
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			/* synthetic pointer: the dispatched moves still arrive here */
		}
		gesture.current = {
			pointerId: event.pointerId,
			status,
			startX: event.clientX,
			startY: event.clientY,
			armed: false,
			over: columns.findIndex((column) => column.status === status),
		};
		pointerXRef.current = event.clientX;
	};

	const onHeaderPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const live = gesture.current;
		if (!live || event.pointerId !== live.pointerId) return;
		pointerXRef.current = event.clientX;
		if (!live.armed) {
			const travel = Math.hypot(
				event.clientX - live.startX,
				event.clientY - live.startY,
			);
			if (travel < DRAG_ARM_DISTANCE) return;
			live.armed = true;
			setDrag({ status: live.status, over: live.over });
			setAnnouncement(`Moving ${projectStatusMeta(live.status).label} column.`);
			if (autoScrollRef.current === null)
				autoScrollRef.current = requestAnimationFrame(runAutoScroll);
		}
		applyOver(event.clientX, live);
	};

	/**
	 * End the gesture. Two no-op outcomes are stated rather than implied:
	 *
	 * - A CANCEL (Escape, pointercancel) says so, so "Moving …" does not linger
	 *   in the live region (UX round 1, Q-2) - and only when the gesture had
	 *   actually armed, because a sub-threshold press never announced anything.
	 * - A DROP THAT LANDS WHERE IT STARTED skips the commit entirely (review
	 *   round 1, R1-3): writing the on-screen order for a move nobody made
	 *   would rewrite the store for nothing - and silently drop the stored
	 *   rank of a dormant column the user never touched - and announcing a
	 *   move for it would be a lie. The region is left empty, which is
	 *   "nothing happened" (UX round 1, U5).
	 */
	const settleDrag = (commit: boolean) => {
		const live = gesture.current;
		gesture.current = null;
		stopAutoScroll();
		setDrag(null);
		if (!live?.armed) return;
		if (!commit) {
			setAnnouncement("Move cancelled.");
			return;
		}
		const from = columns.findIndex((column) => column.status === live.status);
		if (live.over === from) {
			setAnnouncement("");
			return;
		}
		commitMove(live.status, live.over);
	};

	const onHeaderPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
		const live = gesture.current;
		if (!live || event.pointerId !== live.pointerId) return;
		settleDrag(true);
	};

	const onHeaderPointerCancel = () => {
		/*
		 * A cancelled pointer ENDS a drag, it does not settle it (the mesh
		 * canvas's rule): the browser took the gesture away mid-air, and settling
		 * a position nobody released would move a column the user did not drop.
		 */
		settleDrag(false);
	};

	/* Escape cancels, the one gesture state with no pointer of its own. */
	// biome-ignore lint/correctness/useExhaustiveDependencies: gated on the drag state, not on the per-render closures it calls.
	useEffect(() => {
		if (!drag) return;
		/*
		 * A WINDOW listener takes the DOM's own keydown type, not the React
		 * alias this file imports for its JSX handlers: the union with #616
		 * gave the plain name to React's synthetic event, so the global one is
		 * named through `WindowEventMap` rather than shadowed twice.
		 */
		const onKeyDown = (event: WindowEventMap["keydown"]) => {
			if (event.key !== "Escape") return;
			settleDrag(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [drag !== null]);

	/*
	 * The indicator's x is measured AFTER the render that moves it (the rects
	 * must be the ones on screen): the line sits in the gap the column would
	 * land in, half a strip gap off the neighbouring column's edge.
	 */
	/**
	 * Place the line in the gap the drag would land in. A plain function rather
	 * than only an effect body because TWO clocks place it: the render that
	 * moves the landing, and every frame of the auto-scroll loop - the clamp
	 * pins the line to the visible edge in CONTENT coordinates, so a strip that
	 * keeps scrolling under a settled landing would otherwise drift the line
	 * away from the edge it was pinned to (measured while fixing UX round 1:
	 * the line ended 109px left of the gap after the auto-scroll ran its course).
	 */
	const placeIndicator = useCallback((status: string, over: number) => {
		const strip = stripRef.current;
		const line = indicatorRef.current;
		if (!strip || !line) return;
		const stripRect = strip.getBoundingClientRect();
		const others: DOMRect[] = [];
		for (const section of strip.querySelectorAll<HTMLElement>(
			"[data-board-column]",
		)) {
			if (section.dataset.boardColumn !== status) {
				others.push(section.getBoundingClientRect());
			}
		}
		const HALF_GAP = 6; /* half of the strip's `gap-3` (12px) */
		const edge =
			over >= others.length
				? (others[others.length - 1]?.right ?? stripRect.left) + HALF_GAP
				: (others[over]?.left ?? stripRect.right) - HALF_GAP;
		/*
		 * SCROLL-AWARE, AND CLAMPED TO THE VISIBLE STRIP. The line is a child of
		 * the scroll container, so its `left` is in CONTENT coordinates while
		 * `edge` is measured in client ones: without the scroll term the line sits
		 * exactly `scrollLeft` px left of the gap it names (UX round 1, U2 - the
		 * offset was subtracted twice). The clamp keeps a legal landing visible
		 * when its gap lies outside the strip - the narrow-window case design
		 * round 1 (D2) measured, where an unclamped line renders past the clip
		 * and paints nothing at the moment the preview matters most.
		 */
		const scroll = strip.scrollLeft;
		const LINE_WIDTH = 2; /* `w-0.5` */
		const raw = edge - stripRect.left + scroll;
		const minX = scroll + 1;
		const maxX = scroll + stripRect.width - LINE_WIDTH - 1;
		const clamped = Math.round(
			Math.min(Math.max(raw, minX), Math.max(minX, maxX)),
		);
		line.style.left = `${clamped}px`;
	}, []);

	/* The landing moves, the line moves with it; the loop below re-pins it while the strip itself moves. */
	useLayoutEffect(() => {
		if (!drag) return;
		placeIndicator(drag.status, drag.over);
	}, [drag, placeIndicator]);

	const onGripKeyDown = (event: KeyboardEvent<HTMLElement>, status: string) => {
		/*
		 * ENTER/SPACE: the grip is a HANDLE, not a command, so its standard
		 * activation has no action to run - and silently ignoring the keys a
		 * focused button answers to is what UX round 1 (U3) flagged. The
		 * response is the route itself, spoken through the board's live region;
		 * the same sentence `aria-describedby` gives the screen reader on focus.
		 */
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			setAnnouncement(BOARD_MOVE_HINT);
			return;
		}
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const statuses = columns.map((column) => column.status);
		const from = statuses.indexOf(status);
		const to = event.key === "ArrowLeft" ? from - 1 : from + 1;
		if (to < 0 || to >= statuses.length) {
			setAnnouncement(
				`${projectStatusMeta(status).label} column is already ${to < 0 ? "the first column" : "the last column"}.`,
			);
			return;
		}
		commitMove(status, to);
	};

	return (
		<div
			/*
			 * NO FRAME GROUND (slice 3): the columns are the board's structure now,
			 * the way the detail sheet runs — a panel holding wells holding cards
			 * stacked the same 10px radius twice on one view, which is the nesting
			 * the operator's re-skin retires. The columns keep the canvas behind
			 * them, so the well→card step is the ground ladder a board needs.
			 */
			className="[container-type:size] flex min-h-0 flex-1 flex-col"
			data-testid="project-board"
		>
			{/*
			 * THE MOVE IS ANNOUNCED HERE, the board's one live region: a reorder
			 * changes pixels a screen reader cannot see, and the drag's would-be
			 * landing is the part a pointer user reads off the indicator line.
			 */}
			<output
				aria-live="polite"
				className="sr-only"
				data-board-column-announcement=""
			>
				{announcement}
			</output>
			{/*
			 * THE ROUTE, STATED WHERE FOCUS LANDS (UX round 1, U3): the grip's
			 * `title` is hover-only, so the hint is also a described-by target - a
			 * screen reader reads it when the grip takes focus, and the grip's
			 * Enter/Space answer speaks the same sentence through the live region.
			 */}
			<span id={BOARD_MOVE_HINT_ID} className="sr-only">
				{BOARD_MOVE_HINT}
			</span>
			<div
				ref={stripRef}
				data-board-strip=""
				className={cn(
					/*
					 * ONE SCROLLER FOR THE BOARD, BOTH AXES: the strip is the surface's own
					 * scroller (horizontal always, vertical over the sections); the columns
					 * inside a section get their own bounded vertical scrollers under the
					 * operator's section cap, not the board's.
					 *
					 * `items-start` IS LOAD-BEARING (design round 2, D2 = QA round 1, Q2):
					 * without it the strip's single child stretches to the strip's own
					 * client height, so the inner column's box ends after one screen and
					 * every sticky inside it - the column row included - scrolls out of
					 * range (measured as a row offset of -94.3px on a 6289px board). The
					 * child must stay content-height for the sticky chain to hold to the
					 * end of the scroll.
					 *
					 * NO TOP PADDING (round 1, Q2/U2): the column header pins at
					 * `top-0`, and with `pt-3` the scrollport's own top edge sat 12px
					 * above it — a live band where passing cards slid above the pinned
					 * header (the QA hit-test read the header at rel 12 while a card
					 * was live at rel 2.7). The strip's padding now starts at its sides
					 * and bottom, and the header pins flush to the edge it pins to.
					 *
					 * AND THE SIDES ARE THE PAGE GUTTER, FLUSH WITH THE TITLE (operator,
					 * 2026-09-30, board-first feedback): the board's left edge lines up with
					 * the line the title block and the tab row begin on - and with the
					 * app's other pages' boxes, measured at x=24 like the schedules page's
					 * own rows - so the strip carries `px-6`: the 24px gutter exactly,
					 * NOT the 24+12 the strips carried while the page still inset this
					 * region. (The strip's scrollbars ride the VIEW's own edges the way
					 * chat's transcript does; the padding moves content, not the bar.)
					 * The right gutter is the same 24 once the board is scrolled
					 * to its end, and the bottom keeps `pb-9` (24 + 12): nothing aligns
					 * below the last row, and the extra step is the tail the grid had
					 * before the full-bleed change. The pinned offsets above are written
					 * against the strip itself, so none of them moves.
					 */
					"relative flex min-h-0 flex-1 items-start overflow-auto px-6 pb-9",
					drag && "cursor-grabbing select-none",
				)}
			>
				{drag && (
					<div
						ref={indicatorRef}
						aria-hidden="true"
						data-board-drop-indicator=""
						className="pointer-events-none absolute top-3 bottom-3 w-0.5 rounded-full bg-accent"
					/>
				)}
				{/*
				 * THE BOARD IS BANDS OF COLUMNS (the operator's ask, spec §2/§3): one
				 * full-width header row pins at `top-0`, and beneath it each TEAM is a
				 * band whose own header pins at `top-11` — so the two sticky layers
				 * stay the same two constants, and the outgoing band header leaves as
				 * the incoming one docks (at most one in the slot, naming the band
				 * whose cards are passing under it).
				 *
				 * WHY THE COLUMN HEADERS MOVED INTO ONE ROW: with the team dimension
				 * promoted to full-width bands, a column is a position, not a box —
				 * its header belongs to the row every band shares, and its cards live
				 * in one cell per band. The drag-reorder hooks (`data-board-column`,
				 * `data-board-column-handle`) stay on these cells, so the reorder
				 * still measures the columns' live rects — which are the same rects
				 * the row has always painted.
				 */}
				<div className="flex w-max flex-col">
					<div className="sticky top-0 z-30 flex gap-3">
						{columns.map((column) => {
							const meta = projectStatusMeta(column.status);
							return (
								<header
									key={column.status}
									data-board-column={column.status}
									/*
									 * The cell PINS as part of its row (the row is the sticky layer),
									 * and its height is the fixed 44 (`h-11`) the band headers' `top-11`
									 * offset is written against — the two constants stay one fact
									 * written twice. The radius matches the well's so the corners do
									 * not square off.
									 */
									data-board-column-handle={column.status}
									onPointerDown={(event) =>
										onHeaderPointerDown(event, column.status)
									}
									onPointerMove={onHeaderPointerMove}
									onPointerUp={onHeaderPointerUp}
									onPointerCancel={onHeaderPointerCancel}
									className={cn(
										"flex h-11 w-64 shrink-0 cursor-grab items-center justify-between gap-2 rounded-t-md bg-sunken px-3 active:cursor-grabbing",
										drag?.status === column.status && "opacity-85",
									)}
								>
									<span className="flex min-w-0 flex-1 items-center gap-1.5">
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											data-board-column-grip={column.status}
											aria-label={`Move ${meta.label} column`}
											aria-describedby={BOARD_MOVE_HINT_ID}
											title={BOARD_MOVE_HINT}
											className="-ml-1.5 cursor-grab text-ink-muted active:cursor-grabbing"
											onKeyDown={(event) => onGripKeyDown(event, column.status)}
										>
											<GripVertical aria-hidden="true" />
										</Button>
										<span className="flex min-w-0 items-baseline gap-2">
											<span className="truncate text-body-sm font-medium text-ink">
												{meta.label}
											</span>
											{COLUMN_NOTE[column.status] && (
												<span className="truncate text-meta text-ink-muted">
													{COLUMN_NOTE[column.status]}
												</span>
											)}
										</span>
									</span>
									<span className="text-meta text-ink-muted">
										{column.projects.length}
									</span>
								</header>
							);
						})}
					</div>
					{bands.map((band) => (
						<section key={band.team ?? ""} className="flex flex-col">
							{/*
							 * THE BAND HEADER = the list's section header, fixed at 32 (`h-8`)
							 * so the offset below the column row stays a single constant. It is
							 * sticky WITHIN ITS OWN BAND's box, which is what makes the handoff
							 * continuous: bands are stacked flush, so the outgoing header
							 * leaves exactly as the incoming one docks.
							 *
							 * NAME AND COUNT ARE ONE STICKY UNIT (design round 1, D1): the count
							 * rides INSIDE the stuck span so h-scrolling cannot strand it
							 * off-viewport, and with a clamped long name the clamp's right edge
							 * falls after the count instead of on top of the name's glyphs.
							 * The span sticks LEFT while the band is h-scrolled (the board root
							 * is a SIZE container — `cqw`/`cqh` are the scrollport's own
							 * dimensions): the team stays readable without clipping at the
							 * window edge.
							 */}
							<div
								data-board-team={band.team ?? ""}
								className="sticky top-11 z-20 flex h-8 items-center bg-canvas px-3 text-meta"
							>
								<span className="sticky left-3 flex min-w-0 max-w-[calc(100cqw-2.25rem)] items-center gap-2">
									<span className="truncate text-ink">
										{band.team == null
											? NO_TEAM_LABEL
											: teamLabelFor(band.team)}
									</span>
									<span className="shrink-0 text-ink-muted">
										{band.items.length}
									</span>
								</span>
							</div>
							{/*
							 * NO EMPTY-BAND SHAPE SHIPS HERE (design round 2, D4): an earlier draft
							 * drew a flat line for a team with no tickets, but `groupByTeam`
							 * omits empty groups by its own rule, so no team without tickets ever
							 * reaches this map and the state is unrenderable - a branch nothing
							 * can exercise is dead code, not a guard. The operator's "no empty
							 * column space for a team with no tickets" is satisfied by the
							 * omission itself: a zero-ticket team is not a section at all.
							 *
							 * THE WELL IS CAPPED AT ONE SCREEN (operator refinement): the section
							 * never grows past the board viewport - every CELL is its own
							 * bounded vertical scroller (`max-h` = one screen minus the pinned
							 * row and this band's header, `100cqh - 92`), so a long queue
							 * scrolls inside its column while a short one shrinks to content (a
							 * max, not a height). Cells still cross-stretch to the well's
							 * tallest, so the band stays one rectangle. NOTHING TRAPS THE
							 * WHEEL: no `overscroll-behavior` anywhere on this path and no
							 * `overflow: hidden` between the cells and the strip - a wheel over
							 * a column that cannot scroll (or has hit its edge) chains to the
							 * board's own scroller, which is how the next team comes into view.
							 */}
							<div className="flex gap-3 rounded-md bg-sunken py-2">
								{columns.map((column) => {
									const cards = band.items.filter(
										(project) => project.status === column.status,
									);
									return (
										<div
											key={column.status}
											data-board-cell={column.status}
											className="flex max-h-[calc(100cqh-92px)] w-64 shrink-0 flex-col gap-2 overflow-y-auto px-2"
										>
											{cards.length > 0 && (
												<ul className="flex flex-col gap-2">
													{cards.map((project) => (
														<li key={project.id}>
															<BoardCard
																project={project}
																nowMs={nowMs}
																busy={moving.has(project.id)}
																onOpen={() => onOpen(project)}
																onEdit={() => onEdit(project)}
																onDelete={() => onDelete(project)}
																onMove={(status) => onMove(project, status)}
															/>
														</li>
													))}
												</ul>
											)}
										</div>
									);
								})}
							</div>
						</section>
					))}
				</div>
			</div>
		</div>
	);
};

/* `boardColumns` lives in the model; the component only lays the columns out. */

type BoardCardProps = {
	project: DesktopProject;
	nowMs: number;
	busy: boolean;
	onOpen: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onMove: (status: string) => void;
};

const BoardCard: FC<BoardCardProps> = ({
	project,
	nowMs,
	busy,
	onOpen,
	onEdit,
	onDelete,
	onMove,
}) => {
	const meta = listRowMeta(
		project,
		typeof navigator === "undefined" ? undefined : navigator.language,
	);
	/*
	 * THE CARD'S CHECK-IN DOOR (design note §1). The capability is read per card
	 * through the shared react-query cache (one answer for every card), and the
	 * item is MOUNTED or NOTHING - never mounted-and-disabled, the same
	 * fail-closed rule the page's own gate follows.
	 */
	const capabilities = useDesktopCapabilities();
	const requestUpdate = useRequestProjectUpdate();
	const requestUpdateEnabled = desktopFeatureEnabled(
		capabilities.data,
		"projects_request_update",
	);
	/*
	 * THE TITLE IS THE IDENTITY (grounded finding, this slice): the board, the
	 * list and the timeline all rendered the machine KEY, while the detail sheet
	 * rendered `projectDisplayName` — the same rule the sheet uses now reads on
	 * every surface that names a project. Unset title falls back to the key
	 * inside `projectDisplayName`; `data-project-name` keeps the KEY as the
	 * addressable hook (focus handoff), not as display text.
	 */
	const displayName = projectDisplayName(project);
	/*
	 * WHETHER THE TITLE IS ACTUALLY CLIPPED, measured rather than assumed
	 * (operator, 2026-09-30): the title line is `truncate`, and the tooltip
	 * that reveals the full text belongs only on a title the column has really
	 * cut - a panel repeating a fully visible title is noise, and a tab stop
	 * that reveals nothing is worse.
	 *
	 * THE STATE FROM THE TOOLTIP'S OWN PRESENCE, and that is why this effect
	 * re-runs on it (deps below). Giving the trigger a panel changes the tree
	 * ABOVE the span, so React mounts a NEW span on the flip; a measure that
	 * closed over the old node would then be reading a detached element (0 by
	 * 0, so `false`) for the rest of the mount. Measured on this branch: the
	 * capture's play read a 390px title in a 184px box whose own state still
	 * said `false` - the detached-closure shape exactly. `isConnected` is the
	 * same guard at the other end of the effect's life.
	 *
	 * THREE TRIGGERS, because each is a measured defect: the FRAME read, since
	 * at effect time the element may not be laid out yet; the OBSERVER, for the
	 * column widths that follow the strip's size; and `document.fonts.ready`,
	 * for the case neither can see - the web font arriving widens the TEXT
	 * without resizing the BOX, so no resize ever fires (the
	 * `directory-indicator.tsx` lesson, re-earned here).
	 */
	const titleRef = useRef<HTMLSpanElement>(null);
	const [titleClipped, setTitleClipped] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: both deps are TRIGGERS, not body reads - `displayName` re-measures a renamed card and `titleClipped` re-measures the span React mounts on the flip; the rendered box decides (the `directory-indicator.tsx` shape).
	useEffect(() => {
		const node = titleRef.current;
		if (!node) return;
		const measure = () => {
			if (!node.isConnected) return;
			setTitleClipped(node.scrollWidth - node.clientWidth > 0.5);
		};
		const frame = requestAnimationFrame(measure);
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		void document.fonts?.ready.then(measure).catch(() => {});
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	}, [displayName, titleClipped]);
	const overdue = projectOverdue(project, todayUtcMs(nowMs));
	const age = progressAge(project.progress_updated_at, nowMs);
	/*
	 * THE WHOLE CARD IS THE TARGET (operator report, 2026-09-28: "only the
	 * title opens the details"). Before this, the name/description button was
	 * the card's only door - the facts line, the chips and the progress row
	 * were inert - so the pointer said "nothing here" over most of a surface
	 * that reads as one object.
	 *
	 * WHY A ROOT HANDLER rather than wrapping everything in a button: the
	 * card's menu and its sessions door are real buttons, and a button cannot
	 * contain them. So the root carries the role and the handler, the title
	 * becomes plain text inside it, and the two nested doors stop the bubble
	 * at themselves (see the guards below) - which is also what keeps a
	 * keyboard activation of EITHER door from navigating the card it sits in.
	 */
	const openFromCard = () => {
		/* A selection is a deliberate drag across the card's own text, and the
		 * click that ends it must not navigate; the card's text is selectable
		 * (truncation is visual), so this guard is what keeps "select the due
		 * date" from also opening the project. */
		const selection = window.getSelection();
		if (selection && !selection.isCollapsed) return;
		onOpen();
	};
	const openFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		/* A focused child (the menu, the sessions door) owns its own keys; its
		 * click is stopped above, and this keeps the same line for keys that
		 * never become clicks. */
		if (event.target !== event.currentTarget) return;
		/* Space would scroll the column under the caret otherwise. */
		event.preventDefault();
		onOpen();
	};
	return (
		<div
			data-project-name={project.name}
			// biome-ignore lint/a11y/useSemanticElements: a `<button>` element cannot contain the card's own menu and sessions buttons; the content-root guards below make the doors behave under the ROOT HANDLER this role needs. ARIA's presentational-children caveat is accepted deliberately and recorded in the block comment below.
			/* The card navigates to the detail route - the same act the list
			 * row's full-width button and the menu's `Open` item perform - and
			 * the role is what makes that act reachable from the keyboard and
			 * keeps the pointer affordance the base layer gives semantic
			 * controls (`styles/index.css`).
			 *
			 * THE TRADE THIS ROLE MAKES, recorded honestly (review round 1, M2;
			 * design round 1, D3): `button` has presentational children, so the
			 * two door buttons are not exposed as independent controls by the
			 * spec, and some AT flattens them. That is the cost of a card whose
			 * whole surface is one control with its own actions inside - the
			 * accepted pattern - and it is taken because the alternative (a
			 * stretched-link layer) buys the doors their own exposure at the
			 * price of a second interactive layer to keep in sync. The doors
			 * keep their own names and focus stops for the pointer domain; an
			 * AT pass is tracked as a follow-up, not assumed away here. */
			role="button"
			tabIndex={0}
			aria-label={`Open ${displayName}`}
			onClick={openFromCard}
			onKeyDown={openFromKeyboard}
			/*
			 * 6px, no edge: the card is an ITEM inside the column's well, one step
			 * below the column's 10 — the same 10/6 pair the view switcher's track
			 * and pills use — and the surface-on-sunken step is its boundary. The
			 * overdue card keeps its warning edge on purpose: a state is
			 * information, and this is the one boundary the system does not
			 * delete (docs/branding.md § 2: "ask whether removing it entirely
			 * would lose information").
			 *
			 * The hover step is the rows' own (`transition-colors duration-fast
			 * ease-out-quart hover:bg-elevated`): while the title alone was the
			 * target, only the title lifted; now that the whole card is the
			 * target, the whole card answers the pointer.
			 */
			className={cn(
				"group/card flex flex-col gap-2 rounded-sm bg-surface p-3",
				"transition-colors duration-fast ease-out-quart hover:bg-elevated",
				overdue && "border border-warning-border",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<span className="min-w-0 flex-1">
					{/*
					 * THE CLIPPED TITLE HAS A SECOND DOOR (operator, 2026-09-30): hovering
					 * the cut title reveals the full text, and a keyboard user reaches the
					 * same panel because the span takes the tab stop exactly when the
					 * tooltip exists (`titleClipped`) - never as a stop that reveals
					 * nothing.
					 *
					 * A FOCUS STOP INSIDE THIS CARD IS THE CARD'S OWN RECORDED TRADE, not
					 * a new one: its `role="button"` already carries two focusable doors
					 * (the menu and the sessions popover) under the comment that states
					 * the presentational-children cost and why it is accepted. The
					 * alternative - putting the panel on the card root - would open the
					 * full title on every hover of the card's facts, which is the noise
					 * the truncated title alone does not create.
					 *
					 * Radix opens the panel on focus as well as hover, so no key handler
					 * is needed here, and the card's own `openFromKeyboard` ignores
					 * events whose target is a child, so Enter on this span cannot
					 * navigate the card.
					 */}
					<Tooltip
						content={titleClipped ? displayName : null}
						side="top"
						/*
						 * CLOSES WHEN THE POINTER LEAVES THE TRIGGER (QA round 1, Q1 - measured
						 * still painted 12s+ after the pointer was gone). The primitive's
						 * default clears its open timer on leave and then waits for the pointer
						 * to ENTER the panel to close it - and every panel here is
						 * `pointer-events: none`, so that moment cannot arrive and the panel
						 * describes a card the pointer left long ago. Escape and blur keep
						 * working: this closes on leave, it does not disable dismissal.
						 */
						disableHoverableContent
					>
						<span
							ref={titleRef}
							/* The harness's handle on the title line, in the `data-project-name`
							   family; keyed by the project's key so a rig finds it by address. */
							data-project-title={project.name}
							tabIndex={titleClipped ? 0 : undefined}
							className="block truncate text-body-sm font-medium text-ink"
						>
							{displayName}
						</span>
					</Tooltip>
					{/*
					 * The KEY stays the secondary line when a title carries the
					 * identity: the title names the work, the key keeps it
					 * addressable at a glance (and `data-project-name` keeps it
					 * programmatically). Titleless projects render one line — the
					 * fallback in `projectDisplayName`.
					 */}
					{project.title && (
						<span className="mt-0.5 block truncate text-meta text-ink-muted">
							{project.name}
						</span>
					)}
					{project.description && (
						<span className="mt-0.5 block truncate text-meta text-ink-muted">
							{project.description}
						</span>
					)}
				</span>
				<DropdownMenu>
					<DropdownMenuTrigger
						/* The handoff's own hook, in the `data-project-name` family: the
						 * page focuses this node by id after a move settles (see
						 * `useMoveFocusHandoff`). */
						data-project-menu={project.id}
						aria-label={`Actions for ${displayName}`}
						disabled={busy}
						/* THE CARD'S HANDLER MUST NOT SEE THIS PRESS (mouse or
						 * keyboard): the trigger acts, the card does not navigate. Radix
						 * opens on pointerdown, and the click that follows would bubble
						 * into `openFromCard`; this is where that bubble stops. */
						onClick={(event) => event.stopPropagation()}
						className={cn(
							"shrink-0 rounded-sm p-1 text-ink-muted whitespace-nowrap",
							/* SUNKEN, NOT ELEVATED (design round 1, D2 / UX round 1, U2):
							 * the card now paints `elevated` while hovered, so the doors'
							 * old hover - the same token - had no readable step left on a
							 * lit card. The ladder's next step DOWN reads against the
							 * elevated card in both palettes and keeps the glyph's own
							 * `text-ink` step. */
							"hover:bg-sunken hover:text-ink",
						)}
					>
						{/*
						 * A MOVE IN FLIGHT SAYS SO ON THE CARD (UX round 1, U2): a
						 * held PATCH used to leave the row looking untouched for its
						 * whole duration - no signal at the control the reader just
						 * used, which is also what invited the overlapping second
						 * press U1 measured. The glyph swaps to the app's spinner
						 * for exactly this card's move (the page's per-card set), so
						 * the signal appears within a frame of the press.
						 */}
						{busy ? (
							<Spinner size="xs" />
						) : (
							<MoreHorizontal className="size-4" />
						)}
					</DropdownMenuTrigger>
					{/*
					 * THE DOORS' CONTENT IS STILL THE CARD'S DESCENDANT IN THE REACT
					 * TREE (review round 1, B1 / QA round 1, Q-1 / UX round 1, U1).
					 * Radix portals the content to the body, but React keeps
					 * propagating its events to REACT-tree ancestors - so without
					 * this stop, a press on any item below runs `openFromCard` too:
					 * measured on the shipped component, `Set status` moved the card
					 * AND navigated to its detail, `Edit` opened no dialog and left
					 * the board, and a sessions row's conversation was clobbered by
					 * the project push. The trigger guards cover the triggers; this
					 * covers the items. */}
					<DropdownMenuContent
						align="end"
						onClick={(event) => event.stopPropagation()}
					>
						<DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>Set status</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								<DropdownMenuRadioGroup
									value={project.status}
									onValueChange={onMove}
								>
									{[...BOARD_COLUMNS, ...BOARD_SIDE_COLUMNS].map((status) => (
										<DropdownMenuRadioItem key={status} value={status}>
											{projectStatusMeta(status).label}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
						{/*
						 * THE CHECK-IN ITEM, directly after `Set status` and above the
						 * separator: both first-group actions keep the project's state
						 * current, one done by you and one delegated outward to the
						 * sessions; the record-editing pair stays after the rule. No icon -
						 * no sibling carries one, and a lone icon would misalign the text
						 * column (design note §1). ALWAYS ENABLED: a greyed item with no
						 * reason is a defect, and both the empty answer and "already
						 * requested" come back as the result toast.
						 */}
						{requestUpdateEnabled && (
							<DropdownMenuItem onSelect={() => requestUpdate(project)}>
								Request update
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						{/*
						 * Edit NO LONGER OPENS A DIALOG (the inline-edit slice, operator
						 * 2026-09-30): the page routes it to the project's detail, where
						 * every field edits in place — the same destination Open uses,
						 * kept as its own item because the two intents are still separate
						 * to a reader (design may drop it). The prop stays `onEdit`, so
						 * what the item MEANS is the page's to change.
						 */}
						<DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
						<DropdownMenuItem onSelect={onDelete}>Delete</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<div className="flex flex-wrap gap-1.5">
				{/*
				 * The LIVE token is dropped on purpose: the card's own popover
				 * carries liveness (and is the door into a conversation), and a
				 * second "2 live" on the facts line was rendering the same number
				 * twice - measured in the first capture of this set.
				 */}
				{meta
					.filter((entry) => entry.key !== "live")
					.map((entry) => (
						<span
							key={entry.key}
							className="rounded-sm bg-sunken px-1.5 py-0.5 text-meta text-ink-muted"
						>
							{entry.text}
						</span>
					))}
				{overdue && <Badge variant="warning">Overdue</Badge>}
			</div>
			<div className="flex items-center justify-between gap-2">
				<span className="min-w-0 truncate text-meta text-ink-muted">
					{boardProgressText(age)}
				</span>
				<span className="flex shrink-0 items-center gap-1.5">
					{(project.progress_stale || !age) && (
						<span
							aria-label={PROGRESS_STALE_LABEL}
							title={PROGRESS_STALE_LABEL}
							className="size-1.5 rounded-full bg-warning"
						/>
					)}
					{project.sessions > 0 && <CardSessionsPopover project={project} />}
				</span>
			</div>
		</div>
	);
};

/**
 * The card's live-session popover: the board's own way into a conversation.
 *
 * The detail read is fired on OPEN rather than for every card, because the
 * listing carries counts and no ids — fetching N details for a board the user
 * never opens a popover on is exactly the waste the counts exist to avoid.
 */
const CardSessionsPopover: FC<{ project: DesktopProject }> = ({ project }) => {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();
	const detail = useProjectDetail(project.id, open);
	const links = detail.data?.links ?? [];
	const linkLabel = sessionsTriggerLabel(project);
	/* Its own read of the identity rule: this popover is a sibling component,
	 * not a child of the card, so the card's `displayName` is not in scope. */
	const displayName = projectDisplayName(project);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				/* The sweep's own hook into the door, in the `data-project-name`
				 * family this card already uses. */
				data-project-sessions={project.id}
				aria-label={`Sessions linked to ${displayName}`}
				/* The card's handler must not see this press either: the door
				 * opens the popover, the card does not navigate. */
				onClick={(event) => event.stopPropagation()}
				className={cn(
					/* `whitespace-nowrap` + the row's `shrink-0`: the door is a
					 * label, not prose - "2 sessions · 2 live" wrapped mid-phrase
					 * ("2 sessions · 2 / live") when the card got narrow (design
					 * round 2, D9). The row's left half truncates instead. */
					"rounded-sm px-1 text-meta whitespace-nowrap",
					project.live_sessions > 0
						? "text-success hover:bg-sunken"
						: "text-ink-muted hover:bg-sunken",
				)}
			>
				{linkLabel}
			</PopoverTrigger>
			<PopoverContent
				align="end"
				/*
				 * NO PANEL RING (design round 2, D10): the content receives focus on
				 * open, and the global `:focus-visible` rule then paints the 2px accent
				 * outline around the whole panel where every other floating surface reads
				 * as a hairline card. This is the sanctioned suppression - focus lands
				 * here programmatically and a ring is noise, while the rows inside keep
				 * their own rings.
				 */
				className="w-64 p-2 outline-none"
				/* The menu content's stop, for the same reason and the same
				 * measured failure: a row's press (or `Try again`'s) bubbles in the
				 * React tree to the card without it, and the card's own navigation
				 * overwrites the row's. */
				onClick={(event) => event.stopPropagation()}
			>
				{detail.isLoading ? (
					<p className="px-1 py-2 text-meta text-ink-muted">
						Loading linked sessions…
					</p>
				) : detail.isError ? (
					/*
					 * A FAILED READ IS NOT AN EMPTY ONE (review round 1). Without this
					 * branch the popover showed nothing at all, which reads as "no
					 * sessions" while the truth is "not known" - the detail screen's
					 * own rule, in the popover's smaller voice.
					 */
					<div className="flex flex-col items-start gap-1.5 px-1 py-2">
						<p className="text-meta text-ink-muted">
							{detail.error instanceof Error && detail.error.message
								? detail.error.message
								: "The linked sessions could not be read."}
						</p>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void detail.refetch()}
						>
							Try again
						</Button>
					</div>
				) : links.length === 0 ? (
					<p className="px-1 py-2 text-meta text-ink-muted">
						No sessions linked yet.
					</p>
				) : (
					<ul className="flex flex-col">
						{links.map((link) => (
							<li key={link.session_id}>
								<button
									type="button"
									/* A link whose directory is gone is not a door into
									 * anything — the detail states the same rule. */
									disabled={!link.exists}
									onClick={() => {
										if (!link.exists) return;
										setOpen(false);
										void openConversation(navigate, link.session_id);
									}}
									className={cn(
										"flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left text-meta",
										link.exists
											? "text-ink hover:bg-elevated"
											: "text-ink-disabled",
									)}
								>
									<span className="truncate">
										{link.title || link.session_id}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</PopoverContent>
		</Popover>
	);
};
