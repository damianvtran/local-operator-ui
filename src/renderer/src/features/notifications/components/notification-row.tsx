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
import type { FC } from "react";
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

/**
 * THE ONE ALIGNMENT TOKEN for the row's side columns: the height of the title's
 * line box (`text-body-sm` x its line height, 19.5px at the default scale).
 *
 * WHY (operator report, 2026-10-28). The row centred its cells on the row's
 * middle (`items-center`) and the lead cell had no height of its own: its only
 * in-flow child was the 6px unread dot, so the row centred a 6px box and the
 * 24px checkbox - absolutely positioned at that box's static top - hung from the
 * row's midline down past the second line. The checkbox, the priority glyph and
 * the trailing actions now each sit in a cell exactly one first-line tall, at the
 * same top padding as the text, and centre inside it. Their centre is therefore
 * the first line's centre BY CONSTRUCTION, whatever the row's height does below
 * it (a High badge, a second line, a longer excerpt). The checkbox itself is
 * 24px, not a 16px control inside a larger inert wrapper.
 */
const FIRST_LINE_CELL =
	"h-[calc(var(--text-body-sm)*var(--text-body-sm--line-height))] items-center";

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
			/*
			 * The RENDERED revision, exposed for the native scene's negatives: a
			 * press that the store refuses because the row it drew is stale proves
			 * nothing about focus, so the scene has to compare what it is about to
			 * press against the store before pressing (review round 4, R4-2).
			 */
			data-notification-revision={item.revision}
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
				/*
				 * `items-start` + `py-2`: the text block and every side cell share one top
				 * edge, so FIRST_LINE_CELL lines them up (see above). `min-h-14` keeps the
				 * measured 56px row for the usual two lines.
				 */
				"group/row relative flex min-h-14 cursor-default items-start gap-3 px-3 py-2",
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
				className={cn(
					"relative flex w-4 shrink-0 justify-center",
					FIRST_LINE_CELL,
				)}
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
					data-notification-select=""
					className={cn(
						"absolute flex size-6 items-center justify-center",
						selecting || picked
							? "visible"
							: "invisible group-hover/row:visible group-focus-within/row:visible",
					)}
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						// Activation belongs to the checkbox; list chords (especially
						// Cmd/Ctrl+A after a pointer click) must still reach the grid.
						if (event.key === " " || event.key === "Enter")
							event.stopPropagation();
					}}
				>
					<Checkbox
						checked={picked}
						tabIndex={-1}
						className="size-6"
						onClick={(event) => {
							event.stopPropagation();
							onToggleSelect(item, event.shiftKey);
						}}
						aria-label={t("ui.notifications.row.select", { title: item.title })}
					/>
				</span>
			</div>
			<div
				// biome-ignore lint/a11y/useSemanticElements: a gridcell of the reel's grid row; the row, not the cell, is the tab stop (roving tabindex), and a native <td> cannot sit in a flex row
				role="gridcell"
				tabIndex={-1}
				className={cn("flex w-5 shrink-0 justify-center", FIRST_LINE_CELL)}
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
						data-notification-title=""
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
				/*
				 * The 28px actions overflow the 19.5px first-line cell symmetrically
				 * (flex centring), so they too centre on the title line.
				 */
				className={cn(
					"relative flex w-16 shrink-0 justify-end",
					FIRST_LINE_CELL,
				)}
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
