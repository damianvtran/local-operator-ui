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
 * COLUMNS SCROLL IN THE PANEL; the strip scrolls horizontally when the window
 * is narrow (`overflow-x-auto` on the strip, `overflow-y-auto` per column), so
 * a board never clips a column into an unreachable one.
 *
 * THE LIVE CHIP IS A POPOVER, and it is the board's own door into a
 * conversation: the listing carries session COUNTS, not ids, so the popover
 * opens the project's detail read (`projects.get`, cached by react-query after
 * its first open) and lists the linked sessions — each row opens the
 * conversation through the SAME switch the detail and the sidebar use
 * (`openConversation`, the chat feature's one owner of that URL write).
 */

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
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { GripVertical, MoreHorizontal } from "lucide-react";
import type {
	FC,
	KeyboardEvent as ReactKeyboardEvent,
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
import {
	BOARD_COLUMNS,
	BOARD_SIDE_COLUMNS,
	PROGRESS_STALE_LABEL,
	boardColumns,
	boardProgressText,
	listRowMeta,
	progressAge,
	projectOverdue,
	projectStatusMeta,
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
}) => {
	/*
	 * The order is board state, read once per mount from the guarded store the
	 * view switcher also reads, and written on every move: a failed read or
	 * write falls back to the lifecycle and never fails a reorder.
	 */
	const [order, setOrder] = useState<string[]>(readBoardColumnOrder);
	const columns = boardColumns(projects, order);
	const [drag, setDrag] = useState<DragState | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const stripRef = useRef<HTMLDivElement | null>(null);
	const indicatorRef = useRef<HTMLDivElement | null>(null);
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
	};

	const onHeaderPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
		const live = gesture.current;
		if (!live || event.pointerId !== live.pointerId) return;
		if (!live.armed) {
			const travel = Math.hypot(
				event.clientX - live.startX,
				event.clientY - live.startY,
			);
			if (travel < DRAG_ARM_DISTANCE) return;
			live.armed = true;
			setDrag({ status: live.status, over: live.over });
			setAnnouncement(`Moving ${projectStatusMeta(live.status).label} column.`);
		}
		const over = dropIndexAt(event.clientX, live.status);
		if (over !== live.over) {
			live.over = over;
			setDrag({ status: live.status, over });
			/* Announce the landing, not every pixel of travel. */
			setAnnouncement(
				`Moving ${projectStatusMeta(live.status).label} column; it will drop ${dropPhrase(live.status, over)}.`,
			);
		}
	};

	const settleDrag = (commit: boolean) => {
		const live = gesture.current;
		gesture.current = null;
		setDrag(null);
		if (commit && live?.armed) commitMove(live.status, live.over);
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
		const onKeyDown = (event: KeyboardEvent) => {
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
	useLayoutEffect(() => {
		const strip = stripRef.current;
		const line = indicatorRef.current;
		if (!strip || !line || !drag) return;
		const stripRect = strip.getBoundingClientRect();
		const others: DOMRect[] = [];
		for (const section of strip.querySelectorAll<HTMLElement>(
			"[data-board-column]",
		)) {
			if (section.dataset.boardColumn !== drag.status) {
				others.push(section.getBoundingClientRect());
			}
		}
		const HALF_GAP = 6; /* half of the strip's `gap-3` (12px) */
		const edge =
			drag.over >= others.length
				? (others[others.length - 1]?.right ?? stripRect.left) + HALF_GAP
				: (others[drag.over]?.left ?? stripRect.right) - HALF_GAP;
		line.style.left = `${Math.round(edge - stripRect.left)}px`;
	});

	const onGripKeyDown = (
		event: ReactKeyboardEvent<HTMLElement>,
		status: string,
	) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const statuses = columns.map((column) => column.status);
		const from = statuses.indexOf(status);
		const to = event.key === "ArrowLeft" ? from - 1 : from + 1;
		if (to < 0 || to >= statuses.length) {
			setAnnouncement(
				`${projectStatusMeta(status).label} column is already ${to < 0 ? "first" : "last"}.`,
			);
			return;
		}
		commitMove(status, to);
	};

	return (
		<div
			/*
			 * Frame tier: 10px and no edge. A view frame's boundary is its ground
			 * step off the canvas — the rule the chat's panes already follow — and
			 * the hairline was the extra mark this pass retires (docs/branding.md
			 * § 2, § 5).
			 */
			className="@container flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-surface"
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
			<div
				ref={stripRef}
				className={cn(
					"relative flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto p-3",
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
				{columns.map((column) => {
					const meta = projectStatusMeta(column.status);
					return (
						<section
							key={column.status}
							data-board-column={column.status}
							/*
							 * The column is a well, not a card: it keeps the panel tier's 10 and
							 * drops its edge. The sunken step inside the surface panel is the
							 * boundary; panel + column + card edges were three borders stacked
							 * on one small object.
							 */
							className="flex w-64 shrink-0 flex-col overflow-hidden rounded-md bg-sunken"
						>
							<header
								data-board-column-handle={column.status}
								onPointerDown={(event) =>
									onHeaderPointerDown(event, column.status)
								}
								onPointerMove={onHeaderPointerMove}
								onPointerUp={onHeaderPointerUp}
								onPointerCancel={onHeaderPointerCancel}
								className={cn(
									"flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-hairline px-3 py-2 active:cursor-grabbing",
									drag?.status === column.status && "opacity-60",
								)}
							>
								<span className="flex min-w-0 flex-1 items-center gap-1.5">
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										data-board-column-grip={column.status}
										aria-label={`Move ${meta.label} column`}
										title="Drag the header, or press the arrow keys, to move this column"
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
							{column.projects.length === 0 ? (
								<p className="px-3 py-4 text-meta text-ink-muted">
									No projects here.
								</p>
							) : (
								<ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
									{column.projects.map((project) => (
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
						</section>
					);
				})}
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
	const overdue = projectOverdue(project, todayUtcMs(nowMs));
	const age = progressAge(project.progress_updated_at, nowMs);
	return (
		<div
			data-project-name={project.name}
			/*
			 * 6px, no edge: the card is an ITEM inside the column's well, one step
			 * below the column's 10 — the same 10/6 pair the view switcher's track
			 * and pills use — and the surface-on-sunken step is its boundary. The
			 * overdue card keeps its warning edge on purpose: a state is
			 * information, and this is the one boundary the system does not
			 * delete (docs/branding.md § 2: "ask whether removing it entirely
			 * would lose information").
			 */
			className={cn(
				"group/card flex flex-col gap-2 rounded-sm bg-surface p-3",
				overdue && "border border-warning-border",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<button
					type="button"
					onClick={onOpen}
					className="-mx-1 min-w-0 flex-1 rounded-sm px-1 text-left hover:bg-elevated"
				>
					<span className="block truncate text-body-sm font-medium text-ink">
						{project.name}
					</span>
					{project.description && (
						<span className="mt-0.5 block truncate text-meta text-ink-muted">
							{project.description}
						</span>
					)}
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger
						/* The handoff's own hook, in the `data-project-name` family: the
						 * page focuses this node by id after a move settles (see
						 * `useMoveFocusHandoff`). */
						data-project-menu={project.id}
						aria-label={`Actions for ${project.name}`}
						disabled={busy}
						className={cn(
							"shrink-0 rounded-sm p-1 text-ink-muted whitespace-nowrap",
							"hover:bg-elevated hover:text-ink",
						)}
					>
						<MoreHorizontal className="size-4" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
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
						<DropdownMenuSeparator />
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
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				/* The sweep's own hook into the door, in the `data-project-name`
				 * family this card already uses. */
				data-project-sessions={project.id}
				aria-label={`Sessions linked to ${project.name}`}
				className={cn(
					/* `whitespace-nowrap` + the row's `shrink-0`: the door is a
					 * label, not prose - "2 sessions · 2 live" wrapped mid-phrase
					 * ("2 sessions · 2 / live") when the card got narrow (design
					 * round 2, D9). The row's left half truncates instead. */
					"rounded-sm px-1 text-meta whitespace-nowrap",
					project.live_sessions > 0
						? "text-success hover:bg-elevated"
						: "text-ink-muted hover:bg-elevated",
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
