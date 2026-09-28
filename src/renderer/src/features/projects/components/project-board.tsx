/**
 * The tab's Board view: one column per status, cards of facts — the desktop's
 * kanban, no drag-and-drop.
 *
 * WHAT A CARD SAYS, from the feature's own derivations rather than inline
 * formatting: the name, the meta chips `listRowMeta` already produces for the
 * list ("due Oct 15", "13 pt", "milestones 2/5", "2 live" — ONE derivation,
 * two surfaces, so a card and its list row cannot state two different facts),
 * the progress age with the stale badge, and an OVERDUE chip for a target day
 * that has passed with the work unfinished (`projectOverdue`).
 *
 * NO DRAG: status moves are the card menu's `Set status` action, stated in the
 * design (§V2.B.1) and in the plan — a drag would add a dependency tree and a
 * second interaction model for one field.
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
import { MoreHorizontal } from "lucide-react";
import type { FC, KeyboardEvent } from "react";
import { useCallback, useEffect, useState } from "react";
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
	sessionsTriggerLabel,
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

export const ProjectBoard: FC<ProjectBoardProps> = ({
	projects,
	nowMs,
	onOpen,
	onEdit,
	onDelete,
	onMove,
	movingKeys = [],
}) => {
	const columns = boardColumns(projects);
	const moving = new Set(movingKeys);
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
			<div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto p-3">
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
							<header className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-2">
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
			// biome-ignore lint/a11y/useSemanticElements: a `<button>` cannot contain the card's own menu and sessions buttons; the root role keeps the card reachable and named while those doors stay legal inside it.
			/* The card navigates to the detail route - the same act the list
			 * row's full-width button and the menu's `Open` item perform - and
			 * the role is what makes that act reachable from the keyboard and
			 * keeps the pointer affordance the base layer gives semantic
			 * controls (`styles/index.css`). */
			role="button"
			tabIndex={0}
			aria-label={`Open ${project.name}`}
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
					<span className="block truncate text-body-sm font-medium text-ink">
						{project.name}
					</span>
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
						aria-label={`Actions for ${project.name}`}
						disabled={busy}
						/* THE CARD'S HANDLER MUST NOT SEE THIS PRESS (mouse or
						 * keyboard): the trigger acts, the card does not navigate. Radix
						 * opens on pointerdown, and the click that follows would bubble
						 * into `openFromCard`; this is where that bubble stops. */
						onClick={(event) => event.stopPropagation()}
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
