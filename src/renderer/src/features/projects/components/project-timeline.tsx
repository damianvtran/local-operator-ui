/**
 * The tab's Timeline view: a time-scaled schedule — bars, milestone marks and
 * a today marker — under a pinned name column.
 *
 * THE ARITHMETIC IS NOT HERE. `timeline-model.ts` owns the span, the tier
 * choice, the bars and the marks (pure, node-tested); this component measures
 * its own track, lays the results out in px, and paints them with role
 * classes. A schedule surface rather than a chart: deliberately NOT recharts
 * and not a second chart idiom — the numeric charts keep `chart-frame.tsx` as
 * their one home (design §11 item 14).
 *
 * ONE ROW PER DATED PROJECT, then a trailing "no dates" section naming the
 * rest — the honest degradation the design asks for, and the same split the
 * TUI's timeline draws. A project whose milestone DETAIL is still loading
 * draws its bar (the listing carries the dates) and simply has no diamonds
 * yet; the toolbar says how many are still arriving rather than a frame
 * pretending the marks are all there are.
 *
 * THE TIER IS AUTO UNTIL TOUCHED: the finest tier whose axis fits the measured
 * track wins, and `+`/`-` coarsen or refine it from there (zoom is level of
 * detail; `+` moves toward days). The manual choice is this mount's, the same
 * scope the TUI gives its zoom.
 */

import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Minus, Plus } from "lucide-react";
import type { FC } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatProjectDay } from "../project-model";
import {
	TIMELINE_TIERS,
	TIMELINE_TIER_PX_PER_DAY,
	type TimelineItem,
	type TimelineTier,
	autoTimelineTier,
	dayOffset,
	spanDays,
	timelineBar,
	timelineMarks,
	timelineSections,
	timelineSpan,
	timelineTicks,
	todayUtcMs,
} from "../timeline-model";

/** The pinned name column's width in px — one value for the axis and rows. */
const NAME_COL_PX = 224;

/** The row's height; the bar and the diamonds centre in it. */
const ROW_PX = 36;

const TIER_LABEL: Record<TimelineTier, string> = {
	day: "Days",
	week: "Weeks",
	month: "Months",
	quarter: "Quarters",
};

type ProjectTimelineProps = {
	items: TimelineItem[];
	/** Read once per render by the page, the schedules page's own rule. */
	nowMs: number;
	onOpen: (item: TimelineItem) => void;
	/** How many projects' milestone details are still in flight. */
	pendingDetails: number;
};

export const ProjectTimeline: FC<ProjectTimelineProps> = ({
	items,
	nowMs,
	onOpen,
	pendingDetails,
}) => {
	const [manual, setManual] = useState<TimelineTier | null>(null);
	const [width, setWidth] = useState(0);
	/*
	 * THE PANEL is what is measured, not the track: the panel always mounts
	 * (the track appears only once something is dated), so one observer covers
	 * every frame the component ever draws — and the budget is derived from
	 * the panel's own width, the number the auto tier is really a function of.
	 */
	const panelRef = useRef<HTMLDivElement | null>(null);

	const today = todayUtcMs(nowMs);
	const span = useMemo(() => timelineSpan(items, today), [items, today]);
	const sections = useMemo(() => timelineSections(items), [items]);
	useLayoutEffect(() => {
		const element = panelRef.current;
		if (!element) return;
		const measure = () => setWidth(element.clientWidth);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const budget = Math.max(width - NAME_COL_PX - 24, 160);
	const autoTier = span
		? autoTimelineTier(spanDays(span.startMs, span.endMs), budget)
		: "month";
	const tier = manual ?? autoTier;
	const step = (direction: -1 | 1) => {
		const index = TIMELINE_TIERS.indexOf(tier);
		const next = TIMELINE_TIERS[index - direction];
		if (next) setManual(next);
	};
	const pxPerDay = TIMELINE_TIER_PX_PER_DAY[tier];
	const trackPx = span ? spanDays(span.startMs, span.endMs) * pxPerDay : 0;

	return (
		<div
			ref={panelRef}
			className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline bg-surface"
			data-testid="project-timeline"
		>
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-3 py-2">
				<span className="truncate text-meta text-ink-muted" data-timeline-note>
					{pendingDetails > 0
						? `Loading milestones for ${pendingDetails} project${pendingDetails === 1 ? "" : "s"}…`
						: `${sections.dated.length} dated · ${sections.undated.length} without dates`}
				</span>
				<span className="flex shrink-0 items-center gap-1">
					<Button
						variant="secondary"
						size="icon"
						aria-label="Zoom in"
						title="Zoom in (finer)"
						disabled={tier === TIMELINE_TIERS[0]}
						onClick={() => step(1)}
					>
						<Plus />
					</Button>
					<span className="w-16 text-center text-meta text-ink-muted">
						{TIER_LABEL[tier]}
					</span>
					<Button
						variant="secondary"
						size="icon"
						aria-label="Zoom out"
						title="Zoom out (coarser)"
						disabled={tier === TIMELINE_TIERS[TIMELINE_TIERS.length - 1]}
						onClick={() => step(-1)}
					>
						<Minus />
					</Button>
				</span>
			</div>

			{span && sections.dated.length > 0 ? (
				<div className="min-h-0 flex-1 overflow-auto">
					<div className="min-w-max">
						<Axis
							startMs={span.startMs}
							endMs={span.endMs}
							tier={tier}
							pxPerDay={pxPerDay}
							trackPx={trackPx}
						/>
						{sections.dated.map((item) => (
							<TimelineRow
								key={item.project.id}
								item={item}
								spanStart={span.startMs}
								pxPerDay={pxPerDay}
								trackPx={trackPx}
								today={today}
								onOpen={() => onOpen(item)}
							/>
						))}
					</div>
				</div>
			) : (
				<p className="px-3 py-6 text-body-sm text-ink-muted">
					No dates on any project yet. Set a start date, a target date or a
					milestone date and it will appear on the timeline.
				</p>
			)}

			{sections.undated.length > 0 && (
				<div className="shrink-0 border-t border-hairline px-3 py-2 text-meta text-ink-muted">
					No dates ({sections.undated.length}):{" "}
					{sections.undated.map((item, index) => (
						<span key={item.project.id}>
							{index > 0 && ", "}
							<button
								type="button"
								className="text-ink hover:underline"
								onClick={() => onOpen(item)}
							>
								{item.project.name}
							</button>
						</span>
					))}
				</div>
			)}
		</div>
	);
};

/** The axis row: hairline ticks with their labels, on the pinned-left grid. */
const Axis: FC<{
	startMs: number;
	endMs: number;
	tier: TimelineTier;
	pxPerDay: number;
	trackPx: number;
}> = ({ startMs, endMs, tier, pxPerDay, trackPx }) => {
	const ticks = timelineTicks(startMs, endMs, tier);
	return (
		<div className="flex items-stretch border-b border-hairline">
			<span
				className="sticky left-0 z-10 shrink-0 bg-surface"
				style={{ width: NAME_COL_PX }}
			/>
			<span className="relative block h-6" style={{ width: trackPx }}>
				{ticks.map((tick) => (
					<span
						key={tick.dayMs}
						className="absolute top-0 h-full"
						style={{ left: dayOffset(startMs, tick.dayMs) * pxPerDay }}
					>
						<span
							className={cn(
								"absolute top-0 h-full w-px",
								tick.major ? "bg-hairline" : "bg-hairline/60",
							)}
							aria-hidden="true"
						/>
						<span className="absolute top-1/2 left-1 -translate-y-1/2 whitespace-nowrap text-meta text-ink-muted">
							{tick.label}
						</span>
					</span>
				))}
			</span>
		</div>
	);
};

/** One project's row: the pinned name, then the bar, marks and today marker. */
const TimelineRow: FC<{
	item: TimelineItem;
	spanStart: number;
	pxPerDay: number;
	trackPx: number;
	today: number;
	onOpen: () => void;
}> = ({ item, spanStart, pxPerDay, trackPx, today, onOpen }) => {
	const { project } = item;
	const bar = timelineBar(item);
	const marks = timelineMarks(item);
	const iso = (dayMs: number) => new Date(dayMs).toISOString().slice(0, 10);
	return (
		<button
			type="button"
			onClick={onOpen}
			data-project-name={project.name}
			className="flex w-full items-stretch text-left transition-colors duration-fast ease-out-quart hover:bg-elevated"
		>
			<span
				className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-hairline bg-surface px-3"
				style={{ width: NAME_COL_PX, height: ROW_PX }}
			>
				<span className="truncate text-body-sm text-ink">{project.name}</span>
			</span>
			<span
				className="relative block"
				style={{ width: trackPx, height: ROW_PX }}
			>
				{bar && (
					<span
						className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/70"
						style={{
							left: dayOffset(spanStart, bar.fromMs) * pxPerDay,
							width: (dayOffset(bar.fromMs, bar.toMs) + 1) * pxPerDay,
						}}
						title={`${formatProjectDay(iso(bar.fromMs))} → ${formatProjectDay(iso(bar.toMs))}`}
					/>
				)}
				{marks.map((mark) => (
					<span
						key={`${mark.name}-${mark.dayMs}`}
						data-milestone={mark.status}
						className={cn(
							"absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45",
							mark.status === "completed" && "bg-success",
							mark.status === "overdue" && "bg-warning",
							mark.status === "upcoming" &&
								"border-[1.5px] border-ink-muted bg-surface",
						)}
						style={{ left: dayOffset(spanStart, mark.dayMs) * pxPerDay }}
						title={`${mark.name} · ${mark.status} · ${formatProjectDay(iso(mark.dayMs))}`}
					/>
				))}
				<span
					className="absolute inset-y-0 w-px bg-accent/30"
					style={{ left: dayOffset(spanStart, today) * pxPerDay }}
					aria-hidden="true"
				/>
			</span>
		</button>
	);
};
