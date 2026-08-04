import type { ScheduleResponse } from "@shared/api/local-operator";
import { AgentsApi } from "@shared/api/local-operator/agents-api";
import { Badge, Button, Skeleton, Tooltip } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Edit, Trash2, User } from "lucide-react";
import type { FC } from "react";

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

const createScheduleDisplayString = (schedule: ScheduleResponse): string => {
	let intervalString: string;
	if (schedule.interval === 1) {
		intervalString = `Every ${schedule.unit.slice(0, -1)}`; // Remove 's'
	} else {
		intervalString = `Every ${schedule.interval} ${schedule.unit}`;
	}
	let displayString = intervalString;

	const now = new Date();
	const currentYear = now.getFullYear();

	if (schedule.start_time_utc) {
		const startTime = new Date(schedule.start_time_utc);
		displayString += ` @ ${formatTime(startTime)}`;
		if (schedule.one_time) {
			const startYear = startTime.getFullYear();
			displayString += ` on ${formatDate(startTime, startYear !== currentYear)}`;
		}
	}

	if (schedule.end_time_utc) {
		const endTime = new Date(schedule.end_time_utc);
		if (schedule.start_time_utc) {
			// If there's a start time, "to" indicates the end of a range for that start instance
			displayString += ` to ${formatTime(endTime)}`;
			if (schedule.one_time) {
				// Only add date part if it's different from start_time's date or if start_time wasn't one_time formatted
				const startTime = schedule.start_time_utc
					? new Date(schedule.start_time_utc)
					: null;
				if (!startTime || startTime.toDateString() !== endTime.toDateString()) {
					const endYear = endTime.getFullYear();
					displayString += ` on ${formatDate(endTime, endYear !== currentYear)}`;
				}
			}
		} else {
			// If no start time, "ends @ ..."
			displayString += ` ending @ ${formatTime(endTime)}`;
			if (schedule.one_time) {
				const endYear = endTime.getFullYear();
				displayString += ` on ${formatDate(endTime, endYear !== currentYear)}`;
			}
		}
	}

	if (schedule.one_time && !schedule.start_time_utc && !schedule.end_time_utc) {
		displayString += " (One-time)";
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
			return response.result?.name || "Unknown Agent";
		},
		enabled: !!agentId && !!baseUrl,
		staleTime: 1000 * 60 * 5,
	});
};

/**
 * One schedule row.
 *
 * Rows are separated by hairlines on the list side, not boxed per row: the
 * old bordered Paper-per-row doubled the boundary the container already
 * provides. Hover only nudges the row to the next ground step.
 */
export const ScheduleListItem: FC<ScheduleListItemProps> = ({
	schedule,
	onEdit,
	onDelete,
}) => {
	const { data: agentName, isLoading: isLoadingAgentName } = useAgentName(
		schedule.agent_id,
	);

	return (
		<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-hairline px-4 py-3 transition-colors duration-fast ease-out-quart last:border-b-0 hover:bg-surface">
			<p className="min-w-0 break-words text-body-sm text-ink-muted">
				{schedule.prompt}
			</p>

			<div className="flex items-start gap-1">
				<Tooltip content="Edit schedule">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => onEdit(schedule)}
						aria-label="Edit Schedule"
					>
						<Edit />
					</Button>
				</Tooltip>
				<Tooltip content="Delete schedule">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => onDelete(schedule.id)}
						aria-label="Delete Schedule"
					>
						<Trash2 />
					</Button>
				</Tooltip>
			</div>

			<div className="col-span-2 flex flex-col gap-1">
				<div className="flex min-h-7 items-center">
					{isLoadingAgentName ? (
						<Skeleton className="h-6 w-20 rounded-full" />
					) : (
						<Badge variant="accent" shape="pill" aria-label="Agent Name">
							<User size={12} aria-hidden="true" />
							<span className="max-w-40 truncate">
								{agentName || schedule.agent_id.substring(0, 8)}
							</span>
						</Badge>
					)}
				</div>
				<p className="text-ink-muted text-meta">
					{createScheduleDisplayString(schedule)}
				</p>
				<p
					className={cn(
						"text-meta",
						schedule.is_active ? "text-success" : "text-danger",
					)}
				>
					Status: {schedule.is_active ? "Active" : "Inactive"}
				</p>
			</div>

			<p className="col-span-2 text-right text-ink-dim text-mono-sm">
				ID: {schedule.id}
			</p>
		</div>
	);
};
