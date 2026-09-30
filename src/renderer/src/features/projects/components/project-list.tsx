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
 * THE COLUMN STRIP IS A CONTROL, NOT A CAPTION: each header is a real button
 * that opens that column's menu — the column's sort actions above its facet's
 * options, the same panel the toolbar's Filters button opens — and the strip
 * carries real table semantics (`role="row"` / `role="columnheader"` with
 * `aria-sort`) so the sort state a screen reader hears is the sort the list is
 * in, not a category a reviewer inferred from a glyph. The strip is ONE tab
 * stop with a roving tabindex: Left/Right move between the visible headers,
 * Enter/Space opens the focused one. The button never grows a display
 * utility of its own — the shed columns' `hidden`/`@[40rem]:block` live on the
 * CELL, because a second display class on the same element would be resolved
 * by the class merge and stop the shedding.
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

import {
	Badge,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { FC, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRef, useState } from "react";
import type { DesktopProject } from "../../../../../shared/desktop-control-contract";
import type {
	FilterFacetKey,
	FilterOptionValue,
	FilterState,
} from "../project-filters";
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
import {
	type SortDirection,
	type SortKey,
	type SortSpec,
	sortProjects,
} from "../project-sort";
import { ProjectFiltersPanel } from "./project-filters-panel";
import { ProjectStatusBadge } from "./project-status-badge";

type ProjectListProps = {
	projects: DesktopProject[];
	/** Read once per render by the page, the schedules page's own rule. */
	nowMs: number;
	onOpen: (project: DesktopProject) => void;
	/** The explicit column sort in force, or `null` for the arriving order. */
	sort: SortSpec | null;
	onSortChange: (spec: SortSpec | null) => void;
	/* The column menus' scoped panels derive their counts from the WHOLE
	 * listing (the same rule the toolbar popover runs), so the unfiltered rows
	 * and the live filter state are passed alongside the filtered rows above. */
	allProjects: DesktopProject[];
	filters: FilterState;
	query: string;
	todayMs: number;
	onToggleFilter: (facet: FilterFacetKey, value: FilterOptionValue) => void;
	onClearFilters: () => void;
};

/** One column's plan: how it sheds, how wide it is, and what its menu does. */
type Column = {
	key: string;
	label: string;
	/** Applied to both the header cell and every row cell. */
	className: string;
	/** The key this column's sort actions order by. */
	sort: SortKey;
	/**
	 * The facet its menu scopes to. The name column has NONE: its rows are what
	 * the search field finds, so its menu is sort actions only.
	 */
	facet: FilterFacetKey | null;
};

/*
 * The shed order is deliberate: `live` and `milestones` survive longest of the
 * optional four (they are the smallest and the most scanned), `estimate` and
 * `target` go first (they are planning detail, and the detail view repeats
 * them).
 */
const COLUMNS: Column[] = [
	{
		key: "name",
		label: "Project",
		className: "min-w-0 flex-1",
		sort: "name",
		facet: null,
	},
	{
		key: "status",
		label: "Status",
		className: "w-20 shrink-0",
		sort: "status",
		facet: "status",
	},
	{
		key: "target",
		label: "Target",
		className: "hidden w-32 shrink-0 @[40rem]:block",
		sort: "target",
		facet: "target",
	},
	{
		key: "estimate",
		label: "Estimate",
		className: "hidden w-16 shrink-0 @[40rem]:block",
		sort: "estimate",
		facet: "estimate",
	},
	{
		key: "milestones",
		label: "Milestones",
		className: "hidden w-20 shrink-0 @[34rem]:block",
		sort: "milestones",
		facet: "milestones",
	},
	{
		key: "live",
		label: "Live",
		className: "hidden w-14 shrink-0 @[34rem]:block",
		sort: "live",
		facet: "live",
	},
	{
		key: "progress",
		label: "Progress",
		className: "w-40 shrink-0",
		sort: "progress",
		facet: "progress",
	},
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

/**
 * The sorted column's indicator: the glyph's SHAPE carries the direction, and
 * it is `aria-hidden` because `aria-sort` on the header cell already says what
 * it draws — a reader hearing "Target, sort descending, descending" has been
 * told twice. Size 10 is measured, not chosen: label 48 + gap 4 + glyph 10 is
 * the 62px that fits the tightest column (Estimate, 64px).
 */
const SortGlyph: FC<{ direction: SortDirection }> = ({ direction }) =>
	direction === "asc" ? (
		<ArrowUp size={10} className="shrink-0" aria-hidden="true" />
	) : (
		<ArrowDown size={10} className="shrink-0" aria-hidden="true" />
	);

export const ProjectList: FC<ProjectListProps> = ({
	projects,
	nowMs,
	onOpen,
	sort,
	onSortChange,
	allProjects,
	filters,
	query,
	todayMs,
	onToggleFilter,
	onClearFilters,
}) => {
	/*
	 * ORDER FIRST, THEN GROUP: an explicit sort orders the rows and
	 * `groupByTeam` buckets them without touching the order inside a bucket, so
	 * the sections stay alphabetical while the rows inside each one are in the
	 * sort's order (the design's "sorting applies within each section",
	 * achieved without a second sort). Without an explicit sort the rows are in
	 * the order the page derived. The sort is a NEW array either way — the
	 * page's memo chain depends on the input reference staying the input
	 * reference.
	 */
	const ordered = sort ? sortProjects(projects, sort) : projects;
	const groups = groupByTeam(ordered, projectTeamName);
	/*
	 * THE STRIP IS ONE TAB STOP (roving tabindex): the header the reader was
	 * last on carries `tabindex=0` and every other header -1, so the strip adds
	 * ONE stop to a document walk rather than seven, and Left/Right move
	 * between the headers that are actually visible — a shed column cannot take
	 * focus, so the walk skips it instead of stranding the caret.
	 */
	const [activeHeader, setActiveHeader] = useState(0);
	const headerRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const moveHeader = (from: number, delta: 1 | -1) => {
		const count = COLUMNS.length;
		for (let step = 1; step <= count; step += 1) {
			const candidate = (from + delta * step + count * count) % count;
			const node = headerRefs.current[candidate];
			if (node && node.offsetParent !== null) {
				setActiveHeader(candidate);
				node.focus();
				return;
			}
		}
	};
	const onHeaderKeyDown =
		(index: number) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			moveHeader(index, event.key === "ArrowRight" ? 1 : -1);
		};

	return (
		<div
			className="@container flex min-h-0 flex-1 flex-col"
			data-testid="project-list"
		>
			{/*
			 * THE STRIP'S TABLE SEMANTICS ARE REAL ELEMENTS (U3, and
			 * `data-table.tsx`'s own contract): a real table with one header row,
			 * real `<th scope="col">` cells carrying `aria-sort`, and the real
			 * `<button>` inside — role attributes on divs would describe the same
			 * thing with less to stand on. The table is the HEADER STRIP's own
			 * host, not a claim about the list below: those rows are buttons, not
			 * tabular cells, and the table is deliberately display:block so the
			 * flex row inside it lays out as the strip always has (a `table`
			 * display would wrap the flex boxes in anonymous table rows).
			 */}
			<table className="block shrink-0" aria-label="Project columns">
				<thead className="block">
					<tr
						/*
						 * 36px, not 12: the page no longer insets this region, so the strip
						 * restates the sum it used to sit inside - the 24px page gutter plus
						 * the 12 the columns below carry - and stays flush with the scrolled
						 * rows. The scroller itself (`ul` below) carries the 24 as its own
						 * padding, so its bar rides the VIEW's edge, not an inset's.
						 */
						className="flex items-center gap-3 px-9 py-2 text-meta text-ink-muted"
					>
						{COLUMNS.map((column, index) => {
							const active = sort !== null && sort.key === column.sort;
							return (
								<th
									key={column.key}
									scope="col"
									aria-sort={
										active
											? sort.direction === "desc"
												? "descending"
												: "ascending"
											: "none"
									}
									className={cn(column.className, "p-0 text-left font-normal")}
								>
									<Popover>
										<PopoverTrigger asChild>
											<button
												type="button"
												ref={(node) => {
													headerRefs.current[index] = node;
												}}
												tabIndex={index === activeHeader ? 0 : -1}
												data-project-column={column.key}
												onFocus={() => setActiveHeader(index)}
												onKeyDown={onHeaderKeyDown(index)}
												className={cn(
													"flex w-full min-w-0 items-center gap-1 rounded-xs text-left",
													"transition-colors duration-fast ease-out-quart",
													active ? "text-ink" : "hover:text-ink",
												)}
											>
												<span className="truncate">{column.label}</span>
												{active && <SortGlyph direction={sort.direction} />}
											</button>
										</PopoverTrigger>
										<PopoverContent
											align="start"
											aria-label={`${column.label} column`}
											className="max-h-[min(70vh,32rem)] w-72 overflow-y-auto overscroll-contain p-0"
										>
											<ProjectFiltersPanel
												projects={allProjects}
												state={filters}
												query={query}
												todayMs={todayMs}
												onToggle={onToggleFilter}
												onClearAll={onClearFilters}
												scope={column.facet}
												sort={{
													key: column.sort,
													spec: sort,
													onChange: onSortChange,
												}}
											/>
										</PopoverContent>
									</Popover>
								</th>
							);
						})}
					</tr>
				</thead>
			</table>
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
