import type { ScheduleResponse } from "@shared/api/local-operator";
import { AgentsApi } from "@shared/api/local-operator/agents-api";
import { Button, Skeleton, Switch, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { SquarePen, Trash2 } from "lucide-react";
import type { FC } from "react";
import { useId } from "react";

const formatTime = (date: Date): string => {
	return date.toLocaleTimeString(navigator.language, {
		hour: "numeric",
		minute: "2-digit",
	});
};

const formatDate = (date: Date, includeYear: boolean): string => {
	const options: Intl.DateTimeFormatOptions = {
		weekday: "long",
		month: "long",
		day: "numeric",
	};
	if (includeYear) {
		options.year = "numeric";
	}
	return date.toLocaleDateString(navigator.language, options);
};

/**
 * The line a person reads to know when a schedule runs.
 *
 * Cadence and times are built separately because a one-time schedule has no
 * cadence at all. The previous shape put "Every <unit>" in front
 * unconditionally and cancelled it only when the schedule had neither a start
 * nor an end time — that is, never in the case that reads wrong — so a job
 * that runs once announced itself as running every day.
 */
/**
 * The recurrence units that repeat more than once a day.
 *
 * A static table rather than a `Set`: the membership is fixed at authoring
 * time, and a module-scope literal costs nothing per render.
 */
const SUB_DAY_UNITS: Record<string, true> = {
	minutes: true,
	hours: true,
};

const createScheduleDisplayString = (schedule: ScheduleResponse): string => {
	const currentYear = new Date().getFullYear();
	const startTime = schedule.start_time_utc
		? new Date(schedule.start_time_utc)
		: null;
	const endTime = schedule.end_time_utc
		? new Date(schedule.end_time_utc)
		: null;

	/* A one-time run dates itself every time it prints: "at 11:40 PM" alone
	   leaves the reader asking which day. A recurring one never does — the
	   date of one occurrence is not a fact about the schedule. */
	const withDate = (date: Date): string => {
		if (!schedule.one_time) return formatTime(date);
		const dated = formatDate(date, date.getFullYear() !== currentYear);
		return `${formatTime(date)} on ${dated}`;
	};

	/* The end of a recurrence is the exception, and it is not an occurrence.
	   "Every day at 8:16 PM to 11:30 PM" is what a schedule running for four
	   days rendered as - character-identical to one that stops the same night,
	   because the rule above dropped the date that was the entire difference
	   between them. When a recurrence stops IS a fact about the schedule, so
	   it always carries its day. */
	const alwaysDated = (date: Date): string =>
		`${formatTime(date)} on ${formatDate(date, date.getFullYear() !== currentYear)}`;

	let displayString: string;
	if (schedule.one_time) {
		displayString = "Once";
	} else if (schedule.interval === 1) {
		displayString = `Every ${schedule.unit.slice(0, -1)}`; // Remove 's'
	} else {
		displayString = `Every ${schedule.interval} ${schedule.unit}`;
	}

	/* A one-time job with both ends is a window, not a start with a trailing
	   bound: "Once at 1:05 AM on Thursday to 2:05 AM" reads as two events, and
	   the reader has to work out that the second is the same one ending. The
	   repeating case keeps "at ... to ...", because there the start really is a
	   recurring instant and the end really is when the recurrence stops. */
	const oneTimeWindow = Boolean(schedule.one_time && startTime && endTime);

	/* A wall-clock time is only true of a recurrence that happens once a day or
	   less often. "Every hour at 12:19 PM" says the job runs at 12:19 PM, and
	   it does not - it runs at 19 minutes past every hour, and the row above it
	   reading "Every day at 8:19 PM" teaches the reader to take the first one
	   literally.

	   Hourly jobs get the offset they actually have. Minute-interval jobs get
	   nothing: an offset within a 15-minute cycle is real but unsayable in a
	   phrase this size - "every 15 minutes at 7 past" invites the reader to
	   work out :07, :22, :37, :52 - and "Every 15 minutes" is already the whole
	   truth a reader of this row needs. */
	/* The CYCLE has to be under a day, not just the unit: "every 48 hours" is a
	   two-day recurrence written in hours, and dropping its wall-clock time
	   would lose the only thing that says which part of which day it runs. The
	   interval field has a min of 1 and no max, so this is reachable input and
	   not a hypothetical. */
	const cycleMinutes =
		schedule.interval * (schedule.unit === "minutes" ? 1 : 60);
	const recursWithinADay =
		!schedule.one_time &&
		SUB_DAY_UNITS[schedule.unit] === true &&
		cycleMinutes < 24 * 60;

	if (startTime && !oneTimeWindow) {
		if (recursWithinADay) {
			const past = startTime.getMinutes();
			if (schedule.unit === "hours") {
				displayString +=
					past === 0
						? " on the hour"
						: ` at ${past} minute${past === 1 ? "" : "s"} past`;
			}
		} else {
			displayString += ` at ${withDate(startTime)}`;
		}
	}

	if (oneTimeWindow && startTime && endTime) {
		/* Within one day the end carries the date for both, so the day is named
		   once. Across midnight it cannot: "between 11:00 PM and 1:00 AM on
		   Thursday" puts the start on Thursday too, which is a day out. */
		const sameDay = startTime.toDateString() === endTime.toDateString();
		displayString += sameDay
			? ` between ${formatTime(startTime)} and ${withDate(endTime)}`
			: ` between ${withDate(startTime)} and ${withDate(endTime)}`;
	} else if (endTime) {
		if (!schedule.one_time) {
			/* One rule for every recurrence, whatever its unit: the end is when
			   the repeating stops, and it names its day. " to 11:30 PM" read as
			   the far side of a nightly window, and after the sub-day branch
			   landed it could also read "at 16 minutes past to 11:30 PM". */
			displayString += `, ending at ${alwaysDated(endTime)}`;
		} else if (startTime) {
			/* The start already named the day, so an end on the same day repeats
			   it for nothing. */
			const sameDay = startTime.toDateString() === endTime.toDateString();
			displayString += ` to ${sameDay ? formatTime(endTime) : withDate(endTime)}`;
		} else {
			displayString += `, ending at ${withDate(endTime)}`;
		}
	}

	return displayString;
};

type ScheduleListItemProps = {
	schedule: ScheduleResponse;
	onEdit: (schedule: ScheduleResponse) => void;
	onDelete: (scheduleId: string) => void;
	onToggleActive: (schedule: ScheduleResponse) => void;
};

const useAgentName = (agentId: string) => {
	const baseUrl = apiConfig.baseUrl;

	return useQuery({
		queryKey: ["agent-name", agentId, baseUrl],
		queryFn: async () => {
			if (!baseUrl) {
				// eslint-disable-next-line no-console
				console.warn("Base URL for Local Operator API is not configured.");
				return "Agent ID";
			}
			const response = await AgentsApi.getAgent(baseUrl, agentId);
			return response.result?.name || "Unknown agent";
		},
		enabled: !!agentId && !!baseUrl,
		staleTime: 1000 * 60 * 5,
	});
};

/**
 * One schedule row.
 *
 * ## What the row says now, and what it stopped saying
 *
 * It was five stacked blocks — prompt, an accent pill for the agent, the
 * cadence, a coloured `Status: Active` sentence, and a right-aligned raw UUID —
 * running about 166px per schedule. Four schedules did not fit on a laptop
 * screen.
 *
 * It is now two lines in a fixed rhythm, the shape Fantastical and Notion
 * Calendar use for an agenda row: **what it does** at reading weight on line
 * one, and **when, and who for** as one caption on line two. That is 64px.
 *
 * Specifics worth writing down:
 *
 * - **The prompt is `ink`, not `ink-muted`.** It was the only content in the
 *   row and it was set as secondary text under an accent-coloured badge.
 * - **The agent is plain text, not an accent pill.** The accent is spent about
 *   three times per screen; a list of twenty schedules was spending it twenty.
 * - **The UUID is gone from the surface** and lives on the row's `title`, so it
 *   is still there for anyone debugging and absent for everyone else.
 * - **`Status: Active` is a switch.** The page already implements and passes
 *   `onToggleActive`, and the row never called it — so the list could tell you
 *   a schedule was inactive and offer no way to change that. Reporting a state
 *   with no affordance to change it is the definition of a dead end.
 * - **Hover is `elevated`.** It was `hover:bg-surface` inside a `bg-surface`
 *   container, so hovering a row did nothing at all.
 */
export const ScheduleListItem: FC<ScheduleListItemProps> = ({
	schedule,
	onEdit,
	onDelete,
	onToggleActive,
}) => {
	const { data: agentName, isLoading: isLoadingAgentName } = useAgentName(
		schedule.agent_id,
	);
	const switchId = useId();

	return (
		<div
			title={`Schedule ID: ${schedule.id}`}
			className={cn(
				"group flex items-start gap-3 border-hairline border-b px-4 py-3 last:border-b-0",
				"transition-colors duration-fast ease-out-quart hover:bg-elevated",
			)}
		>
			<div className={cn("flex min-w-0 flex-1 flex-col gap-1")}>
				<p
					className={cn(
						"min-w-0 break-words text-body-sm",
						// An inactive schedule is not running, and its prompt reads back
						// at caption weight to say so without a coloured label.
						schedule.is_active ? "text-ink" : "text-ink-muted",
					)}
				>
					{schedule.prompt}
				</p>
				<p className={cn("flex flex-wrap items-center gap-x-1.5 text-meta")}>
					<span className={cn("text-ink-muted")}>
						{createScheduleDisplayString(schedule)}
					</span>
					<span aria-hidden="true" className={cn("text-ink-dim")}>
						·
					</span>
					{isLoadingAgentName ? (
						<Skeleton className={cn("h-3 w-24")} />
					) : (
						<span className={cn("truncate text-ink-dim")}>
							{agentName || schedule.agent_id.substring(0, 8)}
						</span>
					)}
				</p>
			</div>

			<div className={cn("flex shrink-0 items-center gap-1")}>
				{/*
				 * The switch is always drawn — it carries the schedule's state, so
				 * hiding it until hover would hide the state. Edit and delete are
				 * actions, and they reveal like every other row action in the app.
				 */}
				<Tooltip
					content={schedule.is_active ? "Pause schedule" : "Resume schedule"}
				>
					<span className={cn("flex items-center pr-1")}>
						<Switch
							id={switchId}
							checked={schedule.is_active}
							onCheckedChange={() => onToggleActive(schedule)}
							aria-label={
								schedule.is_active ? "Pause schedule" : "Resume schedule"
							}
						/>
					</span>
				</Tooltip>
				<div
					className={cn(
						"flex items-center gap-0.5",
						"pointer-events-none opacity-0",
						"group-hover:pointer-events-auto group-hover:opacity-100",
						"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
					)}
				>
					<Tooltip content="Edit schedule">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => onEdit(schedule)}
							aria-label="Edit schedule"
						>
							<SquarePen />
						</Button>
					</Tooltip>
					<Tooltip content="Delete schedule">
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => onDelete(schedule.id)}
							aria-label="Delete schedule"
							className={cn("hover:bg-danger-wash hover:text-danger")}
						>
							<Trash2 />
						</Button>
					</Tooltip>
				</div>
			</div>
		</div>
	);
};
