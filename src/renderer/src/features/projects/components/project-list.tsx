/**
 * The tab's List view: a header strip, team sections, one row per project.
 *
 * THE VIEW IS BORDERLESS: the panel ground and its radius retired — the rows
 * are the structure, the way the detail sheet runs — and the header strip's
 * hairline went with them. Rows keep their own hairlines (the app-wide rule
 * for repeating rows), and the row ground is the page canvas, hover included.
 *
 * THE SECTIONS ARE TEAMS (slice 3): the same `groupByTeam` rule the board's
 * columns and the timeline run, headers pinned `top-0` inside the scroller so
 * the current team stays named while its rows scroll under it and the next
 * header pushes it out — the ordinary sticky contract, which is all the
 * "pin and push" behaviour needs. A header's ground is `canvas` because that
 * IS the view's ground now; `surface` would float a band over the rows.
 *
 * THE COLUMNS ARE THE DESIGN'S OWN LIST, in its order — name, status chip,
 * target date, estimate, milestone `n/m`, live count, progress age with the
 * stale badge — and each one takes its value from `project-model.ts` rather
 * than formatting anything inline, so the copy a test can pin is the copy the
 * reader sees.
 *
 * RESPONSIVENESS IS COLUMN SHEDDING, not wrapping: this panel sits inside a
 * collapsible rail and a resizable window, so it is a `@container` and the
 * secondary columns (`target`, `estimate`, `milestones`, `live`) are hidden
 * under the container widths where they would otherwise squeeze the name to a
 * stub. The NAME and the PROGRESS column never shed — they are the two facts a
 * row exists for — and the alignment is per-column widths on a flex row rather
 * than a grid template, so a hidden column cannot shift its neighbours into
 * tracks the header no longer names (the header and the rows run the same
 * column list through the same plan function, which is what keeps them
 * aligned).
 *
 * EVERY ROW IS A BUTTON. The whole row opens the detail: a per-cell link would
 * add six tab stops per row and make the target "the row", which a pointer
 * user reads as true and a keyboard user could not reach.
 */

import { Badge } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import type { DesktopProject } from "../../../../../shared/desktop-control-contract";
import {
	NO_TEAM_LABEL,
	PROGRESS_STALE_LABEL,
	groupByTeam,
	listRowMeta,
	liveSessionsLabel,
	milestoneCountLabel,
	progressAge,
	progressAgePhrase,
	projectDisplayName,
	projectTeamName,
} from "../project-model";
import { ProjectStatusBadge } from "./project-status-badge";

type ProjectListProps = {
	projects: DesktopProject[];
	/** Read once per render by the page, the schedules page's own rule. */
	nowMs: number;
	onOpen: (project: DesktopProject) => void;
};

/** One column's plan: how it sheds, and how wide it is when it is shown. */
type Column = {
	key: string;
	label: string;
	/** Applied to both the header cell and every row cell. */
	className: string;
};

/*
 * The shed order is deliberate: `live` and `milestones` survive longest of the
 * optional four (they are the smallest and the most scanned), `estimate` and
 * `target` go first (they are planning detail, and the detail view repeats
 * them).
 */
const COLUMNS: Column[] = [
	{ key: "name", label: "Project", className: "min-w-0 flex-1" },
	{ key: "status", label: "Status", className: "w-20 shrink-0" },
	{
		key: "target",
		label: "Target",
		className: "hidden w-32 shrink-0 @[40rem]:block",
	},
	{
		key: "estimate",
		label: "Estimate",
		className: "hidden w-16 shrink-0 @[40rem]:block",
	},
	{
		key: "milestones",
		label: "Milestones",
		className: "hidden w-20 shrink-0 @[34rem]:block",
	},
	{
		key: "live",
		label: "Live",
		className: "hidden w-14 shrink-0 @[34rem]:block",
	},
	{ key: "progress", label: "Progress", className: "w-40 shrink-0" },
];

/**
 * The progress cell's own text, short because the column's header already says
 * "Progress": the age token, or an honest "not reported". The full sentence
 * ("reported 2h ago by session …") belongs to the detail screen's Progress
 * section, where there is room for it — in the narrower cell the sentence was
 * truncated to "reported 6…" beside the stale badge, which is a number the
 * reader cannot finish reading.
 */
function progressCellText(project: DesktopProject, nowMs: number): string {
	const age = progressAge(project.progress_updated_at, nowMs);
	if (!age) return "not reported";
	return progressAgePhrase(age);
}

export const ProjectList: FC<ProjectListProps> = ({
	projects,
	nowMs,
	onOpen,
}) => {
	const groups = groupByTeam(projects, projectTeamName);
	return (
		<div
			className="@container flex min-h-0 flex-1 flex-col"
			data-testid="project-list"
		>
			<div
				/*
				 * 36px, not 12: the page no longer insets this region, so the strip
				 * restates the sum it used to sit inside - the 24px page gutter plus
				 * the 12 the columns below carry - and stays flush with the scrolled
				 * rows. The scroller itself (`ul` below) carries the 24 as its own
				 * padding, so its bar rides the VIEW's edge, not an inset's.
				 */
				className="flex shrink-0 items-center gap-3 px-9 py-2 text-meta text-ink-muted"
				aria-hidden="true"
			>
				{COLUMNS.map((column) => (
					<span key={column.key} className={column.className}>
						{column.label}
					</span>
				))}
			</div>
			<ul className="min-h-0 flex-1 overflow-y-auto px-6">
				{groups.map((group) => (
					<li key={group.team ?? ""}>
						<div
							className="sticky top-0 z-10 flex items-center gap-2 bg-canvas px-3 py-1.5 text-meta"
							data-project-team={group.team ?? ""}
						>
							<span className="truncate text-ink">
								{group.team ?? NO_TEAM_LABEL}
							</span>
							<span className="shrink-0 text-ink-muted">
								{group.items.length}
							</span>
						</div>
						<ul className="divide-y divide-hairline">
							{group.items.map((project) => {
								const meta = new Map(
									listRowMeta(
										project,
										typeof navigator === "undefined"
											? undefined
											: navigator.language,
									).map((entry) => [entry.key, entry.text]),
								);
								const milestones = milestoneCountLabel(
									project.milestones_completed,
									project.milestones_total,
								);
								const live = liveSessionsLabel(project.live_sessions);
								return (
									<li key={project.id}>
										<button
											type="button"
											onClick={() => onOpen(project)}
											data-project-name={project.name}
											className={cn(
												"flex w-full items-center gap-3 px-3 py-2 text-left",
												"transition-colors duration-fast ease-out-quart",
												"hover:bg-elevated",
											)}
										>
											<span
												className={cn(
													COLUMNS[0].className,
													"truncate text-body-sm text-ink",
												)}
											>
												{/*
												 * THE TITLE IS THE IDENTITY on this surface too (see the
												 * board's note): same `projectDisplayName` rule, key kept
												 * as the addressable `data-project-name` hook.
												 */}
												{projectDisplayName(project)}
											</span>
											<span className={COLUMNS[1].className}>
												<ProjectStatusBadge status={project.status} />
											</span>
											<span
												className={cn(
													COLUMNS[2].className,
													"truncate text-meta text-ink-muted",
												)}
											>
												{/*
												 * `target` OR `completed`: `listRowMeta` emits at most one of the two
												 * (a finished project dates itself from the day it finished), and
												 * reading only `target` left a done row's date column empty.
												 */}
												{meta.get("target") ?? meta.get("completed") ?? ""}
											</span>
											<span
												className={cn(
													COLUMNS[3].className,
													"truncate text-meta text-ink-muted",
												)}
											>
												{meta.get("estimate") ?? ""}
											</span>
											<span
												className={cn(
													COLUMNS[4].className,
													"truncate text-meta text-ink-muted",
												)}
											>
												{milestones}
											</span>
											<span
												className={cn(
													COLUMNS[5].className,
													"truncate text-meta text-ink-muted",
												)}
											>
												{live}
											</span>
											<span
												className={cn(
													COLUMNS[6].className,
													"flex items-center gap-2",
												)}
											>
												<span className="truncate text-meta text-ink-muted">
													{progressCellText(project, nowMs)}
												</span>
												{project.progress_stale && (
													<Badge variant="warning">
														{PROGRESS_STALE_LABEL}
													</Badge>
												)}
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					</li>
				))}
			</ul>
		</div>
	);
};
