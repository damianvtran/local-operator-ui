/**
 * One monitor-carrying conversation on the Schedules page (#1898): its name,
 * its tally (or that it is parked), and its standing watches beneath it.
 *
 * The wake row's twin (`wake-conversation-row.tsx`) in shape - the conversation
 * is the row, the head carries the name and one trailing clause, the lines sit
 * one step in, and `Open conversation` is the row's hover/focus-revealed action
 * - so the two sections read as one page. The LINES are the run pane's own
 * `MonitorRowView`, cancel control included, so a watch looks and cancels the
 * same here as in the conversation it belongs to.
 *
 * Presentational: the cancel interaction (confirmation, in-flight window, the
 * per-row `Cancelled`/`Cancel refused` records) is the PAGE's, passed in as
 * `cancel`, because a cancel's re-read can drop this whole row - the last watch
 * of a conversation retires the entry - and a dialog owned here would unmount
 * mid-refusal (the pane's measured U2, one level up; see `use-monitor-cancel.ts`).
 */
import { MonitorRowView } from "@features/chat/components/run-details/run-detail-monitors";
import type { MonitorCancelSection } from "@features/chat/components/run-details/use-monitor-cancel";
import { Button, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ArrowUpRight } from "lucide-react";
import type { FC } from "react";
import type { MonitorConversationRow as MonitorConversationRowModel } from "../scheduled-task-model";

export type MonitorConversationRowProps = {
	row: MonitorConversationRowModel;
	/** Open the conversation this row is: the row's own affordance. */
	onOpen: (sessionId: string) => void;
	/** The page's cancel interaction: the ask, and each line's own state. */
	cancel: MonitorCancelSection;
};

export const MonitorConversationRow: FC<MonitorConversationRowProps> = ({
	row,
	onOpen,
	cancel,
}) => {
	useI18nLocale();
	return (
		<li
			data-monitor-conversation-row={row.sessionId}
			className={cn(
				"group border-hairline border-b px-4 py-3 last:border-b-0",
				"transition-colors duration-fast ease-out-quart hover:bg-row-hover",
			)}
		>
			<div className={cn("flex items-start gap-3")}>
				<div className={cn("flex min-w-0 flex-1 flex-col gap-1")}>
					<div
						className={cn("flex min-w-0 items-baseline justify-between gap-2")}
					>
						<span
							className={cn("min-w-0 truncate text-body-sm text-ink")}
							title={row.cwd}
						>
							{row.name}
						</span>
						{row.meta && (
							<span className={cn("shrink-0 text-ink-muted text-meta")}>
								{row.meta}
							</span>
						)}
					</div>
					{/* `pl-4`: the wake lines' indent, so both sections' lines sit in
					    one column under their conversation names. */}
					<ul className={cn("flex flex-col gap-1 pl-4")}>
						{row.monitors.map((monitor) => (
							<MonitorRowView
								key={monitor.id}
								row={monitor}
								cancel={cancel}
								/* U3: the reason wraps here; the page has the width the pane lacks. */
								wrapHealth={true}
							/>
						))}
					</ul>
				</div>
				{/*
				 * Revealed on hover AND focus-within, the wake row's pair: hover alone
				 * would leave the control unreachable by Tab. The lines' own cancel
				 * stays visible at rest (the pane's U6), which is why it is not in
				 * this column.
				 */}
				<div
					className={cn(
						"flex shrink-0 items-center gap-0.5",
						"pointer-events-none opacity-0",
						"group-hover:pointer-events-auto group-hover:opacity-100",
						"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
					)}
				>
					<Tooltip
						content={t("ui.schedules.wake_conversation_row.open_conversation")}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t(
								"ui.schedules.wake_conversation_row.open_conversation",
							)}
							onClick={() => onOpen(row.sessionId)}
						>
							<ArrowUpRight />
						</Button>
					</Tooltip>
				</div>
			</div>
		</li>
	);
};
