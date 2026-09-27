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

import { Badge } from "@shared/components/ui";
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
import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopProject } from "../../../../../shared/desktop-control-contract";
import { openConversation } from "../../chat/open-conversation";
import { useProjectDetail } from "../hooks/use-projects-queries";
import {
	BOARD_COLUMNS,
	BOARD_EXTRA_COLUMN,
	PROGRESS_STALE_LABEL,
	boardColumns,
	listRowMeta,
	progressAge,
	progressAgePhrase,
	projectOverdue,
	projectStatusMeta,
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
	archived: "Archived",
};

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
			className="@container flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline bg-surface"
			data-testid="project-board"
		>
			<div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto p-3">
				{columns.map((column) => {
					const meta = projectStatusMeta(column.status);
					return (
						<section
							key={column.status}
							data-board-column={column.status}
							className="flex w-64 shrink-0 flex-col overflow-hidden rounded-md border border-hairline bg-sunken"
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
	return (
		<div
			data-project-name={project.name}
			className={cn(
				"group/card flex flex-col gap-2 rounded-md border bg-surface p-3",
				overdue ? "border-warning-border" : "border-hairline",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<button
					type="button"
					onClick={onOpen}
					className="min-w-0 flex-1 text-left"
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
						aria-label={`Actions for ${project.name}`}
						disabled={busy}
						className={cn(
							"rounded-sm p-1 text-ink-muted",
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
									{[...BOARD_COLUMNS, BOARD_EXTRA_COLUMN].map((status) => (
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
				<span className="truncate text-meta text-ink-muted">
					{age ? `reported ${progressAgePhrase(age)} ago` : "no progress"}
				</span>
				<span className="flex items-center gap-1.5">
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
	const linkLabel = `${project.live_sessions} live`;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label={`Sessions linked to ${project.name}`}
				className={cn(
					"rounded-sm px-1 text-meta",
					project.live_sessions > 0
						? "text-success hover:bg-elevated"
						: "text-ink-muted hover:bg-elevated",
				)}
			>
				{linkLabel}
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 p-2">
				{detail.isLoading ? (
					<p className="px-1 py-2 text-meta text-ink-muted">
						Loading linked sessions…
					</p>
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
