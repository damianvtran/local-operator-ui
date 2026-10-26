/**
 * One reel row (design.md § 4): lead slot, priority glyph, two lines, time, and
 * the hover/focus actions that replace the time.
 *
 * WHY THE LEAD SLOT NEVER CHANGES WIDTH. The unread dot becomes the checkbox on
 * hover, focus or in selection mode; both live in one 16px column so a pointer
 * crossing the list does not reflow every row it passes (design § 4 "Lead").
 *
 * WHY A LIVE ASK HAS NO DISMISS. Dismissing it in one click would leave a turn
 * waiting on an answer that will never come (design § 6, contract § 2.3). Its
 * trailing slot offers Answer instead; the reasoned "Dismiss ask…" door lives
 * in the detail (decisions D4).
 *
 * WHY ACTIONS ARE BUTTONS INSIDE A ROW THAT IS NOT ONE. The row is a grid row
 * with roving tabindex (design § 14); its buttons are reached with arrow keys
 * from the page's key handler, so the row stays one tab stop.
 */
import { Badge, Checkbox, countLabel } from "@shared/components/ui";
import { Tooltip } from "@shared/components/ui/tooltip";
import { formatDate, formatNumber, formatTime, t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import {
	Check,
	Circle,
	Eye,
	MessageCircleQuestion,
	Reply,
	X,
} from "lucide-react";
import type { FC, MouseEvent } from "react";
import type { DesktopNotificationItem } from "../../../../../shared/desktop-control-contract";
import {
	type RowTime,
	isLiveAsk,
	rowTimeOf,
	seenMarkOf,
} from "../notifications-model";
import { PriorityBars } from "./priority-bars";

export const rowTimeText = (time: RowTime): string => {
	switch (time.kind) {
		case "now":
			return t("ui.notifications.time.now");
		case "minutes":
			return t("ui.notifications.time.minutes", {
				count: formatNumber(time.count),
			});
		case "hours":
			return t("ui.notifications.time.hours", {
				count: formatNumber(time.count),
			});
		case "clock":
			return formatTime(time.at, { hour: "2-digit", minute: "2-digit" });
		case "date":
			return formatDate(time.at, { weekday: "short", day: "numeric" });
	}
};

export const priorityName = (item: DesktopNotificationItem): string =>
	item.priority === "high"
		? t("ui.notifications.row.priority.high")
		: item.priority === "normal"
			? t("ui.notifications.row.priority.normal")
			: t("ui.notifications.row.priority.low");

export type NotificationRowProps = {
	item: DesktopNotificationItem;
	nowMs: number;
	/** The row is the one the detail pane shows. */
	open: boolean;
	/** The row is in the multi-selection. */
	picked: boolean;
	/** Something is selected anywhere, so every row shows its checkbox. */
	selecting: boolean;
	/** The roving tab stop: only one row in the grid is tabbable. */
	focused: boolean;
	/** Row writes are paused (refresh failed with data held, design § 5). */
	writesPaused: boolean;
	onOpen: (item: DesktopNotificationItem) => void;
	onToggleSelect: (item: DesktopNotificationItem, shift: boolean) => void;
	onToggleRead: (item: DesktopNotificationItem) => void;
	onDismiss: (item: DesktopNotificationItem) => void;
	onAnswer: (item: DesktopNotificationItem) => void;
	onFocusRow: (item: DesktopNotificationItem) => void;
	/** Shown instead of the source on line 2 (the drawer, which implies it). */
	hideSource?: boolean;
};

export const NotificationRow: FC<NotificationRowProps> = ({
	item,
	nowMs,
	open,
	picked,
	selecting,
	focused,
	writesPaused,
	onOpen,
	onToggleSelect,
	onToggleRead,
	onDismiss,
	onAnswer,
	onFocusRow,
	hideSource = false,
}) => {
	const liveAsk = isLiveAsk(item);
	const unread = !item.read;
	const seen = seenMarkOf(item);
	const time = rowTimeText(rowTimeOf(item.updated_at, nowMs));
	const source = item.session.title || t("ui.notifications.group.untitled");
	const repeat = item.repeat_count > 1 ? item.repeat_count : 0;
	const label = t("ui.notifications.row.a11y", {
		read: unread ? "false" : "true",
		priority: priorityName(item),
		title: item.title,
		source,
		age: time,
		repeat,
	});
	const line2 = (() => {
		if (liveAsk) {
			const parts: string[] = [];
			const options = item.ask?.question_count;
			if (typeof options === "number" && options > 0)
				parts.push(t("ui.notifications.row.ask_options", { options }));
			const deadline = item.ask?.deadline_at;
			if (typeof deadline === "number" && deadline > nowMs) {
				const minutes = Math.max(1, Math.round((deadline - nowMs) / 60_000));
				parts.push(
					t("ui.notifications.row.ask_expires", {
						time:
							minutes < 60
								? t("ui.notifications.time.minutes", {
										count: formatNumber(minutes),
									})
								: t("ui.notifications.time.hours", {
										count: formatNumber(Math.round(minutes / 60)),
									}),
					}),
				);
			}
			return parts.length > 0 ? parts.join(" · ") : item.excerpt;
		}
		if (repeat > 0)
			return `${t("ui.notifications.row.updated_ago", { age: time })} · ${item.excerpt}`;
		return item.excerpt;
	})();
	const stop = (event: MouseEvent) => event.stopPropagation();
	const pausedTip = writesPaused
		? t("ui.notifications.writes_paused_tip")
		: null;

	return (
		/*
		 * `role="row"` inside the page's `role="grid"` (design § 14). The click
		 * opens the detail; the lead slot and the action buttons stop propagation
		 * so their own press is the only effect.
		 */
		/* biome-ignore lint/a11y/useKeyWithClickEvents: the row's keyboard contract lives on the grid (arrows, Enter, Space, E, U, X: `onListKeyDown`), the design's one-tab-stop rule; a per-row key handler would fire twice */
		<div
			// biome-ignore lint/a11y/useSemanticElements: a reel row is a grid row with roving tabindex and in-row action buttons (design.md section 14); a native table cannot host that keyboard contract
			role="row"
			aria-selected={picked}
			aria-label={label}
			tabIndex={focused ? 0 : -1}
			data-notification-row={item.id}
			data-notification-unread={unread ? "" : undefined}
			data-notification-open={open ? "" : undefined}
			onClick={(event) => {
				if (event.shiftKey || selecting) {
					onToggleSelect(item, event.shiftKey);
					return;
				}
				onOpen(item);
			}}
			onFocus={() => onFocusRow(item)}
			className={cn(
				"group/row relative flex h-14 cursor-default items-center gap-3 px-3",
				"outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2",
				"transition-colors duration-fast ease-out-quart",
				picked
					? "bg-accent-wash"
					: open
						? "bg-row-selected"
						: "hover:bg-row-hover",
			)}
		>
			<div
				// biome-ignore lint/a11y/useSemanticElements: a gridcell of the reel's grid row; the row, not the cell, is the tab stop (roving tabindex), and a native <td> cannot sit in a flex row
				role="gridcell"
				tabIndex={-1}
				className="flex w-4 shrink-0 justify-center"
			>
				{/*
				 * The dot and the checkbox share the slot. The checkbox is always in the
				 * DOM (so its accessible name and tab order are stable) and only its
				 * visibility moves; `selecting` forces it on for every row.
				 */}
				<span
					aria-hidden="true"
					className={cn(
						"size-1.5 rounded-full bg-accent forced-colors:bg-[CanvasText]",
						(!unread || selecting) && "invisible",
						"group-hover/row:invisible group-focus-within/row:invisible",
					)}
				/>
				<span
					className={cn(
						"absolute flex size-6 items-center justify-center",
						selecting || picked
							? "visible"
							: "invisible group-hover/row:visible group-focus-within/row:visible",
					)}
					onClick={stop}
					onKeyDown={(event) => event.stopPropagation()}
				>
					<Checkbox
						checked={picked}
						tabIndex={-1}
						aria-label={t("ui.notifications.row.select", { title: item.title })}
						onClick={(event) => {
							event.stopPropagation();
							onToggleSelect(item, event.shiftKey);
						}}
					/>
				</span>
			</div>
			<div
				// biome-ignore lint/a11y/useSemanticElements: a gridcell of the reel's grid row; the row, not the cell, is the tab stop (roving tabindex), and a native <td> cannot sit in a flex row
				role="gridcell"
				tabIndex={-1}
				className="flex w-5 shrink-0 justify-center"
			>
				{item.source === "ask" ? (
					<MessageCircleQuestion
						size={16}
						aria-hidden="true"
						className={liveAsk ? "text-info" : "text-ink-dim"}
					/>
				) : (
					<PriorityBars priority={item.priority} />
				)}
			</div>
			<div
				// biome-ignore lint/a11y/useSemanticElements: a gridcell of the reel's grid row; the row, not the cell, is the tab stop (roving tabindex), and a native <td> cannot sit in a flex row
				role="gridcell"
				tabIndex={-1}
				className="flex min-w-0 flex-1 flex-col gap-0.5"
			>
				<div className="flex min-w-0 items-center gap-1.5">
					<span
						className={cn(
							"min-w-0 truncate text-body-sm",
							unread ? "font-semibold text-ink" : "text-ink-muted",
						)}
					>
						{item.title}
					</span>
					{item.priority === "high" && item.source === "notify" && (
						<Badge variant="warning" size="count" className="h-4.5 px-1.5">
							{t("ui.notifications.row.chip.high")}
						</Badge>
					)}
					{repeat > 0 && (
						<Badge variant="neutral" size="count">
							{t("ui.notifications.row.chip.repeat", {
								count: countLabel(repeat, 99),
							})}
						</Badge>
					)}
				</div>
				<div className="flex min-w-0 items-center gap-1 text-ink-dim text-meta">
					{!hideSource && (
						<>
							<span className="shrink-0 text-ink-muted">{source}</span>
							<span aria-hidden="true">·</span>
						</>
					)}
					{seen && (
						<Tooltip
							content={
								seen === "live"
									? t("ui.notifications.seen.live_hint")
									: t("ui.notifications.seen.in_view_hint")
							}
						>
							<span
								className="inline-flex shrink-0 items-center gap-1"
								data-notification-seen={seen}
							>
								<Eye size={12} aria-hidden="true" />
								{seen === "live"
									? t("ui.notifications.seen.live")
									: t("ui.notifications.seen.in_view")}
							</span>
						</Tooltip>
					)}
					{seen && <span aria-hidden="true">·</span>}
					<span className="min-w-0 truncate">{line2}</span>
				</div>
			</div>
			<div
				// biome-ignore lint/a11y/useSemanticElements: a gridcell of the reel's grid row; the row, not the cell, is the tab stop (roving tabindex), and a native <td> cannot sit in a flex row
				role="gridcell"
				tabIndex={-1}
				className="relative flex h-7 w-16 shrink-0 items-center justify-end"
			>
				<span
					className={cn(
						"text-ink-dim text-meta tabular-nums",
						"group-hover/row:invisible group-focus-within/row:invisible",
					)}
				>
					{time}
				</span>
				<span
					className={cn(
						"absolute inset-e-0 flex items-center gap-0.5",
						"invisible group-hover/row:visible group-focus-within/row:visible",
					)}
				>
					<RowAction
						label={
							pausedTip ??
							(unread
								? t("ui.notifications.row.mark_read")
								: t("ui.notifications.row.mark_unread"))
						}
						disabled={writesPaused}
						onPress={() => onToggleRead(item)}
						data-row-action="read"
					>
						{unread ? <Check size={14} /> : <Circle size={14} />}
					</RowAction>
					{liveAsk ? (
						<RowAction
							label={t("ui.notifications.row.answer")}
							onPress={() => onAnswer(item)}
							data-row-action="answer"
						>
							<Reply size={14} />
						</RowAction>
					) : (
						<RowAction
							label={pausedTip ?? t("ui.notifications.row.dismiss")}
							disabled={writesPaused}
							onPress={() => onDismiss(item)}
							data-row-action="dismiss"
						>
							<X size={14} />
						</RowAction>
					)}
				</span>
			</div>
		</div>
	);
};

/**
 * A 28x28 icon button in the row's trailing slot (design § 4: measured 28x28,
 * above the 24px minimum target). `aria-disabled` rather than `disabled` so a
 * paused control keeps its place in the arrow-key walk and its tooltip says
 * why (design § 5 "writes are paused").
 */
/**
 * One hover/focus action on a row.
 *
 * EXPORTED because the transcript drawer's Updates tab needs the same control
 * (design audit OD3): the drawer had keyboard-only writes and no pointer
 * affordance at all, and a second hand-written button beside this one would be
 * a second disabled/tooltip/tab-stop contract to keep in step.
 */
export const RowAction: FC<{
	label: string;
	disabled?: boolean;
	onPress: () => void;
	children: React.ReactNode;
	"data-row-action": string;
	"data-row-visible"?: string;
}> = ({ label, disabled = false, onPress, children, ...rest }) => (
	<Tooltip content={label}>
		<button
			type="button"
			tabIndex={-1}
			aria-label={label}
			aria-disabled={disabled || undefined}
			data-row-action={rest["data-row-action"]}
			data-row-visible={rest["data-row-visible"]}
			onClick={(event) => {
				event.stopPropagation();
				if (disabled) return;
				onPress();
			}}
			className={cn(
				"flex size-7 items-center justify-center rounded-sm text-ink-muted",
				"hover:bg-elevated hover:text-ink",
				"focus-visible:outline-2 focus-visible:outline-accent",
				disabled &&
					"text-ink-disabled hover:bg-transparent hover:text-ink-disabled",
			)}
		>
			{children}
		</button>
	</Tooltip>
);
