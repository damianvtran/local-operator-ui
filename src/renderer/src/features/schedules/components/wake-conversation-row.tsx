/**
 * One row of the Schedules page: a conversation that has wakes, and its wakes
 * beneath it.
 *
 * ## Why the conversation is the row
 *
 * The row this replaces was a rule plus an AGENT name, and there was nowhere on
 * the page to go and see what the rule did. The thing the page creates is a
 * conversation, so the thing the page lists has to be one: the name is the
 * object the user can open, the wake lines are what it is armed to do, and a
 * conversation with three wakes is one thing rather than three unrelated rows.
 *
 * ## Where it follows the run pane, and where it deliberately does not
 *
 * The wake lines ARE the pane's rows: `WakeRowView` is the same component, so
 * the mark, the due label, the cadence vocabulary and the clamped prompt cannot
 * drift between the two surfaces. What differs is the interaction, and each
 * difference is argued rather than inherited:
 *
 * - the row is interactive: the head opens the conversation, and each wake line
 *   carries `Cancel wake`. The pane's rows carry the same control now (the
 *   wakes control slice), composed for the pane's own surface, and the two
 *   surfaces read their verdicts from ONE model (`wake-controls-model.ts`): a
 *   line whose schedule the engine owns (`aida-*`) shows the managed state
 *   instead of a cancel, on BOTH surfaces, because the desktop route refuses
 *   those ids (its `WakeId` pattern is `^w\d{1,4}$`) and a control that can only
 *   fail is worse than no control. A conversation with more than
 *   `WAKE_LINE_CAP` wakes hides the rest behind a `Disclosure` whose label
 *   carries the count. The pane uses a statement marker because nothing there
 *   can cancel; here a shed line can be brought back, so the control is the
 *   app's one disclosure idiom.
 *
 * ## Hover-revealed actions, and the state that is always drawn
 *
 * The actions reveal on hover and on focus-within, the app's own row idiom
 * (`schedule-list-item.tsx`): a list of conversations should read as a list of
 * conversations, not as a list of buttons. What is ALWAYS drawn is the row's
 * own state - the count, the next fire, or `Parked` - because a state that only
 * appears under the pointer is a state the reader has to hunt for.
 */
import {
	WakeManagedNote,
	WakeManagedState,
	WakeRowView,
} from "@features/chat/components/run-details/run-detail-wakes";
import {
	type AidaWakeIdentity,
	wakeControlMode,
} from "@features/chat/components/run-details/wake-controls-model";
import { Button, Tooltip } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { ArrowUpRight, SquarePen, X } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import {
	type ScheduledTaskRow,
	type WakeLine,
	hiddenWakesLabel,
} from "../scheduled-task-model";

export type WakeConversationRowProps = {
	row: ScheduledTaskRow;
	/** Open the conversation this row is: the row's own affordance. */
	onOpen: (sessionId: string) => void;
	/** Ask to cancel one armed wake; the page owns the confirmation. */
	onCancel: (row: ScheduledTaskRow, wake: WakeLine) => void;
	/** Open the editor for one armed wake. */
	onEdit: (row: ScheduledTaskRow, wake: WakeLine) => void;
	/** What the page knows about the chief of staff, for the guard
	 *  (`wake-controls-model.ts`): the same prop the pane's section takes. */
	identity: AidaWakeIdentity;
};

/**
 * The reveal an action column uses, in one place.
 *
 * Two selectors, not one: `group-hover` covers the pointer and
 * `group-focus-within` covers the keyboard, and a column that revealed on hover
 * alone would be unreachable by Tab (the app's own recorded defect - the row
 * actions of the surface this replaces had exactly this pair).
 */
const ACTION_REVEAL = [
	"pointer-events-none opacity-0",
	"group-hover:pointer-events-auto group-hover:opacity-100",
	"group-focus-within:pointer-events-auto group-focus-within:opacity-100",
];

/**
 * One wake line: the shared row, with the page's own controls.
 *
 * TWO actions, and the split is the point: `Edit wake` changes what the waking
 * turn is asked to do (and can re-anchor it), `Cancel wake` retires the
 * schedule. They are the same species of control - hover- and focus-revealed
 * like every other row action in the app - and only the destructive one is
 * tinted, because a tint on both would say they are equally final.
 *
 * A line the engine owns (`aida-*`) has NO cancel: the model's `managed`
 * verdict, read from the same function the pane's section reads, so the two
 * surfaces cannot disagree about a row. Its state rides the shared
 * `WakeManagedState` under the message; `Edit wake` stays, because the brief for
 * this slice is the cancel, and whether the edit is equally doomed is a separate
 * question tracked in the PR.
 */
const WakeLineItem: FC<{
	wake: WakeLine;
	managedName: string | null;
	onCancel: () => void;
	onEdit: () => void;
}> = ({ wake, managedName, onCancel, onEdit }) => (
	<WakeRowView
		row={wake}
		trailingClause={wake.ranLabel || undefined}
		/*
		 * The managed line wears the SAME pair as the pane's (design round 1's D2
		 * and the section's one-object-one-reading rule): the short state word in
		 * the control column, where the line's missing `Cancel` would have been,
		 * and the sentence — with the lever that works — as the line's note, so
		 * the page and the pane cannot come to explain the same row two ways.
		 */
		note={
			managedName === null ? undefined : <WakeManagedNote name={managedName} />
		}
		action={
			<>
				{managedName !== null && <WakeManagedState name={managedName} />}
				<Tooltip content="Edit wake">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Edit wake"
						onClick={onEdit}
						className={cn(
							...ACTION_REVEAL,
							"group-hover/wake:pointer-events-auto group-hover/wake:opacity-100",
							"group-focus-within/wake:pointer-events-auto group-focus-within/wake:opacity-100",
						)}
					>
						<SquarePen />
					</Button>
				</Tooltip>
				{managedName === null && (
					<Tooltip content="Cancel wake">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Cancel wake"
							onClick={onCancel}
							className={cn(
								...ACTION_REVEAL,
								"group-hover/wake:pointer-events-auto group-hover/wake:opacity-100",
								"group-focus-within/wake:pointer-events-auto group-focus-within/wake:opacity-100",
								"hover:bg-danger-wash hover:text-danger",
							)}
						>
							<X />
						</Button>
					</Tooltip>
				)}
			</>
		}
	/>
);

export const WakeConversationRow: FC<WakeConversationRowProps> = ({
	row,
	onOpen,
	onCancel,
	onEdit,
	identity,
}) => {
	const [expanded, setExpanded] = useState(false);
	const hidden = row.wakes.slice(row.visibleWakes.length);
	/*
	 * One classification per line, over THIS row's own list: the page and the
	 * pane read the same function with the same facts (`wakeControlMode`), so a
	 * line the engine owns reads the same on both surfaces.
	 */
	const context = {
		sessionId: row.sessionId,
		wakeIds: row.wakes.map((wake) => wake.id),
		aida: identity,
	};
	const managedNameFor = (wake: WakeLine): string | null =>
		wakeControlMode(wake.id, context) === "managed" ? identity.name : null;

	return (
		<li
			data-scheduled-task-row={row.sessionId}
			className={cn(
				"group border-hairline border-b px-4 py-3 last:border-b-0",
				"transition-colors duration-fast ease-out-quart hover:bg-row-hover",
			)}
		>
			<div className={cn("flex items-start gap-3")}>
				<div className={cn("flex min-w-0 flex-1 flex-col gap-1")}>
					{/* The head: the conversation, and the two facts about it that decide
					    whether the reader cares - how many wakes, and when the soonest
					    one fires (or that it is parked). */}
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

					{/* One step in from the name, and no second hairline: a wake line
					    belongs to the row above it, which the indent already says. */}
					<ul className={cn("flex flex-col gap-1 pl-4")}>
						{row.visibleWakes.map((wake) => (
							<WakeLineItem
								key={wake.id}
								wake={wake}
								managedName={managedNameFor(wake)}
								onCancel={() => onCancel(row, wake)}
								onEdit={() => onEdit(row, wake)}
							/>
						))}
					</ul>
					{hidden.length > 0 && (
						/* The count is in the label, so the control says how much it holds
						   without being pressed. The hidden lines ARE the content, closed
						   by default, which is this primitive's own rule. */
						<Disclosure
							summary={
								expanded ? "Show fewer" : hiddenWakesLabel(hidden.length)
							}
							onOpenChange={setExpanded}
							className={cn("pl-4")}
							triggerClassName={cn("text-ink-muted hover:text-ink")}
						>
							<ul className={cn("flex flex-col gap-1")}>
								{hidden.map((wake) => (
									<WakeLineItem
										key={wake.id}
										wake={wake}
										managedName={managedNameFor(wake)}
										onCancel={() => onCancel(row, wake)}
										onEdit={() => onEdit(row, wake)}
									/>
								))}
							</ul>
						</Disclosure>
					)}
				</div>

				<div
					className={cn("flex shrink-0 items-center gap-0.5", ...ACTION_REVEAL)}
				>
					<Tooltip content="Open conversation">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Open conversation"
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
